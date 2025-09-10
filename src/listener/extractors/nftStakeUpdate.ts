import { WasmCodeService } from '@/services'
import {
  ExtractorDataSource,
  ExtractorHandler,
  ExtractorHandlerOutput,
} from '@/types'
import { getContractInfo } from '@/utils'

import { WasmEventData, WasmEventDataSource } from '../sources'
import { Extractor } from './base'

export class NftStakeUpdateExtractor extends Extractor {
  static type = 'nftStakeUpdate'
  static sources: ExtractorDataSource[] = [
    WasmEventDataSource.source('stake', {
      key: 'action',
      value: 'stake',
      otherAttributes: ['from', 'token_id'],
    }),
    WasmEventDataSource.source('unstake', {
      key: 'action',
      value: 'unstake',
      otherAttributes: ['from'],
    }),
  ]

  protected stake: ExtractorHandler<WasmEventData> = ({
    address,
    attributes,
  }) => this.save(address, attributes.from![0])
  protected unstake: ExtractorHandler<WasmEventData> = ({
    address,
    attributes,
  }) => this.save(address, attributes.from![0])

  private async save(
    contractAddress: string,
    sender: string
  ): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    // Wait 1 block to ensure staked balances are updated.
    while (true) {
      const currentHeight = await client.getHeight()
      if (currentHeight > Number(this.env.block.height)) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    const { codeId } = await getContractInfo({
      client,
      address: contractAddress,
    })

    // Only process if the contract is a dao-voting-cw721-staked contract.
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        codeId,
        'dao-voting-cw721-staked'
      )
    ) {
      return []
    }

    const output: ExtractorHandlerOutput[] = []

    // Get total voting power at height.
    const totalVotingPower = await client
      .queryContractSmart(contractAddress, {
        total_power_at_height: {},
      })
      .then(({ power }) => power as string)

    output.push({
      address: contractAddress,
      name: `total_power_at_height:${this.env.block.height}`,
      data: totalVotingPower,
    })

    const votingPower = await client
      .queryContractSmart(contractAddress, {
        voting_power_at_height: {
          address: sender,
        },
      })
      .then(({ power }) => power as string)

    // Get all staked NFTs.
    const stakedTokenIds: string[] = []
    const limit = 30
    while (true) {
      const tokenIds = await client.queryContractSmart(contractAddress, {
        staked_nfts: {
          address: sender,
          start_after:
            stakedTokenIds.length > 0
              ? stakedTokenIds[stakedTokenIds.length - 1]
              : undefined,
          limit,
        },
      })

      if (tokenIds.length > 0) {
        stakedTokenIds.push(...tokenIds)
      }

      if (tokenIds.length < limit) {
        break
      }
    }

    output.push({
      address: contractAddress,
      name: `staker:${sender}`,
      data: {
        votingPower,
        stakedTokenIds,
      },
    })
    stakedTokenIds.forEach((tokenId) => {
      output.push({
        address: contractAddress,
        name: `stakedNftOwner:${tokenId}`,
        data: sender,
      })
    })

    return output
  }
}
