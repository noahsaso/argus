import { Job, Queue } from 'bullmq'

import { makeExtractors } from '@/listener'
import { NamedExtractor } from '@/types'
import { AutoCosmWasmClient } from '@/utils'

import { BaseQueue } from '../base'
import { closeBullQueue, getBullQueue, getBullQueueEvents } from '../connection'
import { ExtractQueue } from './extract'

export type SyncExtractorsQueuePayload = {
  /**
   * Extractor names to sync, or ALL to sync all extractors.
   */
  extractors: string[] | 'ALL'
}

export class SyncExtractorsQueue extends BaseQueue<SyncExtractorsQueuePayload> {
  static queueName = 'sync-extractors'

  static getQueue = () =>
    getBullQueue<SyncExtractorsQueuePayload>(this.queueName)
  static getQueueEvents = () => getBullQueueEvents(this.queueName)
  static add = async (
    ...params: Parameters<Queue<SyncExtractorsQueuePayload>['add']>
  ) => (await this.getQueue()).add(...params)
  static addBulk = async (
    ...params: Parameters<Queue<SyncExtractorsQueuePayload>['addBulk']>
  ) => (await this.getQueue()).addBulk(...params)
  static close = () => closeBullQueue(this.queueName)

  private autoCosmWasmClient!: AutoCosmWasmClient
  private extractors: NamedExtractor[] = []

  async init(): Promise<void> {
    this.autoCosmWasmClient = new AutoCosmWasmClient(
      this.options.config.remoteRpc
    )
    await this.autoCosmWasmClient.update()

    // Set up extractors.
    const extractors = await makeExtractors({
      ...this.options,
      autoCosmWasmClient: this.autoCosmWasmClient,
    })

    this.extractors = extractors
  }

  async process(job: Job<SyncExtractorsQueuePayload>): Promise<void> {
    const now = Date.now()

    const toSync =
      job.data.extractors === 'ALL'
        ? this.extractors
        : this.extractors.filter((extractor) =>
            job.data.extractors.includes(extractor.name)
          )

    if (toSync.length === 0) {
      job.log('no extractors to sync')
      return
    }

    job.log(`syncing extractors: ${toSync.map((e) => e.name).join(', ')}`)

    await this.autoCosmWasmClient.update()
    const client = this.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const block = await client.getBlock()
    let count = 0

    for (const { name, extractor } of toSync) {
      job.log(`syncing ${name}...`)
      const syncData = await extractor.sync?.()
      if (syncData) {
        await ExtractQueue.addBulk(
          syncData.map((data, index) => ({
            name: `sync-${name}-${now}-${index}`,
            data: {
              extractor: name,
              data: {
                txHash: '',
                block: {
                  height: BigInt(block.header.height).toString(),
                  timeUnixMs: BigInt(Date.parse(block.header.time)).toString(),
                  timestamp: new Date(block.header.time).toISOString(),
                },
                data,
              },
            },
          }))
        )
        count += syncData.length
      }
    }

    job.log(`synced ${count} items`)
  }
}
