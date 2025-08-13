import retry from 'async-await-retry'
import { Job, Queue } from 'bullmq'

import { extractorMakers } from '@/listener'
import { queueMeilisearchIndexUpdates } from '@/search'
import { ExtractorExtractInput, NamedExtractor } from '@/types'
import { AutoCosmWasmClient } from '@/utils'
import { queueWebhooks } from '@/webhooks'

import { BaseQueue } from '../base'
import { closeBullQueue, getBullQueue, getBullQueueEvents } from '../connection'

export type ExtractQueuePayload = {
  extractor: string
  data: ExtractorExtractInput
}

export class ExtractQueue extends BaseQueue<ExtractQueuePayload> {
  static queueName = 'extract'
  static concurrency = 5

  static getQueue = () => getBullQueue<ExtractQueuePayload>(this.queueName)
  static getQueueEvents = () => getBullQueueEvents(this.queueName)
  static add = async (
    ...params: Parameters<Queue<ExtractQueuePayload>['add']>
  ) => (await this.getQueue()).add(...params)
  static addBulk = async (
    ...params: Parameters<Queue<ExtractQueuePayload>['addBulk']>
  ) => (await this.getQueue()).addBulk(...params)
  static close = () => closeBullQueue(this.queueName)

  private extractors: NamedExtractor[] = []

  async init(): Promise<void> {
    const autoCosmWasmClient = new AutoCosmWasmClient(
      this.options.config.remoteRpc
    )
    await autoCosmWasmClient.update()

    // Set up extractors.
    const extractors = await Promise.all(
      Object.entries(extractorMakers).map(async ([name, extractorMaker]) => ({
        name,
        extractor: await extractorMaker({
          ...this.options,
          autoCosmWasmClient,
        }),
      }))
    )

    this.extractors = extractors
  }

  process({ data, log }: Job<ExtractQueuePayload>): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      // Time out if takes more than 30 seconds.
      let timeout: NodeJS.Timeout | null = setTimeout(() => {
        timeout = null
        reject(new Error('Extract timed out after 30 seconds.'))
      }, 30000)

      try {
        // Process data.
        const extractor = this.extractors.find(
          (e) => e.name === data.extractor
        )?.extractor
        if (!extractor) {
          throw new Error(`Extractor ${data.extractor} not found.`)
        }

        // Retry 3 times with exponential backoff starting at 100ms delay.
        const models = await retry(extractor.extract, [data.data], {
          retriesMax: 3,
          exponential: true,
          interval: 100,
        })

        if (models && Array.isArray(models) && models.length) {
          // Queue Meilisearch index updates.
          const queued = (
            await Promise.all(
              models.map((event) =>
                queueMeilisearchIndexUpdates(event).catch((err) => {
                  console.error(
                    `[${new Date().toISOString()}] Error queuing search index update: ${err}`
                  )
                  return 0
                })
              )
            )
          ).reduce((acc, q) => acc + q, 0)

          if (queued > 0) {
            log(
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
              log(
                `[${new Date().toISOString()}] Queued ${queued.toLocaleString()} webhook(s).`
              )
            }
          }
        }

        if (timeout !== null) {
          resolve()
        }
      } catch (err) {
        if (timeout !== null) {
          log(
            `${err instanceof Error ? err.name : 'Error'}: ${
              err instanceof Error ? err.message : err
            } ${
              err && typeof err === 'object' && 'parent' in err
                ? err.parent
                : ''
            }`.trim()
          )
          // Convert non-error objects to errors so Bull can display it.
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      } finally {
        if (timeout !== null) {
          clearTimeout(timeout)
        }
      }
    })
  }
}
