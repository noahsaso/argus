import { describe } from 'vitest'

import { AggregatorTestOptions } from '../types'
import { loadBalanceTests } from './balance'

export const loadAggregatorTests = (options: AggregatorTestOptions) => {
  describe('aggregator', () => {
    loadBalanceTests(options)
  })
}
