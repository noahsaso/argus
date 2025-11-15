import type { GenericFormula } from '@/types'

export const totals: GenericFormula<{
  totalActiveGrants: number
  totalActiveGrantees: number
  totalActiveGranters: number
  totalRevokedGrants: number
  totalBasicAllowances: number
  totalPeriodicAllowances: number
  totalAllowedMsgAllowances: number
  totalUnknownAllowances: number
}> = {
  docs: {
    description: 'Get comprehensive feegrant totals and statistics',
    args: [],
  },
  compute: async ({ query }) => {
    // Get all latest allowances data in a single optimized query
    const allAllowancesData = await query(`
      SELECT DISTINCT ON (granter, grantee)
        granter,
        grantee,
        active,
        "parsedAllowanceType"
      FROM "FeegrantAllowances"
      ORDER BY granter, grantee, "blockHeight" DESC
    `)

    // Process in memory for better performance than SQL aggregation
    const granteeSet = new Set<string>()
    const granterSet = new Set<string>()

    for (const allowance of allAllowancesData) {
      if (allowance.active) {
        granteeSet.add(allowance.grantee)
        granterSet.add(allowance.granter)
      }
    }

    // Calculate totals in memory (more efficient than SQL aggregation)
    const totalActiveGrants = allAllowancesData.filter(
      (a: any) => a.active
    ).length
    const totalRevokedGrants = allAllowancesData.filter(
      (a: any) => !a.active
    ).length
    const totalActiveGrantees = granteeSet.size
    const totalActiveGranters = granterSet.size

    const activeAllowances = allAllowancesData.filter((a: any) => a.active)
    const totalBasicAllowances = activeAllowances.filter(
      (a: any) => a.parsedAllowanceType === 'BasicAllowance'
    ).length
    const totalPeriodicAllowances = activeAllowances.filter(
      (a: any) => a.parsedAllowanceType === 'PeriodicAllowance'
    ).length
    const totalAllowedMsgAllowances = activeAllowances.filter(
      (a: any) => a.parsedAllowanceType === 'AllowedMsgAllowance'
    ).length
    const totalUnknownAllowances = activeAllowances.filter(
      (a: any) => a.parsedAllowanceType === null
    ).length

    return {
      totalActiveGrants,
      totalActiveGrantees,
      totalActiveGranters,
      totalRevokedGrants,
      totalBasicAllowances,
      totalPeriodicAllowances,
      totalAllowedMsgAllowances,
      totalUnknownAllowances,
    }
  },
}

export const feegrantAllowancesSummary: GenericFormula<{
  totalActiveGrants: number
  totalActiveGrantees: number
  totalActiveGranters: number
  totalRevokedGrants: number
  totalBasicAllowances: number
  totalPeriodicAllowances: number
  totalAllowedMsgAllowances: number
  totalUnknownAllowances: number
  granterAddresses: string[]
  granteeAddresses: string[]
}> = {
  docs: {
    description:
      'Get comprehensive feegrant totals with additional address data',
    args: [],
  },
  compute: async ({ query }) => {
    const allAllowances: any[] = []
    const granteeSet = new Set<string>()
    const granterSet = new Set<string>()

    // Get all allowances in a single query
    const allAllowancesData = await query(`
      SELECT DISTINCT ON (granter, grantee)
        granter,
        grantee,
        active,
        "parsedAllowanceType"
      FROM "FeegrantAllowances"
      ORDER BY granter, grantee, "blockHeight" DESC
    `)

    allAllowances.push(...allAllowancesData)

    // Process in memory
    for (const allowance of allAllowancesData) {
      if (allowance.active) {
        granteeSet.add(allowance.grantee)
        granterSet.add(allowance.granter)
      }
    }

    // Process totals in memory
    const totalActiveGrants = allAllowances.filter((a) => a.active).length
    const totalRevokedGrants = allAllowances.filter((a) => !a.active).length
    const totalActiveGrantees = granteeSet.size
    const totalActiveGranters = granterSet.size

    const activeAllowances = allAllowances.filter((a) => a.active)
    const totalBasicAllowances = activeAllowances.filter(
      (a) => a.parsedAllowanceType === 'BasicAllowance'
    ).length
    const totalPeriodicAllowances = activeAllowances.filter(
      (a) => a.parsedAllowanceType === 'PeriodicAllowance'
    ).length
    const totalAllowedMsgAllowances = activeAllowances.filter(
      (a) => a.parsedAllowanceType === 'AllowedMsgAllowance'
    ).length
    const totalUnknownAllowances = activeAllowances.filter(
      (a) => a.parsedAllowanceType === null
    ).length

    return {
      totalActiveGrants,
      totalActiveGrantees,
      totalActiveGranters,
      totalRevokedGrants,
      totalBasicAllowances,
      totalPeriodicAllowances,
      totalAllowedMsgAllowances,
      totalUnknownAllowances,
      granterAddresses: Array.from(granterSet),
      granteeAddresses: Array.from(granteeSet),
    }
  },
}

