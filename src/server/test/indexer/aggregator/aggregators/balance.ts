import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'

import { BankStateEvent, Block, State } from '@/db'

import { app } from '../../app'
import { AggregatorTestOptions } from '../types'

export const loadBalanceTests = (options: AggregatorTestOptions) => {
  describe('balance', () => {
    describe('overTime', () => {
      beforeEach(async () => {
        const blockTimestamp = new Date()

        // Create test bank state events
        await BankStateEvent.bulkCreate([
          {
            address: 'cosmos1testaddress',
            denom: 'uatom',
            blockHeight: 1,
            blockTimeUnixMs: 1000,
            blockTimestamp,
            balance: '100',
          },
          {
            address: 'cosmos1testaddress',
            denom: 'uatom',
            blockHeight: 2,
            blockTimeUnixMs: 2000,
            blockTimestamp,
            balance: '200',
          },
          {
            address: 'cosmos1testaddress',
            denom: 'uatom',
            blockHeight: 3,
            blockTimeUnixMs: 3000,
            blockTimestamp,
            balance: '300',
          },
        ])

        await Block.createMany([
          { height: 1, timeUnixMs: 1000 },
          { height: 2, timeUnixMs: 2000 },
          { height: 3, timeUnixMs: 3000 },
        ])

        await State.updateSingleton({
          latestBlockHeight: 3,
          latestBlockTimeUnixMs: 3000,
        })
      })

      it('aggregates balance over time with basic statistics', async () => {
        const mockResult = {
          sum: '600',
          average: '200',
          min: '100',
          max: '300',
          count: 3,
          values: [
            { value: '100', blockHeight: '1', blockTimeUnixMs: '1000' },
            { value: '200', blockHeight: '2', blockTimeUnixMs: '2000' },
            { value: '300', blockHeight: '3', blockTimeUnixMs: '3000' },
          ],
        }

        options.mockAggregator({
          compute: async () => mockResult,
        })

        const response = await request(app.callback())
          .get('/a/balance/balanceOverTime')
          .query({
            address: 'cosmos1testaddress',
            denom: 'uatom',
            startTime: '1000',
            endTime: '3000',
            timeStep: '1000',
          })
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(mockResult)
      })

      it('requires address argument', async () => {
        options.mockAggregator({
          compute: async () => {
            throw new Error('address argument is required')
          },
        })

        await request(app.callback())
          .get('/a/balance/balanceOverTime')
          .query({ denom: 'uatom' })
          .set('x-api-key', options.apiKey)
          .expect(500)
          .expect('address argument is required')
      })

      it('requires denom argument', async () => {
        options.mockAggregator({
          compute: async () => {
            throw new Error('denom argument is required')
          },
        })

        await request(app.callback())
          .get('/a/balance/balanceOverTime')
          .query({ address: 'cosmos1testaddress' })
          .set('x-api-key', options.apiKey)
          .expect(500)
          .expect('denom argument is required')
      })

      it('handles empty time range', async () => {
        const emptyResult = {
          sum: '0',
          average: '0',
          min: '0',
          max: '0',
          count: 0,
          values: [],
        }

        options.mockAggregator({
          compute: async () => emptyResult,
        })

        const response = await request(app.callback())
          .get('/a/balance/balanceOverTime')
          .query({
            address: 'cosmos1testaddress',
            denom: 'uatom',
            startTime: '5000',
            endTime: '6000',
          })
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(emptyResult)
      })
    })
  })
}
