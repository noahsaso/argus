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

// Shared helper function for treasury contract validation
const validateTreasuryContract = async (env: any) => {
  const { contractAddress, contractMatchesCodeIdKeys, get } = env

  // Access a WasmStateEvent key to establish block context
  await get(contractAddress, 'dummy_key_for_block_context')

  // Validate this is a treasury contract - check for either xion or treasury code keys
  const isTreasury =
    (await contractMatchesCodeIdKeys(contractAddress, 'xion')) ||
    (await contractMatchesCodeIdKeys(contractAddress, 'treasury'))

  if (!isTreasury) {
    const error = new Error('Method not allowed for non-treasury contracts')
    ;(error as any).statusCode = 405
    throw error
  }

  return true
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
  filter: {
    codeIdsKeys: ['xion', 'treasury'],
  },
  docs: {
    description: 'Get the balance of the treasury',
  },
  compute: async (env) => {
    const { contractAddress, getBalances } = env

    return (await getBalances(contractAddress)) || {}
  },
}

export const balanceHistory: ContractFormula<
  Record<
    string,
    {
      balance: string
      blockHeight: string
      blockTimeUnixMs: string
      blockTimestamp: string
      lastChanged: string
    }
  >
> = {
  filter: {
    codeIdsKeys: ['xion', 'treasury'],
  },
  docs: {
    description:
      'Get the treasury balance with timestamp metadata for time-series analysis (optimized with raw SQL)',
  },
  compute: async (env) => {
    try {
      const { contractAddress, contractMatchesCodeIdKeys, query, block } = env

      // Check if this address is a contract that we keep history for
      const { BANK_HISTORY_CODE_IDS_KEYS } = await import(
        '@/tracer/handlers/bank'
      )
      const historyExists = await contractMatchesCodeIdKeys(
        contractAddress,
        ...BANK_HISTORY_CODE_IDS_KEYS
      )
      if (!historyExists) {
        return {}
      }

      // Optimized raw SQL query for better performance than Sequelize ORM
      const events = await query(
        `
        SELECT DISTINCT ON (denom) 
          denom,
          "blockHeight",
          "blockTimeUnixMs",
          "blockTimestamp",
          balance
        FROM "BankStateEvents"
        WHERE address = $contractAddress
          AND "blockHeight" <= $blockHeight
        ORDER BY denom ASC, "blockHeight" DESC
      `,
        {
          contractAddress,
          blockHeight: block.height,
        }
      )

      if (!events.length) {
        return {}
      }

      // Transform to include timestamp metadata with improved performance
      const balanceHistory: Record<
        string,
        {
          balance: string
          blockHeight: string
          blockTimeUnixMs: string
          blockTimestamp: string
          lastChanged: string
        }
      > = {}

      // Process in memory for better performance
      events.forEach((event: any) => {
        balanceHistory[event.denom] = {
          balance: event.balance,
          blockHeight: event.blockHeight,
          blockTimeUnixMs: event.blockTimeUnixMs,
          blockTimestamp: new Date(event.blockTimestamp).toISOString(),
          lastChanged: new Date(Number(event.blockTimeUnixMs)).toISOString(),
        }
      })

      return balanceHistory
    } catch (error) {
      console.error('Error in balanceHistory formula:', error)
      // Return safe default structure to prevent complete failure
      return {}
    }
  },
}

