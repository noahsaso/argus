import { Job, Queue } from 'bullmq'

import { ConfigManager } from '@/config'
import { State } from '@/db'
import { queueMeilisearchIndexUpdates } from '@/search'
import { makeHandlers } from '@/tracer'
import { NamedHandler } from '@/types'
import { AutoCosmWasmClient, retry } from '@/utils'
import { queueWebhooks } from '@/webhooks'

import { BaseQueue } from '../base'
import { closeBullQueue, getBullQueue, getBullQueueEvents } from '../connection'

/**
 * Payload for items in the export queue, which consists of handler and data
 * match pairings.
 */
export type ExportQueuePayload = {
  handler: string
  data: unknown
}[]

export class ExportQueue extends BaseQueue<ExportQueuePayload> {
  static queueName = 'export'

  static getQueue = () => getBullQueue<ExportQueuePayload>(this.queueName)
  static getQueueEvents = () => getBullQueueEvents(this.queueName)
  static add = async (
    ...params: Parameters<Queue<ExportQueuePayload>['add']>
  ) => (await this.getQueue()).add(...params)
  static addBulk = async (
    ...params: Parameters<Queue<ExportQueuePayload>['addBulk']>
  ) => (await this.getQueue()).addBulk(...params)
  static close = () => closeBullQueue(this.queueName)

  private handlers: NamedHandler[] = []

  async init(): Promise<void> {
    const state = await State.getSingleton()
    const config = ConfigManager.load()

    const autoCosmWasmClient = new AutoCosmWasmClient(
      this.options.config.remoteRpc
    )
    await autoCosmWasmClient.update()

    // Set up handlers.
    const handlers = (
      await makeHandlers({
        ...this.options,
        autoCosmWasmClient,
        chainId:
          state?.chainId || autoCosmWasmClient.chainId || config.chainId || '',
      })
    ).filter(({ handler }) => handler.process)

    this.handlers = handlers
  }

  process(job: Job<ExportQueuePayload>): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      // Time out if takes more than 30 seconds.
      let timeout: NodeJS.Timeout | null = setTimeout(() => {
        timeout = null
        reject(new Error('Export timed out after 30 seconds.'))
      }, 30000)

      try {
        // Group data by handler.
        const groupedData = job.data.reduce(
          (acc, { handler, data }) => ({
            ...acc,
            [handler]: (acc[handler] || []).concat(data),
          }),
          {} as Record<string, any[]>
        )

        // Process handlers in parallel.
        await Promise.all(
          this.handlers.map(async ({ name, handler }) => {
            const events = groupedData[name]
            if (!events?.length || !handler.process) {
              return
            }

            const models = await retry(3, () => handler.process!(events), 100)

            if (models && Array.isArray(models) && models.length) {
              // Queue Meilisearch index updates.
              const queued = (
                await Promise.all(
                  models.map((event) => queueMeilisearchIndexUpdates(event))
                )
              ).reduce((acc, q) => acc + q, 0)

              if (queued > 0) {
                console.log(
                  `[${new Date().toISOString()}] Queued ${queued.toLocaleString()} search index update(s).`
                )
              }

              // Queue webhooks.
              if (this.options.sendWebhooks) {
                const queued = await queueWebhooks(models).catch((err) => {
                  console.error(
                    `[${new Date().toISOString()}] Error queuing webhooks: ${err}`
                  )
                  return 0
                })

                if (queued > 0) {
                  console.log(
                    `[${new Date().toISOString()}] Queued ${queued.toLocaleString()} webhook(s).`
                  )
                }
              }
            }
          })
        )

        if (timeout !== null) {
          resolve()
        }
      } catch (err) {
        if (timeout !== null) {
          job.log(
            `${err instanceof Error ? err.name : 'Error'}: ${
              err instanceof Error ? err.message : err
            } ${
              err && typeof err === 'object' && 'parent' in err
                ? err.parent
                : ''
            }`.trim()
          )
          // Convert non-error objects to errors so Bull can display it.
          reject(new Error(err instanceof Error ? err.message : String(err)))
        }
      } finally {
        if (timeout !== null) {
          clearTimeout(timeout)
        }
      }
    })
  }
}
