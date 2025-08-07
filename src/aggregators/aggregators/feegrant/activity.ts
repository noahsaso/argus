import { Aggregator, FormulaType } from '@/types'

/**
 * Get feegrant grantee activity statistics
 */
export const activity: Aggregator<
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
  compute: async (env) => {
    const { daysAgo } = env.args

    // Use the generic feegrant activity formula
    return await env.compute({
      type: FormulaType.Generic,
      formula: 'feegrant/activity',
      address: '', // Not needed for generic formulas
      args: {
        daysAgo: daysAgo || '30',
      },
    })
  },
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
}