export const activeGrantees: ContractFormula<{
  count: number
  grantees: Array<{
    address: string
    grantedAt: string
    allowanceAmount: string | null
    allowanceDenom: string | null
    allowanceType: string | null
    lastActivity?: string
  }>
  performanceMetrics: {
    timeWindowDays: number
    processingOptimized: boolean
  }
}> = {
  filter: {
    codeIdsKeys: ['xion', 'treasury'],
  },
  docs: {
    description: 'Get all active grantees for this treasury contract (optimized with configurable parameters)',
    args: [
      {
        name: 'timeWindow',
        description: 'Time window in days for activity analysis (default: 30, min: 7, max: 90)',
        required: false,
        schema: { type: 'number', minimum: 7, maximum: 90 },
      },
    ],
  },
  compute: async (env) => {
    try {
      const { contractAddress, getFeegrantAllowances, query, block } = env

      // Use shared validation helper
      await validateTreasuryContract(env)

      // Framework-standard parameter extraction and validation
      const timeWindow = typeof (env.args as any).timeWindow === 'number' ? (env.args as any).timeWindow : 30
      const validatedTimeWindow = Math.min(Math.max(timeWindow, 7), 90)

      // Get all active allowances granted by this treasury using framework method
      const allowances =
        (await getFeegrantAllowances(contractAddress, 'granted')) || []

      if (allowances.length === 0) {
        return {
          count: 0,
          grantees: [],
          performanceMetrics: {
            timeWindowDays: validatedTimeWindow,
            processingOptimized: true,
          },
        }
      }

      // Use configurable time window with framework block filtering
      const timeWindowMs = block.timeUnixMs - BigInt(validatedTimeWindow * 24 * 60 * 60 * 1000)
      const granteeAddresses = allowances.map((a) => a.grantee)

      // Get recent activity using blockHeight index optimization
      const activityData =
        granteeAddresses.length > 0
          ? await query(
              `
        SELECT DISTINCT ON (address)
          address,
          "blockTimeUnixMs" as "lastActivityMs"
        FROM "BankStateEvents"
        WHERE address = ANY($addresses)
          AND "blockTimeUnixMs" >= $timeWindowMs
        ORDER BY address, "blockHeight" DESC
      `,
              {
                addresses: granteeAddresses,
                timeWindowMs: timeWindowMs.toString(),
              }
            )
          : []

      // Process in memory for better performance than SQL joins
      const activityMap = new Map(
        activityData.map((row: any) => [row.address, row.lastActivityMs])
      )

      const grantees = allowances.map((allowance) => ({
        address: allowance.grantee,
        grantedAt: allowance.block.timestamp,
        allowanceAmount: allowance.parsedAmount,
        allowanceDenom: allowance.parsedDenom,
        allowanceType: allowance.parsedAllowanceType,
        lastActivity: activityMap.get(allowance.grantee)
          ? new Date(Number(activityMap.get(allowance.grantee))).toISOString()
          : undefined,
      }))

      return {
        count: grantees.length,
        grantees: grantees.sort((a, b) => b.grantedAt.localeCompare(a.grantedAt)),
        performanceMetrics: {
          timeWindowDays: validatedTimeWindow,
          processingOptimized: true,
        },
      }
    } catch (error) {
      console.error('Error in activeGrantees formula:', error)
      // Return safe default structure to prevent complete failure
      return {
        count: 0,
        grantees: [],
        performanceMetrics: {
          timeWindowDays: 30,
          processingOptimized: true,
        },
      }
    }
  },
}

