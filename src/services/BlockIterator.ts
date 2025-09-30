import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'
import { BlockHeader, Event, fromTendermintEvent } from '@cosmjs/stargate'
import { Tx } from '@dao-dao/types/protobuf/codegen/cosmos/tx/v1beta1/tx'
import { Any } from '@dao-dao/types/protobuf/codegen/google/protobuf/any'

import { AutoCosmWasmClient, batch, retry } from '@/utils'

import { ChainWebSocketListener } from './ChainWebSocketListener'

export type TxData = {
  height: number
  hash: string
  index: number
  code: number
  codespace?: string
  log?: string
  messages: Any[]
  events: Event[] | readonly Event[]
  responseData?: Uint8Array
  tx: Uint8Array
}

export interface BufferedBlockData {
  height: number
  block: BlockHeader
  txs: (TxData | BlockIteratorError)[]
}

export type BufferedItem = BufferedBlockData | BlockIteratorError

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
   * Whether or not to throw errors when a block/TX error is encountered.
   *
   * Default: true.
   */
  public readonly throwErrors: boolean = true

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
    bufferSize = 50,
    throwErrors = true,
  }: {
    rpcUrl: string
    autoCosmWasmClient: AutoCosmWasmClient
    startHeight?: number
    endHeight?: number
    bufferSize?: number
    throwErrors?: boolean
  }) {
    this.rpcUrl = rpcUrl
    this.autoCosmWasmClient = autoCosmWasmClient
    this._startHeight = startHeight
    this.endHeight = endHeight
    this.bufferSize = bufferSize
    this.throwErrors = throwErrors
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
    onBlock?: (block: BlockHeader) => void | Promise<void>
    onTx?: (tx: TxData, block: BlockHeader) => void | Promise<void>
    onError?: (error: BlockIteratorError) => void | Promise<void>
  }) {
    if (!onBlock && !onTx) {
      throw new Error('No callbacks provided')
    }

    const client = await this.autoCosmWasmClient.getValidClient()
    const { earliestBlockHeight = 0 } = (
      await client['forceGetCometClient']().status()
    ).syncInfo

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
    this.startFetching()

    try {
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

          if (this.throwErrors) {
            throw item
          }
        } else {
          // Emit block data.
          await onBlock?.(item.block)

          // Emit successful transactions and errors in order.
          for (const tx of item.txs) {
            if (tx instanceof BlockIteratorError) {
              await onError?.(tx)

              if (this.throwErrors) {
                throw tx
              }
            } else {
              await onTx?.(tx, item.block)
            }
          }
        }

        this.currentHeight++
      }
    } finally {
      this.stopFetching()
    }
  }

  /**
   * Stop the fetcher, letting the iterator finish. The `iterate` function will
   * resolve once buffer is empty and everything has been processed.
   */
  stopFetching() {
    this.fetching = false
    this.stopTrackingLatestBlockHeight()
  }

  /**
   * Fetch blocks and their transactions in parallel.
   */
  private async startFetching() {
    this.fetching = true
    this.fetchHeight = this.startHeight

    // Start tracking the latest block height.
    await this.startTrackingLatestBlockHeight()

    const fetchingBlocks: Promise<void>[] = []

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
        await new Promise((resolve) => setTimeout(resolve, 50))
        continue
      }

      // Fetch this block in parallel
      fetchingBlocks.push(this.fetchBlockData(this.fetchHeight))

      // Keep a reasonable number of concurrent requests
      if (fetchingBlocks.length >= this.bufferSize) {
        await Promise.allSettled(fetchingBlocks)
        fetchingBlocks.length = 0
      }

      this.fetchHeight++
    }

    // Wait for any remaining promises, to ensure the last block is processed
    // and items are buffered.
    await Promise.allSettled(fetchingBlocks)

    // Stop fetching.
    this.stopFetching()
  }

  /**
   * Fetch a single block and its transactions.
   */
  private async fetchBlockData(height: number): Promise<void> {
    try {
      // Fetch the block first.
      const block = await retry(
        30,
        async () => {
          const client = (await this.autoCosmWasmClient.getValidClient())[
            'forceGetCometClient'
          ]()
          const [{ block }, { results }] = await Promise.all([
            client.block(height),
            client.blockResults(height),
          ])
          return { ...block, results }
        },
        1_000
      )

      // Fetch transactions in parallel, batched 10 at a time.
      const txs: (TxData | BlockIteratorError)[] = []
      const batchSize = 10
      await batch({
        list: block.txs,
        batchSize,
        grouped: true,
        task: async (rawTxs, _, batchIndex) => {
          const batchTxs = (
            await Promise.all(
              rawTxs.map(
                async (
                  rawTx,
                  rawTxIndex
                ): Promise<TxData | BlockIteratorError | null> => {
                  const txIndex = batchIndex * batchSize + rawTxIndex

                  let txHash: string | undefined
                  try {
                    txHash = toHex(sha256(rawTx)).toUpperCase()

                    const txResult = block.results[txIndex]
                    // Should never happen if TX index is correct.
                    if (!txResult) {
                      throw new Error(
                        `TX ${txHash} (index ${txIndex}) not found in block ${height} results`
                      )
                    }

                    // Decode TX to get messages (unless TX parse error code 2).
                    const tx = txResult.code !== 2 ? Tx.decode(rawTx) : null

                    return {
                      height: block.header.height,
                      hash: txHash,
                      index: txIndex,
                      code: txResult.code,
                      codespace: txResult.codespace,
                      log: txResult.log,
                      messages: tx?.body?.messages ?? [],
                      events: txResult.events.map(fromTendermintEvent),
                      responseData: txResult.data,
                      tx: rawTx,
                    }
                  } catch (cause) {
                    return new BlockIteratorError(
                      BlockIteratorErrorType.Tx,
                      cause,
                      height,
                      txHash
                    )
                  }
                }
              )
            )
          ).filter((tx): tx is TxData | BlockIteratorError => tx !== null)
          txs.push(...batchTxs)
        },
      })

      // Buffer the block data with both successful TXs and errors.
      this.buffer.set(height, {
        block: {
          version: {
            app: block.header.version.app.toString(),
            block: block.header.version.block.toString(),
          },
          chainId: block.header.chainId,
          height: block.header.height,
          time: block.header.time.toISOString(),
        },
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
          const client = await this.autoCosmWasmClient.getValidClient()
          const height = await client.getHeight().catch(() => null)
          if (!height) {
            return
          }

          this.latestBlockHeight = height

          // Resolve if we receive a block and haven't resolved yet.
          if (!resolved) {
            resolved = true
            resolve()
          }
        }, 3_000)
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
