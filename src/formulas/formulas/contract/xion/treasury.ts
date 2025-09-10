import {
  Addr,
  FeeConfig,
  GrantConfig,
  Params,
} from '@/formulas/formulas/contract/xion/types/Treasury.types'
import { ContractFormula } from '@/types'

import { makeSimpleContractFormula } from '../../utils'

const TreasuryStorageKeys = {
  GRANT_CONFIGS: 'grant_configs',
  FEE_CONFIG: 'fee_config',
  ADMIN: 'admin',
  PENDING_ADMIN: 'pending_admin',
  PARAMS: 'params',
}

export const grantConfigs: ContractFormula<Record<string, GrantConfig>> = {
  docs: {
    description: "Get the treasury's grant configs by msg type url",
  },
  compute: async (env) => {
    const { contractAddress, getMap } = env

    return (
      (await getMap<string, GrantConfig>(
        contractAddress,
        TreasuryStorageKeys.GRANT_CONFIGS
      )) ?? {}
    )
  },
}

export const feeConfig: ContractFormula<FeeConfig | null> = {
  docs: {
    description: 'Get the fee sponsorship configuration for the treasury',
  },
  compute: async (env) => {
    const { contractAddress, get } = env

    return (
      (await get<FeeConfig>(contractAddress, TreasuryStorageKeys.FEE_CONFIG))
        ?.valueJson ?? null
    )
  },
}

export const admin: ContractFormula<Addr | null> = {
  docs: {
    description: 'Get the curent admin for the treasury',
  },
  compute: async (env) => {
    const { contractAddress, get } = env

    return (
      (await get<Addr>(contractAddress, TreasuryStorageKeys.ADMIN))
        ?.valueJson ?? null
    )
  },
}

export const pendingAdmin = makeSimpleContractFormula<Addr | null>({
  docs: {
    description: 'Get the pending admin for the treasury',
  },
  transformation: TreasuryStorageKeys.PENDING_ADMIN,
  fallback: null,
})

export const params: ContractFormula<Record<string, Params>> = {
  docs: {
    description: 'Get the params for the treasury',
  },
  compute: async (env) => {
    const { contractAddress, get } = env

    return (
      (await get<Params>(contractAddress, TreasuryStorageKeys.PARAMS))
        ?.valueJson ?? {}
    )
  },
}

export const balances: ContractFormula<Record<string, string>> = {
  docs: {
    description: 'Get the balance of the treasury',
  },
  compute: async (env) => {
    const { contractAddress, getBalances } = env

    return (await getBalances(contractAddress)) || {}
  },
}

export const all: ContractFormula<{
  grantConfigs: Record<string, GrantConfig>
  feeConfig: FeeConfig | null
  admin: Addr | null
  pendingAdmin: Addr | null
  params: Record<string, Params>
  balances: Record<string, string>
}> = {
  docs: {
    description: 'Get all treasury data in a single endpoint',
  },
  compute: async (env) => {
    // Call all the individual endpoints
    const [
      grantConfigsData,
      feeConfigData,
      adminData,
      pendingAdminData,
      paramsData,
      balanceData,
    ] = await Promise.all([
      grantConfigs.compute(env),
      feeConfig.compute(env),
      admin.compute(env),
      pendingAdmin.compute(env),
      params.compute(env),
      balances.compute(env),
    ])

    // Combine all results into a single object
    return {
      grantConfigs: grantConfigsData,
      feeConfig: feeConfigData,
      admin: adminData,
      pendingAdmin: pendingAdminData,
      params: paramsData,
      balances: balanceData,
    }
  },
}
