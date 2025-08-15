import * as Sentry from '@sentry/node'

import { State } from '@/db'
import { ExportBackgroundQueue } from '@/queues/queues'
import { ExportQueue } from '@/queues/queues/export'
import { TracedEvent } from '@/types'

/**
 * A single item in the batch.
 */
export type BatchItem = {
  /**
   * The name of the handler that processed the item.
   */
  handler: string
  /**
   * The data to export provided by the handler, derived from the trace event.
   */
  data: any
  /**
   * The trace event.
   */
  trace: TracedEvent
}

/**
 * A class that batches trace events and exports them based on block height
 * changes, a maximum batch size, and time intervals.
 */
export class BatchedTraceExporter {
  /**
   * The pending batch of items to be exported.
   */
  private pendingBatch: BatchItem[] = []

  /**
   * Timeout for debounced exports.
   */
  private debounceTimer: NodeJS.Timeout | null = null

  /**
   * The maximum batch size before an immediate export is triggered.
   */
  private maxBatchSize: number

  /**
   * The debounce time in milliseconds.
   */
  private debounceMs: number

  constructor(
    options: {
      maxBatchSize?: number
      debounceMs?: number
    } = {}
  ) {
    this.maxBatchSize = options.maxBatchSize ?? 5_000
    this.debounceMs = options.debounceMs ?? 500
  }

  /**
   * Add items to the current batch, potentially triggering an export.
   *
   * @param items Items to add to the batch
   * @returns Promise that resolves when the items are added to the batch and
   * potentially the batch is exported.
   */
  async exportItems(
    items: BatchItem[],
    currentBlockHeight: number
  ): Promise<void> {
    if (items.length === 0) {
      return
    }

    // If this is a newer block height than the last item in the batch, export
    // the previous batch before adding the new items.
    const lastBlockHeight = this.getLastBlockHeight()
    if (lastBlockHeight !== null && currentBlockHeight > lastBlockHeight) {
      await this.exportBatch()
    }

    // Add items to batch.
    this.pendingBatch.push(...items)

    // If batch size reached, immediately export.
    if (this.pendingBatch.length >= this.maxBatchSize) {
      await this.exportBatch()
    } else {
      // Otherwise, debounce export.
      await this.scheduleDebounceExport()
    }
  }

  /**
   * Schedule a debounced export of the current batch.
   */
  private scheduleDebounceExport(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.exportBatch().catch(async (err) => {
        console.error(
          '-------\nFailed to export batch:\n',
          err instanceof Error ? err.message : err,
          '\nPending batch size: ' +
            this.pendingBatch.length.toLocaleString() +
            '\n-------'
        )

        Sentry.captureException(err, {
          tags: {
            type: 'failed-export-batch',
            script: 'tracer',
            chainId:
              (await State.getSingleton().catch(() => null))?.chainId ??
              'unknown',
          },
          extra: {
            batch: this.pendingBatch,
          },
        })
      })
    }, this.debounceMs)
  }

  /**
   * Export the current batch to the export queue.
   */
  private async exportBatch(): Promise<void> {
    // Clear any pending debounce timer.
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    if (this.pendingBatch.length === 0) {
      return
    }

    // De-duplicate items with the same ID, keeping the last one, since events
    // are emitted in order and the last event is the most up-to-date. Multiple
    // events may occur if a state key is updated multiple times across
    // different messages within the same block.
    const uniqueBatchData = Object.values(
      this.pendingBatch.reduce(
        (acc, data, index) => ({
          ...acc,
          [data.handler + ':' + data.data.id]: {
            ...data,
            index,
          },
        }),
        {} as Record<string, BatchItem & { index: number }>
      )
    )

    // Preserve original order.
    uniqueBatchData.sort((a, b) => a.index - b.index)

    const blockHeight = BigInt(
      this.pendingBatch[this.pendingBatch.length - 1].trace.metadata.blockHeight
    )

    // Export to queues
    await Promise.all([
      ExportQueue.add(
        blockHeight.toString(),
        uniqueBatchData.map(({ handler, data }) => {
          // Remove ID since it's no longer relevant.
          const exportData = { ...data }
          delete exportData.id

          return {
            handler,
            data: exportData,
          }
        })
      ),
      ExportBackgroundQueue.add(
        blockHeight.toString(),
        uniqueBatchData.map(({ handler, data }) => {
          // Remove ID since it's no longer relevant.
          const exportData = { ...data }
          delete exportData.id

          return {
            handler,
            data: exportData,
          }
        })
      ),
    ])

    console.log(
      `\n[${new Date().toISOString()}] Exported ${this.pendingBatch.length.toLocaleString()} events for block ${blockHeight.toLocaleString()}.`
    )

    // Clear the batch on success.
    this.pendingBatch = []
  }

  /**
   * Get the block height of the last item in the batch, or null if the batch is
   * empty.
   */
  private getLastBlockHeight(): number | null {
    if (this.pendingBatch.length === 0) {
      return null
    }

    return this.pendingBatch[this.pendingBatch.length - 1].trace.metadata
      .blockHeight
  }

  /**
   * Get the current pending batch size.
   */
  get pendingBatchSize(): number {
    return this.pendingBatch.length
  }

  /**
   * Check if there are any pending items to be exported.
   */
  get hasPendingItems(): boolean {
    return this.pendingBatchSize > 0
  }

  /**
   * Wait for any pending exports to complete.
   */
  async awaitFlush(): Promise<void> {
    // Export any remaining items in the batch.
    await this.exportBatch()
  }
}
