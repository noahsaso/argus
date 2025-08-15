import { Extraction } from '@/db'
import { WasmCodeService } from '@/services'
import { ExtractionJson, Extractor, ExtractorMaker } from '@/types'
import { batch, retry } from '@/utils'

export type NftStakeUpdateExtractorData = {
  updates: {
    contractAddress: string
    staked: {
      from: string
      tokenId: string
    }[]
    unstaked: {
      from: string
    }[]
  }[]
}

export const nftStakeUpdate: ExtractorMaker<
  NftStakeUpdateExtractorData
> = async ({ autoCosmWasmClient }) => {
  const match: Extractor<NftStakeUpdateExtractorData>['match'] = ({
    events,
  }) => {
    const allStaked = events.flatMap((e) => {
      if (
        e.type !== 'wasm' ||
        !e.attributes.some((a) => a.key === 'action' && a.value === 'stake')
      ) {
        return []
      }

      const contractAddress = e.attributes.find(
        (a) => a.key === '_contract_address'
      )?.value
      const from = e.attributes.find((a) => a.key === 'from')?.value
      const tokenId = e.attributes.find((a) => a.key === 'token_id')?.value
      if (!contractAddress || !from || !tokenId) {
        return []
      }

      return {
        contractAddress,
        staked: {
          from,
          tokenId,
        },
      }
    })
    const allUnstaked = events.flatMap((e) => {
      if (
        e.type !== 'wasm' ||
        !e.attributes.some((a) => a.key === 'action' && a.value === 'unstake')
      ) {
        return []
      }

      const contractAddress = e.attributes.find(
        (a) => a.key === '_contract_address'
      )?.value
      const from = e.attributes.find((a) => a.key === 'from')?.value
      if (!contractAddress || !from) {
        return []
      }

      return {
        contractAddress,
        unstaked: {
          from,
        },
      }
    })

    const updates = Object.values(
      [...allStaked, ...allUnstaked].reduce(
        (acc, { contractAddress, ...fields }) => {
          if (!acc[contractAddress]) {
            acc[contractAddress] = {
              contractAddress,
              staked: [],
              unstaked: [],
            }
          }

          if ('staked' in fields) {
            acc[contractAddress].staked.push(fields.staked)
          }

          if ('unstaked' in fields) {
            acc[contractAddress].unstaked.push(fields.unstaked)
          }

          return acc
        },
        {} as Record<
          string,
          {
            contractAddress: string
            staked: { from: string; tokenId: string }[]
            unstaked: { from: string }[]
          }
        >
      )
    )

    return updates.length > 0
      ? {
          updates,
        }
      : undefined
  }

  const extract: Extractor<NftStakeUpdateExtractorData>['extract'] = async ({
    txHash,
    block: { height, timeUnixMs },
    data: { updates },
  }) => {
    await autoCosmWasmClient.update()
    const client = autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const daoVotingCw721StakedCodeIds =
      WasmCodeService.getInstance().findWasmCodeIdsByKeys(
        'dao-voting-cw721-staked'
      )

    const extractions = (
      await Promise.allSettled(
        updates.map(({ contractAddress, staked, unstaked }) =>
          retry(
            3,
            async () => {
              const { codeId } = await client.getContract(contractAddress)
              // Only process if the contract is a dao-voting-cw721-staked
              // contract.
              if (!daoVotingCw721StakedCodeIds.includes(codeId)) {
                return []
              }

              const uniqueAddresses = [
                ...new Set([
                  ...staked.map((s) => s.from),
                  ...unstaked.map((u) => u.from),
                ]),
              ]

              const extractions: ExtractionJson[] = []

              // Get total voting power at height.
              const totalVotingPower = await client
                .queryContractSmart(contractAddress, {
                  total_power_at_height: {
                    height: Number(height),
                  },
                })
                .then(({ power }) => power as string)

              extractions.push({
                address: contractAddress,
                name: `total_power_at_height:${height}`,
                blockHeight: height,
                blockTimeUnixMs: timeUnixMs,
                txHash,
                data: totalVotingPower,
              })

              // Get staked NFTs and voting power for each address.
              await batch({
                list: uniqueAddresses,
                batchSize: 10,
                task: async (address) => {
                  const votingPower = await client
                    .queryContractSmart(contractAddress, {
                      voting_power_at_height: {
                        address,
                        height: Number(height),
                      },
                    })
                    .then(({ power }) => power as string)

                  // Get all staked NFTs.
                  const stakedTokenIds = []
                  const limit = 30
                  while (true) {
                    const tokenIds = await client.queryContractSmart(
                      contractAddress,
                      {
                        staked_nfts: {
                          address,
                          start_after:
                            stakedTokenIds.length > 0
                              ? stakedTokenIds[stakedTokenIds.length - 1]
                              : undefined,
                          limit,
                        },
                      }
                    )

                    if (tokenIds.length > 0) {
                      stakedTokenIds.push(...tokenIds)
                    }

                    if (tokenIds.length < limit) {
                      break
                    }
                  }

                  extractions.push({
                    address: contractAddress,
                    name: `staker:${address}`,
                    blockHeight: height,
                    blockTimeUnixMs: timeUnixMs,
                    txHash,
                    data: {
                      votingPower,
                      stakedTokenIds,
                    },
                  })
                  stakedTokenIds.forEach((tokenId) => {
                    extractions.push({
                      address: contractAddress,
                      name: `stakedNftOwner:${tokenId}`,
                      blockHeight: height,
                      blockTimeUnixMs: timeUnixMs,
                      txHash,
                      data: address,
                    })
                  })
                },
              })

              return extractions
            },
            1_000
          )
        )
      )
    ).flatMap((s) => (s.status === 'fulfilled' ? s.value : []))

    const createdExtractions = await Extraction.bulkCreate(extractions, {
      updateOnDuplicate: ['blockTimeUnixMs', 'txHash', 'data'],
      conflictAttributes: ['address', 'name', 'blockHeight'],
      returning: true,
    })

    return createdExtractions
  }

  return {
    match,
    extract,
  }
}