export const granteeActivity: ContractFormula<{
  activeCount: number
  totalCount: number
  activityRate: number
  recentActivity: Array<{
    address: string
    transactionCount: number
    lastTransaction: string
    isActive: boolean
  }>
  performanceMetrics: {
    timeWindowDays: number
    processingOptimized: boolean
  }
}> = {
  filter: {
    codeIdsKeys: ['xion', 'treasury'],
  },
  docs: {
    description: 'Get grantee activity statistics for this treasury (optimized with configurable parameters)',
    args: [
      {
        name: 'timeWindow',
        description: 'Time window in days for activity analysis (default: 7, min: 1, max: 90)',
        required: false,
        schema: { type: 'number', minimum: 1, maximum: 90 },
      },
    ],
  },
  compute: async (env) => {
    try {
      const { contractAddress, getFeegrantAllowances, query, block } = env

      // Use shared validation helper
      await validateTreasuryContract(env)

      // Framework-standard parameter extraction and validation
      const timeWindow = typeof (env.args as any).timeWindow === 'number' ? (env.args as any).timeWindow : 7
      const validatedTimeWindow = Math.min(Math.max(timeWindow, 1), 90)

      // Use configurable time window with framework block filtering
      const timeWindowMs = block.timeUnixMs - BigInt(validatedTimeWindow * 24 * 60 * 60 * 1000)

      // Get all active grantees using framework method
      const allowances =
        (await getFeegrantAllowances(contractAddress, 'granted')) || []

      if (allowances.length === 0) {
        return {
          activeCount: 0,
          totalCount: 0,
          activityRate: 0,
          recentActivity: [],
          performanceMetrics: {
            timeWindowDays: validatedTimeWindow,
            processingOptimized: true,
          },
        }
      }

      const granteeAddresses = allowances.map((a) => a.grantee)

      // Get activity data using blockHeight index optimization
      const activityData = await query(
        `
        WITH activity_counts AS (
          SELECT 
            address,
            COUNT(*) as "transactionCount"
          FROM "BankStateEvents"
          WHERE address = ANY($addresses)
            AND "blockTimeUnixMs" >= $windowStart
          GROUP BY address
        ),
        latest_transactions AS (
          SELECT DISTINCT ON (address)
            address,
            "blockTimeUnixMs" as "lastTransactionMs"
          FROM "BankStateEvents"
          WHERE address = ANY($addresses)
            AND "blockTimeUnixMs" >= $windowStart
          ORDER BY address, "blockHeight" DESC
        )
        SELECT 
          ac.address,
          ac."transactionCount",
          COALESCE(lt."lastTransactionMs", '0') as "lastTransactionMs"
        FROM activity_counts ac
        LEFT JOIN latest_transactions lt ON ac.address = lt.address
      `,
        {
          addresses: granteeAddresses,
          windowStart: timeWindowMs.toString(),
        }
      )

      // Process in memory for better performance than SQL joins
      const activityMap = new Map(
        activityData.map((row: any) => [
          row.address,
          {
            transactionCount: Number(row.transactionCount),
            lastTransactionMs: row.lastTransactionMs,
          },
        ])
      )

      const recentActivity = granteeAddresses.map((address) => {
        const activity = activityMap.get(address)
        return {
          address,
          transactionCount: activity?.transactionCount || 0,
          lastTransaction: activity?.lastTransactionMs
            ? new Date(Number(activity.lastTransactionMs)).toISOString()
            : new Date(0).toISOString(),
          isActive: (activity?.transactionCount || 0) > 0,
        }
      })

      const activeCount = recentActivity.filter((a) => a.isActive).length
      const activityRate =
        allowances.length > 0 ? (activeCount / allowances.length) * 100 : 0

      return {
        activeCount,
        totalCount: allowances.length,
        activityRate: Math.round(activityRate * 100) / 100,
        recentActivity: recentActivity.sort(
          (a, b) => b.transactionCount - a.transactionCount
        ),
        performanceMetrics: {
          timeWindowDays: validatedTimeWindow,
          processingOptimized: true,
        },
      }
    } catch (error) {
      console.error('Error in granteeActivity formula:', error)
      // Return safe default structure to prevent complete failure
      return {
        activeCount: 0,
        totalCount: 0,
        activityRate: 0,
        recentActivity: [],
        performanceMetrics: {
          timeWindowDays: 7,
          processingOptimized: true,
        },
      }
    }
  },
}

