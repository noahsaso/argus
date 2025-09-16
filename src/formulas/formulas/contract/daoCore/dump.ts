import { ContractFormula } from '@/types'

import { ContractInfo } from '../../types'
import { contractAdmin, info, instantiatedAt } from '../common'
import {
  Config,
  ProposalModuleWithInfo,
  admin,
  config,
  initialActions,
  item,
  listSubDaos,
  polytoneProxies,
  proposalModules,
  votingModule,
} from './base'
import { proposalCount } from './proposals'
import { DAO_CORE_CONTRACT_NAMES } from './utils'

export type DumpState = {
  // Same as contract query, except `pause_info`. `pause_info` is dynamic by
  // block since it deals with expiration, so it cannot be cached. However, we
  // want to cache DumpState to speed up the UI. The UI accesses `pause_info`
  // separately, so this is fine.
  admin?: string | null
  config?: Config
  version?: ContractInfo
  proposal_modules?: ProposalModuleWithInfo[]
  voting_module?: string
  active_proposal_module_count: number
  total_proposal_module_count: number
  initial_actions?: any[]
  // Extra.
  contractAdmin?: string
  votingModuleInfo?: ContractInfo
  createdAt?: string
  createdAtEpoch?: number
  adminInfo?: {
    admin?: string | null
    config: Config
    info?: ContractInfo
    // Check if it has this current DAO as a SubDAO.
    registeredSubDao?: boolean
  } | null
  proposalCount?: number
  // Map polytone note address to remote address.
  polytoneProxies?: Record<string, string>
  // Hide from search if storage item `hideFromSearch` exists.
  hideFromSearch?: boolean
}

export const dumpState: ContractFormula<DumpState> = {
  docs: {
    description:
      'retrieves a lot of high-level information about a DAO, including its voting and proposal modules',
  },
  compute: async (env) => {
    // Attempt to fetch extraction, returning if found. This is faster and newer
    // than events.
    const extraction = await env.getExtraction(
      env.contractAddress,
      'dao-dao-core/dump_state'
    )
    if (extraction) {
      return extraction.data as DumpState
    }

    // Otherwise fallback to events.
    const [
      adminResponse,
      configResponse,
      version,
      proposal_modules,
      // V2.7.0+
      initial_actions,
      { address: voting_module, info: votingModuleInfo },
      activeProposalModuleCount,
      totalProposalModuleCount,
      contractAdminResponse,
      createdAt,
      proposalCountResponse,
      polytoneProxiesResponse,
      hideFromSearchValue,
    ] = await Promise.all([
      // DAO-level admin.
      admin.compute(env),
      config.compute(env),
      info.compute(env),
      proposalModules.compute(env),
      // V2.7.0+
      initialActions.compute(env),
      votingModule.compute(env).then(async (contractAddress) => ({
        address: contractAddress,
        info: contractAddress
          ? await info.compute({
              ...env,
              contractAddress,
            })
          : undefined,
      })),
      // V2
      env
        .getTransformationMatch<number>(
          env.contractAddress,
          'activeProposalModuleCount'
        )
        .then(
          (transformation) =>
            transformation?.value ??
            // Fallback to events.
            env
              .get<number>(env.contractAddress, 'active_proposal_module_count')
              .then((event) => event?.valueJson)
        ),
      env
        .getTransformationMatch<number>(
          env.contractAddress,
          'totalProposalModuleCount'
        )
        .then(
          (transformation) =>
            transformation?.value ??
            // Fallback to events.
            env
              .get<number>(env.contractAddress, 'total_proposal_module_count')
              .then((event) => event?.valueJson)
        ),
      // Extra.
      contractAdmin.compute(env),
      instantiatedAt.compute(env),
      proposalCount.compute(env),
      polytoneProxies.compute(env),
      item
        .compute({
          ...env,
          args: {
            key: 'hideFromSearch',
          },
        })
        .catch(() => false),
    ])

    // Load admin info if admin is a DAO core contract.
    let adminConfig: Config | undefined | null = null
    let adminAdmin: string | null = null
    let adminRegisteredSubDao: boolean | undefined
    const adminInfo =
      adminResponse && adminResponse !== env.contractAddress
        ? await info
            .compute({
              ...env,
              contractAddress: adminResponse,
            })
            // If fail to fetch contract info, ignore. This may be a wallet or
            // the chain x/gov module account instead of a DAO/contract.
            .catch(() => undefined)
        : undefined
    if (
      adminResponse &&
      adminInfo &&
      DAO_CORE_CONTRACT_NAMES.some((name) => adminInfo.contract.includes(name))
    ) {
      const [_adminAdmin, _adminConfig, adminSubDaos] = await Promise.all([
        admin.compute({
          ...env,
          contractAddress: adminResponse,
        }),
        config.compute({
          ...env,
          contractAddress: adminResponse,
        }),
        listSubDaos.compute({
          ...env,
          contractAddress: adminResponse,
        }),
      ])

      if (_adminConfig) {
        adminAdmin = _adminAdmin
        adminConfig = _adminConfig
        // Check if the current DAO is registered as a SubDAO.
        adminRegisteredSubDao = adminSubDaos.some(
          (subDao) => subDao.addr === env.contractAddress
        )
      }
    }

    return {
      // Same as contract query.
      admin: adminResponse,
      config: configResponse,
      version,
      proposal_modules,
      voting_module,
      initial_actions,
      // V1 doesn't have these counts; all proposal modules are active.
      active_proposal_module_count:
        activeProposalModuleCount ?? proposal_modules?.length ?? 0,
      total_proposal_module_count:
        totalProposalModuleCount ?? proposal_modules?.length ?? 0,
      // Extra.
      contractAdmin: contractAdminResponse,
      votingModuleInfo,
      createdAt,
      createdAtEpoch: createdAt ? new Date(createdAt).getTime() : undefined,
      adminInfo: adminConfig && {
        admin: adminAdmin,
        info: adminInfo,
        config: adminConfig,
        registeredSubDao: adminRegisteredSubDao,
      },
      proposalCount: proposalCountResponse,
      polytoneProxies: polytoneProxiesResponse,
      hideFromSearch: !!hideFromSearchValue,
    }
  },
}
