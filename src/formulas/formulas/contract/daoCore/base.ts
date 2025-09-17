import { ContractFormula } from '@/types'

import {
  ContractInfo,
  Expiration,
  ProposalModule,
  TotalPowerAtHeight,
  VotingPowerAtHeight,
} from '../../types'
import { isExpirationExpired, makeSimpleContractFormula } from '../../utils'
import { info } from '../common'
import { balance } from '../external/cw20'
import { dao as daoPreProposeBaseDao } from '../prePropose/daoPreProposeBase'
import {
  totalPowerAtHeight as daoVotingCw20StakedTotalPowerAtHeight,
  votingPowerAtHeight as daoVotingCw20StakedVotingPowerAtHeight,
} from '../voting/daoVotingCw20Staked'
import {
  totalPowerAtHeight as daoVotingCw4TotalPowerAtHeight,
  votingPowerAtHeight as daoVotingCw4VotingPowerAtHeight,
} from '../voting/daoVotingCw4'
import {
  totalPowerAtHeight as daoVotingCw721StakedTotalPowerAtHeight,
  votingPowerAtHeight as daoVotingCw721StakedVotingPowerAtHeight,
} from '../voting/daoVotingCw721Staked'
import {
  totalPowerAtHeight as daoVotingNativeStakedTotalPowerAtHeight,
  votingPowerAtHeight as daoVotingNativeStakedVotingPowerAtHeight,
} from '../voting/daoVotingNativeStaked'
import {
  totalPowerAtHeight as daoVotingOnftStakedTotalPowerAtHeight,
  votingPowerAtHeight as daoVotingOnftStakedVotingPowerAtHeight,
} from '../voting/daoVotingOnftStaked'
import {
  totalPowerAtHeight as daoVotingSgCommunityNftTotalPowerAtHeight,
  votingPowerAtHeight as daoVotingSgCommunityNftVotingPowerAtHeight,
} from '../voting/daoVotingSgCommunityNft'
import {
  totalPowerAtHeight as daoVotingTokenStakedTotalPowerAtHeight,
  votingPowerAtHeight as daoVotingTokenStakedVotingPowerAtHeight,
} from '../voting/daoVotingTokenStaked'
import { DumpState } from './dump'

export type Config = {
  automatically_add_cw20s: boolean
  automatically_add_cw721s: boolean
  dao_uri?: string | null
  description: string
  image_url?: string | null
  name: string
}

export type ProposalModuleWithInfo = ProposalModule & {
  info?: ContractInfo
}

export type PauseInfoResponse =
  | {
      paused: {
        expiration: Expiration
      }
    }
  | {
      unpaused: {}
    }

export type Cw20Balance = {
  addr: string
  balance?: string
}

export type SubDao = {
  addr: string
  charter?: string | null
}

export const config = makeSimpleContractFormula<Config>({
  docs: {
    description: 'retrieves the DAO configuration',
  },
  sources: [
    {
      type: 'extraction',
      name: 'dao-dao-core/config',
    },
    {
      type: 'transformation',
      name: 'config',
    },
    {
      type: 'event',
      key: 'config_v2',
    },
    {
      type: 'event',
      key: 'config',
    },
  ],
})

export const proposalModules: ContractFormula<ProposalModuleWithInfo[]> = {
  docs: {
    description: 'retrieves all proposal modules for the DAO',
  },
  compute: async (env) => {
    const { contractAddress, getTransformationMap, getMap, getExtractionMap } =
      env

    const proposalModules: ProposalModule[] = []

    const transformedMap =
      (await getTransformationMap<ProposalModule>(
        contractAddress,
        'proposalModule'
      )) ||
      // Fallback to extractions.
      (await getExtractionMap<ProposalModule>(
        contractAddress,
        'proposalModule'
      ))

    // Transformed / extracted.
    if (transformedMap) {
      proposalModules.push(...Object.values(transformedMap))
    } else {
      // Fallback to events.
      // V2.
      const proposalModuleMap = await getMap<string, ProposalModule>(
        contractAddress,
        'proposal_modules_v2'
      )
      if (proposalModuleMap) {
        proposalModules.push(...Object.values(proposalModuleMap))
      }
      // V1.
      else {
        const proposalModuleAddresses = Object.keys(
          (await getMap<string, string>(contractAddress, 'proposal_modules')) ??
            {}
        )
        proposalModules.push(
          ...proposalModuleAddresses.map((address) => ({
            address,
            // V1 modules don't have a prefix.
            prefix: '',
            // V1 modules are always enabled.
            status: 'Enabled' as const,
          }))
        )
      }
    }

    // If no proposal modules, this must not be a DAO core contract.
    if (!proposalModules.length) {
      throw new Error('failed to load proposal modules')
    }

    return await Promise.all(
      proposalModules
        // Reverse since the getter returns them in descending order, and v1
        // prefixes are in ascending order.
        .reverse()
        .map(async (data, index): Promise<ProposalModuleWithInfo> => {
          const contractInfo = await info.compute({
            ...env,
            contractAddress: data.address,
          })

          return {
            ...data,
            prefix: data.prefix || indexToProposalModulePrefix(index),
            info: contractInfo,
          }
        })
    )
  },
}

