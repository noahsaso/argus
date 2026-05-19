import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate'
import { Job, Queue } from 'bullmq'

import { fetchContractStatePage } from '@/services/contract-state-dump'
import {
  getRecoveryContractInfo,
  recoverContractState,
} from '@/services/contract-state-recovery'

import { BaseQueue } from '../base'
import { closeBullQueue, getBullQueue, getBullQueueEvents } from '../connection'

export const CONTRACT_STATE_RECOVERY_DELAY_MS = 60_000

export type ContractStateRecoveryQueuePayload = {
  address: string
  detectedBlockHeight: string
  rpc?: 'remote' | 'local'
}

export class ContractStateRecoveryQueue extends BaseQueue<ContractStateRecoveryQueuePayload> {
  static queueName = 'contract-state-recovery'

  static getQueue = () =>
    getBullQueue<ContractStateRecoveryQueuePayload>(this.queueName)
  static getQueueEvents = () => getBullQueueEvents(this.queueName)
  static add = async (
    ...params: Parameters<Queue<ContractStateRecoveryQueuePayload>['add']>
  ) => (await this.getQueue()).add(...params)
  static close = () => closeBullQueue(this.queueName)

  static addDelayed = async ({
    address,
    detectedBlockHeight,
    rpc = 'remote',
  }: ContractStateRecoveryQueuePayload) =>
    this.add(
      `${address}:${detectedBlockHeight}`,
      { address, detectedBlockHeight, rpc },
      {
        delay: CONTRACT_STATE_RECOVERY_DELAY_MS,
        jobId: `${address}:${detectedBlockHeight}`,
      }
    )

  async process(job: Job<ContractStateRecoveryQueuePayload>): Promise<void> {
    const { address, rpc = 'remote' } = job.data
    const rpcUrl =
      rpc === 'remote'
        ? this.options.config.remoteRpc
        : this.options.config.localRpc
    if (!rpcUrl) {
      throw new Error(`${rpc} RPC is not configured`)
    }

    const client = await CosmWasmClient.connect(rpcUrl)
    try {
      const [contractInfo, block] = await Promise.all([
        getRecoveryContractInfo({ address, client }),
        client.getBlock(),
      ])
      const blockHeight = BigInt(block.header.height).toString()
      const blockTimeUnixMs = Date.parse(block.header.time).toString()

      const result = await recoverContractState({
        address,
        codeId: contractInfo.codeId,
        blockHeight,
        blockTimeUnixMs,
        pageLimit: 1000,
        fetchPage: fetchContractStatePage(client),
      })

      await job.log(
        `recovered ${result.count} state entries for ${address}; ` +
          `${result.events} events, ${result.transformations} transformations`
      )
    } finally {
      client.disconnect()
    }
  }
}