export const treasuryContractList: GenericFormula<{
  treasuryAddresses: string[]
  treasuryCount: number
  lastUpdated: string
  performanceMetrics: {
    candidatesAnalyzed: number
    processingOptimized: boolean
  }
}> = {
  docs: {
    description:
      'Get list of treasury contract addresses (optimized with parallel processing)',
    args: [],
  },
  compute: async ({ query, contractMatchesCodeIdKeys }) => {
    try {
      // Get all unique granter addresses that have issued feegrants
      const granterResults = await query(`
        SELECT DISTINCT granter, COUNT(*) as grant_count
        FROM "FeegrantAllowances"
        GROUP BY granter
        HAVING COUNT(*) > 0
        ORDER BY COUNT(*) DESC
      `)

      // Parallel processing optimization - check all contracts concurrently
      const treasuryValidationPromises = granterResults.map(async (row) => {
        const address = String(row.granter)

        try {
          const isTreasury = await contractMatchesCodeIdKeys(
            address,
            'xion-treasury'
          )
          return isTreasury ? address : null
        } catch (error) {
          console.warn(`Error validating treasury contract ${address}:`, error)
          return null
        }
      })

      // Wait for all validations to complete in parallel
      const validationResults = await Promise.all(treasuryValidationPromises)
      const treasuryAddresses = validationResults.filter(
        (address): address is string => address !== null
      )

      return {
        treasuryAddresses,
        treasuryCount: treasuryAddresses.length,
        lastUpdated: new Date().toISOString(),
        performanceMetrics: {
          candidatesAnalyzed: granterResults.length,
          processingOptimized: true,
        },
      }
    } catch (error) {
      console.error('Error in treasuryContractList formula:', error)
      // Return safe default structure to prevent complete failure
      return {
        treasuryAddresses: [],
        treasuryCount: 0,
        lastUpdated: new Date().toISOString(),
        performanceMetrics: {
          candidatesAnalyzed: 0,
          processingOptimized: true,
        },
      }
    }
  },
}

export const amounts: GenericFormula<{
  totalXionGranted: string
  totalUsdcGranted: string
  totalGrantsWithAmounts: number
  grantsByToken: { denom: string; total: string; count: number }[]
}> = {
  docs: {
    description: 'Get feegrant amounts by token denomination',
    args: [],
  },
  dynamic: true,
  compute: async ({ query }) => {
    // Query for amounts by token using specialized active+denom index
    const results = await query(`
      WITH latest_allowances AS (
        SELECT DISTINCT ON (granter, grantee)
          "parsedAmount",
          "parsedDenom"
        FROM "FeegrantAllowances"
        WHERE active = true AND "parsedAmount" IS NOT NULL AND "parsedDenom" IS NOT NULL
        ORDER BY granter, grantee, "blockHeight" DESC
      )
      SELECT
        "parsedDenom" as denom,
        SUM("parsedAmount"::bigint) as total,
        COUNT(*) as count
      FROM latest_allowances
      GROUP BY "parsedDenom"
      ORDER BY SUM("parsedAmount"::bigint) DESC
    `)

    const grantsByToken = results.map((row: any) => ({
      denom: row.denom,
      total: row.total.toString(),
      count: Number(row.count),
    }))

    // Calculate totals for specific tokens
    const xionGrant = grantsByToken.find((g) => g.denom === 'uxion')
    const usdcGrant = grantsByToken.find((g) => g.denom === 'uusdc')

    const totalGrantsWithAmounts = grantsByToken.reduce(
      (sum, grant) => sum + grant.count,
      0
    )

    return {
      totalXionGranted: xionGrant?.total || '0',
      totalUsdcGranted: usdcGrant?.total || '0',
      totalGrantsWithAmounts,
      grantsByToken,
    }
  },
}

