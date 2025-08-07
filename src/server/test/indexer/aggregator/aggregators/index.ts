import { describe } from 'vitest'

import { AggregatorTestOptions } from '../types'
import { loadBalanceTests } from './balance'
import { loadFeegrantTests } from './feegrant'

export const loadAggregatorTests = (options: AggregatorTestOptions) => {
  describe('aggregator', () => {
    loadBalanceTests(options)
    loadFeegrantTests(options)
  })
}
