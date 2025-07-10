import { beforeEach, describe } from 'vitest'

import { AccountKeyCredit } from '@/db'
import { getAggregator, restoreOriginalMocks } from '@/test/mocks'
import { getAccountWithAuth } from '@/test/utils'
import { Aggregator } from '@/types'

import { loadAggregatorTests } from './aggregators'
import { AggregatorTestOptions } from './types'
import { loadValidationsTests } from './validations'

const mockAggregator = (aggregator?: Partial<Aggregator>) =>
  getAggregator.mockImplementation((name: string) => {
    if (name === 'invalid') {
      return undefined
    }

    return {
      compute: async () => ({ test: 'result' }),
      docs: { description: 'Test aggregator' },
      ...aggregator,
    } as Aggregator
  })

describe('aggregator: GET /a/(.*)', () => {
  const options: AggregatorTestOptions = {
    apiKey: '',
    credit: {} as AccountKeyCredit,
    mockAggregator,
    unmockAggregator: restoreOriginalMocks,
  }

  beforeEach(async () => {
    const { paidApiKey, paidCredit } = await getAccountWithAuth()
    options.apiKey = paidApiKey
    options.credit = paidCredit
  })

  loadValidationsTests(options)
  loadAggregatorTests(options)
})
