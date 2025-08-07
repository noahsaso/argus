import { GenericFormula } from '@/types'

export const totals: GenericFormula<
  {
    totalActiveGrants: number
    totalActiveGrantees: number
    totalActiveGranters: number
    totalRevokedGrants: number
    totalBasicAllowances: number
    totalPeriodicAllowances: number
    totalAllowedMsgAllowances: number
    totalUnknownAllowances: number
  }
> = {
  docs: {
    description: 'Get comprehensive feegrant totals and statistics',
    args: [],
  },
  dynamic: true,
  compute: async ({ query }) => {
    // Single optimized query to get all totals
    const [result] = await query(`
      WITH latest_allowances AS (
        SELECT DISTINCT ON (granter, grantee) 
          granter,
          grantee,
          active,
          "parsedAllowanceType"
        FROM "FeegrantAllowances" 
        ORDER BY granter, grantee, "blockHeight" DESC
      )
      SELECT 
        COUNT(*) FILTER (WHERE active = true) as "totalActiveGrants",
        COUNT(DISTINCT grantee) FILTER (WHERE active = true) as "totalActiveGrantees",
        COUNT(DISTINCT granter) FILTER (WHERE active = true) as "totalActiveGranters",
        COUNT(*) FILTER (WHERE active = false) as "totalRevokedGrants",
        COUNT(*) FILTER (WHERE "parsedAllowanceType" = 'BasicAllowance' AND active = true) as "totalBasicAllowances",
        COUNT(*) FILTER (WHERE "parsedAllowanceType" = 'PeriodicAllowance' AND active = true) as "totalPeriodicAllowances",
        COUNT(*) FILTER (WHERE "parsedAllowanceType" = 'AllowedMsgAllowance' AND active = true) as "totalAllowedMsgAllowances",
        COUNT(*) FILTER (WHERE "parsedAllowanceType" IS NULL AND active = true) as "totalUnknownAllowances"
      FROM latest_allowances
    `)

    return {
      totalActiveGrants: Number(result.totalActiveGrants),
      totalActiveGrantees: Number(result.totalActiveGrantees),
      totalActiveGranters: Number(result.totalActiveGranters),
      totalRevokedGrants: Number(result.totalRevokedGrants),
      totalBasicAllowances: Number(result.totalBasicAllowances),
      totalPeriodicAllowances: Number(result.totalPeriodicAllowances),
      totalAllowedMsgAllowances: Number(result.totalAllowedMsgAllowances),
      totalUnknownAllowances: Number(result.totalUnknownAllowances),
    }
  },
}

export const amounts: GenericFormula<
  {
    totalXionGranted: string
    totalUsdcGranted: string
    totalGrantsWithAmounts: number
    grantsByToken: { denom: string; total: string; count: number }[]
  }
> = {
  docs: {
    description: 'Get feegrant amounts by token denomination',
    args: [],
  },
  dynamic: true,
  compute: async ({ query }) => {
    // Query for amounts by token
    const results = await query(`
      WITH latest_allowances AS (
        SELECT DISTINCT ON (granter, grantee) 
          "parsedAmount", 
          "parsedDenom", 
          active
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
    const xionGrant = grantsByToken.find(g => g.denom === 'uxion')
    const usdcGrant = grantsByToken.find(g => g.denom === 'uusdc')

    const totalGrantsWithAmounts = grantsByToken.reduce((sum, grant) => sum + grant.count, 0)

    return {
      totalXionGranted: xionGrant?.total || '0',
      totalUsdcGranted: usdcGrant?.total || '0',
      totalGrantsWithAmounts,
      grantsByToken,
    }
  },
}

export const activity: GenericFormula<
  {
    totalActiveGrantees: number
    granteesWithRecentTxActivity: number
    granteesWithRecentBalanceActivity: number
    granteesWithAnyRecentActivity: number
    activityRate: number
  },
  {
    daysAgo?: string
  }
> = {
  docs: {
    description: 'Get feegrant grantee activity statistics',
    args: [
      {
        name: 'daysAgo',
        description: 'Number of days to look back for activity (default: 30)',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  dynamic: true,
  compute: async ({ query, date, args }) => {
    const daysAgo = args.daysAgo ? Number(args.daysAgo) : 30
    if (isNaN(daysAgo) || daysAgo <= 0) {
      throw new Error('daysAgo must be a positive number')
    }

    const recentThreshold = date.getTime() - (daysAgo * 24 * 60 * 60 * 1000)

    const [result] = await query(`
      WITH active_grantees AS (
        SELECT DISTINCT ON (granter, grantee) grantee 
        FROM "FeegrantAllowances" 
        WHERE active = true
        ORDER BY granter, grantee, "blockHeight" DESC
      ),
      recent_tx_activity AS (
        SELECT DISTINCT sender as address
        FROM "WasmTxEvents" 
        WHERE "blockTimeUnixMs" >= $recentThreshold
      ),
      recent_balance_activity AS (
        SELECT DISTINCT address 
        FROM "BankStateEvents"
        WHERE "blockTimeUnixMs" >= $recentThreshold
      )
      SELECT 
        COUNT(DISTINCT ag.grantee) as "totalActiveGrantees",
        COUNT(DISTINCT rta.address) as "granteesWithRecentTxActivity",
        COUNT(DISTINCT rba.address) as "granteesWithRecentBalanceActivity",
        COUNT(DISTINCT COALESCE(rta.address, rba.address)) as "granteesWithAnyRecentActivity"
      FROM active_grantees ag
      LEFT JOIN recent_tx_activity rta ON ag.grantee = rta.address
      LEFT JOIN recent_balance_activity rba ON ag.grantee = rba.address
    `, {
      recentThreshold,
    })

    const totalActiveGrantees = Number(result.totalActiveGrantees)
    const granteesWithAnyRecentActivity = Number(result.granteesWithAnyRecentActivity)
    
    const activityRate = totalActiveGrantees > 0 
      ? (granteesWithAnyRecentActivity / totalActiveGrantees) * 100 
      : 0

    return {
      totalActiveGrantees,
      granteesWithRecentTxActivity: Number(result.granteesWithRecentTxActivity),
      granteesWithRecentBalanceActivity: Number(result.granteesWithRecentBalanceActivity),
      granteesWithAnyRecentActivity,
      activityRate: Math.round(activityRate * 100) / 100, // Round to 2 decimal places
    }
  },
}
