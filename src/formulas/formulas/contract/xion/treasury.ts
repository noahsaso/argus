import type {
  Addr,
  FeeConfig,
  GrantConfig,
  Params,
} from '@/formulas/formulas/contract/xion/types/Treasury.types'
import type { ContractFormula } from '@/types'

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
      (await get<FeeConfig>(contractAddress, TreasuryStorageKeys.FEE_CONFIG)) ??
      null
    )
  },
}

export const admin: ContractFormula<Addr | null> = {
  docs: {
    description: 'Get the curent admin for the treasury',
  },
  compute: async (env) => {
    const { contractAddress, get } = env

    return (await get<Addr>(contractAddress, TreasuryStorageKeys.ADMIN)) ?? null
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
      (await get<Params>(contractAddress, TreasuryStorageKeys.PARAMS)) ?? {}
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

export const history: ContractFormula<
  {
    treasury: {
      address: string
      params: Record<string, Params>
      admin: Addr | null
    }
    transactions: Array<{
      denom: string
      balance: string
      blockHeight: string
      blockTimestamp: string
      blockTimeUnixMs: string
    }>
    pagination: {
      page: number
      limit: number
      total: number
      totalPages: number
      hasNext: boolean
      hasPrev: boolean
    }
  },
  {
    page?: string
    limit?: string
    sortBy?: string
    sortOrder?: string
  }
> = {
  docs: {
    description:
      'Get historical transaction data for the treasury with pagination and sorting',
    args: [
      {
        name: 'page',
        description: 'Page number (default: 1)',
        required: false,
        schema: {
          type: 'integer',
          minimum: 1,
        },
      },
      {
        name: 'limit',
        description: 'Items per page (default: 50, max: 1000)',
        required: false,
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: 1000,
        },
      },
      {
        name: 'sortBy',
        description: 'Sort field (blockHeight, denom, balance, blockTimestamp)',
        required: false,
        schema: {
          type: 'string',
          enum: ['blockHeight', 'denom', 'balance', 'blockTimestamp'],
        },
      },
      {
        name: 'sortOrder',
        description: 'Sort direction (asc, desc)',
        required: false,
        schema: {
          type: 'string',
          enum: ['asc', 'desc'],
        },
      },
    ],
  },
  dynamic: true, // Mark as dynamic for live data
  compute: async (env) => {
    const { contractAddress, query, args } = env

    // Parse and validate arguments
    const page = Math.max(1, Number.parseInt(args.page || '1', 10))
    const limit = Math.min(
      1000,
      Math.max(1, Number.parseInt(args.limit || '50', 10))
    )
    const sortBy = args.sortBy || 'blockHeight'
    const sortOrder = args.sortOrder || 'desc'
    const offset = (page - 1) * limit

    // Validate sort parameters
    const validSortFields = [
      'blockHeight',
      'denom',
      'balance',
      'blockTimestamp',
    ]
    const validSortOrders = ['asc', 'desc']

    if (!validSortFields.includes(sortBy)) {
      throw new Error(
        `Invalid sortBy field. Must be one of: ${validSortFields.join(', ')}`
      )
    }

    if (!validSortOrders.includes(sortOrder)) {
      throw new Error(
        `Invalid sortOrder. Must be one of: ${validSortOrders.join(', ')}`
      )
    }

    // Get treasury metadata
    const [treasuryParams, treasuryAdmin] = await Promise.all([
      params.compute(env),
      admin.compute(env),
    ])

    // Get total count for pagination
    const [{ count: totalCount }] = await query(
      'SELECT COUNT(*) as "count" FROM "BankStateEvents" WHERE "address" = $1',
      [contractAddress]
    )

    const total = Number(totalCount)
    const totalPages = Math.ceil(total / limit)

    // Get historical transactions with sorting and pagination
    const transactions = await query(
      `SELECT
        "denom",
        "balance",
        "blockHeight",
        "blockTimestamp",
        "blockTimeUnixMs"
      FROM "BankStateEvents"
      WHERE "address" = $1
      ORDER BY "${sortBy}" ${sortOrder.toUpperCase()}, "denom" ASC
      LIMIT $2 OFFSET $3`,
      [contractAddress, limit, offset]
    )

    return {
      treasury: {
        address: contractAddress,
        params: treasuryParams,
        admin: treasuryAdmin,
      },
      transactions: transactions.map((tx: Record<string, unknown>) => ({
        denom: tx.denom as string,
        balance: tx.balance as string,
        blockHeight: tx.blockHeight as string,
        blockTimestamp: tx.blockTimestamp as string,
        blockTimeUnixMs: tx.blockTimeUnixMs as string,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    }
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
