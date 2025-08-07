import { Aggregator, FormulaType } from '@/types'

/**
 * Get feegrant amounts by token denomination
 */
export const amounts: Aggregator<
  {
    totalXionGranted: string
    totalUsdcGranted: string
    totalGrantsWithAmounts: number
    grantsByToken: { denom: string; total: string; count: number }[]
  }
> = {
  compute: async (env) => {
    // Use the generic feegrant amounts formula
    return await env.compute({
      type: FormulaType.Generic,
      formula: 'feegrant/amounts',
      address: '', // Not needed for generic formulas
      args: {},
    })
  },
  docs: {
    description: 'Get feegrant amounts by token denomination',
    args: [],
  },
}
