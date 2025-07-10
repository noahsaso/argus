import Router from '@koa/router'
import { Redis } from 'ioredis'

import { computeAggregator, getAggregator } from '@/aggregators'
import { ConfigManager, getRedis, testRedisConnection } from '@/config'
import { AccountKey, State } from '@/db'
import { Aggregator } from '@/types'

import { captureSentryException } from '../../sentry'

const IS_TEST = process.env.NODE_ENV === 'test'

// Map IP address to last time it was used.
const testRateLimit = new Map<string, number>()
const testCooldownSeconds = 10

export const loadAggregator = async () => {
  let _state = await State.getSingleton()
  if (!_state) {
    throw new Error('State not found')
  }

  let state = _state

  // Update state every second if not in test mode.
  if (!IS_TEST) {
    const updateState = async () => {
      try {
        const newState = await State.getSingleton()
        if (newState) {
          state = newState
        } else {
          console.error(
            '[aggregator] Failed to update state cache: state not found'
          )
        }
      } catch (err) {
        console.error('[aggregator] Unexpected error updating state cache', err)
      } finally {
        setTimeout(updateState, 1_000)
      }
    }

    console.log('Starting aggregator state updater...')
    await updateState()
  }

  // Create Redis connection if available.
  let redis: Redis | undefined
  if (await testRedisConnection()) {
    redis = getRedis({
      maxRetriesPerRequest: 1,
      connectTimeout: 5_000,
      commandTimeout: 2_000,
    })
  }

  const aggregator: Router.Middleware = async (ctx) => {
    const { ignoreApiKey } = ConfigManager.load()

    const args = ctx.query

    // Support both /a/:key/:aggregator and /a/:aggregator
    // with `key` in the `x-api-key` header.
    const paths = ctx.path.split('/').slice(2)
    let key: string | undefined
    let aggregatorName: string | undefined

    // When testing, load State every time.
    if (IS_TEST) {
      const _state = await State.getSingleton()
      if (!_state) {
        throw new Error('State not found')
      }

      state = _state
    }

    // if paths[0] is the current chainId, ignore it. this allows for
    // development backwards compatibility based on production proxy paths
    // (since indexer.daodao.zone/CHAIN_ID proxies to a different API-server
    // per-chain).
    if (paths.length > 0 && paths[0] === state.chainId) {
      paths.shift()
    }

    if (paths.length < 1) {
      ctx.status = 400
      ctx.body = 'missing required parameters'
      return
    }

    // /:aggregator
    if (ignoreApiKey || typeof ctx.headers['x-api-key'] === 'string') {
      key =
        typeof ctx.headers['x-api-key'] === 'string'
          ? ctx.headers['x-api-key']
          : undefined
      aggregatorName = paths.join('/')
    }
    // /:key/:aggregator
    else {
      key = paths[0]
      aggregatorName = paths.slice(1).join('/')
    }

    // Validate API key.
    let accountKey: AccountKey | null = null
    if (!ignoreApiKey) {
      if (!key) {
        ctx.status = 401
        ctx.body = 'missing API key'
        return
      }

      // Check if Redis has cached account key ID for API key.
      const accountKeyIdForApiKey = await redis?.get(
        `accountKeyIdForApiKey:${key}`
      )

      try {
        if (accountKeyIdForApiKey && !isNaN(Number(accountKeyIdForApiKey))) {
          accountKey = await AccountKey.findByPk(Number(accountKeyIdForApiKey))
        }

        // Fallback to finding account key by private key.
        if (!accountKey) {
          accountKey = await AccountKey.findForKey(key)

          // Save account key mapping to Redis, logging and ignoring errors.
          if (redis && accountKey) {
            redis
              .set(
                `accountKeyIdForApiKey:${key}`,
                accountKey.id,
                'EX',
                // expire in 7 days
                60 * 60 * 24 * 7
              )
              .catch(console.error)
          }
        }
      } catch (err) {
        console.error(err)
        ctx.status = 500
        ctx.body = 'internal server error'
        return
      }

      if (!accountKey) {
        ctx.status = 401
        ctx.body = 'invalid API key'
        return
      }
    }

    // If test account key, apply CORS and rate limit.
    if (accountKey?.isTest) {
      // CORS.
      if (ctx.req.headers['origin'] === 'http://localhost:3000') {
        ctx.set('Access-Control-Allow-Origin', 'http://localhost:3000')
      } else {
        ctx.set('Access-Control-Allow-Origin', 'https://indexer.zone')
      }

      // Remove old rate limited IPs.
      const now = Date.now()
      for (const [ip, lastUsed] of testRateLimit.entries()) {
        if (now - lastUsed >= testCooldownSeconds * 1000) {
          testRateLimit.delete(ip)
        }
      }

      // Rate limit.
      const lastUsed = testRateLimit.get(ctx.ip)
      if (lastUsed && now - lastUsed < testCooldownSeconds * 1000) {
        ctx.status = 429
        ctx.body = `${testCooldownSeconds} second test rate limit exceeded`
        return
      }
      testRateLimit.set(ctx.ip, now)
    }

    // Validate aggregatorName.
    if (!aggregatorName) {
      ctx.status = 400
      ctx.body = 'missing aggregator'
      return
    }

    // Validate that aggregator exists.

    let aggregator: Aggregator | undefined
    try {
      aggregator = getAggregator(aggregatorName)
    } catch (err) {
      console.error(err)
      ctx.status = 500
      ctx.body = 'internal server error'
      return
    }

    if (!aggregator) {
      ctx.status = 404
      ctx.body = 'aggregator not found'
      return
    }

    try {
      // Use account credit for aggregator computation
      if (
        accountKey &&
        !(await accountKey.useCredit(
          undefined,
          // Only wait for increment during testing. Otherwise let
          // increment in background while we compute/respond.
          IS_TEST
        ))
      ) {
        ctx.status = 402
        ctx.body = 'insufficient credits'
        return
      }

      // Compute aggregator
      const result = await computeAggregator({
        chainId: state.chainId,
        block: state.latestBlock,
        aggregator,
        args,
      })

      // If string, encode as JSON.
      if (typeof result.value === 'string') {
        ctx.body = JSON.stringify(result.value)
      } else {
        ctx.body = result.value
      }

      ctx.set('Content-Type', 'application/json')
      // Cache for 30 seconds since aggregators are more expensive
      ctx.set('Cache-Control', 'public, max-age=30')
    } catch (err) {
      console.error(err)

      ctx.status = 500
      ctx.body = err instanceof Error ? err.message : `${err}`

      captureSentryException(ctx, err, {
        tags: {
          key,
          aggregatorName,
          accountId: accountKey?.id,
          accountName: accountKey?.name,
        },
      })
    }
  }

  return aggregator
}
