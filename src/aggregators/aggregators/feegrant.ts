import { Aggregator, FormulaType } from '@/types'

/**
 * Aggregate treasury analytics over time
 */
export const treasuryOverTime: Aggregator<
  Array<{
    blockHeight: number
    blockTimeUnixMs: number
    value: {
      activeGrantees: number
      totalAllowancesGranted: number
      treasuryBalance: string
      utilizationRate: number
      onboardingVelocity: number
    }
  }>,
  {
    contractAddress: string
  }
> = {
  compute: async (env) => {
    const { contractAddress } = env.args

    if (!contractAddress) {
      throw new Error('contractAddress argument is required')
    }

    try {
      // Set default time range - last 7 days with daily steps
      const now = env.date.getTime()
      const defaultStartTime = now - 7 * 24 * 60 * 60 * 1000 // 7 days ago
      const defaultTimeStep = 24 * 60 * 60 * 1000 // 1 day

      // Use framework defaults for time range
      const timeStepBigInt = BigInt(defaultTimeStep)
      const startTimeBigInt = BigInt(defaultStartTime)
      const endTimeBigInt = BigInt(now)

      // Get multiple treasury metrics over time, using balanceHistory for accurate timestamps
      const [activeGranteesData, usageMetricsData, balanceHistoryData] =
        await Promise.all([
          env.computeRange({
            type: FormulaType.Contract,
            formula: 'xion/treasury/activeGrantees',
            address: contractAddress,
            times: {
              start: startTimeBigInt,
              end: endTimeBigInt,
              step: timeStepBigInt,
            },
          }),
          env.computeRange({
            type: FormulaType.Contract,
            formula: 'xion/treasury/usageMetrics',
            address: contractAddress,
            times: {
              start: startTimeBigInt,
              end: endTimeBigInt,
              step: timeStepBigInt,
            },
          }),
          // Use the specialized balanceHistory formula that preserves actual event timestamps
          env.compute({
            type: FormulaType.Contract,
            formula: 'xion/treasury/balanceHistory',
            address: contractAddress,
          }),
        ])

      // Use the activeGrantees data as the primary time series and merge other metrics
      // For balance data, use the actual event timestamp from balanceHistory instead of sampling timestamp
      return activeGranteesData.map((entry, index) => {
        const usageMetrics = usageMetricsData[index]?.value || {}
        const balanceHistory = balanceHistoryData || {}
        const primaryBalanceData = balanceHistory?.uxion || {
          balance: '0',
          lastChanged: new Date(0).toISOString(),
        }
        const primaryBalance = primaryBalanceData.balance || '0'

        // Use actual event timestamp for balance data if available, otherwise fall back to sampling timestamp
        const balanceTimestamp = primaryBalanceData.lastChanged
          ? new Date(primaryBalanceData.lastChanged).getTime()
          : Number(entry.blockTimeUnixMs)

        return {
          blockHeight: Number(entry.blockHeight),
          blockTimeUnixMs: balanceTimestamp, // Use actual balance event timestamp
          value: {
            activeGrantees: entry.value?.count || 0,
            totalAllowancesGranted: usageMetrics.totalAllowancesGranted || 0,
            treasuryBalance: primaryBalance,
            utilizationRate: usageMetrics.utilizationRate || 0,
            onboardingVelocity: 0, // Would need onboarding metrics for this
          },
        }
      })
    } catch (err) {
      // For invalid contract addresses or other issues, return empty data gracefully
      if (
        err instanceof Error &&
        ((err as any).statusCode === 405 || (err as any).statusCode === 404)
      ) {
        return []
      }
      throw err
    }
  },
  docs: {
    description: 'Aggregate treasury analytics over a time range',
    args: [
      {
        name: 'contractAddress',
        description: 'Treasury contract address',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'startTime',
        description: 'Start time in Unix milliseconds',
        required: false,
        schema: { type: 'string' },
      },
      {
        name: 'endTime',
        description: 'End time in Unix milliseconds',
        required: false,
        schema: { type: 'string' },
      },
      {
        name: 'timeStep',
        description:
          'Time step in milliseconds between data points (default: 24h)',
        required: false,
        schema: { type: 'string' },
      },
    ],
  },
}

/**
 * Aggregate chain-wide feegrant analytics over time
 */
export const chainwideOverTime: Aggregator<
  Array<{
    blockHeight: number
    blockTimeUnixMs: number
    value: {
      totalActiveGrants: number
      totalActiveGrantees: number
      totalTreasuryContracts: number
      treasuryMarketShare: number
      grantsGrowthRate?: number
      granteesGrowthRate?: number
    }
  }>