export const usageMetrics: ContractFormula<{
  totalAllowancesGranted: number
  activeAllowances: number
  totalTokensAllocated: string
  utilizationRate: number
  averageAllowanceAmount: string
  topGrantees: Array<{
    address: string
    allowanceAmount: string
    allowanceDenom: string
    activityScore: number
  }>
  performanceMetrics: {
    timeWindowDays: number
    processingOptimized: boolean
  }
}> = {
  filter: {
    codeIdsKeys: ['xion', 'treasury'],
  },
  docs: {
    description: 'Get treasury usage metrics and efficiency statistics (optimized with configurable parameters)',
    args: [
      {
        name: 'timeWindow',
        description: 'Time window in days for activity scoring (default: 30, min: 7, max: 90)',
        required: false,
        schema: { type: 'number', minimum: 7, maximum: 90 },
      },
    ],
  },
  compute: async (env) => {
    try {
      const { contractAddress, query, block, getFeegrantAllowances } = env

      // Use shared validation helper
      await validateTreasuryContract(env)

      // Framework-standard parameter extraction and validation
      const timeWindow = typeof (env.args as any).timeWindow === 'number' ? (env.args as any).timeWindow : 30
      const validatedTimeWindow = Math.min(Math.max(timeWindow, 7), 90)

      // Use configurable time window with framework block filtering
      const timeWindowMs = block.timeUnixMs - BigInt(validatedTimeWindow * 24 * 60 * 60 * 1000)

      // Get allowances using framework method for better performance
      const allowances =
        (await getFeegrantAllowances(contractAddress, 'granted')) || []

      // Process allowance statistics in memory instead of complex SQL
      const activeAllowances = allowances.filter((a) => a.active)
      const totalAllowancesGranted = allowances.length
      const activeAllowancesCount = activeAllowances.length

      // Calculate token allocation statistics in memory
      const tokenStats = new Map<string, { total: bigint; count: number }>()
      let allowancesWithAmounts = 0

      activeAllowances.forEach((allowance) => {
        if (allowance.parsedAmount && allowance.parsedDenom) {
          allowancesWithAmounts++
          const current = tokenStats.get(allowance.parsedDenom) || {
            total: 0n,
            count: 0,
          }
          tokenStats.set(allowance.parsedDenom, {
            total: current.total + BigInt(allowance.parsedAmount),
            count: current.count + 1,
          })
        }
      })

      // Calculate total tokens allocated (primary token)
      let totalTokensAllocated = '0'
      if (tokenStats.size > 0) {
        const primaryTokenEntry = Array.from(tokenStats.values())[0]
        totalTokensAllocated = primaryTokenEntry.total.toString()
      }

      // Calculate utilization rate (active vs total)
      const utilizationRate =
        totalAllowancesGranted > 0
          ? (activeAllowancesCount / totalAllowancesGranted) * 100
          : 0

      // Calculate average allowance amount
      const averageAllowanceAmount =
        allowancesWithAmounts > 0 && BigInt(totalTokensAllocated) > 0n
          ? (
              BigInt(totalTokensAllocated) / BigInt(allowancesWithAmounts)
            ).toString()
          : '0'

      // Get activity scores for active grantees using configurable time window
      const activeGrantees = activeAllowances
        .filter((a) => a.parsedAmount && a.parsedDenom)
        .map((a) => a.grantee)

      const activityScores =
        activeGrantees.length > 0
          ? await query(
              `
            SELECT
              address,
              COUNT(*) as activity_count
            FROM "BankStateEvents"
            WHERE address = ANY($addresses)
              AND "blockTimeUnixMs" >= $periodStart
            GROUP BY address
          `,
              {
                addresses: activeGrantees,
                periodStart: timeWindowMs.toString(),
              }
            )
          : []

      // Process activity scores in memory
      const activityMap = new Map(
        activityScores.map((row: any) => [
          row.address,
          Number(row.activity_count),
        ])
      )

      const topGrantees = activeAllowances
        .filter((a) => a.parsedAmount && a.parsedDenom)
        .map((a) => ({
          address: a.grantee,
          allowanceAmount: a.parsedAmount || '0',
          allowanceDenom: a.parsedDenom || 'unknown',
          activityScore: activityMap.get(a.grantee) || 0,
        }))
        .sort((a, b) => {
          // Sort by activity score first, then by allowance amount
          if (a.activityScore !== b.activityScore) {
            return b.activityScore - a.activityScore
          }
          return Number(BigInt(b.allowanceAmount) - BigInt(a.allowanceAmount))
        })
        .slice(0, 10)

      return {
        totalAllowancesGranted,
        activeAllowances: activeAllowancesCount,
        totalTokensAllocated,
        utilizationRate: Math.round(utilizationRate * 100) / 100,
        averageAllowanceAmount,
        topGrantees,
        performanceMetrics: {
          timeWindowDays: validatedTimeWindow,
          processingOptimized: true,
        },
      }
    } catch (error) {
      console.error('Error in usageMetrics formula:', error)
      // Return safe default structure to prevent complete failure
      return {
        totalAllowancesGranted: 0,
        activeAllowances: 0,
        totalTokensAllocated: '0',
        utilizationRate: 0,
        averageAllowanceAmount: '0',
        topGrantees: [],
        performanceMetrics: {
          timeWindowDays: 30,
          processingOptimized: true,
        },
      }
    }
  },
}

