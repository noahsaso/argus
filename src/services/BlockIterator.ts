import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'
import { Block, IndexedTx } from '@cosmjs/stargate'

import { AutoCosmWasmClient } from '@/utils'

import { ChainWebSocketListener } from './ChainWebSocketListener'

interface BufferedBlockData {
  height: number
  block: Block
  txs: IndexedTx[]
  /**
   * TX-specific errors that occurred within this block.
   */
  txErrors: Error[]
}

/**
 * Block-level error (entire block failed to load).
 */
interface BufferedBlockError {
  height: number
  error: Error
}

type BufferedItem = BufferedBlockData | BufferedBlockError

enum ErrorType {
  StartHeightTooLow = 'startHeightTooLow',
  Block = 'block',
  Tx = 'tx',
}

/**
 * Iterate over blocks and their transactions with parallel fetching and
 * sequential processing.
 */
export class BlockIterator {
  /**
   * The RPC url.
   */
  private readonly rpcUrl: string

  /**
   * The CosmWasm client.
   */
  private readonly autoCosmWasmClient: AutoCosmWasmClient

  /**
   * The start block height, if any. If not provided, the iterator will start
   * from 10 blocks after the earliest block the RPC endpoint has (in case the
   * earliest block gets pruned soon).
   */
  private startHeight: number = 0

  /**
   * The end block height, if any. If not provided, the iterator will not stop
   * until stopped.
   */
  private endHeight?: number

  /**
   * The current block height being processed.
   */
  private currentHeight: number = 0

  /**
   * Buffer to store prefetched blocks/transactions and errors mapped by height.
   */
  private buffer: Map<number, BufferedItem> = new Map()

  /**
   * Maximum number of blocks to buffer ahead.
   */
  private readonly bufferSize: number

  /**
   * Whether the fetcher is currently running.
   */
  private fetching: boolean = false

  /**
   * Height that the fetcher is currently working on.
   */
  private fetchHeight: number = 0

  /**
   * Latest block height of the chain.
   */
  private latestBlockHeight: number = 0

  /**
   * Whether the latest block height is being tracked.
   */
  private trackingLatestBlockHeight: boolean = false

  /**
   * Chain web socket listener.
   */
  private chainWebSocketListener: ChainWebSocketListener | null = null

  /**
   * Interval to check the latest block height. Used as fallback when the
   * websocket is not connected.
   */
  private latestBlockHeightInterval: NodeJS.Timeout | null = null

  constructor({
    rpcUrl,
    autoCosmWasmClient,
    startHeight = 0,
    endHeight,
    bufferSize = 10,
  }: {
    rpcUrl: string
    autoCosmWasmClient: AutoCosmWasmClient
    startHeight?: number
    endHeight?: number
    bufferSize?: number
  }) {
    this.rpcUrl = rpcUrl
    this.autoCosmWasmClient = autoCosmWasmClient
    this.startHeight = startHeight
    this.endHeight = endHeight
    this.bufferSize = bufferSize
  }

