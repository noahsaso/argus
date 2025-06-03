import Router from '@koa/router'
import { Redis } from 'ioredis'
import { Op } from 'sequelize'

import { ConfigManager, getRedis, testRedisConnection } from '@/config'
import {
  AccountKey,
  AccountKeyCredit,
  Computation,
  Contract,
  State,
  Validator,
  getBlockForTime,
  getFirstBlock,
} from '@/db'
import {
  compute,
  computeRange,
  getTypedFormula,
  typeIsFormulaTypeOrWallet,
} from '@/formulas'
import { WasmCodeService } from '@/services/wasm-codes'
import { Block, FormulaType, FormulaTypeValues } from '@/types'
import { validateBlockString } from '@/utils'

import { captureSentryException } from '../../sentry'

const IS_TEST = process.env.NODE_ENV === 'test'

// Map IP address to last time it was used.
const testRateLimit = new Map<string, number>()
const testCooldownSeconds = 10

export const loadComputer = async () => {
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
            '[computer] Failed to update state cache: state not found'
          )
        }
      } catch (err) {
        console.error('[computer] Unexpected error updating state cache', err)
      } finally {
        setTimeout(updateState, 1_000)
      }
    }

    console.log('Starting computer state updater...')
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

  const computer: Router.Middleware = async (ctx) => {
    const { ignoreApiKey } = ConfigManager.load()

    const {
      block: _block,
      blocks: _blocks,
      blockStep: _blockStep,
      time: _time,
      times: _times,
      timeStep: _timeStep,
      ...args
    } = ctx.query

    // Support both /:key/:type/:address/:formula and /:type/:address/:formula
    // with `key` in the `x-api-key` header.
    const paths = ctx.path.split('/').slice(1)
    let key: string | undefined
    let type: FormulaType | undefined
    let address: string | undefined
    let formulaName: string | undefined

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

    if (paths.length < 3) {
      ctx.status = 400
      ctx.body = 'missing required parameters'
      return
    }

    // Validate type, which may be one of the first two path items.

    // /:type/:address/:formula
    if (typeIsFormulaTypeOrWallet(paths[0])) {
      key =
        typeof ctx.headers['x-api-key'] === 'string'
          ? ctx.headers['x-api-key']
          : undefined
      // Backwards compatibility for deprecated wallet type.
      type = paths[0] === 'wallet' ? FormulaType.Account : paths[0]
      address = paths[1]
      formulaName = paths.slice(2).join('/')
    }
    // /:key/:type/:address/:formula
    else if (typeIsFormulaTypeOrWallet(paths[1])) {
      key = paths[0]
      // Backwards compatibility for deprecated wallet type.
      type = paths[1] === 'wallet' ? FormulaType.Account : paths[1]
      address = paths[2]
      formulaName = paths.slice(3).join('/')
    } else {
      ctx.status = 400
      ctx.body = `type must be one of: ${FormulaTypeValues.join(', ')}`
      return
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

    // Validate address.
    if (!address) {
      ctx.status = 400
      ctx.body = 'missing address'
      return
    }

    // Validate formulaName.
    if (!formulaName) {
      ctx.status = 400
      ctx.body = 'missing formula'
      return
    }

    // If block passed, validate.
    let block: Block | undefined
    if (_block && typeof _block === 'string') {
      try {
        block = validateBlockString(_block, 'block')
      } catch (err) {
        ctx.status = 400
        ctx.body = err instanceof Error ? err.message : err
        return
      }
    }

    // If blocks passed, validate that it's a range of two blocks.
    let blocks: [Block, Block] | undefined
    let blockStep: bigint | undefined
    if (_blocks && typeof _blocks === 'string') {
      const [startBlock, endBlock] = _blocks.split('..')
      if (!startBlock || !endBlock) {
        ctx.status = 400
        ctx.body = 'blocks must be a range of two blocks'
        return
      }

      try {
        blocks = [
          validateBlockString(startBlock, 'the start block'),
          validateBlockString(endBlock, 'the end block'),
        ]
      } catch (err) {
        ctx.status = 400
        ctx.body = err instanceof Error ? err.message : err
        return
      }

      if (
        blocks[0].height >= blocks[1].height ||
        blocks[0].timeUnixMs >= blocks[1].timeUnixMs
      ) {
        ctx.status = 400
        ctx.body = 'the start block must be before the end block'
        return
      }

      // If block step passed, validate.
      if (_blockStep && typeof _blockStep === 'string') {
        try {
          blockStep = BigInt(_blockStep)
          if (blockStep < 1) {
            throw new Error()
          }
        } catch (err) {
          ctx.status = 400
          ctx.body = 'block step must be a positive integer'
          return
        }
      }
    }

    // If time passed, validate.
    let time: bigint | undefined
    if (_time && typeof _time === 'string') {
      try {
        time = BigInt(_time)
        if (time < 0) {
          throw new Error()
        }
      } catch (err) {
        ctx.status = 400
        ctx.body = 'time must be an integer greater than or equal to zero'
        return
      }
    }

    // If times passed, validate that it's a range with either a start or a
    // start/end pair.
    let times: [bigint, bigint | undefined] | undefined
    let timeStep: bigint | undefined
    if (_times && typeof _times === 'string') {
      const [startTime, endTime] = _times.split('..')
      if (!startTime) {
        ctx.status = 400
        ctx.body =
          'times must be just a start time or both a start and end time'
        return
      }

      try {
        times = [BigInt(startTime), endTime ? BigInt(endTime) : undefined]
      } catch (err) {
        ctx.status = 400
        ctx.body = 'times must be integers'
        return
      }

      if (times[1] !== undefined && times[0] >= times[1]) {
        ctx.status = 400
        ctx.body = 'the start time must be less than the end time'
        return
      }

      // If time step passed, validate.
      if (_timeStep && typeof _timeStep === 'string') {
        try {
          const parsedStep = BigInt(_timeStep)
          if (parsedStep < 1) {
            throw new Error()
          }

          timeStep = parsedStep
        } catch (err) {
          ctx.status = 400
          ctx.body = 'time step must be a positive integer'
          return
        }
      }
    }

    // Validate that formula exists.
    let typedFormula
    try {
      typedFormula = getTypedFormula(type, formulaName)
    } catch (err) {
      if (err instanceof Error && err.message.includes('Formula not found')) {
        ctx.status = 404
        ctx.body = 'formula not found'
      } else {
        console.error(err)
        ctx.status = 500
        ctx.body = 'internal server error'
      }
      return
    }

    try {
      // If type is "contract"...
      if (typedFormula.type === FormulaType.Contract) {
        const contract = await Contract.findByPk(address)

        // ...validate that contract exists.
        if (!contract) {
          ctx.status = 404
          ctx.body = 'contract not found'
          return
        }

        // ...validate that filter is satisfied.
        if (typedFormula.formula.filter) {
          let allowed = true

          if (typedFormula.formula.filter.codeIdsKeys?.length) {
            const codeIdKeys = typedFormula.formula.filter.codeIdsKeys

            allowed &&= WasmCodeService.getInstance()
              .findWasmCodeIdsByKeys(...codeIdKeys)
              .includes(contract.codeId)
          }

          if (!allowed) {
            ctx.status = 405
            ctx.body = `the ${formulaName} formula does not apply to contract ${address}`
            return
          }
        }
      }
      // ...if type is "validator"...
      else if (typedFormula.type === FormulaType.Validator) {
        const validator = await Validator.findByPk(address)

        // ...validate that validator exists.
        if (!validator) {
          ctx.status = 404
          ctx.body = 'validator not found'
          return
        }
      }

      // If formula is dynamic, we can't compute it over a range since we need
      // specific blocks to compute it for.
      if (typedFormula.formula.dynamic && (blocks || times)) {
        ctx.status = 400
        ctx.body =
          'cannot compute dynamic formula over a range (compute it for a specific block/time instead)'
        return
      }

      let computation

      const computationWhere = {
        targetAddress: address,
        formula: formulaName,
        args: JSON.stringify(args),
      }

      const currentTime = Date.now()

      // If time passed, compute block that correlates with that time.
      if (time) {
        // If time is negative, subtract from current time.
        if (time < 0) {
          time += BigInt(currentTime)
        }

        block = await getBlockForTime(time)
      }

      // If times passed, compute blocks that correlate with those times.
      if (times && !accountKey?.isTest) {
        // If times are negative, subtract from current time.
        if (times[0] < 0) {
          times[0] += BigInt(currentTime)
        }
        if (times[1] && times[1] < 0) {
          times[1] += BigInt(currentTime)
        }

        const startBlock =
          (await getBlockForTime(times[0])) ??
          // Use first block if no event exists before start time.
          (await getFirstBlock())
        // Use latest block if no end time exists.
        const endBlock = times[1]
          ? await getBlockForTime(times[1])
          : state.latestBlock

        if (startBlock && endBlock) {
          blocks = [startBlock, endBlock]
        }
      }

      // If blocks passed, compute range. A range query will probably return
      // with an initial block below the requested start block. This is because
      // the formula output that's valid at the provided start block depends on
      // key events that happened in the past. Each computation in the range
      // indicates what block it was first valid at, so the first one should
      // too.
      if (blocks && !accountKey?.isTest) {
        // Cap end block at latest block.
        if (blocks[1].height > BigInt(state.latestBlockHeight)) {
          blocks[1] = state.latestBlock
        }

        // Use account credit, ignoring/failing if unavailable.
        if (
          accountKey &&
          !(await accountKey.useCredit(
            AccountKeyCredit.creditsForBlockInterval(
              // Add 1n because both blocks are inclusive.
              blocks[1].height - blocks[0].height + 1n
            )
          ))
        ) {
          ctx.status = 402
          ctx.body = 'insufficient credits'
          return
        }

        let outputs: {
          value: any
          blockHeight: bigint
          blockTimeUnixMs: bigint
        }[] = []

        // Find existing start and end computations, and verify all are valid
        // between. If not, compute range.
        let existingUsed = false

        // Only check existing computations if a step is not defined. Otherwise
        // just compute again.
        if (blockStep === undefined && timeStep === undefined) {
          const existingStartComputation = await Computation.findOne({
            where: {
              ...computationWhere,
              blockHeight: {
                [Op.lte]: blocks[0].height,
              },
            },
            order: [['blockHeight', 'DESC']],
          })
          // If start computation exists, check the rest.
          if (existingStartComputation) {
            const existingRestComputations = await Computation.findAll({
              where: {
                ...computationWhere,
                blockHeight: {
                  [Op.gt]: blocks[0].height,
                  [Op.lte]: blocks[1].height,
                },
              },
              order: [['blockHeight', 'ASC']],
            })

            // Ensure entire range is covered by checking if validations are
            // chained. In other words, check that each computation is valid up
            // until the block just before the next computation starts.
            let existingComputations = [
              existingStartComputation,
              ...existingRestComputations,
            ]
            const isRangeCoveredBeforeEnd = existingComputations.every(
              (computation, i) =>
                i === existingComputations.length - 1 ||
                BigInt(computation.latestBlockHeightValid) ===
                  BigInt(existingComputations[i + 1].blockHeight) - 1n
            )

            // If range is covered, ensure that the end computation is valid at
            // the end block.
            let entireRangeValid =
              isRangeCoveredBeforeEnd &&
              (await existingComputations[
                existingComputations.length - 1
              ].updateValidityUpToBlockHeight(blocks[1].height))

            // If range is covered until the end, we are dealing with an
            // incomplete but continuous range. Load just the rest.
            if (isRangeCoveredBeforeEnd && !entireRangeValid) {
              let missingComputations
              // Formula errors are likely user errors, so just return 400.
              try {
                missingComputations = await computeRange({
                  ...typedFormula,
                  chainId: state.chainId,
                  targetAddress: address,
                  args,
                  // Start at the block of the last existing computation, since
                  // we need the block time to perform computations but cannot
                  // retrieve that information with just
                  // `latestBlockHeightValid`.
                  blockStart:
                    existingComputations[existingComputations.length - 1].block,
                  blockEnd: blocks[1],
                  blockStep,
                  timeStep,
                })
              } catch (err) {
                ctx.status = 400
                ctx.body = err instanceof Error ? err.message : `${err}`
                return
              }

              // Ignore first computation since it's equivalent to the last
              // existing computation.
              missingComputations.shift()

              // Cache computations for future queries.
              const createdMissingComputations =
                await Computation.createFromComputationOutputs(
                  address,
                  typedFormula,
                  args,
                  missingComputations
                )

              // Avoid using push(...items) since there is a limit to the number
              // of arguments that can be put on the stack, and the number of
              // computations may be very large.
              existingComputations = [
                ...existingComputations,
                ...createdMissingComputations,
              ]

              // Validate final computation.
              entireRangeValid = await existingComputations[
                existingComputations.length - 1
              ].updateValidityUpToBlockHeight(blocks[1].height)
            }

            if (entireRangeValid) {
              outputs = existingComputations.map(({ block, output }) => ({
                value: output && JSON.parse(output),
                blockHeight: block.height ?? -1n,
                blockTimeUnixMs: block.timeUnixMs ?? -1n,
              }))
              existingUsed = true
            }
          }
        }

        // If could not find existing range, compute.
        if (!existingUsed) {
          let rangeComputations
          // Formula errors are likely user errors, so just return 400.
          try {
            rangeComputations = await computeRange({
              ...typedFormula,
              chainId: state.chainId,
              targetAddress: address,
              args,
              blockStart: blocks[0],
              blockEnd: blocks[1],
              blockStep,
              timeStep,
            })
          } catch (err) {
            ctx.status = 400
            ctx.body = err instanceof Error ? err.message : `${err}`
            return
          }

          outputs = rangeComputations.map(({ block, ...data }) => ({
            ...data,
            // If no block, the computation must not have accessed any keys. It
            // may be a constant formula, in which case it doesn't have any
            // block context.
            blockHeight: block?.height ?? -1n,
            blockTimeUnixMs: block?.timeUnixMs ?? -1n,
            // Remove dependencies and latest block height valid from output.
            dependencies: undefined,
            latestBlockHeightValid: undefined,
          }))

          // Don't cache range computations automatically. // Cache computations
          // for future queries. await Computation.createFromComputationOutputs(
          // address, typedFormula, args, rangeComputations
          // )
        }

        let response: {
          at?: string
          value: any
          // TODO: Turn into strings?
          blockHeight: number
          blockTimeUnixMs: number
        }[] = []
        // Skip to match step.
        if (
          (blockStep === undefined || blockStep === 1n) &&
          (timeStep === undefined || timeStep === 1n)
        ) {
          response = outputs.map(({ value, blockHeight, blockTimeUnixMs }) => ({
            value,
            blockHeight: Number(blockHeight),
            blockTimeUnixMs: Number(blockTimeUnixMs),
          }))
        } else if (blockStep) {
          for (
            let blockHeight = blocks[0].height;
            blockHeight <= blocks[1].height;
            blockHeight =
              // Prevent infinite loop.
              blockHeight === blocks[1].height
                ? blockHeight + 1n
                : // Make sure to include the last block.
                blockHeight + blockStep > blocks[1].height
                ? blocks[1].height
                : // Increment normally.
                  blockHeight + blockStep
          ) {
            // Sorted ascending by block, so find first computation with block
            // height greater than desired block height and use the previous to
            // get the latest value at the target block height. If not found,
            // use the last one.
            let index = outputs.findIndex((c) => c.blockHeight > blockHeight)
            if (index === -1) {
              index = outputs.length
            }
            if (index > 0) {
              const output = outputs[index - 1]
              response.push({
                at: blockHeight.toString(),
                value: output.value,
                blockHeight: Number(output.blockHeight),
                blockTimeUnixMs: Number(output.blockTimeUnixMs),
              })
              // Remove all computations before the one we just added, keeping
              // the current one in case nothing has changed in the next step.
              outputs.splice(0, index - 1)
            }
          }
        } else if (times && timeStep) {
          const endTimeUnixMs = times[1] ?? blocks[1].timeUnixMs
          for (
            let blockTime = times[0];
            blockTime <= endTimeUnixMs;
            blockTime =
              // Prevent infinite loop.
              blockTime === endTimeUnixMs
                ? blockTime + 1n
                : // Make sure to include the last block.
                blockTime + timeStep > endTimeUnixMs
                ? endTimeUnixMs
                : // Increment normally.
                  blockTime + timeStep
          ) {
            // Sorted ascending by block, so find first computation with block
            // time greater than desired block time and use the previous to get
            // the latest value at the target block time. If not found, use the
            // last one.
            let index = outputs.findIndex((c) => c.blockTimeUnixMs > blockTime)
            if (index === -1) {
              index = outputs.length
            }
            if (index > 0) {
              const output = outputs[index - 1]
              response.push({
                at: blockTime.toString(),
                value: output.value,
                blockHeight: Number(output.blockHeight),
                blockTimeUnixMs: Number(output.blockTimeUnixMs),
              })
              // Remove all computations before the one we just added, keeping
              // the current one in case nothing has changed in the next step.
              outputs.splice(0, index - 1)
            }
          }
        }

        computation = response
      } else {
        // Otherwise compute for single block.

        // DISABLE USING CACHED COMPUTATIONS FOR SINGLE QUERIES FOR NOW.

        // // Get most recent computation if this formula does not change each
        // block. const existingComputation = typedFormula.formula.dynamic ?
        // null : await Computation.findOne({ where: { ...computationWhere,
        // blockHeight: { [Op.lte]: block.height,
        //         },
        //       },
        //       order: [['blockHeight', 'DESC']],
        //     })

        // // If found existing computation, check its validity. const
        // existingComputationValid = existingComputation !== null && (await
        // existingComputation.updateValidityUpToBlockHeight(block.height))

        // if (existingComputation && existingComputationValid) { computation =
        //   existingComputation.output &&
        //   JSON.parse(existingComputation.output) } else { Compute if did not
        //   find or use existing.

        // Parallelize credit check and computation. If credit check fails,
        // return failure immediately. Otherwise, continue with computation.
        const [creditResult, computationResult] = await Promise.allSettled([
          // If no account key, assume credit is available.
          accountKey
            ?.useCredit(
              undefined,
              // Only wait for increment during testing. Otherwise let
              // increment in background while we compute/respond.
              IS_TEST
            )
            .catch((err) => {
              console.error('Error checking credit', err)
              return true
            }) || Promise.resolve(true),

          // Computation with proper block handling
          compute({
            ...typedFormula,
            chainId: state.chainId,
            targetAddress: address,
            args,
            block: block || state.latestBlock,
          }),
        ])

        // Handle credit check result. If failed, just ignore (should be
        // impossible since errors are handled above).
        if (creditResult.status === 'fulfilled' && !creditResult.value) {
          ctx.status = 402
          ctx.body = 'insufficient credits'
          return
        }

        // Handle computation result.
        if (computationResult.status === 'rejected') {
          console.error(computationResult.reason)
          ctx.status = 400
          ctx.body =
            computationResult.reason instanceof Error
              ? computationResult.reason.message
              : `${computationResult.reason}`
          return
        }

        // Store computation result if everything succeeded.
        computation = computationResult.value.value

        //   // Cache computation for future queries if this formula does not
        //   change // each block and if it outputted a non-undefined/non-null
        //   value. if ( !typedFormula.formula.dynamic &&
        //   computationOutput.value !== undefined && computationOutput.value
        //   !== null
        //   ) {
        //     await Computation.createFromComputationOutputs( address,
        //       typedFormula, args,
        //       [
        //         {
        //           ...computationOutput,
        //           // Valid up to the current block.
        //           latestBlockHeightValid: block.height,
        //         },
        //       ]
        //     )
        //   }
        // }
      }

      // If string, encode as JSON.
      if (typeof computation === 'string') {
        ctx.body = JSON.stringify(computation)
      } else {
        ctx.body = computation
      }

      ctx.set('Content-Type', 'application/json')
      // Cache for 5 seconds, about 1 block.
      ctx.set('Cache-Control', 'public, max-age=5')
    } catch (err) {
      console.error(err)

      ctx.status = 500
      ctx.body = err instanceof Error ? err.message : `${err}`

      captureSentryException(ctx, err, {
        tags: {
          key,
          type,
          address,
          formulaName,
          accountId: accountKey?.id,
          accountName: accountKey?.name,
        },
      })
    }
  }

  return computer
}
