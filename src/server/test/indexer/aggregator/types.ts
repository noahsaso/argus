import { MockInstance } from 'vitest'

import { AccountKeyCredit } from '@/db'
import { Aggregator } from '@/types'

export type AggregatorTestOptions = {
  apiKey: string
  credit: AccountKeyCredit
  mockAggregator: (aggregator?: Partial<Aggregator>) => MockInstance
  unmockAggregator: () => void
}
