import { Aggregator, NestedAggregatorMap } from '@/types'

import * as aggregators from './aggregators'

export const getAggregator = (
  aggregatorName: string
): Aggregator | undefined => {
  const aggregatorPath = aggregatorName.split('/')
  const aggregatorBase = aggregatorPath
    .slice(0, -1)
    .reduce(
      (acc, key) =>
        acc && typeof acc === 'object' && key in acc
          ? (acc as NestedAggregatorMap)[key]
          : undefined,
      aggregators as NestedAggregatorMap | Aggregator | undefined
    )

  const aggregator =
    typeof aggregatorBase === 'object'
      ? (aggregatorBase as NestedAggregatorMap)[
          aggregatorPath[aggregatorPath.length - 1]
        ]
      : undefined

  return aggregator &&
    'compute' in aggregator &&
    typeof aggregator.compute === 'function'
    ? (aggregator as Aggregator)
    : undefined
}
