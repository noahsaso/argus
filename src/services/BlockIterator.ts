import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'
import { BlockHeader, Event, fromTendermintEvent } from '@cosmjs/stargate'
import { Tx } from '@dao-dao/types/protobuf/codegen/cosmos/tx/v1beta1/tx'
import { Any } from '@dao-dao/types/protobuf/codegen/google/protobuf/any'

import {
  AutoCosmWasmClient,
  BackoffOptions,
  RpcErrorKind,
  batch,
  classifyRpcError,
  getBackoffDelayMs,
  retry,
} from '@/utils'

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
 * Raised as the cause of a block error when a block kept failing with
 * transient RPC errors for longer than the allowed retry duration.
 */
export class TransientRetryExhaustedError extends Error {
  constructor(
    public readonly blockHeight: number,
    public readonly elapsedMs: number,
    public readonly attempts: number,
    public readonly cause: unknown
  ) {
    super(
      `Block ${blockHeight} still failing with transient RPC errors after ${Math.round(
        elapsedMs / 1_000
      )}s and ${attempts} attempts: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    )
    this.name = 'TransientRetryExhaustedError'
  }
}

/**
 * Passed to `onRetryWarning` when fetching a block has been failing with
 * transient errors for longer than `transientRetry.warnAfterMs`.
 */
export type BlockRetryWarning = {
  blockHeight: number
  /**
   * How long this block has been retrying.
   */
  elapsedMs: number
  /**
   * Number of failed attempts that hit a transient error.
   */
  attempts: number
  /**
   * The most recent error.
   */
  error: unknown
}

export type TransientRetryOptions = BackoffOptions & {
  /**
   * Warn once a block has been retrying for this long. Default 1 minute.
   */
  warnAfterMs?: number
  /**
   * Repeat the warning at most this often while the block keeps retrying.
   * Default 5 minutes.
   */
  warnIntervalMs?: number
  /**
   * Give up and raise a block error once a block has been retrying for this
   * long, so a permanently unavailable height is not a silent stall. Default
   * 30 minutes.
   */
  maxDurationMs?: number
}

/**
 * Thrown internally when a fetch is abandoned because the iterator stopped.
 */
class FetchAbandonedError extends Error {}

/**
 * Iterate over blocks and their transactions with parallel fetching and
 * sequential processing.
 *
 * Transient RPC errors while fetching a block (results not stored yet, HTTP
 * 5xx, timeouts and connection resets) are retried with exponential backoff
 * until `transientRetry.maxDurationMs`. Other errors are retried 30 times, 1
 * second apart, before becoming a block error.
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
   * Default: true for block and tx.
   */
  public readonly throwErrors: {
    block: boolean
    tx: boolean
  } = {
    block: true,
    tx: true,
  }

  /**
   * Whether the fetcher is currently running.
   */
  private fetching: boolean = false

  /**
   * Whether `stopFetching` has been called. Unlike `fetching`, which is false
   * until the fetcher starts, this also covers startup, so a stop requested
   * while `iterate` is still retrying startup RPC calls is not lost.
   */
  private stopRequested: boolean = false

  /**
   * Callbacks to run once `stopFetching` is called, one per operation that is
   * waiting and should be interrupted (a startup attempt, a block fetch attempt
   * or a backoff sleep). Each operation removes its callback when it settles,
   * so completed operations and their results are not kept alive.
   */
  private readonly stopListeners = new Set<() => void>()

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

  /**
   * How to retry transient RPC errors while fetching a block.
   */
  public readonly transientRetry: Required<TransientRetryOptions>

  /**
   * Lowest height whose fetch was abandoned because the iterator stopped. The
   * processor stops before this height since it will never be buffered.
   */
  private abandonedHeight: number | null = null

  /**
   * Callback for long transient retries, set by `iterate`.
   */
  private onRetryWarning?: (warning: BlockRetryWarning) => void | Promise<void>

  constructor({
    rpcUrl,
    autoCosmWasmClient,
    startHeight = 0,
    endHeight,
    bufferSize = 50,
    throwErrors: { block = true, tx = true } = {},
    transientRetry: {
      initialDelayMs = 1_000,
      maxDelayMs = 30_000,
      warnAfterMs = 60_000,
      warnIntervalMs = 5 * 60_000,
      maxDurationMs = 30 * 60_000,
    } = {},
  }: {
    rpcUrl: string
    autoCosmWasmClient: AutoCosmWasmClient
    startHeight?: number
    endHeight?: number
    bufferSize?: number
    throwErrors?: {
      block?: boolean
      tx?: boolean
    }
    transientRetry?: TransientRetryOptions
  }) {
    this.rpcUrl = rpcUrl
    this.autoCosmWasmClient = autoCosmWasmClient
    this._startHeight = startHeight
    this.endHeight = endHeight
    this.bufferSize = bufferSize
    this.throwErrors = { block, tx }
    this.transientRetry = {
      initialDelayMs,
      maxDelayMs,
      warnAfterMs,
      warnIntervalMs,
      maxDurationMs,
    }
  }

  get startHeight() {
    return this._startHeight
  }

  /**
   * Start the iterator.
   *
   * `onBlockProcessed` is called after `onBlock` and `onTx` have finished for
   * every transaction in a block, so it marks the block as fully processed.
   *
   * `onRetryWarning` is called when a block has been retrying transient errors
   * for longer than `transientRetry.warnAfterMs`, and again every
   * `transientRetry.warnIntervalMs` while it keeps failing.
   */
  async iterate({
    onBlock,
    onTx,
    onBlockProcessed,
    onError,
    onRetryWarning,
  }: {
    onBlock?: (block: BlockHeader) => void | Promise<void>
    onTx?: (tx: TxData, block: BlockHeader) => void | Promise<void>
    onBlockProcessed?: (block: BlockHeader) => void | Promise<void>
    onError?: (error: BlockIteratorError) => void | Promise<void>
    onRetryWarning?: (warning: BlockRetryWarning) => void | Promise<void>
  }) {
    if (!onBlock && !onTx) {
      throw new Error('No callbacks provided')
    }

    this.onRetryWarning = onRetryWarning
    this.abandonedHeight = null

    // Retry transient RPC errors at startup (such as a 502 from the RPC proxy)
    // with backoff instead of halting. If the iterator is stopped meanwhile,
    // return without fetching anything.
    const startup = await this.retryTransientStartup(async () => {
      const client = await this.autoCosmWasmClient.getValidClient()
      const status = await client['forceGetCometClient']().status()
      return { client, status }
    })
    if (!startup) {
      return
    }
    const { client, status } = startup
    let { earliestBlockHeight = 0 } = status.syncInfo

    // Sometimes earliest block height is incorrectly reported as 0 (xion). If
    // so, try to find the earliest block height by forcing an error.
    if (earliestBlockHeight === 0) {
      try {
        await client.getBlock(1)
        earliestBlockHeight = 1
      } catch (error) {
        // {"code":-32603,"message":"Internal error","data":"height 10 is not available, lowest height is 9675000"}
        const data = error instanceof Error ? error.message : String(error)
        const match = data.match(
          /height 1 is not available, lowest height is (\d+)/
        )
        if (match && match.length > 1) {
          earliestBlockHeight = Number(match[1])
          console.debug(
            'Found correct earliest block height from error:',
            earliestBlockHeight
          )
        } else {
          throw error
        }
      }
    }

    if (earliestBlockHeight === 0) {
      throw new Error(
        'Could not find earliest block height due to /status endpoint returning 0. This is likely due to a bug in the RPC endpoint.'
      )
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

    // Don't start fetching if the iterator was stopped during startup.
    if (this.stopRequested) {
      return
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
          // If the fetch for this height was abandoned because the iterator
          // stopped, it will never arrive, so stop processing.
          if (
            !this.fetching &&
            this.abandonedHeight !== null &&
            this.currentHeight >= this.abandonedHeight
          ) {
            break
          }

          await new Promise((resolve) => setTimeout(resolve, 10))
          continue
        }

        // If we got the item, delete it from the buffer.
        this.buffer.delete(this.currentHeight)

        // Emit block-level errors.
        if (item instanceof BlockIteratorError) {
          await onError?.(item)

          if (this.throwErrors.block) {
            throw item
          }
        } else {
          // Emit block data.
          await onBlock?.(item.block)

          // Emit successful transactions and errors in order.
          for (const tx of item.txs) {
            if (tx instanceof BlockIteratorError) {
              await onError?.(tx)

              if (this.throwErrors.tx) {
                throw tx
              }
            } else {
              await onTx?.(tx, item.block)
            }
          }

          await onBlockProcessed?.(item.block)
        }

        this.currentHeight++
      }
    } finally {
      this.haltFetching()
    }
  }

  /**
   * Stop the fetcher, letting the iterator finish. The `iterate` function will
   * resolve once buffer is empty and everything has been processed. If called
   * while `iterate` is still starting up (for example retrying an RPC outage),
   * `iterate` resolves without fetching any blocks. A stopped iterator does not
   * start again.
   */
  stopFetching() {
    this.stopRequested = true
    const listeners = [...this.stopListeners]
    this.stopListeners.clear()
    listeners.forEach((listener) => listener())
    this.haltFetching()
  }

  /**
   * Stop the fetcher and stop tracking the latest block height.
   */
  private haltFetching() {
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
    this.haltFetching()
  }

  /**
   * Fetch a block and its results, retrying until success, a non-transient
   * error, the transient retry limit, or the iterator stopping.
   */
  private async fetchBlockWithRetries(height: number) {
    const {
      initialDelayMs,
      maxDelayMs,
      warnAfterMs,
      warnIntervalMs,
      maxDurationMs,
    } = this.transientRetry
    const startedAt = Date.now()
    let transientAttempts = 0
    let lastWarnedAt: number | null = null

    while (true) {
      // Don't start another attempt once the iterator has been stopped.
      if (this.stopRequested) {
        throw new FetchAbandonedError()
      }

      try {
        // Retry non-transient errors 30 times, 1 second apart, as before.
        // Transient errors bail out to the backoff loop below.
        return await retry(
          30,
          async (_, bail) => {
            try {
              if (this.stopRequested) {
                throw new FetchAbandonedError()
              }

              // Stop waiting as soon as the iterator is stopped, since
              // getting a valid client may itself be retrying a connection.
              return await this.abandonOnStop(
                (async () => {
                  const client = (
                    await this.autoCosmWasmClient.getValidClient()
                  )['forceGetCometClient']()
                  const [{ block }, { results }] = await Promise.all([
                    client.block(height),
                    client.blockResults(height),
                  ])
                  return { ...block, results }
                })()
              )
            } catch (err) {
              if (
                err instanceof FetchAbandonedError ||
                classifyRpcError(err) !== RpcErrorKind.Other
              ) {
                bail(err instanceof Error ? err : new Error(String(err)))
              }
              throw err
            }
          },
          1_000
        )
      } catch (error) {
        if (error instanceof FetchAbandonedError) {
          throw error
        }

        const kind = classifyRpcError(error)
        if (kind === RpcErrorKind.Other) {
          throw error
        }

        if (!this.fetching) {
          throw new FetchAbandonedError()
        }

        // The block may not have been committed yet. Wait a second and retry
        // without a limit, as before.
        if (kind === RpcErrorKind.Pending) {
          await this.sleepWhileFetching(1_000)
          continue
        }

        transientAttempts++
        const now = Date.now()
        const elapsedMs = now - startedAt

        if (elapsedMs >= maxDurationMs) {
          throw new TransientRetryExhaustedError(
            height,
            elapsedMs,
            transientAttempts,
            error
          )
        }

        if (
          elapsedMs >= warnAfterMs &&
          (lastWarnedAt === null || now - lastWarnedAt >= warnIntervalMs)
        ) {
          lastWarnedAt = now
          console.warn(
            `[${new Date().toISOString()}] Block ${height} has been retrying transient RPC errors for ${Math.round(
              elapsedMs / 1_000
            )}s (${transientAttempts} attempts): ${
              error instanceof Error ? error.message : String(error)
            }`
          )
          try {
            await this.onRetryWarning?.({
              blockHeight: height,
              elapsedMs,
              attempts: transientAttempts,
              error,
            })
          } catch (err) {
            console.error('Error in onRetryWarning callback:', err)
          }
        }

        await this.sleepWhileFetching(
          Math.min(
            getBackoffDelayMs(transientAttempts, {
              initialDelayMs,
              maxDelayMs,
            }),
            maxDurationMs - elapsedMs
          )
        )
      }
    }
  }

  /**
   * Run a startup step, retrying transient RPC errors with backoff until
   * `transientRetry.maxDurationMs`. Other errors are thrown right away.
   *
   * Resolves to `null` as soon as the iterator is stopped, without waiting for
   * an attempt in progress (which may itself be retrying a connection). That
   * attempt's result is ignored.
   */
  private async retryTransientStartup<T>(
    fn: () => Promise<T>
  ): Promise<T | null> {
    const { initialDelayMs, maxDelayMs, warnAfterMs, maxDurationMs } =
      this.transientRetry
    const startedAt = Date.now()

    for (let attempt = 1; !this.stopRequested; attempt++) {
      try {
        const outcome = await this.raceStopRequest(fn())
        if (!outcome) {
          return null
        }
        return outcome.value
      } catch (error) {
        if (this.stopRequested) {
          return null
        }

        const elapsedMs = Date.now() - startedAt
        if (
          classifyRpcError(error) === RpcErrorKind.Other ||
          elapsedMs >= maxDurationMs
        ) {
          throw error
        }

        const delayMs = Math.min(
          getBackoffDelayMs(attempt, { initialDelayMs, maxDelayMs }),
          maxDurationMs - elapsedMs
        )
        const log = elapsedMs >= warnAfterMs ? console.warn : console.log
        log(
          `[${new Date().toISOString()}] Block iterator startup failed with a transient RPC error (attempt ${attempt}), retrying in ${delayMs}ms: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
        await this.sleepUnlessStopRequested(delayMs)
      }
    }