> = {
  compute: async (env) => {
    // Set default time range - last 7 days with daily steps
    const now = env.date.getTime()
    const defaultStartTime = now - 7 * 24 * 60 * 60 * 1000 // 7 days ago
    const defaultTimeStep = 24 * 60 * 60 * 1000 // 1 day

    // Use framework defaults for time range
    const timeStepBigInt = BigInt(defaultTimeStep)
    const startTimeBigInt = BigInt(defaultStartTime)
    const endTimeBigInt = BigInt(now)

    // Get chain-wide analytics over time using optimized version
    const analyticsData = await env.computeRange({
      type: FormulaType.Generic,
      formula: 'feegrant/treasuryAnalytics',
      address: '_',
      times: {
        start: startTimeBigInt,
        end: endTimeBigInt,
        step: timeStepBigInt,
      },
    })

    // Transform to expected format with trend calculation
    return analyticsData.map((entry, index) => {
      const currentValue = entry.value || {}
      const previousValue =
        index > 0 ? analyticsData[index - 1]?.value || {} : {}

      // Calculate growth rates compared to previous period
      const grantsGrowthRate =
        previousValue.totalActiveGrants > 0
          ? ((currentValue.totalActiveGrants -
              previousValue.totalActiveGrants) /
              previousValue.totalActiveGrants) *
            100
          : 0

      const granteesGrowthRate =
        previousValue.totalActiveGrantees > 0
          ? ((currentValue.totalActiveGrantees -
              previousValue.totalActiveGrantees) /
              previousValue.totalActiveGrantees) *
            100
          : 0

      return {
        blockHeight: Number(entry.blockHeight),
        blockTimeUnixMs: Number(entry.blockTimeUnixMs),
        value: {
          totalActiveGrants: currentValue.totalActiveGrants || 0,
          totalActiveGrantees: currentValue.totalActiveGrantees || 0,
          totalTreasuryContracts: currentValue.totalTreasuryContracts || 0,
          treasuryMarketShare: currentValue.treasuryMarketShare || 0,
          grantsGrowthRate: Math.round(grantsGrowthRate * 100) / 100,
          granteesGrowthRate: Math.round(granteesGrowthRate * 100) / 100,
        },
      }
    })
  },
  docs: {
    description: 'Aggregate chain-wide feegrant analytics over a time range',
    args: [
      {
        name: 'startTime',
        description: 'Start time in Unix milliseconds',
        required: false,
        schema: { type: 'string' },
      },
      {
        name: 'endTime',
        description: 'End time in Unix milliseconds',
        required: false,
        schema: { type: 'string' },
      },
      {
        name: 'timeStep',
        description:
          'Time step in milliseconds between data points (default: 24h)',
        required: false,
        schema: { type: 'string' },
      },
    ],
  },
}

/**
 * Aggregate treasury onboarding metrics over time
 */
export const treasuryOnboardingOverTime: Aggregator<
  Array<{
    blockHeight: number
    blockTimeUnixMs: number
    value: {
      newGranteesInPeriod: number
      cumulativeGrantees: number
      onboardingVelocity: number
    }
  }>,
  {
    contractAddress: string
  }
> = {
  compute: async (env) => {
    const { contractAddress } = env.args

    if (!contractAddress) {
      throw new Error('contractAddress argument is required')
    }

    try {
      // Set default time range - last 7 days with daily steps
      const now = env.date.getTime()
      const defaultStartTime = now - 7 * 24 * 60 * 60 * 1000 // 7 days ago
      const defaultTimeStep = 24 * 60 * 60 * 1000 // 1 day

      // Use framework defaults for time range
      const timeStepBigInt = BigInt(defaultTimeStep)
      const startTimeBigInt = BigInt(defaultStartTime)
      const endTimeBigInt = BigInt(now)

      // Get onboarding metrics over time
      const onboardingData = await env.computeRange({
        type: FormulaType.Contract,
        formula: 'xion/treasury/onboardingMetrics',
        address: contractAddress,
        args: {
          timeWindow: timeStepBigInt.toString(),
          granularity: 'daily',
        },
        times: {
          start: startTimeBigInt,
          end: endTimeBigInt,
          step: timeStepBigInt,
        },
      })

      // Transform to expected format
      let cumulativeGrantees = 0
      return onboardingData.map((entry) => {
        const metrics = entry.value || {
          newGrantees: 0,
          totalGrantees: 0,
          onboardingVelocity: 0,
          growthRate: 0,
        }
        cumulativeGrantees += metrics.newGrantees

        return {
          blockHeight: Number(entry.blockHeight),
          blockTimeUnixMs: Number(entry.blockTimeUnixMs),
          value: {
            newGranteesInPeriod: metrics.newGrantees,
            cumulativeGrantees,
            onboardingVelocity: metrics.onboardingVelocity,
          },
        }
      })
    } catch (err) {
      // For invalid contract addresses or other issues, return empty data gracefully
      if (
        err instanceof Error &&
        ((err as any).statusCode === 405 || (err as any).statusCode === 404)
      ) {
        return []
      }
      throw err
    }
  },
  docs: {
    description: 'Aggregate treasury onboarding metrics over a time range',
    args: [
      {
        name: 'contractAddress',
        description: 'Treasury contract address',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'startTime',
        description: 'Start time in Unix milliseconds',
        required: false,
        schema: { type: 'string' },
      },
      {
        name: 'endTime',
        description: 'End time in Unix milliseconds',
        required: false,
        schema: { type: 'string' },
      },
      {
        name: 'timeStep',
        description:
          'Time step in milliseconds between data points (default: 24h)',
        required: false,
        schema: { type: 'string' },
      },
    ],
  },
}

