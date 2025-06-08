import * as Sentry from '@sentry/node'
import { LRUCache } from 'lru-cache'

import { State } from '@/db'
import { TracedEvent } from '@/types'
import { AutoCosmWasmClient, retry } from '@/utils'

import { ChainWebSocketListener } from './ChainWebSocketListener'

export class BlockTimeFetcher {
  /**
   * Cache block height to time.
   */
  public readonly cache = new LRUCache<number, number>({
    max: 1_000,
  })

  /**
   * The time out waiting for a block to be added to the cache.
   */
  private readonly timeoutMs: number

  constructor(
    /**
     * The CosmWasm client for querying the chain.
     */
    private readonly autoCosmWasmClient: AutoCosmWasmClient,
    /**
     * The WebSocket listener.
     */
    private readonly webSocketListener: ChainWebSocketListener,
    /**
     * Options.
     */
    options: {
      /**
       * The timeout in milliseconds waiting for a block to be added to the
       * cache. Defaults to 3 seconds (3,000ms).
       */
      timeoutMs?: number
    } = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 3_000
  }

  /**
   * Get the block time for a given trace.
   */
  async fetch(trace: TracedEvent): Promise<number> {
    const { blockHeight } = trace.metadata

    // If not in cache but WebSocket is connected and every block is less than
    // the current one, wait for it to be added to the cache. We might be just a
    // moment ahead of the new block event.
    if (!this.cache.has(blockHeight) && this.webSocketListener.connected) {
      const blockHeights = this.cache.dump().map(([key]) => key)
      if (blockHeights.every((b) => b < blockHeight)) {
        const time = await new Promise<number | undefined>((resolve) => {
          const interval = setInterval(() => {
            if (this.cache.has(blockHeight)) {
              clearInterval(interval)
              clearTimeout(timeout)
              resolve(this.cache.get(blockHeight))
            }
          }, 50)

          const timeout = setTimeout(() => {
            const blockHeights = this.cache.dump().map(([key]) => key)
            const earliestBlockHeight = blockHeights.reduce(
              (acc, curr) => (curr < acc ? curr : acc),
              Infinity
            )
            const latestBlockHeight = blockHeights.reduce(
              (acc, curr) => (curr > acc ? curr : acc),
              -Infinity
            )

            console.log(
              `[${new Date().toISOString()}] Timed out waiting for ${blockHeight.toLocaleString()}'s time... (${earliestBlockHeight.toLocaleString()} — ${latestBlockHeight.toLocaleString()})`
            )
            clearInterval(interval)
            resolve(undefined)
          }, this.timeoutMs)
        })

        if (time !== undefined) {
          return time
        }
      }
    }

    if (this.cache.has(blockHeight)) {
      return this.cache.get(blockHeight) ?? 0
    }

    // This may fail if the RPC does not have the block info at this height
    // anymore (i.e. if it's too old and the RPC pruned it).
    const loadIntoCache = async () => {
      try {
        if (this.autoCosmWasmClient.client) {
          const {
            header: { time },
          } = await this.autoCosmWasmClient.client.getBlock(blockHeight)
          this.cache.set(blockHeight, Date.parse(time))
        } else {
          throw new Error(
            `CosmWasm client not connected, cannot get block time for ${blockHeight.toLocaleString()}.`
          )
        }
      } catch (err) {
        // If the block is not available because it's too low, do nothing so we
        // don't retry.
        if (
          err instanceof Error &&
          err.message.includes('is not available, lowest height is')
        ) {
          return
        }

        throw err
      }
    }

    try {
      await retry(3, loadIntoCache, 250)
    } catch (err) {
      console.error(
        '-------\nFailed to get block:\n',
        err instanceof Error ? err.message : err,
        '\nBlock height: ' +
          BigInt(blockHeight).toLocaleString() +
          '\nData: ' +
          JSON.stringify(trace, null, 2) +
          '\n-------'
      )

      Sentry.captureException(err, {
        tags: {
          type: 'failed-get-block',
          script: 'tracer',
          chainId:
            (await State.getSingleton().catch(() => null))?.chainId ??
            'unknown',
        },
        extra: {
          trace,
          blockHeight,
        },
      })

      // Set to 0 on failure so we can continue.
      this.cache.set(blockHeight, 0)
    }

    return this.cache.get(blockHeight) ?? 0
  }
}
