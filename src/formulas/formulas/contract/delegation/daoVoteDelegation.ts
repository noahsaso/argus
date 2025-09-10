import { ContractFormula } from '@/types'

import {
  makeSimpleContractFormula,
  mapRange,
  snapshotItemMayLoadAtHeight,
  snapshotMapMayLoadAtHeight,
  snapshotVectorMapLoad,
  wormholeLoad,
} from '../../utils'
import { totalPowerAtHeight } from '../daoCore/base'

const CODE_IDS_KEYS: string[] = ['dao-vote-delegation']

export { info } from '../common'

export const config = makeSimpleContractFormula({
  docs: {
    description: 'retrieves the configuration of the delegation module',
  },
  filter: {
    codeIdsKeys: CODE_IDS_KEYS,
  },
  transformation: 'config',
  fallbackKeys: ['config'],
})

export const registration: ContractFormula<
  {
    registered: boolean
    power: string
    height: number
  },
  {
    delegate: string
    height?: string
  }
> = {
  docs: {
    description:
      'retrieves whether or not a delegate is registered, optionally at a given block height',
    args: [
      {
        name: 'delegate',
        description: 'address of the delegate',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'height',
        description: 'block height to retrieve delegate registration at',
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
    if (!env.args.delegate) {
      throw new Error('delegate is required')
    }

    const height = env.args.height
      ? Number(env.args.height)
      : Number(env.block.height)

    const registered = !!(await snapshotMapMayLoadAtHeight({
      env,
      name: 'delegates',
      key: env.args.delegate,
      height,
    }))

    const power =
      (await wormholeLoad<string, string>({
        env,
        name: 'delegatedVotingPower',
        key: env.args.delegate,
        timestamp: height,
      })) || '0'

    return {
      registered,
      power,
      height,
    }
  },
}

export const delegates: ContractFormula<
  {
    delegates: {
      delegate: string
      power: string
    }[]
  },
  {
    startAfter?: string
    limit?: string
  }
> = {
  docs: {
    description: 'retrieves the list of active delegates',
    args: [
      {
        name: 'startAfter',
        description: 'address to start listing delegates after',
        required: false,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'limit',
        description: 'maximum number of delegates to return',
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
      args: { startAfter, limit },
      block: { height },
    } = env

    const range = await mapRange({
      env,
      name: 'delegates',
      startAfter,
      limit: limit ? Math.max(0, Number(limit)) : undefined,
    })

    const delegates = await Promise.all(
      range.map(async ({ key }) => ({
        delegate: key,
        power:
          (await wormholeLoad<string, string>({
            env,
            name: 'delegatedVotingPower',
            key,
            timestamp: Number(height),
          })) || '0',
      }))
    )

    return {
      delegates,
    }
  },
}

export const delegations: ContractFormula<
  {
    delegations: {
      delegate: string
      percent: string
      active: boolean
    }[]
    height: number
  },
  {
    delegator: string
    height?: string
    offset?: string
    limit?: string
  }
> = {
  docs: {
    description:
      'retrieves a list of delegations by a delegator, optionally at a given block height',
    args: [
      {
        name: 'delegator',
        description: 'address of the delegator',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'height',
        description: 'block height to retrieve delegations at',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'offset',
        description: 'offset to start listing delegations at',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'limit',
        description: 'maximum number of delegations to return',
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
      args: { delegator, height: _height, offset: _offset, limit: _limit },
    } = env

    if (!delegator) {
      throw new Error('delegator is required')
    }

    const height = _height
      ? Math.max(0, Number(_height))
      : Number(env.block.height)
    const offset = _offset ? Math.max(0, Number(_offset)) : undefined
    const limit = _limit ? Math.max(0, Number(_limit)) : undefined

    const list = await snapshotVectorMapLoad<
      string,
      { delegate: string; percent: string }
    >({
      env,
      name: 'delegations',
      key: delegator,
      height,
      offset,
      limit,
    })

    const delegations = (
      await Promise.all(
        list.map(async ({ item }) =>
          item
            ? {
                delegate: item.delegate,
                percent: item.percent,
                active: !!(await snapshotMapMayLoadAtHeight({
                  env,
                  name: 'delegates',
                  key: item.delegate,
                  height,
                })),
              }
            : []
        )
      )
    ).flat()

    return {
      delegations,
      height,
    }
  },
}

export const unvotedDelegatedVotingPower: ContractFormula<
  {
    total: string
    effective: string
  },
  {
    delegate: string
    proposalModule: string
    proposalId: string
    height: string
  }
> = {
  docs: {
    description:
      'retrieves the voting power delegated to a delegate that has not yet been used in votes cast by delegators in a specific proposal',
    args: [
      {
        name: 'delegate',
        description: 'address of the delegate',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'proposalModule',
        description: 'address of the proposal module',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'proposalId',
        description: 'proposal ID',
        required: true,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'height',
        description: 'block height the proposal was created at',
        required: true,
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
      get,
      getTransformationMatch,
      args: { delegate, proposalModule, proposalId, height: _height },
    } = env

    if (!delegate) {
      throw new Error('delegate is required')
    }
    if (!proposalModule) {
      throw new Error('proposalModule is required')
    }
    if (!proposalId) {
      throw new Error('proposalId is required')
    }
    if (!_height) {
      throw new Error('height is required')
    }

    const height = Number(_height)
    if (height < 1) {
      throw new Error('height must be greater than or equal to 1')
    }

    const active = !!(await snapshotMapMayLoadAtHeight({
      env,
      name: 'delegates',
      key: delegate,
      height,
    }))
    if (!active) {
      return {
        total: '0',
        effective: '0',
      }
    }

    // if no unvoted delegated VP exists for the proposal, use the delegate's
    // total delegated VP at that height. UNVOTED_DELEGATED_VP gets set when the
    // delegate or one of their delegators casts a vote. if empty, none of them
    // have voted yet.
    const total =
      (
        await getTransformationMatch<string>(
          contractAddress,
          `unvotedDelegatedVotingPower:${delegate}:${proposalModule}:${proposalId}`
        )
      )?.value ??
      (await wormholeLoad<string, string>({
        env,
        name: 'delegatedVotingPower',
        key: delegate,
        timestamp: height,
      })) ??
      '0'

    let effective = total

    // if a VP cap is set, apply it to the total VP to get the effective VP.
    const vpCapPercent = await snapshotItemMayLoadAtHeight<string>({
      env,
      name: 'vpCapPercent',
      height,
    })

    if (vpCapPercent && Number(vpCapPercent) < 1) {
      const dao =
        (await getTransformationMatch<string>(contractAddress, 'dao'))?.value ??
        (await get(contractAddress, 'dao'))?.valueJson
      if (!dao) {
        throw new Error('DAO not found')
      }

      const totalPower = Number(
        (
          await totalPowerAtHeight.compute({
            ...env,
            contractAddress: dao,
            args: {
              height: _height,
            },
          })
        ).power
      )

      const vpCapPercentNum = Number(vpCapPercent)
      const cap =
        totalPower === 0 || vpCapPercentNum === 0
          ? 0
          : Math.floor(totalPower * vpCapPercentNum)

      effective = BigInt(Math.min(Number(total), cap)).toString()
    }

    return {
      total,
      effective,
    }
  },
}

export const proposalModules = makeSimpleContractFormula<
  string[],
  string[],
  {
    startAfter?: string
    limit?: string
  }
>({
  docs: {
    description: 'retrieves the list of proposal modules',
    args: [
      {
        name: 'startAfter',
        description: 'address to start listing proposal modules after',
        required: false,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'limit',
        description: 'maximum number of proposal modules to return',
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
  transformation: 'proposalHookCallers',
  fallback: [],
  transform: (data, { args: { startAfter, limit } }) =>
    data
      // Ascending by address.
      .sort(([a], [b]) => a.localeCompare(b))
      .filter((item) => !startAfter || item.localeCompare(startAfter) > 0)
      .slice(0, limit ? Math.max(0, Number(limit)) : Infinity),
})

export const votingPowerHookCallers = makeSimpleContractFormula<
  string[],
  string[],
  {
    startAfter?: string
    limit?: string
  }
>({
  docs: {
    description: 'retrieves the list of voting power hook callers',
    args: [
      {
        name: 'startAfter',
        description: 'address to start listing hook callers after',
        required: false,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'limit',
        description: 'maximum number of hook callers to return',
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
  transformation: 'votingPowerHookCallers',
  fallback: [],
  transform: (data, { args: { startAfter, limit } }) =>
    data
      // Ascending by address.
      .sort(([a], [b]) => a.localeCompare(b))
      .filter((item) => !startAfter || item.localeCompare(startAfter) > 0)
      .slice(0, limit ? Math.max(0, Number(limit)) : Infinity),
})

export const votingPowerCap: ContractFormula<
  {
    vp_cap_percent?: string | null
    height: number
  },
  {
    height?: string
  }
> = {
  docs: {
    description: 'retrieves the voting power cap, optionally at a given height',
    args: [
      {
        name: 'height',
        description: 'block height to retrieve voting power cap at',
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
    const height = env.args.height
      ? Number(env.args.height)
      : Number(env.block.height)
    const vpCapPercent =
      (await snapshotItemMayLoadAtHeight<string | null>({
        env,
        name: 'vpCapPercent',
        height,
      })) ?? null

    return {
      vp_cap_percent: vpCapPercent,
      height,
    }
  },
}