export const activeProposalModules: ContractFormula<ProposalModuleWithInfo[]> =
  {
    docs: {
      description:
        'retrieves all active (enabled) proposal modules for the DAO',
    },
    compute: async (env) => {
      const modules = await proposalModules.compute(env)
      return modules.filter(
        (module) => module.status === 'enabled' || module.status === 'Enabled'
      )
    },
  }

export const pauseInfo = makeSimpleContractFormula<
  Expiration,
  PauseInfoResponse
>({
  docs: {
    description: 'retrieves the pause status of the DAO',
  },
  // This formula depends on the block height/time to check expiration.
  dynamic: true,
  sources: [
    {
      type: 'transformation',
      name: 'paused',
    },
    {
      type: 'event',
      key: 'paused',
    },
  ],
  transform: (expiration, env) =>
    isExpirationExpired(env, expiration)
      ? { unpaused: {} }
      : { paused: { expiration } },
})

// Backwards compatibility.
export const paused = pauseInfo

export const admin = makeSimpleContractFormula<string | null>({
  docs: {
    description: 'retrieves the admin address of the DAO',
  },
  sources: [
    {
      type: 'transformation',
      name: 'admin',
    },
    {
      type: 'event',
      key: 'admin',
    },
    // Fallback to Neutron SubDAO config main_dao field.
    {
      type: 'event',
      key: 'config_v2',
      transform: (data?: { main_dao?: string }) => data?.main_dao ?? null,
    },
  ],
})

export const adminNomination = makeSimpleContractFormula<string | null>({
  docs: {
    description: 'retrieves the nominated admin address of the DAO',
  },
  sources: [
    {
      type: 'transformation',
      name: 'nominatedAdmin',
    },
    {
      type: 'event',
      key: 'nominated_admin',
    },
  ],
})

export const votingModule = makeSimpleContractFormula<string>({
  docs: {
    description: 'retrieves the voting module address of the DAO',
  },
  sources: [
    {
      type: 'extraction',
      name: 'dao-dao-core/dump_state',
      transform: (data: DumpState) => {
        // Should never happen.
        if (!data.voting_module) {
          throw new Error('failed to load voting module')
        }
        return data.voting_module
      },
    },
    {
      type: 'transformation',
      name: 'votingModule',
    },
    {
      type: 'event',
      key: 'voting_module',
    },
  ],
})

export const item = makeSimpleContractFormula<
  string | null,
  string,
  { key: string }