export const onboardingMetrics: ContractFormula<{
  newGrantees: number
  totalGrantees: number
  growthRate: number
  onboardingTrend: Array<{
    date: string
    newGrantees: number
    cumulativeGrantees: number
  }>
  onboardingVelocity: number
  performanceMetrics: {
    timeWindowDays: number
    granularity: string
    processingOptimized: boolean
  }
}> = {
  filter: {
    codeIdsKeys: ['xion', 'treasury'],
  },
  docs: {
    description: 'Get treasury onboarding metrics and growth statistics (optimized with configurable parameters)',
    args: [
      {
        name: 'timeWindow',
        description: 'Time window in days for analysis (default: 30, min: 7, max: 365)',
        required: false,
        schema: { type: 'number', minimum: 7, maximum: 365 },
      },
      {
        name: 'granularity',
        description: 'Data granularity: daily, weekly, monthly (default: daily)',
        required: false,
        schema: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
      },
    ],
  },
  compute: async (env) => {
    try {
      const { contractAddress, query, date } = env

      // Use shared validation helper
      await validateTreasuryContract(env)

      // Framework-standard parameter extraction and validation
      const timeWindow = typeof (env.args as any).timeWindow === 'number' ? (env.args as any).timeWindow : 30
      const granularity = typeof (env.args as any).granularity === 'string' ? (env.args as any).granularity : 'daily'

      // Parameter validation following framework standards
      const validatedTimeWindow = Math.min(Math.max(timeWindow, 7), 365)
      const validatedGranularity = ['daily', 'weekly', 'monthly'].includes(granularity) ? granularity : 'daily'

      // Smart granularity mapping with optimized intervals
      const granularityConfig = {
        daily: { ms: 24 * 60 * 60 * 1000 },
        weekly: { ms: 7 * 24 * 60 * 60 * 1000 },
        monthly: { ms: 30 * 24 * 60 * 60 * 1000 }
      }

      const config = granularityConfig[validatedGranularity as keyof typeof granularityConfig]
      const timeWindowMs = validatedTimeWindow * 24 * 60 * 60 * 1000
      const windowStart = date.getTime() - timeWindowMs

      // Get first-time allowances for each grantee with optimized query
      const onboardingData = await query(
        `
        WITH first_allowances AS (
          SELECT
            grantee,
            MIN("blockTimeUnixMs") as "firstGrantMs"
          FROM "FeegrantAllowances"
          WHERE granter = $contractAddress
          GROUP BY grantee
        ),
        recent_onboarding AS (
          SELECT *
          FROM first_allowances
          WHERE "firstGrantMs" >= $windowStart
        ),
        time_buckets AS (
          SELECT
            floor(("firstGrantMs" - $windowStart) / $granularityMs) as bucket,
            COUNT(*) as "newGrantees"
          FROM recent_onboarding
          GROUP BY bucket
          ORDER BY bucket
        )
        SELECT
          bucket,
          "newGrantees"
        FROM time_buckets
      `,
        {
          contractAddress,
          windowStart: windowStart.toString(),
          granularityMs: config.ms.toString(),
        }
      )

      // Get total metrics in parallel for better performance
      const [totalMetrics, previousMetrics] = await Promise.all([
        query(
          `
          SELECT COUNT(DISTINCT grantee) as total
          FROM "FeegrantAllowances"
          WHERE granter = $contractAddress
        `,
          { contractAddress: contractAddress }
        ),

        query(
          `
          SELECT COUNT(DISTINCT grantee) as "previousTotal"
          FROM "FeegrantAllowances"
          WHERE granter = $contractAddress
            AND (SELECT MIN("blockTimeUnixMs") FROM "FeegrantAllowances" fa2
                 WHERE fa2.granter = "FeegrantAllowances".granter
                 AND fa2.grantee = "FeegrantAllowances".grantee) < $windowStart
        `,
          {
            contractAddress: contractAddress,
            windowStart: windowStart.toString(),
          }
        ),
      ])

      const totalGrantees = Number(totalMetrics[0]?.total || 0)
      const previousTotal = Number(previousMetrics[0]?.previousTotal || 0)
      const newGrantees = onboardingData.reduce(
        (sum, row: any) => sum + Number(row.newGrantees),
        0
      )

      // Calculate growth rate with safe division
      const growthRate =
        previousTotal > 0 ? (newGrantees / previousTotal) * 100 : newGrantees > 0 ? 100 : 0

      // Calculate cumulative data in memory (more efficient than SQL window functions)
      let cumulativeGrantees = 0
      const onboardingTrend = onboardingData.map((row: any) => {
        const newGranteesCount = Number(row.newGrantees)
        cumulativeGrantees += newGranteesCount
        
        const bucketStart = windowStart + Number(row.bucket) * config.ms
        return {
          date: new Date(bucketStart).toISOString().split('T')[0],
          newGrantees: newGranteesCount,
          cumulativeGrantees: previousTotal + cumulativeGrantees,
        }
      })

      // Calculate onboarding velocity based on actual granularity
      const days = validatedTimeWindow
      const onboardingVelocity = days > 0 ? newGrantees / days : 0

      return {
        newGrantees,
        totalGrantees,
        growthRate: Math.round(growthRate * 100) / 100,
        onboardingTrend,
        onboardingVelocity: Math.round(onboardingVelocity * 100) / 100,
        performanceMetrics: {
          timeWindowDays: validatedTimeWindow,
          granularity: validatedGranularity,
          processingOptimized: true,
        },
      }
    } catch (error) {
      console.error('Error in onboardingMetrics formula:', error)
      // Return safe default structure to prevent complete failure
      return {
        newGrantees: 0,
        totalGrantees: 0,
        growthRate: 0,
        onboardingTrend: [],
        onboardingVelocity: 0,
        performanceMetrics: {
          timeWindowDays: 30,
          granularity: 'daily',
          processingOptimized: true,
        },
      }
    }
  },
}