    return null
  }

  /**
   * Resolve with `promise`, or reject with `FetchAbandonedError` as soon as
   * `stopFetching` is called. The result of `promise` is then ignored.
   */
  private async abandonOnStop<T>(promise: Promise<T>): Promise<T> {
    const outcome = await this.raceStopRequest(promise)
    if (!outcome) {
      throw new FetchAbandonedError()
    }
    return outcome.value
  }

  /**
   * Resolve with `{ value }` once `promise` resolves, reject if it rejects, or
   * resolve with `null` as soon as `stopFetching` is called, whichever happens
   * first. The stop callback is removed as soon as this settles, so nothing
   * keeps a reference to `promise` or its result afterwards.
   */
  private raceStopRequest<T>(
    promise: Promise<T>
  ): Promise<{ value: T } | null> {
    // Ignore the outcome if the stop request wins.
    promise.catch(() => {})

    if (this.stopRequested) {
      return Promise.resolve(null)
    }

    return new Promise<{ value: T } | null>((resolve, reject) => {
      const onStop = () => resolve(null)
      this.stopListeners.add(onStop)
      promise
        .then((value) => resolve({ value }), reject)
        .finally(() => this.stopListeners.delete(onStop))
    })
  }

  /**
   * Sleep for `ms`, waking early if `stopFetching` is called.
   */
  private async sleepUnlessStopRequested(ms: number) {
    let timeout: NodeJS.Timeout | undefined
    await this.raceStopRequest(
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, ms)
      })
    )
    clearTimeout(timeout)
  }

  /**
   * Sleep for up to `ms`, waking early if the iterator stops.
   */
  private async sleepWhileFetching(ms: number) {
    const until = Date.now() + ms
    while (this.fetching && Date.now() < until) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, until - Date.now()))
      )
    }
  }

  /**
   * Fetch a single block and its transactions.
   */
  private async fetchBlockData(height: number): Promise<void> {
    try {
      // Fetch the block first.
      const block = await this.fetchBlockWithRetries(height)

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
      // The iterator stopped while this block was retrying. Nothing will be
      // buffered for it, so tell the processor to stop before it.
      if (error instanceof FetchAbandonedError) {
        this.abandonedHeight =
          this.abandonedHeight === null
            ? height
            : Math.min(this.abandonedHeight, height)
        return
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
          // Ignore errors (such as the client being disconnected during an RPC
          // outage); the next interval tries again. An uncaught rejection here
          // would crash the process.
          const height = await this.autoCosmWasmClient
            .getValidClient()
            .then((client) => client.getHeight())
            .catch(() => null)
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
