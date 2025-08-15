import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'
import { Block, IndexedTx } from '@cosmjs/stargate'

import { AutoCosmWasmClient, batch, retry } from '@/utils'

import { ChainWebSocketListener } from './ChainWebSocketListener'

interface BufferedBlockData {
  height: number
  block: Block
  txs: (IndexedTx | BlockIteratorError)[]
}

type BufferedItem = BufferedBlockData | BlockIteratorError

export enum BlockIteratorErrorType {
  StartHeightTooLow = 'startHeightTooLow',
  Block = 'block',
  Tx = 'tx',
}

export class BlockIteratorError extends Error {
  constructor(
    public readonly type: BlockIteratorErrorType,
    public readonly cause: unknown,
    public readonly blockHeight?: number,
    public readonly txHash?: string
  ) {
    super(
      cause
        ? cause instanceof Error
          ? cause.message
          : String(cause) || ''
        : ''
    )
    this.name = 'BlockIteratorError'
  }
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
  private _startHeight: number = 0

  /**
   * The end block height, if any. If not provided, the iterator will not stop
   * until stopped.
   */
  public readonly endHeight?: number

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
  public readonly bufferSize: number

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
   * Interval to check the latest block height. Used in addition to WebSocket,
   * in case it disconnects or stops working.
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
    this._startHeight = startHeight
    this.endHeight = endHeight
    this.bufferSize = bufferSize
  }

  get startHeight() {
    return this._startHeight
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
    onTx?: (tx: IndexedTx, block: Block) => void | Promise<void>
    onError?: (error: BlockIteratorError) => void | Promise<void>
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
        new BlockIteratorError(
          BlockIteratorErrorType.StartHeightTooLow,
          new Error(
            `Start height ${this.startHeight} is too low, using ${minStartHeight}`
          )
        )
      )
    }

    this._startHeight = Math.max(this.startHeight ?? 0, minStartHeight)

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

      // Emit block-level errors.
      if (item instanceof BlockIteratorError) {
        await onError?.(item)
      } else {
        // Emit block data.
        await onBlock?.(item.block)

        // Emit successful transactions and errors in order.
        for (const tx of item.txs) {
          if (tx instanceof BlockIteratorError) {
            await onError?.(tx)
          } else {
            await onTx?.(tx, item.block)
          }
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
      // Fetch the block first.
      const block = await retry(
        5,
        () => {
          if (!this.autoCosmWasmClient.client) {
            throw new Error('Client is undefined')
          }
          return this.autoCosmWasmClient.client.getBlock(height)
        },
        500
      )

      // Fetch transactions in parallel, batched 10 at a time.
      const txs: (IndexedTx | BlockIteratorError)[] = []
      await batch({
        list: block.txs,
        batchSize: 10,
        grouped: true,
        task: async (rawTxs) => {
          const batchTxs = await Promise.all(
            rawTxs.map(async (rawTx) => {
              let txHash: string | undefined
              try {
                txHash = toHex(sha256(rawTx)).toUpperCase()
                const tx = await retry(
                  5,
                  async (_, bail) => {
                    if (!this.autoCosmWasmClient.client) {
                      await this.autoCosmWasmClient.update()
                      if (!this.autoCosmWasmClient.client) {
                        bail('Client is undefined')
                        return
                      }
                    }
                    return this.autoCosmWasmClient.client.getTx(txHash!)
                  },
                  500
                )
                if (!tx) {
                  throw new Error(`Tx ${txHash} not found in block ${height}`)
                }

                return tx
              } catch (cause) {
                return new BlockIteratorError(
                  BlockIteratorErrorType.Tx,
                  cause,
                  height,
                  txHash
                )
              }
            })
          )
          txs.push(...batchTxs)
        },
      })

      // Buffer the block data with both successful TXs and errors.
      this.buffer.set(height, {
        block,
        txs,
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
      this.buffer.set(
        height,
        new BlockIteratorError(BlockIteratorErrorType.Block, error, height)
      )
    }
  }

  /**
   * Start tracking the latest block height. Resolves once the first block is
   * received and saved to `this.latestBlockHeight`.
   */
  private async startTrackingLatestBlockHeight() {
    if (this.trackingLatestBlockHeight) {
      return
    }

    this.trackingLatestBlockHeight = true

    // Resolves when the first block is received from either the WebSocket or
    // the interval polling.
    return new Promise<void>((resolve) => {
      let resolved = false

      // Start polling the latest block height.
      if (!this.latestBlockHeightInterval) {
        this.latestBlockHeightInterval = setInterval(async () => {
          if (!this.autoCosmWasmClient.client) {
            await this.autoCosmWasmClient.update()
          }

          const height = await this.autoCosmWasmClient.client?.getHeight()
          if (height) {
            this.latestBlockHeight = height

            // Resolve if we receive a block and haven't resolved yet.
            if (!resolved) {
              resolved = true
              resolve()
            }
          }
        }, 1_000)
      }

      // Attempt to connect to the websocket. If it fails on the first
      // connection attempt, resolve. It will keep trying to reconnect while
      // interval polling is active.
      this.chainWebSocketListener = new ChainWebSocketListener('NewBlock', {
        rpc: this.rpcUrl,
      })

      // Set up the callback to update the latest block height.
      this.chainWebSocketListener.onNewBlock(async ({ height }) => {
        this.latestBlockHeight = Number(height)
        // Resolve if we receive a block and haven't resolved yet.
        if (!resolved) {
          resolved = true
          resolve()
        }
      })

      // Detect WebSocket connection state changes to start/stop the fallback
      // polling mechanism.
      this.chainWebSocketListener.onConnectionStateChange(
        async ({ state, attempt }) => {
          switch (state) {
            case 'error':
            case 'disconnected': {
              // If this is the first connection attempt and it failed, resolve.
              // It will keep trying to reconnect while interval polling is
              // active.
              if (attempt === 1 && !resolved) {
                resolved = true
                resolve()
              }

              break
            }
          }
        }
      )

      // Connect to the websocket, resolving on success. Connection error
      // resolves above in the `onConnectionStateChange` handler.
      this.chainWebSocketListener.connect({ skipWait: true })
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
