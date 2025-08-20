import { Job, Queue } from 'bullmq'

import { State } from '@/db'
import { compute, getTypedFormula } from '@/formulas'
import { getMeilisearchIndexName, loadMeilisearch } from '@/search'
import { PendingMeilisearchIndexUpdate } from '@/types'

import { BaseQueue } from '../base'
import { closeBullQueue, getBullQueue, getBullQueueEvents } from '../connection'

export class SearchQueue extends BaseQueue<PendingMeilisearchIndexUpdate> {
  static queueName = 'search'
  static concurrency = 10

  static getQueue = () =>
    getBullQueue<PendingMeilisearchIndexUpdate>(this.queueName)
  static getQueueEvents = () => getBullQueueEvents(this.queueName)
  static add = async (
    ...params: Parameters<Queue<PendingMeilisearchIndexUpdate>['add']>
  ) => (await this.getQueue()).add(...params)
  static addBulk = async (
    ...params: Parameters<Queue<PendingMeilisearchIndexUpdate>['addBulk']>
  ) => (await this.getQueue()).addBulk(...params)
  static close = () => closeBullQueue(this.queueName)

  async process({
    data: {
      index: indexName,
      update: {
        id,
        formula: { type, name, targetAddress, args = {} },
      },
    },
  }: Job<PendingMeilisearchIndexUpdate>): Promise<void> {
    const typedFormula = getTypedFormula(type, name)

    const state = await State.getSingleton()
    if (!state) {
      throw new Error('State not found.')
    }

    const index = loadMeilisearch().index(
      getMeilisearchIndexName(state, indexName)
    )

    const { block, value } = await compute({
      chainId: state.chainId,
      block: state.latestBlock,
      targetAddress,
      args,
      ...typedFormula,
    })

    await index.addDocuments([
      {
        id,
        block: block && {
          height: Number(block.height),
          timeUnixMs: Number(block.timeUnixMs),
        },
        value,
      },
    ])
  }
}