>({
  docs: {
    description: "retrieves a specific item from the DAO's storage",
    args: [
      {
        name: 'key',
        description: 'key of the item to retrieve',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  validate: ({ key }) => {
    if (!key) {
      throw new Error('missing `key`')
    }
  },
  sources: [
    {
      type: 'transformation',
      name: ({ key }) => `item:${key}`,
    },
    {
      type: 'event',
      key: ({ key }) => ['items', key],
    },
  ],
})

export const listItems: ContractFormula<[string, string][]> = {
  docs: {
    description: 'retrieves all items stored in the DAO',
  },
  compute: async ({
    contractAddress,
    getTransformationMap,
    getMap,
    getExtraction,
  }) => {
    const items =
      (await getTransformationMap<string>(contractAddress, 'item')) ??
      // Fallback to events.
      (await getMap<string>(contractAddress, 'items'))

    if (items) return Object.entries(items)
    else {
      const extraction = await getExtraction(
        contractAddress,
        'dao-dao-core/list_items'
      )
      if (extraction) {
        return extraction.data as [string, string][]
      }
    }
    return []
  },
}

export const cw20List: ContractFormula<string[]> = {
  docs: {
    description:
      'retrieves the list of CW20 token addresses associated with the DAO',
  },
  compute: async ({ contractAddress, getTransformationMap, getMap }) =>
    Object.keys(
      (await getTransformationMap<string>(contractAddress, 'cw20')) ??
        // Fallback to events.
        (await getMap<string>(contractAddress, 'cw20s')) ??
        {}
    ),
}

export const cw721List: ContractFormula<string[]> = {
  docs: {
    description:
      'retrieves the list of CW721 NFT addresses associated with the DAO',
  },
  compute: async ({ contractAddress, getTransformationMap, getMap }) =>
    Object.keys(
      (await getTransformationMap<string>(contractAddress, 'cw721')) ??
        // Fallback to events.
        (await getMap<string>(contractAddress, 'cw721s')) ??
        {}
    ),
}

export const cw20Balances: ContractFormula<Cw20Balance[]> = {
  docs: {
    description: 'retrieves the CW20 token balances for the DAO',
  },
  compute: async (env) => {
    // cw20 addresses stored in contract list. backwards compatibility as the
    // frontend doesn't use this anymore.
    const cw20Addresses = (await cw20List.compute(env)) ?? []
    // cw20 addresses stored in items, formatted as `cw20:[address]`
    const cw20ItemAddresses = (await listItems.compute(env)).flatMap(
      ([key, value]) =>
        key.startsWith('cw20:') && value === '1' ? key.substring(5) : []
    )

    return await Promise.all(
      Array.from(new Set([...cw20Addresses, ...cw20ItemAddresses])).map(
        async (addr): Promise<Cw20Balance> => {
          const balanceResponse = await balance.compute({
            ...env,
            contractAddress: addr,
            args: { address: env.contractAddress },
          })

          return {
            addr,
            balance: balanceResponse,
          }
        }
      )
    )
  },
}

export const listSubDaos: ContractFormula<SubDao[]> = {
  docs: {
    description: 'retrieves the list of subDAOs recognized by the DAO',
  },
  compute: async ({ contractAddress, getTransformationMap, getMap }) => {
    // V2. V1 doesn't have sub DAOs; use empty map if undefined.
    const subDaoMap =
      (await getTransformationMap<string | null>(contractAddress, 'subDao')) ??
      // Fallback to events.
      (await getMap<string, string | null>(contractAddress, 'sub_daos')) ??
      {}

    return Object.entries(subDaoMap).map(([addr, charter]) => ({
      addr,
      charter,
    }))
  },
}

export const daoUri: ContractFormula<{ dao_uri: string | null }> = {
  docs: {
    description: 'retrieves the URI of the DAO',
  },
  compute: async (env) => ({
    dao_uri: (await config.compute(env)).dao_uri ?? null,
  }),
}

const VOTING_POWER_AT_HEIGHT_FORMULAS: ContractFormula<
  VotingPowerAtHeight,
  { address: string; height?: string }
>[] = [
  daoVotingCw4VotingPowerAtHeight,
  daoVotingCw20StakedVotingPowerAtHeight,
  daoVotingCw721StakedVotingPowerAtHeight,
  daoVotingNativeStakedVotingPowerAtHeight,
  daoVotingTokenStakedVotingPowerAtHeight,
  daoVotingOnftStakedVotingPowerAtHeight,
  daoVotingSgCommunityNftVotingPowerAtHeight,
]

export const votingPowerAtHeight: ContractFormula<
  VotingPowerAtHeight,
  { address: string; height?: string }
> = {
  docs: {
    description:
      'retrieves the voting power for a given address, optionally at a specific block height for a given address',
    args: [
      {
        name: 'address',
        description: 'address to check voting power for',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'height',
        description: 'block height to check voting power at',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  compute: async (env) => {
    const votingModuleAddress = (await votingModule.compute(env)) ?? ''
    if (!votingModuleAddress) {
      throw new Error('missing `votingModuleAddress`')
    }

    const codeIdKey = await env.getCodeIdKeyForContract(votingModuleAddress)
    // Unrecognized contract.
    if (!codeIdKey) {
      throw new Error('unrecognized voting module')
    }

    // Find formula matching code ID key.
    const votingPowerAtHeightFormula = VOTING_POWER_AT_HEIGHT_FORMULAS.find(
      (formula) => formula.filter?.codeIdsKeys?.includes(codeIdKey)
    )
    if (!votingPowerAtHeightFormula) {
      throw new Error(`no voting module passthrough found for ${codeIdKey}`)
    }

    return await votingPowerAtHeightFormula.compute({
      ...env,
      contractAddress: votingModuleAddress,
    })
  },
}

export const votingPower: ContractFormula<string, { address: string }> = {
  docs: {
    description:
      'retrieves the voting power for a given address at the current block height',
    args: [
      {
        name: 'address',
        description: 'address to check voting power for',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async (env) => (await votingPowerAtHeight.compute(env)).power,
}

const TOTAL_POWER_AT_HEIGHT_FORMULAS: ContractFormula<
  TotalPowerAtHeight,
  {
    height?: string
  }
>[] = [
  daoVotingCw4TotalPowerAtHeight,
  daoVotingCw20StakedTotalPowerAtHeight,
  daoVotingCw721StakedTotalPowerAtHeight,
  daoVotingNativeStakedTotalPowerAtHeight,
  daoVotingTokenStakedTotalPowerAtHeight,
  daoVotingOnftStakedTotalPowerAtHeight,
  daoVotingSgCommunityNftTotalPowerAtHeight,
]

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
        description: 'block height to check voting power at',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  compute: async (env) => {
    const votingModuleAddress = (await votingModule.compute(env)) ?? ''
    if (!votingModuleAddress) {
      throw new Error('missing `votingModuleAddress`')
    }

    const codeIdKey = await env.getCodeIdKeyForContract(votingModuleAddress)
    // Unrecognized contract.
    if (!codeIdKey) {
      throw new Error('unrecognized voting module')
    }

    // Find formula matching code ID key.
    const totalPowerAtHeightFormula = TOTAL_POWER_AT_HEIGHT_FORMULAS.find(
      (formula) => formula.filter?.codeIdsKeys?.includes(codeIdKey)
    )
    if (!totalPowerAtHeightFormula) {
      throw new Error(`no voting module passthrough found for ${codeIdKey}`)
    }

    return await totalPowerAtHeightFormula.compute({
      ...env,
      contractAddress: votingModuleAddress,
    })
  },
}

export const totalPower: ContractFormula<string> = {
  docs: {
    description: 'retrieves the total voting power at the current block height',
  },
  compute: async (env) => (await totalPowerAtHeight.compute(env)).power,
}

export const initialActions: ContractFormula<any[]> = makeSimpleContractFormula(
  {
    docs: {
      description: 'retrieves the initial actions for the DAO',
    },
    transformation: 'initialActions',
    fallbackKeys: ['initial_actions'],
    fallback: [],
  }
)

// Returns DAO contracts with an admin state key set to this DAO.
export const potentialSubDaos: ContractFormula<
  {
    contractAddress: string
    info: ContractInfo | undefined
  }[]
> = {
  docs: {
    description:
      'retrieves potential subDAOs, which are DAOs whose admin state key is set to this DAO. these may or may not be recognized by the DAO',
  },
  compute: async (env) => {
    const { contractAddress, getTransformationMatches, getCodeIdsForKeys } = env

    const daoCodeIds = getCodeIdsForKeys('dao-dao-core')

    const contractsWithAdmin =
      (
        await getTransformationMatches(
          undefined,
          'admin',
          contractAddress,
          daoCodeIds
        )
      )?.map((match) => match.contractAddress) ?? []

    const infos = await Promise.all(
      contractsWithAdmin.map((contractAddress) =>
        info.compute({
          ...env,
          contractAddress,
        })
      )
    )

    return contractsWithAdmin.map((contractAddress, index) => ({
      contractAddress,
      info: infos[index],
    }))
  },
}

// Map polytone note contract to the proxy contract for this DAO.
export const polytoneProxies: ContractFormula<Record<string, string>> = {
  docs: {
    description: 'retrieves polytone proxies for the DAO',
  },
  compute: async (env) => {
    const { contractAddress, getTransformationMatches } = env
    const notesWithRemoteAddress =
      (await getTransformationMatches(
        undefined,
        `remoteAddress:${contractAddress}`
      )) ?? []

    return notesWithRemoteAddress.reduce(
      (acc, { contractAddress, value }) => ({
        ...acc,
        [contractAddress]: value as string,
      }),
      {} as Record<string, string>
    )
  },
}

type ApprovalDao = {
  dao: string
  preProposeAddress: string
}

// Get all DAOs with dao-pre-propose-approval-* contracts that have this DAO set
// as the approver.
export const approvalDaos: ContractFormula<ApprovalDao[]> = {
  docs: {
    description:
      'retrieves DAOs that have a pre-propose-approval contract whose approver is set to this DAO',
  },
  compute: async (env) => {
    const { contractAddress, getTransformationMatches, getCodeIdsForKeys } = env

    const codeIds = getCodeIdsForKeys(
      'dao-pre-propose-approval-single',
      'dao-pre-propose-approval-multiple'
    )
    if (!codeIds.length) {
      throw new Error('missing dao-pre-propose-approval-* code IDs')
    }

    const daoPreProposeApprovalContracts =
      (await getTransformationMatches(
        undefined,
        `approver:${contractAddress}`,
        true,
        codeIds
      )) ?? []

    const daos = await Promise.all(
      daoPreProposeApprovalContracts.map(({ contractAddress }) =>
        daoPreProposeBaseDao.compute({
          ...env,
          contractAddress,
        })
      )
    )

    return daos.flatMap((dao, index): ApprovalDao | [] =>
      dao
        ? {
            dao,
            preProposeAddress:
              daoPreProposeApprovalContracts[index].contractAddress,
          }
        : []
    )
  },
}

// Helpers

// V1 proposal module don't have prefixes, so we need to generate them.
const indexToProposalModulePrefix = (index: number) => {
  index += 1
  let prefix = ''
  while (index > 0) {
    const letterIndex = (index - 1) % 26
    // capital A = 65, Z = 90
    prefix = String.fromCharCode(65 + letterIndex) + prefix
    index = ((index - letterIndex) / 26) | 0
  }

  return prefix
}
