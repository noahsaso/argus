import { Aggregator, FormulaType } from '@/types'

/**
 * Get feegrant totals and statistics
 */
export const totals: Aggregator<{
  totalActiveGrants: number
  totalActiveGrantees: number
  totalActiveGranters: number
  totalRevokedGrants: number
  totalBasicAllowances: number
  totalPeriodicAllowances: number
  totalAllowedMsgAllowances: number
  totalUnknownAllowances: number
}> = {
  compute: async (env) => {
    // Use the generic feegrant totals formula
    return await env.compute({
      type: FormulaType.Generic,
      formula: 'feegrant/totals',
      address: '', // Not needed for generic formulas
      args: {},
    })
  },
  docs: {
    description: 'Get comprehensive feegrant totals and statistics',
    args: [],
  },
}