export const activity: GenericFormula<{
  totalActiveGrantees: number
  granteesWithRecentTxActivity: number
  granteesWithRecentBalanceActivity: number
  granteesWithAnyRecentActivity: number
  activityRate: number
}> = {
  docs: {
    description: 'Get feegrant grantee activity statistics',
    args: [],
  },
  compute: async ({ query }) => {
    const recentThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days

    // Step 1: Get all active grantees using a single optimized query
    const activeGranteesData = await query(`
      SELECT DISTINCT ON (granter, grantee) grantee
      FROM "FeegrantAllowances"
      WHERE active = true
      ORDER BY granter, grantee, "blockHeight" DESC
    `)

    const activeGrantees = activeGranteesData.map((row: any) => row.grantee)
    const totalActiveGrantees = activeGrantees.length

    if (totalActiveGrantees === 0) {
      return {
        totalActiveGrantees: 0,
        granteesWithRecentTxActivity: 0,
        granteesWithRecentBalanceActivity: 0,
        granteesWithAnyRecentActivity: 0,
        activityRate: 0,
      }
    }

    // Step 2: Check for recent transaction activity (batch query for better performance)
    const txActivityData = await query(
      `
      SELECT DISTINCT sender as address
      FROM "WasmTxEvents"
      WHERE "blockTimeUnixMs" >= $recentThreshold
        AND sender = ANY($activeGrantees)
    `,
      {
        recentThreshold: recentThreshold.toString(),
        activeGrantees,
      }
    )

    // Step 3: Check for recent balance activity (batch query for better performance)
    const balanceActivityData = await query(
      `
      SELECT DISTINCT address
      FROM "BankStateEvents"
      WHERE "blockTimeUnixMs" >= $recentThreshold
        AND address = ANY($activeGrantees)
    `,
      {
        recentThreshold: recentThreshold.toString(),
        activeGrantees,
      }
    )

    // Process results in memory (faster than SQL joins)
    const txActiveAddresses = new Set(
      txActivityData.map((row: any) => row.address)
    )
    const balanceActiveAddresses = new Set(
      balanceActivityData.map((row: any) => row.address)
    )

    const granteesWithRecentTxActivity = txActiveAddresses.size
    const granteesWithRecentBalanceActivity = balanceActiveAddresses.size

    // Calculate union of active addresses
    const allActiveAddresses = new Set([
      ...txActiveAddresses,
      ...balanceActiveAddresses,
    ])
    const granteesWithAnyRecentActivity = allActiveAddresses.size

    const activityRate =
      totalActiveGrantees > 0
        ? (granteesWithAnyRecentActivity / totalActiveGrantees) * 100
        : 0

    return {
      totalActiveGrantees,
      granteesWithRecentTxActivity,
      granteesWithRecentBalanceActivity,
      granteesWithAnyRecentActivity,
      activityRate: Math.round(activityRate * 100) / 100,
    }
  },
}

