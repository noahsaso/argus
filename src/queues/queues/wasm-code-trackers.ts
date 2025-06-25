import { Job, Queue } from 'bullmq'

import { State } from '@/db'
import { ParsedWasmStateEvent } from '@/types'
import { WasmCodeTrackerManager } from '@/wasmCodeTrackers'

import { BaseQueue } from '../base'
import { closeBullQueue, getBullQueue, getBullQueueEvents } from '../connection'

export type WasmCodeTrackersQueuePayload = {
  contractEvents: {
    address: string
    codeId: number
  }[]
  stateEventUpdates: Omit<ParsedWasmStateEvent, 'blockTimestamp'>[]
}

export class WasmCodeTrackersQueue extends BaseQueue<WasmCodeTrackersQueuePayload> {
  static queueName = 'wasm-code-trackers'

  static getQueue = () =>
    getBullQueue<WasmCodeTrackersQueuePayload>(this.queueName)
  static getQueueEvents = () => getBullQueueEvents(this.queueName)
  static add = async (
    ...params: Parameters<Queue<WasmCodeTrackersQueuePayload>['add']>
  ) => (await this.getQueue()).add(...params)
  static addBulk = async (
    ...params: Parameters<Queue<WasmCodeTrackersQueuePayload>['addBulk']>
  ) => (await this.getQueue()).addBulk(...params)
  static close = () => closeBullQueue(this.queueName)

  async process({
    data: { contractEvents, stateEventUpdates },
  }: Job<WasmCodeTrackersQueuePayload>): Promise<void> {
    const chainId = (await State.getSingleton())?.chainId
    if (!chainId) {
      throw new Error('Chain ID not found')
    }

    await new WasmCodeTrackerManager(chainId).trackCodes(
      contractEvents,
      stateEventUpdates
    )
  }
}