  /**
   * Start the iterator.
   */
  async iterate({
    onBlock,
    onTx,
    onError,
  }: {
    onBlock?: (block: Block) => void | Promise<void>
    onTx?: (tx: IndexedTx) => void | Promise<void>
    onError?: (type: ErrorType, error: Error) => void | Promise<void>
  }) {
    if (!onBlock && !onTx) {
      throw new Error('No callbacks provided')
    }

    await this.autoCosmWasmClient.update()
    if (!this.autoCosmWasmClient.client) {
      throw new Error('AutoCosmWasmClient is not initialized')
    }

    const { earliestBlockHeight } = (
      await this.autoCosmWasmClient.client['forceGetCometClient']().status()
    ).syncInfo
    if (!earliestBlockHeight) {
      throw new Error('Earliest block height is not available')
    }

    // Start height cannot be before the earliest block height—use 10 blocks
    // after the earliest block height in case the earliest block gets pruned
    // soon.
    const minStartHeight = earliestBlockHeight + 10

    // If start height is too low, notify the error callback and use the minimum
    // start height instead.
    if (this.startHeight > 0 && this.startHeight < minStartHeight) {
      await onError?.(
        ErrorType.StartHeightTooLow,
        new Error(
          `Start height ${this.startHeight} is too low, using ${minStartHeight}`
        )
      )
    }

    this.startHeight = Math.max(this.startHeight ?? 0, minStartHeight)

    // Fatal error if end height is less than start height.
    if (this.endHeight && this.endHeight < this.startHeight) {
      throw new Error(
        `End height ${this.endHeight} is less than start height ${this.startHeight}`
      )
    }

    // Start fetching blocks in parallel.
    this.fetching = true
    this.startFetching()

    // Process buffered items sequentially until the fetcher stops and the
    // buffer is empty.
    this.currentHeight = this.startHeight
    while (this.fetching || this.buffer.size > 0) {
      const item = this.buffer.get(this.currentHeight)

      // Wait a bit and retry.
      if (!item) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        continue
      }

      // If we got the item, delete it from the buffer.
      this.buffer.delete(this.currentHeight)

      if ('error' in item) {
        // This is a block-level error
        await onError?.(ErrorType.Block, item.error)
      } else {
        // This is block data (may include TX errors)
        await onBlock?.(item.block)

        // Process successful transactions
        for (const tx of item.txs) {
          await onTx?.(tx)
        }

        // Process TX-specific errors that occurred within this block
        for (const txError of item.txErrors) {
          await onError?.(ErrorType.Tx, txError)
        }
      }

      this.currentHeight++
    }
  }

  /**
   * Stop the fetcher, letting the iterator finish. The `iterate` function will
   * resolve once buffer is empty and everything has been processed.
   */
  stopIterating() {
    this.fetching = false
  }

  /**
   * Fetch blocks and their transactions in parallel.
   */
  private async startFetching() {
    this.fetching = true
    this.fetchHeight = this.startHeight

    // Start tracking the latest block height.
    await this.startTrackingLatestBlockHeight()

    const promises: Promise<void>[] = []

    while (
      this.fetching &&
      (!this.endHeight || this.fetchHeight <= this.endHeight)
    ) {
      if (
        // Wait if buffer is full.
        this.buffer.size >= this.bufferSize ||
        // Wait for the latest block height to be >= the fetch height.
        this.latestBlockHeight < this.fetchHeight
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        continue
      }

      // Fetch this block in parallel
      const promise = this.fetchBlockData(this.fetchHeight)
      promises.push(promise)

      // Keep a reasonable number of concurrent requests
      if (promises.length >= this.bufferSize) {
        await Promise.allSettled(promises)
        promises.length = 0
      }

      this.fetchHeight++
    }

    this.fetching = false

    // Stop tracking the latest block height.
    this.stopTrackingLatestBlockHeight()

    // Wait for any remaining promises
    await Promise.allSettled(promises)
  }

  /**
   * Fetch a single block and its transactions.
   */
  private async fetchBlockData(height: number): Promise<void> {
    try {
      if (!this.autoCosmWasmClient.client) {
        throw new Error('Client is undefined')
      }

      // Try to fetch the block first
      const block = await this.autoCosmWasmClient.client.getBlock(height)

      // Block loaded successfully, now fetch transactions
      const txs: IndexedTx[] = []
      const txErrors: Error[] = []

      // Fetch all transactions in parallel
      const txPromises = block.txs.map(async (rawTx) => {
        if (!this.autoCosmWasmClient.client) {
          throw new Error('Client is undefined')
        }

        const txHash = toHex(sha256(rawTx)).toUpperCase()
        const tx = await this.autoCosmWasmClient.client.getTx(txHash)
        if (!tx) {
          throw new Error(`Tx ${txHash} not found in block ${height}`)
        }

        return tx
      })

      const txResults = await Promise.allSettled(txPromises)

      // Separate successful TXs from TX-specific errors
      for (const result of txResults) {
        if (result.status === 'fulfilled') {
          txs.push(result.value)
        } else {
          txErrors.push(
            result.reason instanceof Error
              ? result.reason
              : new Error(String(result.reason))
          )
        }
      }

      // Buffer the block data with both successful TXs and TX errors
      this.buffer.set(height, {
        block,
        txs,
        txErrors,
        height,
      })
    } catch (error) {
      // If the error is that the height is greater than the current height,
      // wait a second and retry since the block may not have been committed
      // yet.
      if (
        error instanceof Error &&
        error.message.includes(
          'must be less than or equal to the current blockchain height'
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return this.fetchBlockData(height)
      }

      // Block-level error - the entire block failed to load
      this.buffer.set(height, {
        error: error instanceof Error ? error : new Error(String(error)),
        height,
      })
    }
  }

  /**
   * Start tracking the latest block height.
   */
  private async startTrackingLatestBlockHeight() {
    if (this.trackingLatestBlockHeight) {
      return
    }

    this.trackingLatestBlockHeight = true

    // Attempt to connect to the websocket, resolving on success. If it fails on
    // the first connection attempt, resolve. It will keep trying to reconnect
    // while interval polling is active.
    return new Promise<void>((resolve) => {
      this.chainWebSocketListener = new ChainWebSocketListener('NewBlock', {
        rpc: this.rpcUrl,
      })

      // Set up the callback to update the latest block height.
      this.chainWebSocketListener.onNewBlock(async (block) => {
        this.latestBlockHeight = Number(block.height)
      })

      // Detect WebSocket connection state changes to start/stop the fallback
      // polling mechanism.
      this.chainWebSocketListener.onConnectionStateChange(
        async ({ state, attempt }) => {
          switch (state) {
            case 'connected': {
              // Stop polling if the websocket is connected.
              if (this.latestBlockHeightInterval) {
                clearInterval(this.latestBlockHeightInterval)
                this.latestBlockHeightInterval = null
              }
              break
            }
            case 'error':
            case 'disconnected': {
              // If this is the first connection attempt and it failed, resolve.
              // It will keep trying to reconnect while interval polling is
              // active.
              if (attempt === 1) {
                resolve()
              }

              // Start polling if the websocket is disconnected and we're
              // supposed to be tracking the latest block height.
              if (
                this.trackingLatestBlockHeight &&
                !this.latestBlockHeightInterval
              ) {
                this.latestBlockHeightInterval = setInterval(async () => {
                  if (!this.autoCosmWasmClient.client) {
                    await this.autoCosmWasmClient.update()
                  }

                  const height =
                    await this.autoCosmWasmClient.client?.getHeight()
                  if (height) {
                    this.latestBlockHeight = height
                  }
                }, 1_000)
              }
              break
            }
          }
        }
      )

      // Connect to the websocket, resolving on success. Connection error
      // resolves above in the `onConnectionStateChange` handler.
      this.chainWebSocketListener.connect({ skipWait: true }).then(resolve)
    })
  }

  /**
   * Stop tracking the latest block height.
   */
  private stopTrackingLatestBlockHeight() {
    // Make sure the WebSocket disconnect handler doesn't start polling again.
    this.trackingLatestBlockHeight = false

    if (this.latestBlockHeightInterval) {
      clearInterval(this.latestBlockHeightInterval)
      this.latestBlockHeightInterval = null
    }

    if (this.chainWebSocketListener) {
      this.chainWebSocketListener.disconnect()
      this.chainWebSocketListener = null
    }
  }
}