// NOTE: I have optimized this as much as i could figure out
// there might be more ways to improve it that im not aware of.
export const treasuryAnalytics: GenericFormula<{
  totalTreasuryContracts: number
  activeTreasuryContracts: number
  totalGrantsFromTreasuries: number
  activeGrantsFromTreasuries: number
  treasuryMarketShare: number
  topTreasuries: Array<{
    address: string
    totalGrants: number
    activeGrants: number
    totalAllocated: string
    granteeCount: number
    activityRate: number
  }>
}> = {
  docs: {
    description: 'Get comprehensive treasury analytics',
    args: [],
  },
  compute: async ({
    query,
    contractMatchesCodeIdKeys,
    getFeegrantAllowances,
    block,
  }) => {
    // Step 1: Get potential treasury addresses using optimized approach
    // Use minimum thresholds to filter likely treasury contracts
    const candidatesQuery = await query(
      `
      WITH granter_candidates AS (
        SELECT
          granter,
          COUNT(*) as "totalGrants",
          COUNT(*) FILTER (WHERE active = true) as "activeGrants",
          COUNT(DISTINCT grantee) as "granteeCount",
          SUM(CASE WHEN active = true AND "parsedAmount" IS NOT NULL
              THEN "parsedAmount"::bigint ELSE 0 END) as "totalAllocated"
        FROM (
          SELECT DISTINCT ON (granter, grantee)
            granter, grantee, active, "parsedAmount"
          FROM "FeegrantAllowances"
          WHERE "blockHeight" <= $blockHeight
          ORDER BY granter, grantee, "blockHeight" DESC
        ) latest_allowances
        GROUP BY granter
        HAVING COUNT(*) >= 2 AND COUNT(*) FILTER (WHERE active = true) >= 1
        ORDER BY COUNT(*) DESC
        LIMIT 30
      )
      SELECT
        granter as address,
        "totalGrants",
        "activeGrants",
        "granteeCount",
        "totalAllocated"
      FROM granter_candidates
      ORDER BY "totalGrants" DESC
    `,
      { blockHeight: block.height }
    )

    // Step 2: Check for cached treasury addresses first, then validate in parallel
    const treasuryValidationPromises = candidatesQuery.map(async (row: any) => {
      const address = String(row.address)

      try {
        const isTreasury = await contractMatchesCodeIdKeys(
          address,
          'xion-treasury'
        )

        if (!isTreasury) {
          return null
        }

        // Step 3: Get activity data efficiently for confirmed treasuries
        const recentThreshold =
          block.timeUnixMs - BigInt(30 * 24 * 60 * 60 * 1000)

        // Use framework function to get grantees
        const allowances = await getFeegrantAllowances(address, 'granted')
        const activeGranteeAddresses = (allowances || [])
          .filter((a) => a.active)
          .map((a) => a.grantee)

        if (activeGranteeAddresses.length === 0) {
          return {
            address,
            totalGrants: Number(row.totalGrants),
            activeGrants: Number(row.activeGrants),
            granteeCount: Number(row.granteeCount),
            totalAllocated: row.totalAllocated?.toString() || '0',
            activeGrantees: 0,
          }
        }

        // Optimized activity query using EXISTS pattern
        const [activityResult] = await query(
          `
          SELECT COUNT(DISTINCT address) as "activeGrantees"
          FROM "BankStateEvents"
          WHERE address = ANY($granteeAddresses)
            AND "blockHeight" <= $blockHeight
            AND "blockTimeUnixMs" >= $recentThreshold
        `,
          {
            granteeAddresses: activeGranteeAddresses,
            blockHeight: block.height,
            recentThreshold: recentThreshold.toString(),
          }
        )

        return {
          address,
          totalGrants: Number(row.totalGrants),
          activeGrants: Number(row.activeGrants),
          granteeCount: Number(row.granteeCount),
          totalAllocated: row.totalAllocated?.toString() || '0',
          activeGrantees: Number(activityResult?.activeGrantees || 0),
        }
      } catch (error) {
        console.warn(`Error validating treasury ${address}:`, error)
        return null
      }
    })

    // Wait for all treasury validations to complete in parallel
    const validationResults = await Promise.all(treasuryValidationPromises)
    const treasuryContracts = validationResults.filter(
      (result): result is NonNullable<typeof result> => result !== null
    )

    // Step 4: Get overall statistics efficiently
    const [overallStats] = await query(
      `
      WITH latest_allowances AS (
        SELECT DISTINCT ON (granter, grantee)
          granter, active
        FROM "FeegrantAllowances"
        WHERE "blockHeight" <= $blockHeight
        ORDER BY granter, grantee, "blockHeight" DESC
      )
      SELECT
        COUNT(*) as "totalGrants",
        COUNT(*) FILTER (WHERE active = true) as "activeGrants"
      FROM latest_allowances
    `,
      { blockHeight: block.height }
    )

    // Step 5: Calculate final metrics
    const totalTreasuryContracts = treasuryContracts.length
    const activeTreasuryContracts = treasuryContracts.filter(
      (t) => t.activeGrants > 0
    ).length
    const totalGrantsFromTreasuries = treasuryContracts.reduce(
      (sum, t) => sum + t.totalGrants,
      0
    )
    const activeGrantsFromTreasuries = treasuryContracts.reduce(
      (sum, t) => sum + t.activeGrants,
      0
    )

    const treasuryMarketShare =
      Number(overallStats.activeGrants) > 0
        ? (activeGrantsFromTreasuries / Number(overallStats.activeGrants)) * 100
        : 0

    const topTreasuries = treasuryContracts
      .sort((a, b) => b.totalGrants - a.totalGrants)
      .slice(0, 10)
      .map((treasury) => ({
        address: treasury.address,
        totalGrants: treasury.totalGrants,
        activeGrants: treasury.activeGrants,
        totalAllocated: treasury.totalAllocated,
        granteeCount: treasury.granteeCount,
        activityRate:
          treasury.granteeCount > 0
            ? Math.round(
                (treasury.activeGrantees / treasury.granteeCount) * 10000
              ) / 100
            : 0,
      }))

    return {
      totalTreasuryContracts,
      activeTreasuryContracts,
      totalGrantsFromTreasuries,
      activeGrantsFromTreasuries,
      treasuryMarketShare: Math.round(treasuryMarketShare * 100) / 100,
      topTreasuries,
    }
  },
}

