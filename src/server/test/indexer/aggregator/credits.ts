import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { app } from '../app'
import { AggregatorTestOptions } from './types'

export const loadCreditsTests = (options: AggregatorTestOptions) => {
  describe('credits', () => {
    it('charges credits for aggregator computation', async () => {
      options.mockAggregator()

      const initialCredits = options.credit.remaining

      await request(app.callback())
        .get('/a/test/aggregator')
        .set('x-api-key', options.apiKey)
        .expect(200)

      // Credits should be decremented
      await options.credit.reload()
      expect(options.credit.remaining).toBeLessThan(initialCredits)
    })

    it('returns 402 when insufficient credits', async () => {
      // Set credits to 0
      await options.credit.update({ amount: 0 })

      options.mockAggregator()

      await request(app.callback())
        .get('/a/test/aggregator')
        .set('x-api-key', options.apiKey)
        .expect(402)
        .expect('insufficient credits')
    })

    it('does not charge credits on error', async () => {
      options.mockAggregator({
        compute: async () => {
          throw new Error('Test error')
        },
      })

      const initialCredits = options.credit.remaining

      await request(app.callback())
        .get('/a/test/aggregator')
        .set('x-api-key', options.apiKey)
        .expect(500)

      // Credits should not be decremented on error
      await options.credit.reload()
      expect(options.credit.remaining).toBe(initialCredits)
    })
  })
}
