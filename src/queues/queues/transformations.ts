import { Job, Queue } from 'bullmq'
import { Op } from 'sequelize'

import { Contract, WasmStateEvent } from '@/db'
import { WasmCodeService } from '@/services'
import { transformParsedStateEvents } from '@/transformers'

import { BaseQueue } from '../base'
import { closeBullQueue, getBullQueue, getBullQueueEvents } from '../connection'

export type TransformationsQueuePayload = {
  /**
   * Minimum block height. Defaults to 0.
   */
  minBlockHeight?: number
  /**
   * Batch size. Defaults to 5,000.
   */
  batchSize?: number
  /**
   * Transform set of addresses.
   */
  addresses?: string[]
  /**
   * Transform contracts matching code IDs keys.
   */
  codeIdsKeys?: string[]
  /**
   * Transform contracts matching code IDs.
   */
  codeIds?: number[]
  /**
   * Force transform all.
   */
  forceAll?: boolean
}

export class TransformationsQueue extends BaseQueue<TransformationsQueuePayload> {
  static queueName = 'transformations'

  static getQueue = () =>
    getBullQueue<TransformationsQueuePayload>(this.queueName)
  static getQueueEvents = () => getBullQueueEvents(this.queueName)
  static add = async (
    ...params: Parameters<Queue<TransformationsQueuePayload>['add']>
  ) => (await this.getQueue()).add(...params)
  static addBulk = async (
    ...params: Parameters<Queue<TransformationsQueuePayload>['addBulk']>
  ) => (await this.getQueue()).addBulk(...params)
  static close = () => closeBullQueue(this.queueName)

  async process(job: Job<TransformationsQueuePayload>): Promise<void> {
    const {
      minBlockHeight = 0,
      batchSize = 5000,
      addresses,
      codeIdsKeys,
      codeIds: _codeIds = [],
      forceAll = false,
    } = job.data

    const codeIds = []
    if (!forceAll) {
      const foundCodeIds = WasmCodeService.instance.findWasmCodeIdsByKeys(
        ...(codeIdsKeys || [])
      )
      if (codeIdsKeys?.length && !foundCodeIds.length) {
        job.log(
          `no code IDs found for code IDs keys: ${codeIdsKeys.join(', ')}`
        )
        return
      }
      codeIds.push(..._codeIds, ...foundCodeIds)
    }

    const addressFilter =
      !forceAll && addresses?.length
        ? {
            contractAddress: addresses,
          }
        : undefined

    if (forceAll) {
      job.log('force transforming all events')
    } else if (!addressFilter && !codeIds.length) {
      job.log('no contract address nor code ID filter provided')
      return
    } else {
      job.log(
        `transforming events for contract addresses: ${
          addresses?.join(', ') || '<any>'
        } and code IDs: ${codeIds.length > 0 ? codeIds.join(', ') : '<any>'}`
      )
    }

    const includeContract = {
      include: {
        model: Contract,
        required: true,
        where:
          codeIds.length > 0
            ? {
                codeId: {
                  [Op.in]: codeIds,
                },
              }
            : undefined,
      },
    }

    let latestBlockHeight = minBlockHeight
    const total = await WasmStateEvent.count({
      where: {
        ...addressFilter,
        blockHeight: {
          [Op.gte]: latestBlockHeight,
        },
      },
      ...includeContract,
    })

    job.log(`found ${total.toLocaleString()} events to transform...`)

    let processed = 0
    let transformed = 0

    const saveProgress = () =>
      job.updateProgress(Math.round((processed / total) * 100))

    saveProgress()

    // Track the last seen event's composite key for pagination
    let lastSeenKey: string | undefined
    let lastSeenContractAddress: string | undefined
    let lastSeenBlockHeight: string | undefined

    while (processed < total) {
      const events = await WasmStateEvent.findAll({
        where: {
          ...addressFilter,
          // Since there can be multiple events per block, the fixed batch size
          // will likely end up leaving some events in the latest block out of
          // this batch. To fix this, repeat the latest block again (>=)
          // excluding the events we've already seen.
          blockHeight: {
            [Op.gte]: latestBlockHeight,
          },
          // If we have a last seen event, use it for pagination
          ...(lastSeenKey &&
            lastSeenContractAddress &&
            lastSeenBlockHeight && {
              [Op.or]: [
                {
                  blockHeight: {
                    [Op.gt]: lastSeenBlockHeight,
                  },
                },
                {
                  blockHeight: lastSeenBlockHeight,
                  contractAddress: {
                    [Op.gt]: lastSeenContractAddress,
                  },
                },
                {
                  blockHeight: lastSeenBlockHeight,
                  contractAddress: lastSeenContractAddress,
                  key: {
                    [Op.gt]: lastSeenKey,
                  },
                },
              ],
            }),
        },
        limit: batchSize,
        order: [
          ['blockHeight', 'ASC'],
          ['contractAddress', 'ASC'],
          ['key', 'ASC'],
        ],
        ...includeContract,
      })

      // If there are no more events, we're done.
      if (events.length === 0) {
        break
      }

      const lastEvent = events[events.length - 1]
      lastSeenKey = lastEvent.key
      lastSeenContractAddress = lastEvent.contractAddress
      lastSeenBlockHeight = lastEvent.blockHeight
      latestBlockHeight = Number(lastSeenBlockHeight)

      processed += events.length

      const transformations = await transformParsedStateEvents(
        events.map((event) => event.asParsedEvent)
      )

      // const { updated, destroyed } = update
      //   ? await updateComputationValidityDependentOnChanges(transformations)
      //   : {
      //       updated: 0,
      //       destroyed: 0,
      //     }

      transformed += transformations.length

      job.log(
        `transformed/processed/total: ${transformed.toLocaleString()}/${processed.toLocaleString()}/${total.toLocaleString()}. latest block height: ${latestBlockHeight.toLocaleString()}`
      )

      saveProgress()
    }
  }
}