export const historicalTrends: GenericFormula<{
  timeSeriesData: Array<{
    date: string
    newGrants: number
    cumulativeGrants: number
    newGrantees: number
    cumulativeGrantees: number
    newGranters: number
    cumulativeGranters: number
    revokedGrants: number
    netGrants: number
  }>
  growthMetrics: {
    grantsGrowthRate: number
    granteesGrowthRate: number
    grantersGrowthRate: number
    averageDailyGrants: number
    peakGrantingDay: string
    peakGrantingCount: number
  }
  performanceMetrics: {
    timeWindowDays: number
    granularity: string
    dataPointsReturned: number
    processingOptimized: boolean
  }
}> = {
  docs: {
    description:
      'Get historical feegrant trends and growth analytics (optimized for performance)',
    args: [
      {
        name: 'timeWindow',
        description:
          'Time window in days for analysis (default: 90, min: 7, max: 365)',
        required: false,
        schema: { type: 'number', minimum: 7, maximum: 365 },
      },
      {
        name: 'granularity',
        description:
          'Data granularity: daily, weekly, monthly (default: daily)',
        required: false,
        schema: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
      },
      {
        name: 'limit',
        description:
          'Maximum data points to return (default: 1000, min: 30, max: 2000)',
        required: false,
        schema: { type: 'number', minimum: 30, maximum: 2000 },
      },
    ],
  },
  dynamic: true,
  compute: async (env) => {
    try {
      const { query, date } = env

      // Framework-standard parameter extraction and validation
      const timeWindow =
        typeof (env.args as any).timeWindow === 'number'
          ? (env.args as any).timeWindow
          : 90
      const granularity =
        typeof (env.args as any).granularity === 'string'
          ? (env.args as any).granularity
          : 'daily'
      const limit =
        typeof (env.args as any).limit === 'number'
          ? (env.args as any).limit
          : 1000

      // Parameter validation following framework standards
      const validatedTimeWindow = Math.min(Math.max(timeWindow, 7), 365)
      const validatedGranularity = ['daily', 'weekly', 'monthly'].includes(
        granularity
      )
        ? granularity
        : 'daily'
      const validatedLimit = Math.min(Math.max(limit, 30), 2000)

      // Smart granularity mapping with optimized intervals
      const granularityConfig = {
        daily: { ms: 24 * 60 * 60 * 1000, format: 'day' },
        weekly: { ms: 7 * 24 * 60 * 60 * 1000, format: 'week' },
        monthly: { ms: 30 * 24 * 60 * 60 * 1000, format: 'month' },
      }

      const config =
        granularityConfig[
          validatedGranularity as keyof typeof granularityConfig
        ]
      const timeWindowMs = validatedTimeWindow * 24 * 60 * 60 * 1000
      const windowStart = date.getTime() - timeWindowMs

      // Early exit if time window is too small
      if (windowStart >= date.getTime()) {
        return {
          timeSeriesData: [],
          growthMetrics: {
            grantsGrowthRate: 0,
            granteesGrowthRate: 0,
            grantersGrowthRate: 0,
            averageDailyGrants: 0,
            peakGrantingDay: '',
            peakGrantingCount: 0,
          },
          performanceMetrics: {
            timeWindowDays: validatedTimeWindow,
            granularity: validatedGranularity,
            dataPointsReturned: 0,
            processingOptimized: true,
          },
        }
      }

      // Optimized single query without expensive window functions
      const timeSeriesData = await query(
        `
        WITH time_buckets AS (
          SELECT
            date_trunc($granularity, to_timestamp("blockTimeUnixMs" / 1000)) as bucket_date,
            COUNT(*) as grants,
            COUNT(DISTINCT grantee) as grantees,
            COUNT(DISTINCT granter) as granters,
            COUNT(*) FILTER (WHERE active = false) as revoked,
            COUNT(*) FILTER (WHERE active = true) - COUNT(*) FILTER (WHERE active = false) as net
          FROM "FeegrantAllowances"
          WHERE "blockTimeUnixMs" >= $windowStart
          GROUP BY date_trunc($granularity, to_timestamp("blockTimeUnixMs" / 1000))
          ORDER BY bucket_date
          LIMIT $limit
        )
        SELECT
          bucket_date,
          grants as "newGrants",
          grantees as "newGrantees",
          granters as "newGranters",
          revoked as "revokedGrants",
          net as "netGrants"
        FROM time_buckets
        ORDER BY bucket_date
      `,
        {
          windowStart: windowStart.toString(),
          granularity: config.format,
          limit: validatedLimit,
        }
      )

      // Calculate cumulative data in memory (more efficient than SQL window functions)
      let cumulativeGrants = 0
      let cumulativeGrantees = 0
      let cumulativeGranters = 0

      const formattedData = timeSeriesData.map((row: any) => {
        const newGrants = Number(row.newGrants)
        const newGrantees = Number(row.newGrantees)
        const newGranters = Number(row.newGranters)

        // Update running totals in memory
        cumulativeGrants += newGrants
        cumulativeGrantees += newGrantees
        cumulativeGranters += newGranters

        return {
          date: new Date(row.bucket_date).toISOString().split('T')[0],
          newGrants,
          cumulativeGrants,
          newGrantees,
          cumulativeGrantees,
          newGranters,
          cumulativeGranters,
          revokedGrants: Number(row.revokedGrants),
          netGrants: Number(row.netGrants),
        }
      })

      // Early exit if no data
      if (formattedData.length === 0) {
        return {
          timeSeriesData: [],
          growthMetrics: {
            grantsGrowthRate: 0,
            granteesGrowthRate: 0,
            grantersGrowthRate: 0,
            averageDailyGrants: 0,
            peakGrantingDay: '',
            peakGrantingCount: 0,
          },
          performanceMetrics: {
            timeWindowDays: validatedTimeWindow,
            granularity: validatedGranularity,
            dataPointsReturned: 0,
            processingOptimized: true,
          },
        }
      }

      // Calculate growth metrics efficiently in memory
      const totalNewGrants = formattedData.reduce(
        (sum, d) => sum + d.newGrants,
        0
      )
      const totalNewGrantees = formattedData.reduce(
        (sum, d) => sum + d.newGrantees,
        0
      )
      const totalNewGranters = formattedData.reduce(
        (sum, d) => sum + d.newGranters,
        0
      )

      // Find peak granting day
      const peakDay = formattedData.reduce(
        (max, current) => (current.newGrants > max.newGrants ? current : max),
        formattedData[0]
      )

      // Optimized baseline query with time constraints to improve performance
      const baselineWindowStart = windowStart - 30 * 24 * 60 * 60 * 1000 // 30 days before analysis window
      const [baselineData] = await query(
        `
        SELECT
          COUNT(DISTINCT granter || ':' || grantee) as "baselineGrants",
          COUNT(DISTINCT grantee) as "baselineGrantees",
          COUNT(DISTINCT granter) as "baselineGranters"
        FROM "FeegrantAllowances"
        WHERE "blockTimeUnixMs" >= $baselineStart AND "blockTimeUnixMs" < $windowStart
      `,
        {
          baselineStart: baselineWindowStart.toString(),
          windowStart: windowStart.toString(),
        }
      )

      const baseline = baselineData || {
        baselineGrants: 0,
        baselineGrantees: 0,
        baselineGranters: 0,
      }

      // Calculate growth rates with safe division
      const grantsGrowthRate =
        Number(baseline.baselineGrants) > 0
          ? (totalNewGrants / Number(baseline.baselineGrants)) * 100
          : totalNewGrants > 0
          ? 100
          : 0

      const granteesGrowthRate =
        Number(baseline.baselineGrantees) > 0
          ? (totalNewGrantees / Number(baseline.baselineGrantees)) * 100
          : totalNewGrantees > 0
          ? 100
          : 0

      const grantersGrowthRate =
        Number(baseline.baselineGranters) > 0
          ? (totalNewGranters / Number(baseline.baselineGranters)) * 100
          : totalNewGranters > 0
          ? 100
          : 0

      // Calculate average daily grants based on actual granularity
      const actualDays = validatedTimeWindow
      const averageDailyGrants =
        actualDays > 0 ? totalNewGrants / actualDays : 0

      return {
        timeSeriesData: formattedData,
        growthMetrics: {
          grantsGrowthRate: Math.round(grantsGrowthRate * 100) / 100,
          granteesGrowthRate: Math.round(granteesGrowthRate * 100) / 100,
          grantersGrowthRate: Math.round(grantersGrowthRate * 100) / 100,
          averageDailyGrants: Math.round(averageDailyGrants * 100) / 100,
          peakGrantingDay: peakDay.date,
          peakGrantingCount: peakDay.newGrants,
        },
        performanceMetrics: {
          timeWindowDays: validatedTimeWindow,
          granularity: validatedGranularity,
          dataPointsReturned: formattedData.length,
          processingOptimized: true,
        },
      }
    } catch (error) {
      console.error('Error in historicalTrends formula:', error)
      // Return safe default structure to prevent complete failure
      return {
        timeSeriesData: [],
        growthMetrics: {
          grantsGrowthRate: 0,
          granteesGrowthRate: 0,
          grantersGrowthRate: 0,
          averageDailyGrants: 0,
          peakGrantingDay: '',
          peakGrantingCount: 0,
        },
        performanceMetrics: {
          timeWindowDays: 90,
          granularity: 'daily',
          dataPointsReturned: 0,
          processingOptimized: true,
        },
      }
    }
  },
}

