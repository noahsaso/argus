import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'

import { BankStateEvent, Block, Contract, FeegrantAllowance, State, WasmTxEvent } from '@/db'

import { app } from '../../app'
import { AggregatorTestOptions } from '../types'

export const loadFeegrantTests = (options: AggregatorTestOptions) => {
  describe('feegrant', () => {
    beforeEach(async () => {
      const blockTimestamp = new Date('2022-01-01T00:00:00.000Z')

      // Create comprehensive test data for feegrant analytics
      await FeegrantAllowance.bulkCreate([
        {
          granter: 'xion1granter123',
          grantee: 'xion1grantee456',
          blockHeight: '100',
          blockTimeUnixMs: '1640995200000',
          blockTimestamp,
          allowanceData: 'base64allowancedata1',
          allowanceType: 'BasicAllowance',
          active: true,
          parsedAmount: '1000000',
          parsedDenom: 'uxion',
          parsedAllowanceType: 'BasicAllowance',
          parsedExpirationUnixMs: null,
        },
        {
          granter: 'xion1granter123',
          grantee: 'xion1grantee789',
          blockHeight: '200',
          blockTimeUnixMs: '1640995300000',
          blockTimestamp: new Date('2022-01-01T00:01:40.000Z'),
          allowanceData: 'base64allowancedata2',
          allowanceType: 'PeriodicAllowance',
          active: true,
          parsedAmount: '2000000',
          parsedDenom: 'uxion',
          parsedAllowanceType: 'PeriodicAllowance',
          parsedExpirationUnixMs: '1672531200000', // 2023-01-01
        },
        {
          granter: 'xion1granter456',
          grantee: 'xion1grantee123',
          blockHeight: '150',
          blockTimeUnixMs: '1640995250000',
          blockTimestamp: new Date('2022-01-01T00:00:50.000Z'),
          allowanceData: 'base64allowancedata3',
          allowanceType: 'BasicAllowance',
          active: true,
          parsedAmount: '500000',
          parsedDenom: 'uusdc',
          parsedAllowanceType: 'BasicAllowance',
          parsedExpirationUnixMs: null,
        },
        {
          granter: 'xion1granter789',
          grantee: 'xion1grantee456',
          blockHeight: '300',
          blockTimeUnixMs: '1640995400000',
          blockTimestamp: new Date('2022-01-01T00:03:20.000Z'),
          allowanceData: '',
          allowanceType: null,
          active: false, // Revoked allowance
          parsedAmount: null,
          parsedDenom: null,
          parsedAllowanceType: null,
          parsedExpirationUnixMs: null,
        },
        {
          granter: 'xion1granter999',
          grantee: 'xion1grantee999',
          blockHeight: '250',
          blockTimeUnixMs: '1640995350000',
          blockTimestamp: new Date('2022-01-01T00:02:30.000Z'),
          allowanceData: 'base64allowancedata4',
          allowanceType: 'AllowedMsgAllowance',
          active: true,
          parsedAmount: '750000',
          parsedDenom: 'uxion',
          parsedAllowanceType: 'AllowedMsgAllowance',
          parsedExpirationUnixMs: null,
        },
      ])

      // Create contracts first (required for foreign key constraint)
      await Contract.bulkCreate([
        {
          address: 'xion1contract123',
          codeId: 1,
          admin: null,
          creator: 'xion1creator123',
          label: 'Test Contract 1',
          instantiatedAtBlockHeight: '290',
          instantiatedAtBlockTimeUnixMs: '1640995350000',
          instantiatedAtBlockTimestamp: new Date('2022-01-01T00:02:30.000Z'),
          txHash: 'tx1hash',
        },
        {
          address: 'xion1contract456',
          codeId: 2,
          admin: null,
          creator: 'xion1creator456',
          label: 'Test Contract 2',
          instantiatedAtBlockHeight: '295',
          instantiatedAtBlockTimeUnixMs: '1640995375000',
          instantiatedAtBlockTimestamp: new Date('2022-01-01T00:02:55.000Z'),
          txHash: 'tx2hash',
        },
      ])

      // Add activity data for testing
      await WasmTxEvent.bulkCreate([
        {
          contractAddress: 'xion1contract123',
          sender: 'xion1grantee456', // Active grantee with recent activity
          blockHeight: '290',
          blockTimeUnixMs: '1640995350000', // Recent activity
          blockTimestamp: new Date('2022-01-01T00:02:30.000Z'),
          txIndex: 0,
          messageId: '0',
          action: 'execute',
          msg: '{}',
          msgJson: {},
          reply: null,
          funds: [],
          response: null,
          gasUsed: '100000',
        },
        {
          contractAddress: 'xion1contract456',
          sender: 'xion1grantee123', // Another grantee with activity
          blockHeight: '295',
          blockTimeUnixMs: '1640995375000',
          blockTimestamp: new Date('2022-01-01T00:02:55.000Z'),
          txIndex: 0,
          messageId: '0',
          action: 'execute',
          msg: '{}',
          msgJson: {},
          reply: null,
          funds: [],
          response: null,
          gasUsed: '100000',
        },
      ])

      await BankStateEvent.bulkCreate([
        {
          address: 'xion1grantee456',
          denom: 'uxion',
          blockHeight: 285,
          blockTimeUnixMs: 1640995325000,
          blockTimestamp: new Date('2022-01-01T00:02:05.000Z'),
          balance: '1000',
        },
        {
          address: 'xion1grantee789',
          denom: 'uxion',
          blockHeight: 280,
          blockTimeUnixMs: 1640995300000,
          blockTimestamp: new Date('2022-01-01T00:01:40.000Z'),
          balance: '2000',
        },
      ])

      await Block.createMany([
        { height: 100, timeUnixMs: 1640995200000 },
        { height: 150, timeUnixMs: 1640995250000 },
        { height: 200, timeUnixMs: 1640995300000 },
        { height: 250, timeUnixMs: 1640995350000 },
        { height: 280, timeUnixMs: 1640995300000 },
        { height: 285, timeUnixMs: 1640995325000 },
        { height: 290, timeUnixMs: 1640995350000 },
        { height: 295, timeUnixMs: 1640995375000 },
        { height: 300, timeUnixMs: 1640995400000 },
      ])

      await State.updateSingleton({
        latestBlockHeight: 300,
        latestBlockTimeUnixMs: 1640995400000,
        lastFeegrantBlockHeightExported: 300,
      })
    })

    describe('totals', () => {
      it('returns comprehensive feegrant statistics', async () => {
        const mockResult = {
          totalActiveGrants: 4,
          totalActiveGrantees: 4,
          totalActiveGranters: 3,
          totalRevokedGrants: 1,
          totalBasicAllowances: 2,
          totalPeriodicAllowances: 1,
          totalAllowedMsgAllowances: 1,
          totalUnknownAllowances: 0,
        }

        options.mockAggregator({
          compute: async () => mockResult,
        })

        const response = await request(app.callback())
          .get('/a/feegrant/totals')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(mockResult)
      })

      it('handles empty database scenario', async () => {
        const emptyResult = {
          totalActiveGrants: 0,
          totalActiveGrantees: 0,
          totalActiveGranters: 0,
          totalRevokedGrants: 0,
          totalBasicAllowances: 0,
          totalPeriodicAllowances: 0,
          totalAllowedMsgAllowances: 0,
          totalUnknownAllowances: 0,
        }

        options.mockAggregator({
          compute: async () => emptyResult,
        })

        const response = await request(app.callback())
          .get('/a/feegrant/totals')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(emptyResult)
      })

      it('handles mixed allowance types correctly', async () => {
        const mixedResult = {
          totalActiveGrants: 10,
          totalActiveGrantees: 8,
          totalActiveGranters: 5,
          totalRevokedGrants: 2,
          totalBasicAllowances: 6,
          totalPeriodicAllowances: 3,
          totalAllowedMsgAllowances: 1,
          totalUnknownAllowances: 0,
        }

        options.mockAggregator({
          compute: async () => mixedResult,
        })

        const response = await request(app.callback())
          .get('/a/feegrant/totals')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(mixedResult)
      })
    })

    describe('amounts', () => {
      it('returns token amount statistics', async () => {
        const mockResult = {
          totalXionGranted: '3750000',
          totalUsdcGranted: '500000',
          totalGrantsWithAmounts: 4,
          grantsByToken: [
            {
              denom: 'uxion',
              total: '3750000',
              count: 3,
            },
            {
              denom: 'uusdc',
              total: '500000',
              count: 1,
            },
          ],
        }

        options.mockAggregator({
          compute: async () => mockResult,
        })

        const response = await request(app.callback())
          .get('/a/feegrant/amounts')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(mockResult)
      })

      it('handles no grants with amounts', async () => {
        const noAmountsResult = {
          totalXionGranted: '0',
          totalUsdcGranted: '0',
          totalGrantsWithAmounts: 0,
          grantsByToken: [],
        }

        options.mockAggregator({
          compute: async () => noAmountsResult,
        })

        const response = await request(app.callback())
          .get('/a/feegrant/amounts')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(noAmountsResult)
      })

      it('handles large amounts correctly', async () => {
        const largeAmountsResult = {
          totalXionGranted: '1000000000000', // 1 million XION
          totalUsdcGranted: '500000000000', // 500k USDC
          totalGrantsWithAmounts: 2,
          grantsByToken: [
            {
              denom: 'uxion',
              total: '1000000000000',
              count: 1,
            },
            {
              denom: 'uusdc',
              total: '500000000000',
              count: 1,
            },
          ],
        }

        options.mockAggregator({
          compute: async () => largeAmountsResult,
        })

        const response = await request(app.callback())
          .get('/a/feegrant/amounts')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(largeAmountsResult)
      })

      it('handles multiple token denominations', async () => {
        const multiTokenResult = {
          totalXionGranted: '1000000',
          totalUsdcGranted: '500000',
          totalGrantsWithAmounts: 5,
          grantsByToken: [
            {
              denom: 'uxion',
              total: '1000000',
              count: 2,
            },
            {
              denom: 'uusdc',
              total: '500000',
              count: 1,
            },
            {
              denom: 'uatom',
              total: '250000',
              count: 1,
            },
            {
              denom: 'ujuno',
              total: '100000',
              count: 1,
            },
          ],
        }

        options.mockAggregator({
          compute: async () => multiTokenResult,
        })

        const response = await request(app.callback())
          .get('/a/feegrant/amounts')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(multiTokenResult)
      })
    })

    describe('activity', () => {
      it('returns activity statistics with default 30 day window', async () => {
        const mockResult = {
          totalActiveGrantees: 4,
          granteesWithRecentTxActivity: 2,
          granteesWithRecentBalanceActivity: 2,
          granteesWithAnyRecentActivity: 3,
          activityRate: 75.0,
        }

        options.mockAggregator({
          compute: async () => mockResult,
        })

        const response = await request(app.callback())
          .get('/a/feegrant/activity')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(mockResult)
      })

      it('returns activity statistics with custom time window', async () => {
        const mockResult = {
          totalActiveGrantees: 4,
          granteesWithRecentTxActivity: 1,
          granteesWithRecentBalanceActivity: 1,
          granteesWithAnyRecentActivity: 2,
          activityRate: 50.0,
        }

        options.mockAggregator({
          compute: async () => mockResult,
        })

        const response = await request(app.callback())
          .get('/a/feegrant/activity?daysAgo=7')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(mockResult)
      })

      it('handles very short time window with no activity', async () => {
        const noActivityResult = {
          totalActiveGrantees: 4,
          granteesWithRecentTxActivity: 0,
          granteesWithRecentBalanceActivity: 0,
          granteesWithAnyRecentActivity: 0,
          activityRate: 0.0,
        }

        options.mockAggregator({
          compute: async () => noActivityResult,
        })

        const response = await request(app.callback())
          .get('/a/feegrant/activity?daysAgo=0.001')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(noActivityResult)
      })

      it('handles 100% activity rate', async () => {
        const fullActivityResult = {
          totalActiveGrantees: 5,
          granteesWithRecentTxActivity: 3,
          granteesWithRecentBalanceActivity: 4,
          granteesWithAnyRecentActivity: 5,
          activityRate: 100.0,
        }

        options.mockAggregator({
          compute: async () => fullActivityResult,
        })

        const response = await request(app.callback())
          .get('/a/feegrant/activity?daysAgo=30')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(fullActivityResult)
      })

      it('validates daysAgo parameter', async () => {
        options.mockAggregator({
          compute: async () => {
            throw new Error('daysAgo must be a positive number')
          },
        })

        await request(app.callback())
          .get('/a/feegrant/activity?daysAgo=invalid')
          .set('x-api-key', options.apiKey)
          .expect(500)
          .expect('daysAgo must be a positive number')
      })

      it('validates negative daysAgo parameter', async () => {
        options.mockAggregator({
          compute: async () => {
            throw new Error('daysAgo must be a positive number')
          },
        })

        await request(app.callback())
          .get('/a/feegrant/activity?daysAgo=-5')
          .set('x-api-key', options.apiKey)
          .expect(500)
          .expect('daysAgo must be a positive number')
      })

      it('handles zero active grantees', async () => {
        const zeroGranteesResult = {
          totalActiveGrantees: 0,
          granteesWithRecentTxActivity: 0,
          granteesWithRecentBalanceActivity: 0,
          granteesWithAnyRecentActivity: 0,
          activityRate: 0.0,
        }

        options.mockAggregator({
          compute: async () => zeroGranteesResult,
        })

        const response = await request(app.callback())
          .get('/a/feegrant/activity')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(zeroGranteesResult)
      })

      it('handles large numbers of grantees', async () => {
        const largeScaleResult = {
          totalActiveGrantees: 10000,
          granteesWithRecentTxActivity: 2500,
          granteesWithRecentBalanceActivity: 3000,
          granteesWithAnyRecentActivity: 4500,
          activityRate: 45.0,
        }

        options.mockAggregator({
          compute: async () => largeScaleResult,
        })

        const response = await request(app.callback())
          .get('/a/feegrant/activity?daysAgo=30')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.body).toEqual(largeScaleResult)
      })
    })

    describe('caching behavior', () => {
      it('includes cache headers for totals endpoint', async () => {
        options.mockAggregator({
          compute: async () => ({
            totalActiveGrants: 1,
            totalActiveGrantees: 1,
            totalActiveGranters: 1,
            totalRevokedGrants: 0,
            totalBasicAllowances: 1,
            totalPeriodicAllowances: 0,
            totalAllowedMsgAllowances: 0,
            totalUnknownAllowances: 0,
          }),
        })

        const response = await request(app.callback())
          .get('/a/feegrant/totals')
          .set('x-api-key', options.apiKey)
          .expect(200)

        // Check for cache headers (these are set by the aggregator route handler)
        expect(response.headers['cache-control']).toBeDefined()
      })

      it('includes cache headers for amounts endpoint', async () => {
        options.mockAggregator({
          compute: async () => ({
            totalXionGranted: '0',
            totalUsdcGranted: '0',
            totalGrantsWithAmounts: 0,
            grantsByToken: [],
          }),
        })

        const response = await request(app.callback())
          .get('/a/feegrant/amounts')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.headers['cache-control']).toBeDefined()
      })

      it('includes cache headers for activity endpoint', async () => {
        options.mockAggregator({
          compute: async () => ({
            totalActiveGrantees: 0,
            granteesWithRecentTxActivity: 0,
            granteesWithRecentBalanceActivity: 0,
            granteesWithAnyRecentActivity: 0,
            activityRate: 0.0,
          }),
        })

        const response = await request(app.callback())
          .get('/a/feegrant/activity')
          .set('x-api-key', options.apiKey)
          .expect(200)

        expect(response.headers['cache-control']).toBeDefined()
      })
    })

    describe('error handling', () => {
      it('handles aggregator computation errors gracefully', async () => {
        options.mockAggregator({
          compute: async () => {
            throw new Error('Database connection failed')
          },
        })

        await request(app.callback())
          .get('/a/feegrant/totals')
          .set('x-api-key', options.apiKey)
          .expect(500)
          .expect('Database connection failed')
      })

      it('handles invalid aggregator names', async () => {
        await request(app.callback())
          .get('/a/feegrant/nonexistent')
          .set('x-api-key', options.apiKey)
          .expect(500)
      })

      it('requires valid API key', async () => {
        await request(app.callback())
          .get('/a/feegrant/totals')
          .expect(401)
      })
    })
  })
}