/**
 * Aggregate token movement analytics over time
 */
/**
 * Get current token movement analytics (non-time-series)
 */
export const tokenMovement: Aggregator<{
  chainWideMovement: {
    totalFeegrantVolume: string
    totalFeegrantTransactions: number
    averageTransactionValue: string
    topTokensByVolume: Array<{
      denom: string
      volume: string
      transactionCount: number
      averageValue: string
    }>
  }
  treasuryMovement: {
    totalTreasuryVolume: string
    totalTreasuryTransactions: number
    treasuryMarketShare: number
    topTreasuriesByVolume: Array<{
      address: string
      volume: string
      transactionCount: number
      averageValue: string
      granteeCount: number
    }>
  }
  dailyTrends: Array<{
    date: string
    totalVolume: string
    transactionCount: number
    treasuryVolume: string
    treasuryTransactions: number
  }>
}> = {
  compute: async (env) => {
    // Get current token movement data using optimized version
    const result = await env.compute({
      type: FormulaType.Generic,
      formula: 'feegrant/tokenMovement',
      address: '_',
    })

    return result
  },
  docs: {
    description:
      'Get current comprehensive token movement analytics for feegrant usage',
    args: [],
  },
}

export const tokenMovementOverTime: Aggregator<
  Array<{
    blockHeight: number
    blockTimeUnixMs: number
    value: {
      totalFeegrantVolume: string
      treasuryVolume: string
      nonTreasuryVolume: string
      volumeByToken: Array<{
        denom: string
        volume: string
      }>
    }
  }>
> = {
  compute: async (env) => {
    // Set default time range - last 7 days with daily steps
    const now = env.date.getTime()
    const defaultStartTime = now - 7 * 24 * 60 * 60 * 1000 // 7 days ago
    const defaultTimeStep = 24 * 60 * 60 * 1000 // 1 day

    // Use framework defaults for time range
    const timeStepBigInt = BigInt(defaultTimeStep)
    const startTimeBigInt = BigInt(defaultStartTime)
    const endTimeBigInt = BigInt(now)

    // Get token movement data over time using optimized version
    const movementData = await env.computeRange({
      type: FormulaType.Generic,
      formula: 'feegrant/tokenMovement',
      address: '_',
      times: {
        start: startTimeBigInt,
        end: endTimeBigInt,
        step: timeStepBigInt,
      },
    })

    // Transform to expected format
    return movementData.map((entry) => ({
      blockHeight: Number(entry.blockHeight),
      blockTimeUnixMs: Number(entry.blockTimeUnixMs),
      value: {
        totalFeegrantVolume:
          entry.value?.chainWideMovement?.totalFeegrantVolume || '0',
        treasuryVolume:
          entry.value?.treasuryMovement?.totalTreasuryVolume || '0',
        nonTreasuryVolume:
          entry.value?.chainWideMovement?.nonTreasuryVolume || '0',
        volumeByToken: entry.value?.chainWideMovement?.volumeByToken || [],
      },
    }))
  },
  docs: {
    description: 'Aggregate token movement analytics over a time range',
    args: [
      {
        name: 'startTime',
        description: 'Start time in Unix milliseconds',
        required: false,
        schema: { type: 'string' },
      },
      {
        name: 'endTime',
        description: 'End time in Unix milliseconds',
        required: false,
        schema: { type: 'string' },
      },
      {
        name: 'timeStep',
        description:
          'Time step in milliseconds between data points (default: 24h)',
        required: false,
        schema: { type: 'string' },
      },
      {
        name: 'timeWindow',
        description:
          'Time window for each data point analysis (default: 30 days)',
        required: false,
        schema: { type: 'string' },
      },
    ],
  },
}