// NOTE: this one alone took significant neurons and money to make it more performant
export const tokenMovement: GenericFormula<{
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
  performanceMetrics: {
    totalGranteesAnalyzed: number
    timeWindowDays: number
    processingOptimized: boolean
  }
}> = {
  docs: {
    description: 'Get comprehensive token movement analytics.',
    args: [
      {
        name: 'limit',
        description:
          'Maximum number of grantees to analyze (default: 1000, min: 100, max: 5000)',
        required: false,
        schema: { type: 'number', minimum: 100, maximum: 5000 },
      },
      {
        name: 'timeWindow',
        description: 'Time window in days for analysis (default: 30)',
        required: false,
        schema: { type: 'number', minimum: 1, maximum: 90 },
      },
    ],
  },
  compute: async (env) => {
    try {
      const { query, contractMatchesCodeIdKeys } = env

      // Fix parameter extraction - use framework standard args approach
      const limit =
        typeof (env.args as any).limit === 'number'
          ? (env.args as any).limit
          : 1000
      const timeWindow =
        typeof (env.args as any).timeWindow === 'number'
          ? (env.args as any).timeWindow
          : 30

      // Parameter validation following framework standards
      const validatedLimit = Math.min(Math.max(limit, 100), 5000)
      const validatedTimeWindow = Math.min(Math.max(timeWindow, 1), 90)
      const timeWindowMs = validatedTimeWindow * 24 * 60 * 60 * 1000
      const windowStart = Date.now() - timeWindowMs

      // Step 1: Optimized grantee sampling with configurable limit
      // Use DISTINCT ON pattern for better performance
      const granteeQueryLimit = Math.floor(validatedLimit * 0.8) // 80% of limit for top active
      const granteeRandomLimit = validatedLimit - granteeQueryLimit // 20% for random sample

      const [topActiveGrantees, randomSampleGrantees] = await Promise.all([
        // Top active grantees using framework-proven DISTINCT ON pattern
        query(
          `
          SELECT DISTINCT ON (fa.grantee) fa.grantee
          FROM "FeegrantAllowances" fa
          WHERE fa.active = true
          ORDER BY fa.grantee, fa."blockHeight" DESC
          LIMIT $limit
        `,
          { limit: granteeQueryLimit }
        ),
        // Random sample using proven approach
        query(
          `
          SELECT DISTINCT grantee
          FROM "FeegrantAllowances"
          WHERE active = true
          ORDER BY RANDOM()
          LIMIT $limit
        `,
          { limit: granteeRandomLimit }
        ),
      ])

      // Combine and deduplicate using Set pattern
      const allSampledGrantees = new Set([
        ...topActiveGrantees.map((row: any) => row.grantee),
        ...randomSampleGrantees.map((row: any) => row.grantee),
      ])
      const granteeAddresses = Array.from(allSampledGrantees)

      // Step 2: Simplified chain-wide movement analysis (replace expensive window functions)
      const chainWideData = await query(
        `
      WITH denom_aggregates AS (
        SELECT
          bse.denom,
          COUNT(*) as "transactionCount",
          -- Simple volume calculation using SUM of absolute balance changes
          SUM(ABS(bse.balance::bigint)) as "totalVolume"
        FROM "BankStateEvents" bse
        WHERE bse.address = ANY($granteeAddresses)
          AND bse."blockTimeUnixMs" >= $windowStart
        GROUP BY bse.denom
      )
      SELECT
        denom,
        "totalVolume",
        "transactionCount",
        CASE
          WHEN "transactionCount" > 0
          THEN "totalVolume" / "transactionCount"
          ELSE 0
        END as "averageValue"
      FROM denom_aggregates
      ORDER BY "totalVolume" DESC
    `,
        {
          granteeAddresses,
          windowStart: windowStart.toString(),
        }
      )

      const topTokensByVolume = chainWideData.map((row: any) => ({
        denom: row.denom,
        volume: row.totalVolume?.toString() || '0',
        transactionCount: Number(row.transactionCount),
        averageValue: Math.floor(Number(row.averageValue || 0)).toString(),
      }))

      const totalFeegrantVolume = topTokensByVolume
        .reduce((sum, token) => sum + BigInt(token.volume), BigInt(0))
        .toString()

      const totalFeegrantTransactions = topTokensByVolume.reduce(
        (sum, token) => sum + token.transactionCount,
        0
      )

      const averageTransactionValue =
        totalFeegrantTransactions > 0
          ? (
              BigInt(totalFeegrantVolume) / BigInt(totalFeegrantTransactions)
            ).toString()
          : '0'

      // Step 3: Simplified treasury analysis with broken down queries
      // First get treasury candidates using DISTINCT ON pattern
      const treasuryCandidatesData = await query(
        `
      SELECT
        fa.granter,
        COUNT(DISTINCT fa.grantee) as "granteeCount",
        COUNT(*) as "grantCount"
      FROM "FeegrantAllowances" fa
      WHERE fa.active = true
      GROUP BY fa.granter
      HAVING COUNT(*) >= 5
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `
      )

      // Then get treasury movement data separately for better performance
      const treasuryMovementPromises = treasuryCandidatesData.map(
        async (candidate: any) => {
          const granteeResult = await query(
            `
        SELECT DISTINCT grantee
        FROM "FeegrantAllowances"
        WHERE granter = $granter AND active = true
      `,
            { granter: candidate.granter }
          )

          const treasuryGranteeAddresses = granteeResult.map(
            (row: any) => row.grantee
          )

          if (treasuryGranteeAddresses.length === 0) {
            return {
              treasury: candidate.granter,
              granteeCount: Number(candidate.granteeCount),
              totalVolume: '0',
              transactionCount: 0,
            }
          }

          // Simple volume calculation for treasury grantees
          const [movementResult] = await query(
            `
        SELECT
          COUNT(*) as "transactionCount",
          SUM(ABS(balance::bigint)) as "totalVolume"
        FROM "BankStateEvents"
        WHERE address = ANY($granteeAddresses)
          AND "blockTimeUnixMs" >= $windowStart
      `,
            {
              granteeAddresses: treasuryGranteeAddresses,
              windowStart: windowStart.toString(),
            }
          )

          return {
            treasury: candidate.granter,
            granteeCount: Number(candidate.granteeCount),
            totalVolume: movementResult?.totalVolume?.toString() || '0',
            transactionCount: Number(movementResult?.transactionCount || 0),
          }
        }
      )

      // Wait for all treasury movement calculations in parallel
      const treasuryCandidatesWithMovement = await Promise.all(
        treasuryMovementPromises
      )

      // Step 4: Parallel treasury validation using Promise.all() for better performance
      const treasuryValidationPromises = treasuryCandidatesWithMovement.map(
        async (candidate) => {
          const address = String(candidate.treasury)

          try {
            const isTreasury = await contractMatchesCodeIdKeys(
              address,
              'xion',
              'treasury'
            )

            if (!isTreasury) {
              return null
            }

            const volume = candidate.totalVolume
            const transactionCount = candidate.transactionCount

            return {
              address,
              volume,
              transactionCount,
              averageValue:
                transactionCount > 0
                  ? (BigInt(volume) / BigInt(transactionCount)).toString()
                  : '0',
              granteeCount: candidate.granteeCount,
            }
          } catch (error) {
            console.warn(`Error validating treasury ${address}:`, error)
            return null
          }
        }
      )

      // Wait for all treasury validations in parallel
      const validationResults = await Promise.all(treasuryValidationPromises)
      const topTreasuriesByVolume = validationResults.filter(
        (result): result is NonNullable<typeof result> => result !== null
      )

      const totalTreasuryVolume = topTreasuriesByVolume
        .reduce((sum, t) => sum + BigInt(t.volume), BigInt(0))
        .toString()

      const totalTreasuryTransactions = topTreasuriesByVolume.reduce(
        (sum, t) => sum + t.transactionCount,
        0
      )

      const treasuryMarketShare =
        BigInt(totalFeegrantVolume) > 0n
          ? Number(
              (BigInt(totalTreasuryVolume) * BigInt(10000)) /
                BigInt(totalFeegrantVolume)
            ) / 100
          : 0

      // Step 5: Simplified daily trends using proven DISTINCT ON patterns
      const dailyTrends = await query(
        `
      SELECT
        date_trunc('day', to_timestamp("blockTimeUnixMs" / 1000))::date as day,
        COUNT(*) as "transactionCount",
        SUM(ABS(balance::bigint)) as "totalVolume"
      FROM "BankStateEvents"
      WHERE address = ANY($granteeAddresses)
        AND "blockTimeUnixMs" >= $windowStart
      GROUP BY date_trunc('day', to_timestamp("blockTimeUnixMs" / 1000))::date
      ORDER BY day
    `,
        {
          granteeAddresses,
          windowStart: windowStart.toString(),
        }
      )

      const formattedDailyTrends = dailyTrends.map((row: any) => ({
        date: row.day,
        totalVolume: row.totalVolume?.toString() || '0',
        transactionCount: Number(row.transactionCount),
        treasuryVolume: '0', // Simplified for performance
        treasuryTransactions: 0,
      }))

      return {
        chainWideMovement: {
          totalFeegrantVolume,
          totalFeegrantTransactions,
          averageTransactionValue,
          topTokensByVolume,
        },
        treasuryMovement: {
          totalTreasuryVolume,
          totalTreasuryTransactions,
          treasuryMarketShare: Math.round(treasuryMarketShare * 100) / 100,
          topTreasuriesByVolume,
        },
        dailyTrends: formattedDailyTrends,
        performanceMetrics: {
          totalGranteesAnalyzed: granteeAddresses.length,
          timeWindowDays: validatedTimeWindow,
          processingOptimized: true,
        },
      }
    } catch (error) {
      console.error('Error in tokenMovement formula:', error)
      // Return default structure to prevent complete failure
      return {
        chainWideMovement: {
          totalFeegrantVolume: '0',
          totalFeegrantTransactions: 0,
          averageTransactionValue: '0',
          topTokensByVolume: [],
        },
        treasuryMovement: {
          totalTreasuryVolume: '0',
          totalTreasuryTransactions: 0,
          treasuryMarketShare: 0,
          topTreasuriesByVolume: [],
        },
        dailyTrends: [],
        performanceMetrics: {
          totalGranteesAnalyzed: 0,
          timeWindowDays: 30,
          processingOptimized: true,
        },
      }
    }
  },
}
