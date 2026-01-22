import { Job, Queue } from 'bullmq'
import { Sequelize } from 'sequelize'

import { Block, State } from '@/db'
import { getExtractorMap } from '@/listener'
import { queueMeilisearchIndexUpdates } from '@/search'
import { ExtractorEnv, ExtractorHandleableData } from '@/types'
import { AutoCosmWasmClient, retry } from '@/utils'
import { queueWebhooks } from '@/webhooks'

import { BaseQueue } from '../base'
import { closeBullQueue, getBullQueue, getBullQueueEvents } from '../connection'

export type ExtractQueuePayload = {
  extractor: string
  data: ExtractorHandleableData
  env: Pick<ExtractorEnv, 'txHash' | 'block'>
}

export class ExtractQueue extends BaseQueue<ExtractQueuePayload> {
  static queueName = 'extract'
  static concurrency = 10

  static getQueue = () => getBullQueue<ExtractQueuePayload>(this.queueName)
  static getQueueEvents = () => getBullQueueEvents(this.queueName)
  static add = async (
    ...params: Parameters<Queue<ExtractQueuePayload>['add']>
  ) => (await this.getQueue()).add(...params)
  static addBulk = async (
    ...params: Parameters<Queue<ExtractQueuePayload>['addBulk']>
  ) => (await this.getQueue()).addBulk(...params)
  static close = () => closeBullQueue(this.queueName)

  private autoCosmWasmClient!: AutoCosmWasmClient

  async init(): Promise<void> {
    this.autoCosmWasmClient = new AutoCosmWasmClient(
      this.options.config.remoteRpc
    )
    await this.autoCosmWasmClient.update()
  }

  async process(job: Job<ExtractQueuePayload>) {
    await this.autoCosmWasmClient.getValidClient()

    const extractors = getExtractorMap()

    return new Promise(async (resolve, reject) => {
      // Time out if takes more than 30 seconds.
      let timeout: NodeJS.Timeout | null = setTimeout(() => {
        timeout = null
        reject(new Error('Extract timed out after 30 seconds.'))
      }, 30000)

      try {
        // Process data.
        const Extractor = extractors[job.data.extractor]
        if (!Extractor) {
          throw new Error(`Extractor ${job.data.extractor} not found.`)
        }

        const extractor = new Extractor({
          config: this.options.config,
          sendWebhooks: this.options.sendWebhooks,
          autoCosmWasmClient: this.autoCosmWasmClient,
          ...job.data.env,
        })

        const models = await retry(
          3,
          () => extractor.extract([job.data.data]),
          100
        )

        if (models.length > 0) {
          const latestBlock = models.sort(
            (a, b) => Number(a.block.height) - Number(b.block.height)
          )[models.length - 1]
          const latestBlockHeight = latestBlock.block.height
          const latestBlockTimeUnixMs = latestBlock.block.timeUnixMs

          // Update state singleton with latest block height/time and create
          // block if it doesn't exist.
          await Promise.all([
            State.updateSingleton({
              latestBlockHeight: Sequelize.fn(
                'GREATEST',
                Sequelize.col('latestBlockHeight'),
                latestBlockHeight
              ),
              latestBlockTimeUnixMs: Sequelize.fn(
                'GREATEST',
                Sequelize.col('latestBlockTimeUnixMs'),
                latestBlockTimeUnixMs
              ),
            }),
            Block.createOne({
              height: latestBlockHeight,
              timeUnixMs: latestBlockTimeUnixMs,
            }),
          ])

          // Queue Meilisearch index updates.
          const queued = (
            await Promise.all(
              models.map((event) =>
                queueMeilisearchIndexUpdates(event).catch((err) => {
                  console.error(
                    `[${new Date().toISOString()}] Error queuing search index updates:`,
                    err
                  )
                  return 0
                })
              )
            )
          ).reduce((acc, q) => acc + q, 0)

          if (queued > 0) {
            job.log(
              `[${new Date().toISOString()}] Queued ${queued.toLocaleString()} search index update(s).`
            )
          }

          // Queue webhooks.
          if (this.options.sendWebhooks) {
            const queued = await queueWebhooks(models).catch((err) => {
              console.error(
                `[${new Date().toISOString()}] Error queuing webhooks:`,
                err
              )
              return 0
            })

            if (queued > 0) {
              job.log(
                `[${new Date().toISOString()}] Queued ${queued.toLocaleString()} webhook(s).`
              )
            }
          }
        }

        if (timeout !== null) {
          resolve(models.map((model) => model.toJSON()))
        }
      } catch (err) {
        if (timeout !== null) {
          // console.error(err)
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