export const treasuryHealth: ContractFormula<{
  status: 'healthy' | 'warning' | 'critical'
  balanceRatio: number
  utilizationRate: number
  activeGranteeRatio: number
  averageDailyBurn: string
  estimatedRunwayDays: number
  alerts: Array<{
    type: 'info' | 'warning' | 'critical'
    message: string
    recommendation?: string
  }>
  performanceMetrics: {
    activityWindowDays: number
    burnRateWindowDays: number
    processingOptimized: boolean
  }
}> = {
  docs: {
    description: 'Get comprehensive treasury health assessment (optimized with configurable parameters)',
    args: [
      {
        name: 'activityWindow',
        description: 'Time window in days for activity analysis (default: 7, min: 3, max: 30)',
        required: false,
        schema: { type: 'number', minimum: 3, maximum: 30 },
      },
      {
        name: 'burnRateWindow',
        description: 'Time window in days for burn rate calculation (default: 30, min: 7, max: 90)',
        required: false,
        schema: { type: 'number', minimum: 7, maximum: 90 },
      },
    ],
  },
  compute: async (env) => {
    try {
      const { contractAddress, getBalances, query, date } = env

      // Use shared validation helper
      await validateTreasuryContract(env)

      // Framework-standard parameter extraction and validation
      const activityWindow = typeof (env.args as any).activityWindow === 'number' ? (env.args as any).activityWindow : 7
      const burnRateWindow = typeof (env.args as any).burnRateWindow === 'number' ? (env.args as any).burnRateWindow : 30

      // Parameter validation following framework standards
      const validatedActivityWindow = Math.min(Math.max(activityWindow, 3), 30)
      const validatedBurnRateWindow = Math.min(Math.max(burnRateWindow, 7), 90)

      // Get current balances
      const currentBalances = (await getBalances(contractAddress)) || {}
      const primaryDenom = 'uxion' // Assuming XION as primary
      const currentBalance = BigInt(currentBalances[primaryDenom] || '0')

      // Calculate configurable time windows
      const activityWindowMs = validatedActivityWindow * 24 * 60 * 60 * 1000
      const burnRateWindowMs = validatedBurnRateWindow * 24 * 60 * 60 * 1000

      // Get usage and activity metrics with configurable windows
      const [activeStats, burnData] = await Promise.all([
        // Active allowances and utilization
        query(
          `
          WITH latest_allowances AS (
            SELECT DISTINCT ON (granter, grantee)
              active, "parsedAmount", grantee
            FROM "FeegrantAllowances"
            WHERE granter = $contractAddress
            ORDER BY granter, grantee, "blockHeight" DESC
          ),
          recent_activity AS (
            SELECT COUNT(DISTINCT address) as "activeGrantees"
            FROM "BankStateEvents"
            WHERE address IN (
              SELECT grantee FROM latest_allowances WHERE active = true
            )
            AND "blockTimeUnixMs" >= $activityWindowStart
          )
          SELECT
            COUNT(*) as "totalAllowances",
            COUNT(*) FILTER (WHERE active = true) as "activeAllowances",
            SUM(CASE WHEN active = true AND "parsedAmount" IS NOT NULL
                THEN "parsedAmount"::bigint ELSE 0 END) as "totalAllocated",
            (SELECT "activeGrantees" FROM recent_activity) as "activeGrantees"
          FROM latest_allowances
        `,
          {
            contractAddress,
            activityWindowStart: (date.getTime() - activityWindowMs).toString(),
          }
        ),

        // Historical balance changes for burn rate with configurable window
        query(
          `
          SELECT
            "blockTimeUnixMs",
            balance
          FROM "BankStateEvents"
          WHERE address = $contractAddress
            AND denom = $primaryDenom
            AND "blockTimeUnixMs" >= $burnRateWindowStart
          ORDER BY "blockTimeUnixMs" DESC
          LIMIT $maxDataPoints
        `,
          {
            contractAddress,
            primaryDenom: primaryDenom,
            burnRateWindowStart: (date.getTime() - burnRateWindowMs).toString(),
            maxDataPoints: Math.min(validatedBurnRateWindow, 90), // Limit data points for performance
          }
        ),
      ])

      const stats = activeStats[0] || {}
      const totalAllowances = Number(stats.totalAllowances || 0)
      const activeAllowances = Number(stats.activeAllowances || 0)
      const totalAllocated = BigInt(String(stats.totalAllocated || '0'))
      const activeGrantees = Number(stats.activeGrantees || 0)

      // Calculate metrics with safe division
      const utilizationRate =
        totalAllowances > 0 ? (activeAllowances / totalAllowances) * 100 : 0
      const balanceRatio =
        totalAllocated > 0n
          ? Number((currentBalance * 100n) / totalAllocated)
          : 100
      const activeGranteeRatio =
        activeAllowances > 0 ? (activeGrantees / activeAllowances) * 100 : 0

      // Calculate burn rate with improved accuracy
      let averageDailyBurn = '0'
      let estimatedRunwayDays = Number.MAX_SAFE_INTEGER

      if (burnData.length >= 2) {
        const oldestBalance = BigInt(
          String(burnData[burnData.length - 1].balance)
        )
        const newestBalance = BigInt(String(burnData[0].balance))
        const timeSpanMs =
          Number(burnData[0].blockTimeUnixMs) -
          Number(burnData[burnData.length - 1].blockTimeUnixMs)
        const timeSpanDays = timeSpanMs / (24 * 60 * 60 * 1000)

        if (timeSpanDays > 0 && oldestBalance > newestBalance) {
          const totalBurn = oldestBalance - newestBalance
          averageDailyBurn = (
            totalBurn / BigInt(Math.floor(timeSpanDays))
          ).toString()

          if (BigInt(averageDailyBurn) > 0n) {
            estimatedRunwayDays = Math.floor(
              Number(currentBalance) / Number(averageDailyBurn)
            )
          }
        }
      }

      // Generate comprehensive alerts with improved logic
      const alerts: any[] = []

      if (balanceRatio < 20) {
        alerts.push({
          type: 'critical',
          message:
            'Treasury balance is critically low compared to allocated amounts',
          recommendation:
            'Consider reducing allowances or adding funds immediately',
        })
      } else if (balanceRatio < 50) {
        alerts.push({
          type: 'warning',
          message: 'Treasury balance is getting low',
          recommendation: 'Monitor spending and consider adding funds',
        })
      }

      if (utilizationRate < 30) {
        alerts.push({
          type: 'warning',
          message: 'Low allowance utilization rate',
          recommendation:
            'Review inactive allowances or increase marketing efforts',
        })
      }

      if (activeGranteeRatio < 40) {
        alerts.push({
          type: 'warning',
          message: 'Low grantee activity rate',
          recommendation: 'Engage with grantees to increase usage',
        })
      }

      if (
        estimatedRunwayDays < 30 &&
        estimatedRunwayDays < Number.MAX_SAFE_INTEGER
      ) {
        alerts.push({
          type: 'critical',
          message: `Treasury runway less than ${estimatedRunwayDays} days at current burn rate`,
          recommendation: 'Urgent funding needed or reduce spending',
        })
      } else if (
        estimatedRunwayDays < 90 &&
        estimatedRunwayDays < Number.MAX_SAFE_INTEGER
      ) {
        alerts.push({
          type: 'warning',
          message: `Treasury runway approximately ${estimatedRunwayDays} days`,
          recommendation: 'Plan for additional funding',
        })
      }

      // Add performance-specific alerts
      if (burnData.length < 2) {
        alerts.push({
          type: 'info',
          message: 'Insufficient burn rate data for accurate runway estimation',
          recommendation: 'Monitor treasury over a longer period for better insights',
        })
      }

      // Determine overall status
      const criticalAlerts = alerts.filter((a) => a.type === 'critical').length
      const warningAlerts = alerts.filter((a) => a.type === 'warning').length

      const status =
        criticalAlerts > 0
          ? 'critical'
          : warningAlerts > 0
          ? 'warning'
          : 'healthy'

      return {
        status,
        balanceRatio: Math.round(balanceRatio * 100) / 100,
        utilizationRate: Math.round(utilizationRate * 100) / 100,
        activeGranteeRatio: Math.round(activeGranteeRatio * 100) / 100,
        averageDailyBurn,
        estimatedRunwayDays:
          estimatedRunwayDays === Number.MAX_SAFE_INTEGER
            ? -1
            : estimatedRunwayDays,
        alerts,
        performanceMetrics: {
          activityWindowDays: validatedActivityWindow,
          burnRateWindowDays: validatedBurnRateWindow,
          processingOptimized: true,
        },
      }
    } catch (error) {
      console.error('Error in treasuryHealth formula:', error)
      // Return safe default structure to prevent complete failure
      return {
        status: 'critical',
        balanceRatio: 0,
        utilizationRate: 0,
        activeGranteeRatio: 0,
        averageDailyBurn: '0',
        estimatedRunwayDays: -1,
        alerts: [
          {
            type: 'critical',
            message: 'Failed to assess treasury health due to system error',
            recommendation: 'Check system logs and try again',
          },
        ],
        performanceMetrics: {
          activityWindowDays: 7,
          burnRateWindowDays: 30,
          processingOptimized: true,
        },
      }
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
