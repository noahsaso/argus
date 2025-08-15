import { ContractFormula } from '@/types'

import {
  Expiration,
  TotalPowerAtHeight,
  VotingPowerAtHeight,
} from '../../types'
import {
  makeSimpleContractFormula,
  mapRange,
  snapshotItemMayLoadAtHeight,
  snapshotMapMayLoadAtHeight,
} from '../../utils'

type Config = {
  owner?: string | null
  nft_address: string
  unstaking_duration?: any
}

const CODE_IDS_KEYS = ['dao-voting-cw721-staked']

export { activeThreshold } from './common'

export const config = makeSimpleContractFormula<Config>({
  docs: {
    description: 'retrieves the configuration of the contract',
  },
  filter: {
    codeIdsKeys: CODE_IDS_KEYS,
  },
  transformation: 'config',
})

export const dao = makeSimpleContractFormula<string>({
  docs: {
    description: 'retrieves the DAO address associated with the contract',
  },
  filter: {
    codeIdsKeys: CODE_IDS_KEYS,
  },
  transformation: 'dao',
})

type NftClaim = {
  token_id: string
  release_at: Expiration
  legacy: boolean
}

export const nftClaims: ContractFormula<NftClaim[], { address: string }> = {
  docs: {
    description: 'retrieves the NFT claims for a given address',
    args: [
      {
        name: 'address',
        description: 'address to get NFT claims for',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({
    contractAddress,
    get,
    getTransformationMap,
    args: { address },
  }) => {
    if (!address) {
      throw new Error('missing `address`')
    }

    const legacyClaims = (
      (
        await get<Omit<NftClaim, 'legacy'>[]>(
          contractAddress,
          'nft_claims',
          address
        )
      )?.valueJson ?? []
    ).map((claim) => ({
      ...claim,
      legacy: true,
    }))

    const claims = Object.entries(
      (await getTransformationMap<Expiration>(
        contractAddress,
        `claim:${address}`
      )) ?? {}
    ).map(
      ([token_id, release_at]): NftClaim => ({
        token_id,
        release_at,
        legacy: false,
      })
    )

    return [...legacyClaims, ...claims]
  },
}

export const votingPowerAtHeight: ContractFormula<
  VotingPowerAtHeight,
  {
    address: string
    height?: string
  }
> = {
  docs: {
    description:
      'retrieves the voting power for an address, optionally at a specific block height',
    args: [
      {
        name: 'address',
        description: 'address to get voting power for',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'height',
        description: 'block height to get voting power at',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  // Filter by code ID since someone may modify the contract. This is also used
  // in DAO core to match the voting module and pass the query through.
  filter: {
    codeIdsKeys: CODE_IDS_KEYS,
  },
  compute: async (env) => {
    if (!env.args.address) {
      throw new Error('missing `address`')
    }

    const height = env.args.height
      ? Number(env.args.height)
      : Number(env.block.height)
    const power =
      (await snapshotMapMayLoadAtHeight<string, string>({
        env,
        name: 'nftBalances',
        key: env.args.address,
        height,
      })) ?? '0'

    return {
      power,
      height,
    }
  },
}

export const votingPower: ContractFormula<string, { address: string }> = {
  docs: {
    description:
      'retrieves the voting power for an address at the current block height',
    args: [
      {
        name: 'address',
        description: 'address to get voting power for',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  filter: votingPowerAtHeight.filter,
  compute: async (env) => (await votingPowerAtHeight.compute(env)).power,
}

export const totalPowerAtHeight: ContractFormula<
  TotalPowerAtHeight,
  {
    height?: string
  }
> = {
  docs: {
    description:
      'retrieves the total voting power, optionally at a specific block height',
    args: [
      {
        name: 'height',
        description: 'block height to get total power at',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  // Filter by code ID since someone may modify the contract. This is also used
  // in DAO core to match the voting module and pass the query through.
  filter: {
    codeIdsKeys: CODE_IDS_KEYS,
  },
  compute: async (env) => {
    const height = env.args.height
      ? Number(env.args.height)
      : Number(env.block.height)

    let power = await snapshotItemMayLoadAtHeight<string>({
      env,
      name: 'totalStakedNfts',
      height,
    })

    // If power not found, try extraction.
    if (!power) {
      power = (
        await env.getExtraction(
          env.contractAddress,
          `total_power_at_height:${BigInt(height).toString()}`
        )
      )?.data as string | undefined
    }

    power ??= '0'

    return {
      power,
      height,
    }
  },
}

export const totalPower: ContractFormula<string> = {
  docs: {
    description: 'retrieves the total voting power at the current block height',
  },
  filter: totalPowerAtHeight.filter,
  compute: async (env) => (await totalPowerAtHeight.compute(env)).power,
}

export const stakedNfts: ContractFormula<
  any[],
  {
    address: string
    limit?: string
    startAfter?: string
  }
> = {
  docs: {
    description: 'retrieves the staked NFTs for a given address',
    args: [
      {
        name: 'address',
        description: 'address to get staked NFTs for',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'limit',
        description: 'maximum number of NFTs to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startAfter',
        description: 'token ID to start after in the list',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  filter: {
    codeIdsKeys: CODE_IDS_KEYS,
  },
  compute: async (env) => {
    const { address, limit, startAfter } = env.args
    if (!address) {
      throw new Error('missing `address`')
    }

    // Get extraction, if exists.
    const extractedTokenIds = (
      (await env.getExtraction(env.contractAddress, `staker:${address}`))
        ?.data as any
    )?.stakedTokenIds
    if (extractedTokenIds) {
      return extractedTokenIds
    }

    // Fallback to state.
    const tokenIds = (
      await mapRange({
        env,
        name: `stakedNft:${address}`,
        startAfter,
        limit: limit ? Math.max(0, Number(limit)) : undefined,
      })
    ).map(({ key }) => key)

    return tokenIds
  },
}

export const staker: ContractFormula<string, { tokenId: string }> = {
  docs: {
    description: 'retrieves the staker address for a given token ID',
    args: [
      {
        name: 'tokenId',
        description: 'token ID to get staker for',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  filter: {
    codeIdsKeys: CODE_IDS_KEYS,
  },
  compute: async ({
    contractAddress,
    getTransformationMatch,
    getExtraction,
    args: { tokenId },
  }) => {
    if (!tokenId) {
      throw new Error('missing `tokenId`')
    }

    // Get extraction, if exists.
    const extractedOwner = (
      await getExtraction(contractAddress, `stakedNftOwner:${tokenId}`)
    )?.data as string | undefined
    if (extractedOwner) {
      return extractedOwner
    }

    const owner = (
      await getTransformationMatch<string>(
        contractAddress,
        `stakedNftOwner:${tokenId}`
      )
    )?.value

    if (!owner) {
      throw new Error('token ID not found')
    }

    return owner
  },
}

type Staker = {
  address: string
  count: number
  votingPowerPercent: number
}

export const topStakers: ContractFormula<
  Staker[],
  {
    limit?: string
  }
> = {
  docs: {
    description: 'retrieves the top stakers sorted by voting power',
    args: [
      {
        name: 'limit',
        description: 'maximum number of stakers to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  filter: {
    codeIdsKeys: CODE_IDS_KEYS,
  },
  compute: async (env) => {
    const {
      contractAddress,
      getTransformationMap,
      getExtractionMap,
      args: { limit },
    } = env

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    const [nftBalancesMap, stakerExtractions] = await Promise.all([
      // State
      getTransformationMap<string>(contractAddress, 'nftBalances').then(
        (map) => map ?? {}
      ),
      // TX extractions
      getExtractionMap<{
        votingPower: string
      }>(contractAddress, 'staker').then((map) => map ?? {}),
    ])

    // Combine.
    const allBalances = {
      ...nftBalancesMap,
      // Override state with extractions.
      ...Object.fromEntries(
        Object.entries(stakerExtractions).map(([address, { votingPower }]) => [
          address,
          votingPower,
        ])
      ),
    }

    const nftBalances = Object.entries(allBalances)
      // Remove zero balances.
      .filter(([, balance]) => Number(balance) > 0)
      // Descending by balance.
      .sort(([, a], [, b]) => Number(b) - Number(a))
      .slice(0, limitNum)

    // Get total power.
    const totalVotingPower = Number(
      await totalPower.compute({
        ...env,
        // Make sure to not pass height in case it was passed to this formula.
        args: {},
      })
    )

    // Compute voting power for each staker.
    const stakers = nftBalances.map(
      ([address, balance]): Staker => ({
        address,
        count: Number(balance),
        votingPowerPercent:
          totalVotingPower === 0
            ? 0
            : (Number(balance) / totalVotingPower) * 100,
      })
    )

    return stakers
  },
}

// Map NFT token ID to staker.
export const ownersOfStakedNfts: ContractFormula<Record<string, string>> = {
  docs: {
    description: 'retrieves a mapping of NFT token IDs to their stakers',
  },
  filter: {
    codeIdsKeys: CODE_IDS_KEYS,
  },
  compute: async (env) => {
    const { contractAddress, getTransformationMap, getExtractionMap } = env

    const [nftBalancesMap, stakerExtractions] = await Promise.all([
      // State
      getTransformationMap<string>(contractAddress, 'nftBalances').then(
        (map) => map ?? {}
      ),
      // TX extractions
      getExtractionMap<{
        votingPower: string
      }>(contractAddress, 'stakedNftOwner').then((map) => map ?? {}),
    ])

    // Combine.
    const allBalances = {
      ...nftBalancesMap,
      // Override state with extractions.
      ...Object.fromEntries(
        Object.entries(stakerExtractions).map(([address, { votingPower }]) => [
          address,
          votingPower,
        ])
      ),
    }

    const stakers = Object.entries(allBalances)
      // Remove zero balances.
      .filter(([, balance]) => Number(balance) > 0)
      .map(([address]) => address)

    const stakedNftsPerStaker = await Promise.all(
      stakers.map(async (address) => ({
        address,
        tokenIds: await stakedNfts.compute({
          ...env,
          args: {
            address,
          },
        }),
      }))
    )

    return stakedNftsPerStaker.reduce(
      (acc, { address, tokenIds }) => ({
        ...acc,
        ...tokenIds.reduce(
          (acc, tokenId) => ({
            ...acc,
            [tokenId]: address,
          }),
          {} as Record<string, string>
        ),
      }),
      {} as Record<string, string>
    )
  },
}

export const hooks = makeSimpleContractFormula<string[], { hooks: string[] }>({
  docs: {
    description: 'retrieves the hooks associated with the contract',
  },
  transformation: 'hooks',
  fallbackKeys: ['hooks'],
  fallback: { hooks: [] },
  transform: (hooks) => ({ hooks }),
})
