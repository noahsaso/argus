import * as Sentry from '@sentry/node'

import { State } from '@/db'
import { BlockTimeFetcher } from '@/services'
import { NamedHandler, TracedEvent, TracedEventWithBlockTime } from '@/types'
import { AsyncProfiler } from '@/utils'

import { BatchItem, BatchedTraceExporter } from './BatchedTraceExporter'

/**
 * A queue that exports traces to the database in batches.
 */
export class TracerManager {
  /**
   * The inbound queue of traces to export, which cannot be paused.
   */
  private inboundQueue: TracedEvent[] = []

  /**
   * The queue of traces being exported, fed by the inbound queue, which can be
   * paused if too many traces are being exported.
   */
  private outboundQueue: TracedEvent[] = []

  /**
   * The worker that exports traces to the database from the outbound queue.
   */
  private outboundQueueWorker: Promise<void> | null = null

  /**
   * Whether moving traces from the inbound queue to the outbound queue is
   * paused.
   */
  private paused = false

  /**
   * The maximum size of the outbound queue.
   */
  private maxOutboundQueueSize: number

  constructor(
    /**
     * The handlers.
     */
    private handlers: NamedHandler[],
    /**
     * The block time fetcher.
     */
    private blockTimeFetcher: BlockTimeFetcher,
    /**
     * The batched trace exporter.
     */
    private exporter: BatchedTraceExporter,
    /**
     * Options.
     */
    options: {
      /**
       * The maximum size of the outbound queue.
       */
      maxOutboundQueueSize?: number
    } = {}
  ) {
    this.maxOutboundQueueSize = options.maxOutboundQueueSize ?? 5_000
  }

  /**
   * Enqueue a trace to be exported.
   */
  enqueue(trace: TracedEvent) {
    this.inboundQueue.push(trace)

    // If paused, do nothing other than enqueue.
    if (this.paused) {
      return
    }

    // Process the inbound queue.
    this.processInboundQueue()
  }

  /**
   * Process the inbound queue, moving traces to the outbound queue and managing
   * the outbound queue size by pausing and resuming as needed.
   */
  private processInboundQueue() {
    while (this.inboundQueue.length) {
      const trace = this.inboundQueue.shift()
      if (!trace) {
        break
      }

      this.outboundQueue.push(trace)

      // If outbound queue is full, pause until it drains.
      if (this.outboundQueue.length >= this.maxOutboundQueueSize) {
        this.paused = true

        // Resume once queue drains.
        const interval = setInterval(() => {
          if (this.outboundQueue.length < this.maxOutboundQueueSize / 5) {
            this.paused = false
            clearInterval(interval)
            this.processInboundQueue()
          }
        }, 100)

        // Stop processing inbound queue for now. The interval will resume it
        // once the outbound queue has drained.
        break
      }
    }

    // Ensure the worker is exporting the outbound queue.
    this.ensureOutboundQueueWorker()
  }

  /**
   * Ensure the worker is exporting the outbound queue.
   */
  private ensureOutboundQueueWorker() {
    if (!this.outboundQueueWorker) {
      this.outboundQueueWorker = (async () => {
        try {
          while (this.outboundQueue.length) {
            const trace = this.outboundQueue.shift()
            if (!trace) {
              break
            }

            try {
              await this.export(trace)
            } catch (err) {
              console.error(
                '-------\nFailed to export trace:\n',
                err instanceof Error ? err.message : err,
                '\nBlock height: ' +
                  BigInt(trace?.metadata.blockHeight ?? '-1').toLocaleString() +
                  '\nData: ' +
                  JSON.stringify(trace, null, 2) +
                  '\n-------'
              )

              Sentry.captureException(err, {
                tags: {
                  type: 'failed-export-trace',
                  script: 'tracer',
                  chainId:
                    (await State.getSingleton().catch(() => null))?.chainId ??
                    'unknown',
                },
                extra: {
                  trace,
                },
              })
            }
          }
        } finally {
          this.outboundQueueWorker = null
        }
      })()
    }
  }

  /**
   * Export a trace.
   */
  private async export(trace: TracedEvent) {
    try {
      // Fetch block time.
      const blockTimeUnixMs = await AsyncProfiler.profile(
        () => this.blockTimeFetcher.fetch(trace),
        'blockTimeFetcher.fetch',
        'tracer-manager-export-trace'
      )
      const eventWithBlockTime: TracedEventWithBlockTime = {
        ...trace,
        blockTimeUnixMs,
      }

      // Match traces with handlers and get queue data.
      const matchedData = this.handlers
        .filter(
          ({ handler }) =>
            // Filter by store if present. Osmosis, for example, does not emit
            // store_name in metadata, so try all handlers.
            !trace.metadata.store_name ||
            handler.storeName === trace.metadata.store_name
        )
        .flatMap(({ name, handler }): BatchItem | [] => {
          const data = handler.match(eventWithBlockTime)
          return data
            ? {
                handler: name,
                hasBackground: !!handler.processBackground,
                data,
                trace,
              }
            : []
        })

      await this.exporter.exportItems(matchedData, trace.metadata.blockHeight)
    } catch (err) {
      console.error(
        '-------\nFailed to export trace:\n',
        err instanceof Error ? err.message : err,
        '\nBlock height: ' +
          BigInt(trace?.metadata.blockHeight ?? '-1').toLocaleString() +
          '\nData: ' +
          JSON.stringify(trace, null, 2) +
          '\n-------'
      )

      Sentry.captureException(err, {
        tags: {
          type: 'failed-export-trace',
          script: 'tracer',
          chainId: (await State.getSingleton())?.chainId ?? 'unknown',
        },
        extra: {
          trace,
        },
      })
    }
  }

  /**
   * Get the size of the inbound queue.
   */
  get inboundQueueSize() {
    return this.inboundQueue.length
  }

  /**
   * Get the size of the outbound queue.
   */
  get outboundQueueSize() {
    return this.outboundQueue.length
  }

  /**
   * Get the total size of the queues.
   */
  get totalQueueSize() {
    return this.inboundQueueSize + this.outboundQueueSize
  }

  /**
   * Wait for all the queues to flush and traces to be exported.
   */
  async awaitFlush() {
    // Wait for the inbound and outbound queues to drain.
    await new Promise<void>((resolve) => {
      const checkAndResolve = () => {
        if (this.totalQueueSize === 0) {
          resolve()
        } else {
          setTimeout(checkAndResolve, 100)
        }
      }
      checkAndResolve()
    })

    // Wait for the outbound queue worker to finish.
    await this.outboundQueueWorker

    // Wait for the exporter to flush.
    await this.exporter.awaitFlush()
  }
}
