import { Job, Queue } from 'bullmq'

import { Contract, WasmStateEvent } from '@/db'
import { queueMeilisearchIndexUpdates } from '@/search'
import { transformParsedStateEvents } from '@/transformers'
import { retry } from '@/utils'
import { queueWebhooks } from '@/webhooks'

import { BaseQueue } from '../base'
import { closeBullQueue, getBullQueue, getBullQueueEvents } from '../connection'

export type TransformQueuePayload = {
  wasmStateEventIds: string[]
}

export class TransformQueue extends BaseQueue<TransformQueuePayload> {
  static queueName = 'transform'
  static concurrency = 10

  static getQueue = () => getBullQueue<TransformQueuePayload>(this.queueName)
  static getQueueEvents = () => getBullQueueEvents(this.queueName)
  static add = async (
    ...params: Parameters<Queue<TransformQueuePayload>['add']>
  ) => (await this.getQueue()).add(...params)
  static addBulk = async (
    ...params: Parameters<Queue<TransformQueuePayload>['addBulk']>
  ) => (await this.getQueue()).addBulk(...params)
  static close = () => closeBullQueue(this.queueName)

  process({ data, log }: Job<TransformQueuePayload>): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      // Time out if takes more than 30 seconds.
      let timeout: NodeJS.Timeout | null = setTimeout(() => {
        timeout = null
        reject(new Error('Extract timed out after 30 seconds.'))
      }, 30000)

      try {
        const wasmStateEvents = await WasmStateEvent.findAll({
          where: {
            id: data.wasmStateEventIds,
          },
          include: Contract,
        })

        const stateEvents = wasmStateEvents.map((event) => event.asParsedEvent)

        const transformations = await retry(
          3,
          () => transformParsedStateEvents(stateEvents),
          100
        )

        const contractMap: Record<string, Contract | undefined> =
          Object.fromEntries(
            wasmStateEvents.map(({ contract }) => [contract.address, contract])
          )

        // Add contract to transformations.
        transformations.forEach((transformation) => {
          transformation.contract = contractMap[transformation.contractAddress]!
        })

        const models = [...wasmStateEvents, ...transformations]

        // Queue Meilisearch index updates.
        const queued = (
          await Promise.all(
            models.map((model) => queueMeilisearchIndexUpdates(model))
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
