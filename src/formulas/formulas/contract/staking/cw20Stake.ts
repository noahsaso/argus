import { ContractFormula } from '@/types'

import {
  makeSimpleContractFormula,
  mapRange,
  snapshotItemMayLoadAtHeight,
  snapshotMapMayLoadAtHeight,
} from '../../utils'

export type StakerBalance = {
  address: string
  balance: string
}

export type StakedBalanceAtHeight = {
  balance: string
  height: number
}

export type TotalStakedAtHeight = {
  total: string
  height: number
}

export const config = makeSimpleContractFormula<any>({
  docs: {
    description: 'retrieves the configuration of the staking contract',
  },
  key: 'config',
})

export const stakedBalanceAtHeight: ContractFormula<
  StakedBalanceAtHeight,
  {
    address: string
    height?: string
    // Required when querying oraichain-cw20-staking contract directly.
    oraichainStakingToken?: string
  }
> = {
  docs: {
    description:
      'retrieves the staked balance object of an address at a specific block height, defaulting to the current block height',
    args: [
      {
        name: 'address',
        description: 'address to check the staked balance for',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'height',
        description: 'block height to get the staked balance at',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  filter: {
    codeIdsKeys: [
      'cw20-stake',
      'oraichain-cw20-staking',
      'oraichain-cw20-staking-proxy-snapshot',
    ],
  },
  compute: async (env) => {
    const {
      args: { address, height: _height, oraichainStakingToken },
      block,
      contractMatchesCodeIdKeys,
    } = env
    if (!address) {
      throw new Error('missing `address`')
    }

    let key = address
    const height = _height ? Number(_height) : Number(block.height)

    let contractAddress = env.contractAddress
    if (
      await contractMatchesCodeIdKeys(
        contractAddress,
        'oraichain-cw20-staking-proxy-snapshot'
      )
    ) {
      const proxyConfig = await config.compute(env)
      if (!proxyConfig) {
        throw new Error('missing proxy config')
      }
      contractAddress = proxyConfig.staking_contract
      key = `${proxyConfig.asset_key}:${address}`
    } else if (
      await contractMatchesCodeIdKeys(contractAddress, 'oraichain-cw20-staking')
    ) {
      if (!oraichainStakingToken) {
        throw new Error('missing `oraichainStakingToken`')
      }
      key = `${oraichainStakingToken}:${address}`
    }

    const balance =
      (await snapshotMapMayLoadAtHeight<string, string>({
        env: {
          ...env,
          contractAddress,
        },
        name: 'stakedBalance',
        key,
        height,
      })) ?? '0'

    return {
      balance,
      height,
    }
  },
}

export const stakedBalance: ContractFormula<
  string,
  {
    address: string
    height?: string
    // Required when querying oraichain-cw20-staking contract directly.
    oraichainStakingToken?: string
  }
> = {
  docs: {
    description:
      'retrieves the staked balance string of an address at a specific block height, defaulting to the current block height',
    args: [
      {
        name: 'address',
        description: 'address to check the staked balance for',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'height',
        description: 'block height to get the staked balance at',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  filter: stakedBalanceAtHeight.filter,
  compute: async (env) => (await stakedBalanceAtHeight.compute(env)).balance,
}

export const totalStakedAtHeight: ContractFormula<
  TotalStakedAtHeight,
  {
    height?: string
    // Required when querying oraichain-cw20-staking contract directly.
    oraichainStakingToken?: string
  }
> = {
  docs: {
    description:
      'retrieves the total staked amount at a specific block height, defaulting to the current block height',
    args: [
      {
        name: 'height',
        description: 'block height to get the total staked amount at',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  filter: {
    codeIdsKeys: [
      'cw20-stake',
      'oraichain-cw20-staking',
      'oraichain-cw20-staking-proxy-snapshot',
    ],
  },
  compute: async (env) => {
    const {
      args: { height: _height, oraichainStakingToken },
      block,
      contractMatchesCodeIdKeys,
    } = env

    let oraichainToken: string | undefined
    const height = _height ? Number(_height) : Number(block.height)

    let contractAddress = env.contractAddress
    if (
      await contractMatchesCodeIdKeys(
        contractAddress,
        'oraichain-cw20-staking-proxy-snapshot'
      )
    ) {
      const proxyConfig = await config.compute(env)
      if (!proxyConfig) {
        throw new Error('missing proxy config')
      }
      contractAddress = proxyConfig.staking_contract
      oraichainToken = proxyConfig.asset_key
    } else if (
      await contractMatchesCodeIdKeys(contractAddress, 'oraichain-cw20-staking')
    ) {
      if (!oraichainStakingToken) {
        throw new Error('missing `oraichainStakingToken`')
      }
      oraichainToken = oraichainStakingToken
    }

    const total =
      (oraichainToken
        ? await snapshotMapMayLoadAtHeight<string, string>({
            env: {
              ...env,
              contractAddress,
            },
            name: 'stakedTotal',
            key: oraichainToken,
            height,
          })
        : await snapshotItemMayLoadAtHeight<string>({
            env,
            name: 'stakedTotal',
            height,
          })) ?? '0'

    return {
      total,
      height,
    }
  },
}

export const totalStaked: ContractFormula<
  string,
  {
    height?: string
    // Required when querying oraichain-cw20-staking contract directly.
    oraichainStakingToken?: string
  }
> = {
  docs: {
    description:
      'retrieves the total staked amount at a specific block height, defaulting to the current block height',
    args: [
      {
        name: 'height',
        description: 'block height to get the total staked amount at',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  filter: totalStakedAtHeight.filter,
  compute: async (env) => (await totalStakedAtHeight.compute(env)).total,
}

export const stakedValue: ContractFormula<string, { address: string }> = {
  docs: {
    description: 'calculates the value of staked tokens for an address',
    args: [
      {
        name: 'address',
        description: 'address to calculate the staked value for',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  filter: {
    codeIdsKeys: ['cw20-stake'],
  },
  compute: async (env) => {
    if (!env.args.address) {
      throw new Error('missing `address`')
    }

    const balance = Number(await totalValue.compute(env))
    const staked = Number(await stakedBalance.compute(env))
    const total = Number(
      await totalStaked.compute({
        ...env,
        args: {},
      })
    )

    if (balance === 0 || staked === 0 || total === 0) {
      return '0'
    }

    return total === 0 ? '0' : Math.floor((staked * balance) / total).toString()
  },
}

export const totalValue = makeSimpleContractFormula<string>({
  key: 'balance',
  fallback: '0',
  docs: {
    description: 'retrieves the total value of the staking contract',
  },
})

export const claims: ContractFormula<any[], { address: string }> = {
  docs: {
    description: 'retrieves the claims for an address',
    args: [
      {
        name: 'address',
        description: 'address to retrieve claims for',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({ contractAddress, get, args: { address } }) => {
    if (!address) {
      throw new Error('missing `address`')
    }

    return (
      (await get<any[]>(contractAddress, 'claims', address))?.valueJson ?? []
    )
  },
}

export const listStakers: ContractFormula<
  StakerBalance[],
  {
    limit?: string
    startAfter?: string
  }
> = {
  docs: {
    description: 'lists stakers and their balances',
    args: [
      {
        name: 'limit',
        description: 'maximum number of stakers to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startAfter',
        description: 'address to start listing after',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async (env) => {
    const { limit, startAfter } = env.args

    const stakers = await mapRange<string>({
      env,
      name: 'stakedBalance',
      startAfter,
      limit: limit ? Math.max(0, Number(limit)) : undefined,
    })

    return stakers.map(({ key, value }) => ({
      address: key,
      balance: value,
    }))
  },
}

export const topStakers: ContractFormula<
  StakerBalance[],
  {
    limit?: string
    // Required when querying oraichain-cw20-staking contract directly.
    oraichainStakingToken?: string
  }
> = {
  docs: {
    description: 'retrieves the top stakers by balance',
    args: [
      {
        name: 'limit',
        description: 'maximum number of top stakers to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  filter: {
    codeIdsKeys: [
      'cw20-stake',
      'oraichain-cw20-staking',
      'oraichain-cw20-staking-proxy-snapshot',
    ],
  },
  compute: async (env) => {
    const {
      args: { limit, oraichainStakingToken },
      getTransformationMap,
      contractMatchesCodeIdKeys,
    } = env

    let contractAddress = env.contractAddress
    const keys = ['stakedBalance']
    if (
      await contractMatchesCodeIdKeys(
        contractAddress,
        'oraichain-cw20-staking-proxy-snapshot'
      )
    ) {
      const proxyConfig = await config.compute(env)
      if (!proxyConfig) {
        throw new Error('missing proxy config')
      }
      contractAddress = proxyConfig.staking_contract
      keys.push(proxyConfig.asset_key)
    } else if (
      await contractMatchesCodeIdKeys(contractAddress, 'oraichain-cw20-staking')
    ) {
      if (!oraichainStakingToken) {
        throw new Error('missing `oraichainStakingToken`')
      }
      keys.push(oraichainStakingToken)
    }

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    const stakers =
      (await getTransformationMap<string>(contractAddress, keys.join(':'))) ??
      {}
    const stakes = Object.entries(stakers)
      // Remove invalid addresses that end in colons (not sure how these appear,
      // probably the snapshot map internals) and zero balances.
      .filter(
        ([address, balance]) => !address.endsWith(':') && Number(balance) > 0
      )
      // Descending by balance.
      .sort(([, a], [, b]) => Number(b) - Number(a))
      .slice(0, limitNum)

    return stakes.map(([address, balance]) => ({
      address,
      balance,
    }))
  },
}

export const getHooks = makeSimpleContractFormula<
  string[],
  { hooks: string[] }
>({
  docs: {
    description: 'retrieves the hooks associated with the staking contract',
  },
  transformation: 'hooks',
  fallbackKeys: ['hooks'],
  fallback: { hooks: [] },
  transform: (hooks) => ({ hooks }),
})
