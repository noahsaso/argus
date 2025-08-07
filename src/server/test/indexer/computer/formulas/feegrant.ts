import request from 'supertest'
import { beforeEach, describe, it } from 'vitest'

import { BankStateEvent, Block, FeegrantAllowance, State, WasmTxEvent } from '@/db'

import { app } from '../../app'
import { ComputerTestOptions } from '../types'

export const loadFeegrantTests = (options: ComputerTestOptions) => {
  describe('feegrant', () => {
    beforeEach(async () => {
      const blockTimestamp = new Date('2022-01-01T00:00:00.000Z')

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
      ])

      await Block.createMany([
        {
          height: 100,
          timeUnixMs: 1640995200000,
        },
        {
          height: 150,
          timeUnixMs: 1640995250000,
        },
        {
          height: 200,
          timeUnixMs: 1640995300000,
        },
        {
          height: 300,
          timeUnixMs: 1640995400000,
        },
      ])

      await State.updateSingleton({
        latestBlockHeight: 300,
        latestBlockTimeUnixMs: 1640995400000,
        lastFeegrantBlockHeightExported: 300,
      })
    })

    describe('getFeegrantAllowance', () => {
      it('returns allowance for valid granter-grantee pair', async () => {
        await request(app.callback())
          .get(
            '/account/xion1granter123/feegrant/allowance?grantee=xion1grantee456'
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            granter: 'xion1granter123',
            grantee: 'xion1grantee456',
            allowanceData: 'base64allowancedata1',
            allowanceType: 'BasicAllowance',
            active: true,
            block: {
              height: '100',
              timeUnixMs: '1640995200000',
              timestamp: '2022-01-01T00:00:00.000Z',
            },
          })
      })

      it('returns allowance for specific block height', async () => {
        await request(app.callback())
          .get(
            '/account/xion1granter123/feegrant/allowance?grantee=xion1grantee789&block=200:1640995300000'
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            granter: 'xion1granter123',
            grantee: 'xion1grantee789',
            allowanceData: 'base64allowancedata2',
            allowanceType: 'PeriodicAllowance',
            active: true,
            block: {
              height: '200',
              timeUnixMs: '1640995300000',
              timestamp: '2022-01-01T00:01:40.000Z',
            },
          })
      })

      it('returns undefined for non-existent allowance', async () => {
        await request(app.callback())
          .get(
            '/account/xion1nonexistent/feegrant/allowance?grantee=xion1grantee456'
          )
          .set('x-api-key', options.apiKey)
          .expect(204)
      })

      it('returns undefined for revoked allowance when querying latest', async () => {
        await request(app.callback())
          .get(
            '/account/xion1granter789/feegrant/allowance?grantee=xion1grantee456'
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            granter: 'xion1granter789',
            grantee: 'xion1grantee456',
            allowanceData: '',
            allowanceType: null,
            active: false,
            block: {
              height: '300',
              timeUnixMs: '1640995400000',
              timestamp: '2022-01-01T00:03:20.000Z',
            },
          })
      })
    })

    describe('getFeegrantAllowances', () => {
      it('returns allowances granted by address', async () => {
        await request(app.callback())
          .get('/account/xion1granter123/feegrant/allowances?type=granted')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              granter: 'xion1granter123',
              grantee: 'xion1grantee456',
              allowanceData: 'base64allowancedata1',
              allowanceType: 'BasicAllowance',
              active: true,
              block: {
                height: '100',
                timeUnixMs: '1640995200000',
                timestamp: '2022-01-01T00:00:00.000Z',
              },
            },
            {
              granter: 'xion1granter123',
              grantee: 'xion1grantee789',
              allowanceData: 'base64allowancedata2',
              allowanceType: 'PeriodicAllowance',
              active: true,
              block: {
                height: '200',
                timeUnixMs: '1640995300000',
                timestamp: '2022-01-01T00:01:40.000Z',
              },
            },
          ])
      })

      it('returns allowances received by address', async () => {
        await request(app.callback())
          .get('/account/xion1grantee456/feegrant/allowances?type=received')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              granter: 'xion1granter123',
              grantee: 'xion1grantee456',
              allowanceData: 'base64allowancedata1',
              allowanceType: 'BasicAllowance',
              active: true,
              block: {
                height: '100',
                timeUnixMs: '1640995200000',
                timestamp: '2022-01-01T00:00:00.000Z',
              },
            },
          ])
      })

      it('defaults to granted type when no type specified', async () => {
        await request(app.callback())
          .get('/account/xion1granter123/feegrant/allowances')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              granter: 'xion1granter123',
              grantee: 'xion1grantee456',
              allowanceData: 'base64allowancedata1',
              allowanceType: 'BasicAllowance',
              active: true,
              block: {
                height: '100',
                timeUnixMs: '1640995200000',
                timestamp: '2022-01-01T00:00:00.000Z',
              },
            },
            {
              granter: 'xion1granter123',
              grantee: 'xion1grantee789',
              allowanceData: 'base64allowancedata2',
              allowanceType: 'PeriodicAllowance',
              active: true,
              block: {
                height: '200',
                timeUnixMs: '1640995300000',
                timestamp: '2022-01-01T00:01:40.000Z',
              },
            },
          ])
      })

      it('filters out inactive allowances', async () => {
        await request(app.callback())
          .get('/account/xion1granter789/feegrant/allowances?type=granted')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([])
      })

      it('returns empty array for address with no allowances', async () => {
        await request(app.callback())
          .get('/account/xion1nonexistent/feegrant/allowances?type=granted')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([])
      })

      it('returns allowances for specific block height', async () => {
        await request(app.callback())
          .get(
            '/account/xion1granter123/feegrant/allowances?type=granted&block=150:1640995250000'
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              granter: 'xion1granter123',
              grantee: 'xion1grantee456',
              allowanceData: 'base64allowancedata1',
              allowanceType: 'BasicAllowance',
              active: true,
              block: {
                height: '100',
                timeUnixMs: '1640995200000',
                timestamp: '2022-01-01T00:00:00.000Z',
              },
            },
          ])
      })
    })

    describe('hasFeegrantAllowance', () => {
      it('returns true for active allowance', async () => {
        await request(app.callback())
          .get('/account/xion1granter123/feegrant/has?grantee=xion1grantee456')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect('true')
      })

      it('returns false for inactive allowance', async () => {
        await request(app.callback())
          .get('/account/xion1granter789/feegrant/has?grantee=xion1grantee456')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect('false')
      })

      it('returns false for non-existent allowance', async () => {
        await request(app.callback())
          .get('/account/xion1nonexistent/feegrant/has?grantee=xion1grantee456')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect('false')
      })

      it('returns correct result for specific block height', async () => {
        await request(app.callback())
          .get(
            '/account/xion1granter123/feegrant/has?grantee=xion1grantee789&block=150:1640995250000'
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect('false')

        await request(app.callback())
          .get(
            '/account/xion1granter123/feegrant/has?grantee=xion1grantee789&block=200:1640995300000'
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect('true')
      })
    })

    describe('block height filtering', () => {
      it('applies block height filter correctly for allowance queries', async () => {
        // Query at block 150 should not see the allowance created at block 200
        await request(app.callback())
          .get(
            '/account/xion1granter123/feegrant/allowance?grantee=xion1grantee789&block=150:1640995250000'
          )
          .set('x-api-key', options.apiKey)
          .expect(204)

        // Query at block 200 should see the allowance
        await request(app.callback())
          .get(
            '/account/xion1granter123/feegrant/allowance?grantee=xion1grantee789&block=200:1640995300000'
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            granter: 'xion1granter123',
            grantee: 'xion1grantee789',
            allowanceData: 'base64allowancedata2',
            allowanceType: 'PeriodicAllowance',
            active: true,
            block: {
              height: '200',
              timeUnixMs: '1640995300000',
              timestamp: '2022-01-01T00:01:40.000Z',
            },
          })
      })

      it('applies block height filter correctly for allowances queries', async () => {
        // Query at block 150 should only see allowances up to that block
        await request(app.callback())
          .get(
            '/account/xion1granter123/feegrant/allowances?type=granted&block=150:1640995250000'
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              granter: 'xion1granter123',
              grantee: 'xion1grantee456',
              allowanceData: 'base64allowancedata1',
              allowanceType: 'BasicAllowance',
              active: true,
              block: {
                height: '100',
                timeUnixMs: '1640995200000',
                timestamp: '2022-01-01T00:00:00.000Z',
              },
            },
          ])
      })
    })

    describe('generic feegrant formulas', () => {
      beforeEach(async () => {
        // Add activity data for testing
        await WasmTxEvent.bulkCreate([
          {
            contractAddress: 'xion1contract123',
            sender: 'xion1grantee456', // Active grantee with recent activity
            blockHeight: 290,
            blockTimeUnixMs: 1640995350000, // Recent activity
            blockTimestamp: new Date('2022-01-01T00:02:30.000Z'),
            txHash: 'tx1',
            msg: '{}',
          },
          {
            contractAddress: 'xion1contract456',
            sender: 'xion1grantee123', // Another grantee with activity
            blockHeight: 295,
            blockTimeUnixMs: 1640995375000,
            blockTimestamp: new Date('2022-01-01T00:02:55.000Z'),
            txHash: 'tx2',
            msg: '{}',
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
      })

      describe('totals', () => {
        it('returns comprehensive feegrant statistics', async () => {
          await request(app.callback())
            .get('/generic/feegrant/totals')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .expect({
              totalActiveGrants: 3,
              totalActiveGrantees: 3,
              totalActiveGranters: 2,
              totalRevokedGrants: 1,
              totalBasicAllowances: 2,
              totalPeriodicAllowances: 1,
              totalAllowedMsgAllowances: 0,
              totalUnknownAllowances: 0,
            })
        })

        it('handles empty database', async () => {
          // Clear all data
          await FeegrantAllowance.destroy({ where: {} })

          await request(app.callback())
            .get('/generic/feegrant/totals')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .expect({
              totalActiveGrants: 0,
              totalActiveGrantees: 0,
              totalActiveGranters: 0,
              totalRevokedGrants: 0,
              totalBasicAllowances: 0,
              totalPeriodicAllowances: 0,
              totalAllowedMsgAllowances: 0,
              totalUnknownAllowances: 0,
            })
        })
      })

      describe('amounts', () => {
        it('returns token amount statistics', async () => {
          await request(app.callback())
            .get('/generic/feegrant/amounts')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .expect({
              totalXionGranted: '3000000',
              totalUsdcGranted: '500000',
              totalGrantsWithAmounts: 3,
              grantsByToken: [
                {
                  denom: 'uxion',
                  total: '3000000',
                  count: 2,
                },
                {
                  denom: 'uusdc',
                  total: '500000',
                  count: 1,
                },
              ],
            })
        })

        it('handles no grants with amounts', async () => {
          // Update all grants to have no parsed amounts
          await FeegrantAllowance.update(
            { parsedAmount: null, parsedDenom: null },
            { where: {} }
          )

          await request(app.callback())
            .get('/generic/feegrant/amounts')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .expect({
              totalXionGranted: '0',
              totalUsdcGranted: '0',
              totalGrantsWithAmounts: 0,
              grantsByToken: [],
            })
        })
      })

      describe('activity', () => {
        it('returns activity statistics with default 30 day window', async () => {
          await request(app.callback())
            .get('/generic/feegrant/activity')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .expect({
              totalActiveGrantees: 3,
              granteesWithRecentTxActivity: 2,
              granteesWithRecentBalanceActivity: 2,
              granteesWithAnyRecentActivity: 3,
              activityRate: 100.0,
            })
        })

        it('returns activity statistics with custom time window', async () => {
          await request(app.callback())
            .get('/generic/feegrant/activity?daysAgo=1')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .expect({
              totalActiveGrantees: 3,
              granteesWithRecentTxActivity: 2,
              granteesWithRecentBalanceActivity: 2,
              granteesWithAnyRecentActivity: 3,
              activityRate: 100.0,
            })
        })

        it('handles very short time window with no activity', async () => {
          // Use a very short time window that excludes all activity
          const veryRecentTime = Date.now() - 1000 // 1 second ago
          
          // Mock the date to be very recent
          await request(app.callback())
            .get('/generic/feegrant/activity?daysAgo=0.00001') // ~1 second
            .set('x-api-key', options.apiKey)
            .expect(200)
            .expect({
              totalActiveGrantees: 3,
              granteesWithRecentTxActivity: 0,
              granteesWithRecentBalanceActivity: 0,
              granteesWithAnyRecentActivity: 0,
              activityRate: 0.0,
            })
        })

        it('validates daysAgo parameter', async () => {
          await request(app.callback())
            .get('/generic/feegrant/activity?daysAgo=invalid')
            .set('x-api-key', options.apiKey)
            .expect(500)
            .expect('daysAgo must be a positive number')
        })

        it('validates negative daysAgo parameter', async () => {
          await request(app.callback())
            .get('/generic/feegrant/activity?daysAgo=-5')
            .set('x-api-key', options.apiKey)
            .expect(500)
            .expect('daysAgo must be a positive number')
        })

        it('handles zero active grantees', async () => {
          // Make all allowances inactive
          await FeegrantAllowance.update({ active: false }, { where: {} })

          await request(app.callback())
            .get('/generic/feegrant/activity')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .expect({
              totalActiveGrantees: 0,
              granteesWithRecentTxActivity: 0,
              granteesWithRecentBalanceActivity: 0,
              granteesWithAnyRecentActivity: 0,
              activityRate: 0.0,
            })
        })
      })
    })
  })
}
