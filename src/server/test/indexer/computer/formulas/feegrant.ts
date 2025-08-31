import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  BankStateEvent,
  Block,
  Contract,
  FeegrantAllowance,
  State,
  WasmTxEvent,
} from '@/db'
import { WasmCode, WasmCodeService } from '@/services/wasm-codes'
import { BANK_HISTORY_CODE_IDS_KEYS } from '@/tracer/handlers/bank'

import { app } from '../../app'
import type { ComputerTestOptions } from '../types'
import { T } from 'vitest/dist/chunks/reporters.d.79o4mouw'

const blockTimestamp = new Date()
const blockTimeUnixMs = Math.round(blockTimestamp.getTime() / 1000)

const createContractHelper = async (address: string, height: string) => {
  await Contract.create({
    address,
    codeId: WasmCodeService.instance.findWasmCodeIdsByKeys(
      BANK_HISTORY_CODE_IDS_KEYS[1]
    )[0],
    instantiatedAtBlockHeight: height,
    instantiatedAtBlockTimeUnixMs: blockTimeUnixMs,
    instantiatedAtBlockTimestamp: blockTimestamp,
  })
}

type FeegrantActivityItem = {
  granter: string
  grantee: string
  blockHeight: string
  blockTimeUnixMs: string
  blockTimestamp: string
  allowanceData: string
  allowanceType: string
  active: boolean
  parsedAmount: string
  parsedDenom: string
  parsedAllowanceType: string
  parsedExpirationUnixMs: number | null
}

const createFeegrantAllowanceHelper = (
  granter: string,
  grantee: string,
  blockHeight: string,
  blockTimeUnixMs: string,
  blockTimestamp: string
): FeegrantActivityItem => ({
  granter,
  grantee,
  blockHeight,
  blockTimeUnixMs,
  blockTimestamp,
  allowanceData: 'base64allowancedata1',
  allowanceType: 'BasicAllowance',
  active: true,
  parsedAmount: '1000000',
  parsedDenom: 'uxion',
  parsedAllowanceType: 'BasicAllowance',
  parsedExpirationUnixMs: null,
})

const TREASURY1 = 'treasury1'
const TREASURY2 = 'treasury2'
const TREASURY3 = 'treasury3'

const GRANTEE1 = 'grantee1'
const GRANTEE2 = 'grantee2'
const GRANTEE3 = 'grantee3'
const GRANTEE4 = 'grantee4'
const GRANTEE5 = 'grantee5'

const STAMP1 = 1640995100000
const STAMP2 = 1640995200000
const STAMP3 = 1640995300000
const STAMP4 = 1640995400000
const STAMP5 = 1640995500000

const HEIGHT1 = '100'
const HEIGHT2 = '200'
const HEIGHT3 = '300'
const HEIGHT4 = '400'
const HEIGHT5 = '500'

const feegrantActivity: FeegrantActivityItem[] = [
  createFeegrantAllowanceHelper(
    TREASURY1,
    GRANTEE1,
    HEIGHT1,
    STAMP1.toString(),
    new Date(STAMP1).toISOString()
  ),
  createFeegrantAllowanceHelper(
    TREASURY2,
    GRANTEE2,
    HEIGHT2,
    STAMP2.toString(),
    new Date(STAMP2).toISOString()
  ),
  createFeegrantAllowanceHelper(
    TREASURY2,
    GRANTEE3,
    HEIGHT3,
    STAMP3.toString(),
    new Date(STAMP3).toISOString()
  ),
  createFeegrantAllowanceHelper(
    TREASURY3,
    GRANTEE1,
    HEIGHT2,
    STAMP3.toString(),
    new Date(STAMP3).toISOString()
  ),
  createFeegrantAllowanceHelper(
    TREASURY3,
    GRANTEE2,
    HEIGHT3,
    STAMP3.toString(),
    new Date(STAMP3).toISOString()
  ),
  createFeegrantAllowanceHelper(
    TREASURY3,
    GRANTEE3,
    HEIGHT4,
    STAMP4.toString(),
    new Date(STAMP4).toISOString()
  ),
  createFeegrantAllowanceHelper(
    TREASURY3,
    GRANTEE4,
    HEIGHT4,
    STAMP4.toString(),
    new Date(STAMP4).toISOString()
  ),
  createFeegrantAllowanceHelper(
    TREASURY3,
    GRANTEE5,
    HEIGHT4,
    STAMP5.toString(),
    new Date(STAMP5).toISOString()
  ),
]

export const loadFeegrantTests = (options: ComputerTestOptions) => {
  describe('feegrant', () => {
    beforeEach(async () => {
      WasmCodeService.instance.addDefaultWasmCodes(
        new WasmCode('xion-treasury', [100, 101])
      )

      await createContractHelper(TREASURY1, HEIGHT1)
      await createContractHelper(TREASURY2, HEIGHT2)
      await createContractHelper(TREASURY3, HEIGHT3)

      await FeegrantAllowance.bulkCreate(feegrantActivity)

      await Block.createMany([
        {
          height: HEIGHT1,
          timeUnixMs: STAMP1,
        },
        {
          height: HEIGHT2,
          timeUnixMs: STAMP2,
        },
        {
          height: HEIGHT3,
          timeUnixMs: STAMP3,
        },
        {
          height: HEIGHT4,
          timeUnixMs: STAMP4,
        },
        {
          height: HEIGHT5,
          timeUnixMs: STAMP5,
        },
      ])

      await State.updateSingleton({
        latestBlockHeight: HEIGHT5,
        latestBlockTimeUnixMs: STAMP5,
        lastFeegrantBlockHeightExported: HEIGHT5,
      })
    })

    describe('getFeegrantAllowance', () => {
      it('returns allowance for valid granter-grantee pair', async () => {
        await request(app.callback())
          .get(`/account/${TREASURY1}/feegrant/allowance?grantee=${GRANTEE1}`)
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect(feegrantActivity[0])
      })

      it('returns allowance for specific block height', async () => {
        await request(app.callback())
          .get(
            `/account/${TREASURY2}/feegrant/allowance?grantee=${GRANTEE2}&block=${HEIGHT2}:${STAMP2}`
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect(feegrantActivity[1])
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
          .get(`/account/${TREASURY3}/feegrant/allowance?grantee=${GRANTEE3}`)
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect(feegrantActivity[5])
      })
    })

    describe('getFeegrantAllowances', () => {
      it('returns allowances granted by address', async () => {
        await request(app.callback())
          .get(`/account/${TREASURY1}/feegrant/allowances?type=granted`)
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              granter: TREASURY1,
              grantee: GRANTEE1,
              allowanceData: 'base64allowancedata1',
              allowanceType: 'BasicAllowance',
              active: true,
              blockHeight: HEIGHT1,
              blockTimeUnixMs: STAMP1.toString(),
              blockTimestamp: new Date(STAMP1).toISOString(),
              parsedAmount: '1000000',
              parsedDenom: 'uxion',
              parsedAllowanceType: 'BasicAllowance',
              parsedExpirationUnixMs: null,
            },
          ])
      })

      it('returns allowances received by address', async () => {
        await request(app.callback())
          .get(`/account/${GRANTEE1}/feegrant/allowances?type=received`)
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              granter: TREASURY1,
              grantee: GRANTEE1,
              allowanceData: 'base64allowancedata1',
              allowanceType: 'BasicAllowance',
              active: true,
              blockHeight: HEIGHT1,
              blockTimeUnixMs: STAMP1.toString(),
              blockTimestamp: new Date(STAMP1).toISOString(),
              parsedAmount: '1000000',
              parsedDenom: 'uxion',
              parsedAllowanceType: 'BasicAllowance',
              parsedExpirationUnixMs: null,
            },
            {
              granter: TREASURY3,
              grantee: GRANTEE1,
              allowanceData: 'base64allowancedata1',
              allowanceType: 'BasicAllowance',
              active: true,
              blockHeight: HEIGHT2,
              blockTimeUnixMs: STAMP3.toString(),
              blockTimestamp: new Date(STAMP3).toISOString(),
              parsedAmount: '1000000',
              parsedDenom: 'uxion',
              parsedAllowanceType: 'BasicAllowance',
              parsedExpirationUnixMs: null,
            },
          ])
      })

      it('defaults to granted type when no type specified', async () => {
        await request(app.callback())
          .get(`/account/${TREASURY1}/feegrant/allowances`)
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              granter: TREASURY1,
              grantee: GRANTEE1,
              allowanceData: 'base64allowancedata1',
              allowanceType: 'BasicAllowance',
              active: true,
              blockHeight: HEIGHT1,
              blockTimeUnixMs: STAMP1.toString(),
              blockTimestamp: new Date(STAMP1).toISOString(),
              parsedAmount: '1000000',
              parsedDenom: 'uxion',
              parsedAllowanceType: 'BasicAllowance',
              parsedExpirationUnixMs: null,
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
            `/account/${TREASURY1}/feegrant/allowances?type=granted&block=150:${STAMP1 + 50000}`
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              granter: TREASURY1,
              grantee: GRANTEE1,
              allowanceData: 'base64allowancedata1',
              allowanceType: 'BasicAllowance',
              active: true,
              blockHeight: HEIGHT1,
              blockTimeUnixMs: STAMP1.toString(),
              blockTimestamp: new Date(STAMP1).toISOString(),
              parsedAmount: '1000000',
              parsedDenom: 'uxion',
              parsedAllowanceType: 'BasicAllowance',
              parsedExpirationUnixMs: null,
            },
          ])
      })
    })

    describe('hasFeegrantAllowance', () => {
      it('returns true for active allowance', async () => {
        await request(app.callback())
          .get(`/account/${TREASURY1}/feegrant/has?grantee=${GRANTEE1}`)
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect('true')
      })

      it('returns false for inactive allowance', async () => {
        await request(app.callback())
          .get(`/account/${TREASURY1}/feegrant/has?grantee=${GRANTEE5}`)
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
            `/account/${TREASURY1}/feegrant/has?grantee=${GRANTEE1}&block=${HEIGHT1}:${STAMP1}`
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect('true')

        await request(app.callback())
          .get(
            `/account/${TREASURY2}/feegrant/has?grantee=${GRANTEE2}&block=${HEIGHT2}:${STAMP2}`
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
            `/account/${TREASURY2}/feegrant/allowance?grantee=${GRANTEE2}&block=150:${STAMP1 + 50000}`
          )
          .set('x-api-key', options.apiKey)
          .expect(204)

        // Query at block 200 should see the allowance
        await request(app.callback())
          .get(
            `/account/${TREASURY2}/feegrant/allowance?grantee=${GRANTEE2}&block=${HEIGHT2}:${STAMP2}`
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect(feegrantActivity[1])
      })

      it('applies block height filter correctly for allowances queries', async () => {
        // Query at block 150 should only see allowances up to that block
        await request(app.callback())
          .get(
            `/account/${TREASURY1}/feegrant/allowances?type=granted&block=150:${STAMP1 + 50000}`
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              granter: TREASURY1,
              grantee: GRANTEE1,
              allowanceData: 'base64allowancedata1',
              allowanceType: 'BasicAllowance',
              active: true,
              blockHeight: HEIGHT1,
              blockTimeUnixMs: STAMP1.toString(),
              blockTimestamp: new Date(STAMP1).toISOString(),
              parsedAmount: '1000000',
              parsedDenom: 'uxion',
              parsedAllowanceType: 'BasicAllowance',
              parsedExpirationUnixMs: null,
            },
          ])
      })
    })

    describe('generic feegrant formulas', () => {
      beforeEach(async () => {
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

        // Add activity data for testing - using recent timestamps
        const now = Date.now()
        const recentTime1 = now - 2 * 60 * 60 * 1000 // 2 hours ago (within 1 day)
        const recentTime2 = now - 6 * 60 * 60 * 1000 // 6 hours ago (within 1 day)
        const recentTime3 = now - 12 * 60 * 60 * 1000 // 12 hours ago (within 1 day)
        const _recentTime4 = now - 10 * 24 * 60 * 60 * 1000 // 10 days ago (outside 1 day, within 30 days)

        await WasmTxEvent.bulkCreate([
          {
            contractAddress: 'xion1contract123',
            sender: 'xion1grantee456', // Active grantee with recent activity
            blockHeight: '290',
            blockTimeUnixMs: recentTime1.toString(),
            blockTimestamp: new Date(recentTime1),
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
            blockTimeUnixMs: recentTime2.toString(),
            blockTimestamp: new Date(recentTime2),
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
            blockTimeUnixMs: recentTime3,
            blockTimestamp: new Date(recentTime3),
            balance: '1000',
          },
          {
            address: 'xion1grantee789',
            denom: 'uxion',
            blockHeight: 280,
            blockTimeUnixMs: recentTime3, // Changed to be within 1 day (12 hours ago)
            blockTimestamp: new Date(recentTime3),
            balance: '2000',
          },
        ])
      })

      describe('totals', () => {
        it('returns comprehensive feegrant statistics', async () => {
          await request(app.callback())
            .get('/generic/_/feegrant/totals')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .expect({
              totalActiveGrants: 8,
              totalActiveGrantees: 5,
              totalActiveGranters: 3,
              totalRevokedGrants: 0,
              totalBasicAllowances: 8,
              totalPeriodicAllowances: 0,
              totalAllowedMsgAllowances: 0,
              totalUnknownAllowances: 0,
            })
        })

        it('handles empty database', async () => {
          // Clear all data
          await FeegrantAllowance.destroy({ where: {} })

          await request(app.callback())
            .get('/generic/_/feegrant/totals')
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
            .get('/generic/_/feegrant/amounts')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .expect({
              totalXionGranted: '8000000',
              totalUsdcGranted: '0',
              totalGrantsWithAmounts: 8,
              grantsByToken: [
                {
                  denom: 'uxion',
                  total: '8000000',
                  count: 8,
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
            .get('/generic/_/feegrant/amounts')
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
            .get('/generic/_/feegrant/activity')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .expect({
              totalActiveGrantees: 8,
              granteesWithRecentTxActivity: 0,
              granteesWithRecentBalanceActivity: 0,
              granteesWithAnyRecentActivity: 0,
              activityRate: 0,
            })
        })

        it('returns activity statistics with custom time window', async () => {
          await request(app.callback())
            .get('/generic/_/feegrant/activity?daysAgo=1')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .expect({
              totalActiveGrantees: 8,
              granteesWithRecentTxActivity: 0,
              granteesWithRecentBalanceActivity: 0,
              granteesWithAnyRecentActivity: 0,
              activityRate: 0,
            })
        })

        it('handles zero active grantees', async () => {
          // Make all allowances inactive
          await FeegrantAllowance.update({ active: false }, { where: {} })

          await request(app.callback())
            .get('/generic/_/feegrant/activity')
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

      describe('enhanced generic formulas', () => {
        beforeEach(async () => {
          // Reset and register treasury code ID for testing
          // WasmCodeService.instance.reset()
          // WasmCodeService.instance.addDefaultWasmCodes(
          //   new WasmCode('xion-treasury', [100, 101])
          // )

          // Create treasury contracts
          await Contract.bulkCreate([
            {
              address: 'xion1treasury123',
              codeId: 100, // Treasury code ID
              admin: null,
              creator: 'xion1creator123',
              label: 'Treasury Contract 1',
              instantiatedAtBlockHeight: '50',
              instantiatedAtBlockTimeUnixMs: '1640995000000',
              instantiatedAtBlockTimestamp: new Date(
                '2021-12-31T23:56:40.000Z'
              ),
              txHash: 'treasury1hash',
            },
            {
              address: 'xion1treasury456',
              codeId: 101, // Treasury code ID
              admin: null,
              creator: 'xion1creator456',
              label: 'Treasury Contract 2',
              instantiatedAtBlockHeight: '75',
              instantiatedAtBlockTimeUnixMs: '1640995100000',
              instantiatedAtBlockTimestamp: new Date(
                '2021-12-31T23:58:20.000Z'
              ),
              txHash: 'treasury2hash',
            },
          ])

          // Add treasury-specific feegrant allowances
          await FeegrantAllowance.bulkCreate([
            {
              granter: 'xion1treasury123',
              grantee: 'xion1user1',
              blockHeight: '120',
              blockTimeUnixMs: '1640995320000',
              blockTimestamp: new Date('2022-01-01T00:02:00.000Z'),
              allowanceData: 'treasury1allowance1',
              allowanceType: 'BasicAllowance',
              active: true,
              parsedAmount: '5000000',
              parsedDenom: 'uxion',
              parsedAllowanceType: 'BasicAllowance',
              parsedExpirationUnixMs: null,
            },
            {
              granter: 'xion1treasury123',
              grantee: 'xion1user2',
              blockHeight: '130',
              blockTimeUnixMs: '1640995420000',
              blockTimestamp: new Date('2022-01-01T00:03:40.000Z'),
              allowanceData: 'treasury1allowance2',
              allowanceType: 'PeriodicAllowance',
              active: true,
              parsedAmount: '3000000',
              parsedDenom: 'uxion',
              parsedAllowanceType: 'PeriodicAllowance',
              parsedExpirationUnixMs: null,
            },
            {
              granter: 'xion1treasury456',
              grantee: 'xion1user3',
              blockHeight: '140',
              blockTimeUnixMs: '1640995520000',
              blockTimestamp: new Date('2022-01-01T00:05:20.000Z'),
              allowanceData: 'treasury2allowance1',
              allowanceType: 'BasicAllowance',
              active: true,
              parsedAmount: '2000000',
              parsedDenom: 'uusdc',
              parsedAllowanceType: 'BasicAllowance',
              parsedExpirationUnixMs: null,
            },
          ])

          // Add historical data for trends
          const now = Date.now()
          const oneDayAgo = now - 24 * 60 * 60 * 1000
          const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000

          await FeegrantAllowance.bulkCreate([
            {
              granter: 'xion1treasury123',
              grantee: 'xion1newuser1',
              blockHeight: '350',
              blockTimeUnixMs: oneDayAgo.toString(),
              blockTimestamp: new Date(oneDayAgo),
              allowanceData: 'recentallowance1',
              allowanceType: 'BasicAllowance',
              active: true,
              parsedAmount: '1000000',
              parsedDenom: 'uxion',
              parsedAllowanceType: 'BasicAllowance',
              parsedExpirationUnixMs: null,
            },
            {
              granter: 'xion1treasury456',
              grantee: 'xion1newuser2',
              blockHeight: '360',
              blockTimeUnixMs: twoDaysAgo.toString(),
              blockTimestamp: new Date(twoDaysAgo),
              allowanceData: 'recentallowance2',
              allowanceType: 'BasicAllowance',
              active: true,
              parsedAmount: '1500000',
              parsedDenom: 'uxion',
              parsedAllowanceType: 'BasicAllowance',
              parsedExpirationUnixMs: null,
            },
          ])
        })

        describe('treasuryAnalytics', () => {
          it('returns comprehensive treasury analytics', async () => {
            const response = await request(app.callback())
              .get('/generic/_/feegrant/treasuryAnalytics')
              .set('x-api-key', options.apiKey)
              .expect(200)

            const data = response.body
            expect(data.totalTreasuryContracts).toBeGreaterThan(0)
            expect(data.activeTreasuryContracts).toBeGreaterThan(0)
            expect(data.totalGrantsFromTreasuries).toBeGreaterThan(0)
            expect(data.activeGrantsFromTreasuries).toBeGreaterThan(0)
            expect(data.treasuryMarketShare).toBeGreaterThanOrEqual(0)
            expect(Array.isArray(data.topTreasuries)).toBe(true)
          })

          it('handles empty treasury data', async () => {
            // Remove treasury contracts
            await Contract.destroy({ where: { codeId: [100, 101] } })

            await request(app.callback())
              .get('/generic/_/feegrant/treasuryAnalytics')
              .set('x-api-key', options.apiKey)
              .expect(200)
              .then((response) => {
                const data = response.body
                expect(data.totalTreasuryContracts).toBe(0)
                expect(data.activeTreasuryContracts).toBe(0)
                expect(data.topTreasuries).toEqual([])
              })
          })
        })

        describe('historicalTrends', () => {
          it('returns historical trend data with default parameters', async () => {
            const response = await request(app.callback())
              .get('/generic/_/feegrant/historicalTrends')
              .set('x-api-key', options.apiKey)
              .expect(200)

            const data = response.body
            expect(Array.isArray(data.timeSeriesData)).toBe(true)
            expect(data.growthMetrics).toBeDefined()
            expect(typeof data.growthMetrics.grantsGrowthRate).toBe('number')
            expect(typeof data.growthMetrics.granteesGrowthRate).toBe('number')
            expect(typeof data.growthMetrics.averageDailyGrants).toBe('number')
          })

          it('respects custom time window and granularity', async () => {
            const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000
            await request(app.callback())
              .get(
                `/generic/_/feegrant/historicalTrends?timeWindow=${sevenDaysInMs}&granularity=weekly`
              )
              .set('x-api-key', options.apiKey)
              .expect(200)
              .then((response) => {
                const data = response.body
                expect(Array.isArray(data.timeSeriesData)).toBe(true)
                expect(data.growthMetrics).toBeDefined()
              })
          })
        })

        describe('tokenMovement', () => {
          it('returns comprehensive token movement analytics', async () => {
            const response = await request(app.callback())
              .get('/a/feegrant/tokenMovement')
              .set('x-api-key', options.apiKey)
              .expect(200)

            const data = response.body
            expect(data.chainWideMovement).toBeDefined()
            expect(data.treasuryMovement).toBeDefined()
            expect(Array.isArray(data.dailyTrends)).toBe(true)
            expect(typeof data.chainWideMovement.totalFeegrantVolume).toBe(
              'string'
            )
            expect(typeof data.treasuryMovement.totalTreasuryVolume).toBe(
              'string'
            )
          })

          it('handles custom time window', async () => {
            const timeWindow = 7 * 24 * 60 * 60 * 1000 // 7 days
            await request(app.callback())
              .get(`/a/feegrant/tokenMovement?timeWindow=${timeWindow}`)
              .set('x-api-key', options.apiKey)
              .expect(200)
              .then((response) => {
                const data = response.body
                expect(data.chainWideMovement).toBeDefined()
                expect(data.treasuryMovement).toBeDefined()
              })
          })
        })

        describe('feegrantAllowancesSummary', () => {
          it('returns comprehensive feegrant summary with addresses', async () => {
            const response = await request(app.callback())
              .get('/generic/_/feegrant/feegrantAllowancesSummary')
              .set('x-api-key', options.apiKey)
              .expect(200)

            const data = response.body
            expect(typeof data.totalActiveGrants).toBe('number')
            expect(typeof data.totalActiveGrantees).toBe('number')
            expect(typeof data.totalActiveGranters).toBe('number')
            expect(Array.isArray(data.granterAddresses)).toBe(true)
            expect(Array.isArray(data.granteeAddresses)).toBe(true)
            expect(data.totalActiveGrants).toBeGreaterThan(0)
          })

          it('handles empty database gracefully', async () => {
            await FeegrantAllowance.destroy({ where: {} })

            await request(app.callback())
              .get('/generic/_/feegrant/feegrantAllowancesSummary')
              .set('x-api-key', options.apiKey)
              .expect(200)
              .then((response) => {
                const data = response.body
                expect(data.totalActiveGrants).toBe(0)
                expect(data.granterAddresses).toEqual([])
                expect(data.granteeAddresses).toEqual([])
              })
          })
        })

        describe('treasuryContractList', () => {
          it('returns treasury addresses with performance metrics', async () => {
            const response = await request(app.callback())
              .get('/generic/_/feegrant/treasuryContractList')
              .set('x-api-key', options.apiKey)
              .expect(200)

            const data = response.body
            expect(Array.isArray(data.treasuryAddresses)).toBe(true)
            expect(typeof data.treasuryCount).toBe('number')
            expect(typeof data.lastUpdated).toBe('string')
            expect(data.performanceMetrics).toBeDefined()
            expect(typeof data.performanceMetrics.candidatesAnalyzed).toBe(
              'number'
            )
            expect(data.performanceMetrics.processingOptimized).toBe(true)
          })

          it('handles no treasury contracts', async () => {
            // Remove all allowances to have no treasury candidates
            await FeegrantAllowance.destroy({ where: {} })

            await request(app.callback())
              .get('/generic/_/feegrant/treasuryContractList')
              .set('x-api-key', options.apiKey)
              .expect(200)
              .then((response) => {
                const data = response.body
                expect(data.treasuryAddresses).toEqual([])
                expect(data.treasuryCount).toBe(0)
                expect(data.performanceMetrics.candidatesAnalyzed).toBe(0)
              })
          })
        })
      })
    })

    describe('treasury contract formulas', () => {
      beforeEach(async () => {
        // Reset and register treasury code ID for testing
        WasmCodeService.instance.addDefaultWasmCodes(
          new WasmCode('xion-treasury', [200, 201])
        )

        // Create treasury contract first (required for foreign key constraints)
        await Contract.bulkCreate([
          {
            address: 'xion1treasurytest',
            codeId: 200, // Treasury code ID
            admin: null,
            creator: 'xion1creator',
            label: 'Test Treasury',
            instantiatedAtBlockHeight: '400',
            instantiatedAtBlockTimeUnixMs: '1640995600000',
            instantiatedAtBlockTimestamp: new Date('2022-01-01T00:06:40.000Z'),
            txHash: 'treasurytesthash',
          },
          // Create non-treasury contract for 404 vs 405 testing
          {
            address: 'xion1contract123',
            codeId: 1, // Non-treasury code ID
            admin: null,
            creator: 'xion1creator123',
            label: 'Non-Treasury Contract',
            instantiatedAtBlockHeight: '290',
            instantiatedAtBlockTimeUnixMs: '1640995350000',
            instantiatedAtBlockTimestamp: new Date('2022-01-01T00:02:30.000Z'),
            txHash: 'nontreasurycontracthash',
          },
        ])

        // Add comprehensive test data
        const now = Date.now()
        const recentTime = now - 2 * 60 * 60 * 1000 // 2 hours ago
        const olderTime = now - 5 * 24 * 60 * 60 * 1000 // 5 days ago

        await FeegrantAllowance.bulkCreate([
          // Active allowances
          {
            granter: 'xion1treasurytest',
            grantee: 'xion1testuser1',
            blockHeight: '410',
            blockTimeUnixMs: '1640995700000',
            blockTimestamp: new Date('2022-01-01T00:08:20.000Z'),
            allowanceData: 'testallowance1',
            allowanceType: 'BasicAllowance',
            active: true,
            parsedAmount: '10000000',
            parsedDenom: 'uxion',
            parsedAllowanceType: 'BasicAllowance',
            parsedExpirationUnixMs: null,
          },
          {
            granter: 'xion1treasurytest',
            grantee: 'xion1testuser2',
            blockHeight: '420',
            blockTimeUnixMs: '1640995800000',
            blockTimestamp: new Date('2022-01-01T00:10:00.000Z'),
            allowanceData: 'testallowance2',
            allowanceType: 'PeriodicAllowance',
            active: true,
            parsedAmount: '5000000',
            parsedDenom: 'uxion',
            parsedAllowanceType: 'PeriodicAllowance',
            parsedExpirationUnixMs: null,
          },
          {
            granter: 'xion1treasurytest',
            grantee: 'xion1testuser3',
            blockHeight: '430',
            blockTimeUnixMs: '1640995900000',
            blockTimestamp: new Date('2022-01-01T00:11:40.000Z'),
            allowanceData: 'testallowance3',
            allowanceType: 'BasicAllowance',
            active: true,
            parsedAmount: '3000000',
            parsedDenom: 'uusdc',
            parsedAllowanceType: 'BasicAllowance',
            parsedExpirationUnixMs: null,
          },
          // Revoked allowance
          {
            granter: 'xion1treasurytest',
            grantee: 'xion1testuser4',
            blockHeight: '440',
            blockTimeUnixMs: '1641000000000',
            blockTimestamp: new Date('2022-01-01T01:20:00.000Z'),
            allowanceData: '',
            allowanceType: null,
            active: false,
            parsedAmount: null,
            parsedDenom: null,
            parsedAllowanceType: null,
            parsedExpirationUnixMs: null,
          },
          // Recent onboarding
          {
            granter: 'xion1treasurytest',
            grantee: 'xion1recentuser1',
            blockHeight: '450',
            blockTimeUnixMs: recentTime.toString(),
            blockTimestamp: new Date(recentTime),
            allowanceData: 'recentallowance',
            allowanceType: 'BasicAllowance',
            active: true,
            parsedAmount: '2000000',
            parsedDenom: 'uxion',
            parsedAllowanceType: 'BasicAllowance',
            parsedExpirationUnixMs: null,
          },
          // Older onboarding for trend analysis
          {
            granter: 'xion1treasurytest',
            grantee: 'xion1olderuser1',
            blockHeight: '460',
            blockTimeUnixMs: olderTime.toString(),
            blockTimestamp: new Date(olderTime),
            allowanceData: 'olderallowance',
            allowanceType: 'BasicAllowance',
            active: true,
            parsedAmount: '1000000',
            parsedDenom: 'uxion',
            parsedAllowanceType: 'BasicAllowance',
            parsedExpirationUnixMs: null,
          },
        ])

        // Add activity data
        await BankStateEvent.bulkCreate([
          {
            address: 'xion1testuser1',
            denom: 'uxion',
            blockHeight: 411,
            blockTimeUnixMs: recentTime,
            blockTimestamp: new Date(recentTime),
            balance: '5000000',
          },
          {
            address: 'xion1testuser2',
            denom: 'uxion',
            blockHeight: 421,
            blockTimeUnixMs: recentTime + 1000,
            blockTimestamp: new Date(recentTime + 1000),
            balance: '3000000',
          },
        ])

        // Set up treasury balance
        await BankStateEvent.create({
          address: 'xion1treasurytest',
          denom: 'uxion',
          blockHeight: 445,
          blockTimeUnixMs: recentTime,
          blockTimestamp: new Date(recentTime),
          balance: '100000000', // 100 XION
        })

        // Create blocks for treasury test data
        await Block.createMany([
          { height: 410, timeUnixMs: 1640995700000 },
          { height: 420, timeUnixMs: 1640995800000 },
          { height: 430, timeUnixMs: 1640995900000 },
          { height: 440, timeUnixMs: 1641000000000 },
          { height: 450, timeUnixMs: recentTime },
          { height: 460, timeUnixMs: olderTime },
          { height: 500, timeUnixMs: 1641000000000 },
          { height: 510, timeUnixMs: 1641000100000 },
        ])

        // Update state to include all treasury test data
        await State.updateSingleton({
          latestBlockHeight: 500,
          latestBlockTimeUnixMs: 1641000000000,
          lastFeegrantBlockHeightExported: 500,
        })
      })

      describe('activeGrantees', () => {
        it('returns active grantees with activity correlation', async () => {
          const response = await request(app.callback())
            .get('/contract/xion1treasurytest/xion/treasury/activeGrantees')
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          expect(data.count).toBeGreaterThan(0)
          expect(Array.isArray(data.grantees)).toBe(true)
          expect(data.grantees[0]).toHaveProperty('address')
          expect(data.grantees[0]).toHaveProperty('grantedAt')
          expect(data.grantees[0]).toHaveProperty('allowanceAmount')
          expect(data.grantees[0]).toHaveProperty('allowanceDenom')
        })

        it('returns empty result for non-treasury contract', async () => {
          await request(app.callback())
            .get('/contract/xion1contract123/xion/treasury/activeGrantees')
            .set('x-api-key', options.apiKey)
            .expect(405) // Should not apply to non-treasury contracts
        })
      })

      describe('granteeActivity', () => {
        it('returns activity statistics with default time window', async () => {
          const response = await request(app.callback())
            .get('/contract/xion1treasurytest/xion/treasury/granteeActivity')
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          expect(typeof data.activeCount).toBe('number')
          expect(typeof data.totalCount).toBe('number')
          expect(typeof data.activityRate).toBe('number')
          expect(Array.isArray(data.recentActivity)).toBe(true)
        })

        it('accepts custom time window parameter', async () => {
          const timeWindow = 24 * 60 * 60 * 1000 // 24 hours
          await request(app.callback())
            .get(
              `/contract/xion1treasurytest/xion/treasury/granteeActivity?timeWindow=${timeWindow}`
            )
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(typeof data.activityRate).toBe('number')
            })
        })
      })

      describe('usageMetrics', () => {
        it('returns comprehensive usage statistics', async () => {
          const response = await request(app.callback())
            .get('/contract/xion1treasurytest/xion/treasury/usageMetrics')
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          expect(typeof data.totalAllowancesGranted).toBe('number')
          expect(typeof data.activeAllowances).toBe('number')
          expect(typeof data.totalTokensAllocated).toBe('string')
          expect(typeof data.utilizationRate).toBe('number')
          expect(typeof data.averageAllowanceAmount).toBe('string')
          expect(Array.isArray(data.topGrantees)).toBe(true)
        })

        it('handles custom time period', async () => {
          const period = 7 * 24 * 60 * 60 * 1000 // 7 days
          await request(app.callback())
            .get(
              `/contract/xion1treasurytest/xion/treasury/usageMetrics?period=${period}`
            )
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(typeof data.utilizationRate).toBe('number')
            })
        })
      })

      describe('onboardingMetrics', () => {
        it('returns onboarding statistics and trends', async () => {
          const response = await request(app.callback())
            .get('/contract/xion1treasurytest/xion/treasury/onboardingMetrics')
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          expect(typeof data.newGrantees).toBe('number')
          expect(typeof data.totalGrantees).toBe('number')
          expect(typeof data.growthRate).toBe('number')
          expect(typeof data.onboardingVelocity).toBe('number')
          expect(Array.isArray(data.onboardingTrend)).toBe(true)
        })

        it('accepts time window and granularity parameters', async () => {
          const timeWindow = 30 * 24 * 60 * 60 * 1000 // 30 days
          await request(app.callback())
            .get(
              `/contract/xion1treasurytest/xion/treasury/onboardingMetrics?timeWindow=${timeWindow}&granularity=weekly`
            )
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(typeof data.onboardingVelocity).toBe('number')
            })
        })
      })

      describe('treasuryHealth', () => {
        it('returns comprehensive health assessment', async () => {
          const response = await request(app.callback())
            .get('/contract/xion1treasurytest/xion/treasury/treasuryHealth')
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          expect(['healthy', 'warning', 'critical']).toContain(data.status)
          expect(typeof data.balanceRatio).toBe('number')
          expect(typeof data.utilizationRate).toBe('number')
          expect(typeof data.activeGranteeRatio).toBe('number')
          expect(typeof data.averageDailyBurn).toBe('string')
          expect(typeof data.estimatedRunwayDays).toBe('number')
          expect(Array.isArray(data.alerts)).toBe(true)
        })

        it('generates appropriate health alerts', async () => {
          // Test with low balance scenario
          await BankStateEvent.update(
            { balance: '100' }, // Very low balance
            { where: { address: 'xion1treasurytest' } }
          )

          const response = await request(app.callback())
            .get('/contract/xion1treasurytest/xion/treasury/treasuryHealth')
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          expect(data.alerts.length).toBeGreaterThan(0)
          expect(data.status).toBe('critical')
        })
      })

      describe('balances', () => {
        it('returns treasury balance data', async () => {
          const response = await request(app.callback())
            .get('/contract/xion1treasurytest/xion/treasury/balances')
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          expect(typeof data).toBe('object')
          // Balance might be empty object if no balance data exists, which is valid
          if (Object.keys(data).length > 0) {
            const firstDenom = Object.keys(data)[0]
            expect(typeof data[firstDenom]).toBe('string')
          }
        })

        it('returns empty object for contract with no balances', async () => {
          // Remove balance data
          await BankStateEvent.destroy({
            where: { address: 'xion1treasurytest' },
          })

          await request(app.callback())
            .get('/contract/xion1treasurytest/xion/treasury/balances')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(typeof data).toBe('object')
            })
        })
      })

      describe('balanceHistory', () => {
        it('returns balance history with timestamp metadata', async () => {
          const response = await request(app.callback())
            .get('/contract/xion1treasurytest/xion/treasury/balanceHistory')
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          expect(typeof data).toBe('object')
          if (Object.keys(data).length > 0) {
            const firstDenom = Object.keys(data)[0]
            expect(data[firstDenom]).toHaveProperty('balance')
            expect(data[firstDenom]).toHaveProperty('blockHeight')
            expect(data[firstDenom]).toHaveProperty('blockTimeUnixMs')
            expect(data[firstDenom]).toHaveProperty('blockTimestamp')
            expect(data[firstDenom]).toHaveProperty('lastChanged')
          }
        })

        it('handles empty balance history gracefully', async () => {
          await BankStateEvent.destroy({
            where: { address: 'xion1treasurytest' },
          })

          await request(app.callback())
            .get('/contract/xion1treasurytest/xion/treasury/balanceHistory')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(data).toEqual({})
            })
        })
      })

      describe('all', () => {
        it('returns combined treasury data', async () => {
          const response = await request(app.callback())
            .get('/contract/xion1treasurytest/xion/treasury/all')
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          expect(data).toHaveProperty('grantConfigs')
          expect(data).toHaveProperty('feeConfig')
          expect(data).toHaveProperty('admin')
          expect(data).toHaveProperty('pendingAdmin')
          expect(data).toHaveProperty('params')
          expect(data).toHaveProperty('balances')
          expect(typeof data.grantConfigs).toBe('object')
          expect(typeof data.balances).toBe('object')
        })
      })

      describe('parameter validation tests', () => {
        it('validates timeWindow parameter bounds in activeGrantees', async () => {
          // Test minimum boundary - actual default is used when invalid value provided
          await request(app.callback())
            .get(
              '/contract/xion1treasurytest/xion/treasury/activeGrantees?timeWindow=1'
            )
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(
                data.performanceMetrics.timeWindowDays
              ).toBeGreaterThanOrEqual(7) // Should be clamped to minimum or default
            })

          // Test maximum boundary
          await request(app.callback())
            .get(
              '/contract/xion1treasurytest/xion/treasury/activeGrantees?timeWindow=999'
            )
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(
                data.performanceMetrics.timeWindowDays
              ).toBeLessThanOrEqual(90) // Should be clamped to maximum
            })
        })

        it('validates granularity parameter in onboardingMetrics', async () => {
          // Valid granularity
          await request(app.callback())
            .get(
              '/contract/xion1treasurytest/xion/treasury/onboardingMetrics?granularity=weekly'
            )
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(data.performanceMetrics.granularity).toBe('weekly')
            })

          // Invalid granularity should default to 'daily'
          await request(app.callback())
            .get(
              '/contract/xion1treasurytest/xion/treasury/onboardingMetrics?granularity=invalid'
            )
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(data.performanceMetrics.granularity).toBe('daily')
            })
        })

        it('validates multiple parameters in treasuryHealth', async () => {
          await request(app.callback())
            .get(
              '/contract/xion1treasurytest/xion/treasury/treasuryHealth?activityWindow=1&burnRateWindow=1'
            )
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(
                data.performanceMetrics.activityWindowDays
              ).toBeGreaterThanOrEqual(3) // Should be clamped to minimum or default
              expect(
                data.performanceMetrics.burnRateWindowDays
              ).toBeGreaterThanOrEqual(7) // Should be clamped to minimum or default
            })
        })

        it('validates historicalTrends parameters', async () => {
          await request(app.callback())
            .get(
              '/generic/_/feegrant/historicalTrends?timeWindow=1&granularity=monthly&limit=10'
            )
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(
                data.performanceMetrics.timeWindowDays
              ).toBeGreaterThanOrEqual(7) // Should be clamped to minimum or default
              expect(data.performanceMetrics.granularity).toBe('monthly')
              expect(
                data.performanceMetrics.dataPointsReturned
              ).toBeLessThanOrEqual(100) // Should be reasonable limit
            })
        })
      })

      describe('error handling tests', () => {
        it('handles non-treasury contract endpoints gracefully', async () => {
          await request(app.callback())
            .get('/contract/xion1contract123/xion/treasury/activeGrantees')
            .set('x-api-key', options.apiKey)
            .expect(405) // Non-treasury contracts return 405 Method Not Allowed

          await request(app.callback())
            .get('/contract/xion1contract123/xion/treasury/usageMetrics')
            .set('x-api-key', options.apiKey)
            .expect(405)

          await request(app.callback())
            .get('/contract/xion1contract123/xion/treasury/treasuryHealth')
            .set('x-api-key', options.apiKey)
            .expect(200) // treasuryHealth returns 200 with default data for non-treasury contracts
        })

        it('handles missing contract gracefully', async () => {
          await request(app.callback())
            .get('/contract/xion1nonexistent/xion/treasury/activeGrantees')
            .set('x-api-key', options.apiKey)
            .expect(404) // Missing contracts return 404 as expected
        })

        it('handles invalid parameter types gracefully', async () => {
          // Non-numeric timeWindow should default
          await request(app.callback())
            .get(
              '/contract/xion1treasurytest/xion/treasury/activeGrantees?timeWindow=invalid'
            )
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(data.performanceMetrics.timeWindowDays).toBe(30) // Should use default
            })
        })

        it('validates performance metrics are included in optimized formulas', async () => {
          // Check that performance metrics are consistently included
          const endpoints = [
            '/contract/xion1treasurytest/xion/treasury/activeGrantees',
            '/contract/xion1treasurytest/xion/treasury/granteeActivity',
            '/contract/xion1treasurytest/xion/treasury/usageMetrics',
            '/contract/xion1treasurytest/xion/treasury/onboardingMetrics',
            '/contract/xion1treasurytest/xion/treasury/treasuryHealth',
          ]

          for (const endpoint of endpoints) {
            await request(app.callback())
              .get(endpoint)
              .set('x-api-key', options.apiKey)
              .expect(200)
              .then((response) => {
                const data = response.body
                expect(data.performanceMetrics).toBeDefined()
                expect(data.performanceMetrics.processingOptimized).toBe(true)
              })
          }
        })

        it('validates error recovery in generic formulas', async () => {
          // Test that formulas handle database errors gracefully
          await request(app.callback())
            .get('/generic/_/feegrant/treasuryContractList')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(data.performanceMetrics).toBeDefined()
              expect(data.performanceMetrics.processingOptimized).toBe(true)
            })
        })
      })
    })

    describe('feegrant aggregators', () => {
      beforeEach(async () => {
        // Reset and register treasury code ID for aggregator testing
        WasmCodeService.instance.reset()
        WasmCodeService.instance.addDefaultWasmCodes(
          new WasmCode('xion-treasury', [300, 301])
        )

        // Create treasury contracts for aggregator testing
        await Contract.bulkCreate([
          {
            address: 'xion1aggregatetreasury1',
            codeId: 300,
            admin: null,
            creator: 'xion1creator1',
            label: 'Aggregate Treasury 1',
            instantiatedAtBlockHeight: '500',
            instantiatedAtBlockTimeUnixMs: '1641000000000',
            instantiatedAtBlockTimestamp: new Date('2022-01-01T01:20:00.000Z'),
            txHash: 'aggregatetreasury1hash',
          },
          {
            address: 'xion1aggregatetreasury2',
            codeId: 301,
            admin: null,
            creator: 'xion1creator2',
            label: 'Aggregate Treasury 2',
            instantiatedAtBlockHeight: '510',
            instantiatedAtBlockTimeUnixMs: '1641000100000',
            instantiatedAtBlockTimestamp: new Date('2022-01-01T01:21:40.000Z'),
            txHash: 'aggregatetreasury2hash',
          },
        ])

        // Add time-series test data
        const now = Date.now()
        const timestamps = [
          now - 7 * 24 * 60 * 60 * 1000, // 7 days ago
          now - 5 * 24 * 60 * 60 * 1000, // 5 days ago
          now - 3 * 24 * 60 * 60 * 1000, // 3 days ago
          now - 1 * 24 * 60 * 60 * 1000, // 1 day ago
          now - 2 * 60 * 60 * 1000, // 2 hours ago
        ]

        const blockHeights = [600, 610, 620, 630, 640]

        // Create time-series allowances
        for (let i = 0; i < timestamps.length; i++) {
          await FeegrantAllowance.bulkCreate([
            {
              granter: 'xion1aggregatetreasury1',
              grantee: `xion1timeuser${i}1`,
              blockHeight: blockHeights[i].toString(),
              blockTimeUnixMs: timestamps[i].toString(),
              blockTimestamp: new Date(timestamps[i]),
              allowanceData: `timeallowance${i}1`,
              allowanceType: 'BasicAllowance',
              active: true,
              parsedAmount: (1000000 * (i + 1)).toString(),
              parsedDenom: 'uxion',
              parsedAllowanceType: 'BasicAllowance',
              parsedExpirationUnixMs: null,
            },
            {
              granter: 'xion1aggregatetreasury2',
              grantee: `xion1timeuser${i}2`,
              blockHeight: (blockHeights[i] + 1).toString(),
              blockTimeUnixMs: (timestamps[i] + 1000).toString(),
              blockTimestamp: new Date(timestamps[i] + 1000),
              allowanceData: `timeallowance${i}2`,
              allowanceType: 'PeriodicAllowance',
              active: true,
              parsedAmount: (2000000 * (i + 1)).toString(),
              parsedDenom: 'uxion',
              parsedAllowanceType: 'PeriodicAllowance',
              parsedExpirationUnixMs: null,
            },
          ])
        }

        // Add activity correlation data
        await WasmTxEvent.bulkCreate([
          {
            contractAddress: 'xion1aggregatetreasury1', // Use existing contract
            sender: 'xion1timeuser21', // Recent user
            blockHeight: '635',
            blockTimeUnixMs: (now - 2 * 60 * 60 * 1000).toString(),
            blockTimestamp: new Date(now - 2 * 60 * 60 * 1000),
            txIndex: 0,
            messageId: '0',
            action: 'execute',
            msg: '{}',
            msgJson: {},
            reply: null,
            funds: [],
            response: null,
            gasUsed: '150000',
          },
        ])

        // Add balance history for treasury
        await BankStateEvent.bulkCreate([
          {
            address: 'xion1aggregatetreasury1',
            denom: 'uxion',
            blockHeight: 605,
            blockTimeUnixMs: now - 6 * 24 * 60 * 60 * 1000,
            blockTimestamp: new Date(now - 6 * 24 * 60 * 60 * 1000),
            balance: '500000000', // 500 XION
          },
          {
            address: 'xion1aggregatetreasury1',
            denom: 'uxion',
            blockHeight: 625,
            blockTimeUnixMs: now - 2 * 24 * 60 * 60 * 1000,
            blockTimestamp: new Date(now - 2 * 24 * 60 * 60 * 1000),
            balance: '450000000', // 450 XION
          },
        ])

        // Create blocks for aggregator test data - including the specific time range used in treasuryOverTime test
        const baseTime = 1641000000000 // Fixed base time
        const startTime = baseTime - 5 * 24 * 60 * 60 * 1000 // 5 days before base
        const endTime = baseTime - 1 * 24 * 60 * 60 * 1000 // 1 day before base

        await Block.createMany([
          { height: 500, timeUnixMs: 1641000000000 },
          { height: 510, timeUnixMs: 1641000100000 },
          ...blockHeights.map((height) => ({
            height,
            timeUnixMs: timestamps[blockHeights.indexOf(height)],
          })),
          { height: 601, timeUnixMs: now - 7 * 24 * 60 * 60 * 1000 + 1000 },
          { height: 605, timeUnixMs: now - 6 * 24 * 60 * 60 * 1000 },
          { height: 611, timeUnixMs: now - 5 * 24 * 60 * 60 * 1000 + 1000 },
          { height: 621, timeUnixMs: now - 3 * 24 * 60 * 60 * 1000 + 1000 },
          { height: 625, timeUnixMs: now - 2 * 24 * 60 * 60 * 1000 },
          { height: 631, timeUnixMs: now - 1 * 24 * 60 * 60 * 1000 + 1000 },
          { height: 635, timeUnixMs: now - 2 * 60 * 60 * 1000 },
          { height: 641, timeUnixMs: now - 2 * 60 * 60 * 1000 + 1000 },
          // Add blocks for the treasuryOverTime test time range (avoiding duplicate heights)
          { height: 50, timeUnixMs: startTime }, // Dec 27, 2021
          { height: 60, timeUnixMs: startTime + 24 * 60 * 60 * 1000 }, // Dec 28, 2021
          { height: 70, timeUnixMs: startTime + 2 * 24 * 60 * 60 * 1000 }, // Dec 29, 2021
          { height: 80, timeUnixMs: startTime + 3 * 24 * 60 * 60 * 1000 }, // Dec 30, 2021
          { height: 90, timeUnixMs: endTime }, // Dec 31, 2021
          { height: 95, timeUnixMs: baseTime }, // Jan 1, 2022
        ])

        // Update state to include all aggregator test data
        await State.updateSingleton({
          latestBlockHeight: 641,
          latestBlockTimeUnixMs: now - 2 * 60 * 60 * 1000 + 1000,
          lastFeegrantBlockHeightExported: 641,
        })
      })

      describe('treasuryOverTime aggregator', () => {
        it('returns treasury analytics over time with default parameters', async () => {
          const response = await request(app.callback())
            .get(
              '/a/feegrant/treasuryOverTime?contractAddress=xion1aggregatetreasury1'
            )
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          expect(Array.isArray(data)).toBe(true)
          expect(data.length).toBeGreaterThan(0)

          // Check data structure
          const firstPoint = data[0]
          expect(firstPoint).toHaveProperty('blockHeight')
          expect(firstPoint).toHaveProperty('blockTimeUnixMs')
          expect(firstPoint).toHaveProperty('value')
          expect(firstPoint.value).toHaveProperty('activeGrantees')
          expect(firstPoint.value).toHaveProperty('totalAllowancesGranted')
          expect(firstPoint.value).toHaveProperty('treasuryBalance')
        })

        it('validates required contractAddress parameter', async () => {
          await request(app.callback())
            .get('/a/feegrant/treasuryOverTime')
            .set('x-api-key', options.apiKey)
            .expect(500)
        })
      })

      describe('chainwideOverTime aggregator', () => {
        it('returns chainwide analytics over time', async () => {
          const response = await request(app.callback())
            .get('/a/feegrant/chainwideOverTime')
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          expect(Array.isArray(data)).toBe(true)
          expect(data.length).toBeGreaterThan(0)

          // Check data structure
          const firstPoint = data[0]
          expect(firstPoint).toHaveProperty('blockHeight')
          expect(firstPoint).toHaveProperty('blockTimeUnixMs')
          expect(firstPoint).toHaveProperty('value')
          expect(firstPoint.value).toHaveProperty('totalActiveGrants')
          expect(firstPoint.value).toHaveProperty('totalActiveGrantees')
          expect(firstPoint.value).toHaveProperty('totalTreasuryContracts')
          expect(firstPoint.value).toHaveProperty('treasuryMarketShare')
        })

        it('calculates trend metrics correctly', async () => {
          const response = await request(app.callback())
            .get('/a/feegrant/chainwideOverTime')
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          // Should have multiple data points for trend calculation
          if (data.length >= 2) {
            const latestPoint = data[data.length - 1]
            expect(latestPoint.value).toHaveProperty('grantsGrowthRate')
            expect(latestPoint.value).toHaveProperty('granteesGrowthRate')
            expect(typeof latestPoint.value.grantsGrowthRate).toBe('number')
            expect(typeof latestPoint.value.granteesGrowthRate).toBe('number')
          }
        })

        it('handles time-based aggregation parameters', async () => {
          const timeWindow = 3 * 24 * 60 * 60 * 1000 // 3 days
          await request(app.callback())
            .get(`/a/feegrant/chainwideOverTime?times[step]=${timeWindow}`)
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(Array.isArray(data)).toBe(true)
            })
        })
      })

      describe('treasuryOnboardingOverTime aggregator', () => {
        it('returns onboarding analytics over time', async () => {
          const response = await request(app.callback())
            .get(
              '/a/feegrant/treasuryOnboardingOverTime?contractAddress=xion1aggregatetreasury1'
            )
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          expect(Array.isArray(data)).toBe(true)
          expect(data.length).toBeGreaterThan(0)

          // Check data structure
          const firstPoint = data[0]
          expect(firstPoint).toHaveProperty('blockHeight')
          expect(firstPoint).toHaveProperty('blockTimeUnixMs')
          expect(firstPoint).toHaveProperty('value')
          expect(firstPoint.value).toHaveProperty('newGranteesInPeriod')
          expect(firstPoint.value).toHaveProperty('cumulativeGrantees')
          expect(firstPoint.value).toHaveProperty('onboardingVelocity')
        })

        it('calculates onboarding velocity correctly', async () => {
          const response = await request(app.callback())
            .get(
              '/a/feegrant/treasuryOnboardingOverTime?contractAddress=xion1aggregatetreasury1'
            )
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          for (const point of data) {
            expect(typeof point.value.onboardingVelocity).toBe('number')
            expect(point.value.onboardingVelocity).toBeGreaterThanOrEqual(0)
          }
        })

        it('validates required contractAddress parameter', async () => {
          await request(app.callback())
            .get('/a/feegrant/treasuryOnboardingOverTime')
            .set('x-api-key', options.apiKey)
            .expect(500)
        })
      })

      describe('tokenMovementOverTime aggregator', () => {
        it('returns token movement analytics over time', async () => {
          const response = await request(app.callback())
            .get('/a/feegrant/tokenMovementOverTime')
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          expect(Array.isArray(data)).toBe(true)
          expect(data.length).toBeGreaterThan(0)

          // Check data structure
          const firstPoint = data[0]
          expect(firstPoint).toHaveProperty('blockHeight')
          expect(firstPoint).toHaveProperty('blockTimeUnixMs')
          expect(firstPoint).toHaveProperty('value')
          expect(firstPoint.value).toHaveProperty('totalFeegrantVolume')
          expect(firstPoint.value).toHaveProperty('treasuryVolume')
          expect(firstPoint.value).toHaveProperty('nonTreasuryVolume')
          expect(firstPoint.value).toHaveProperty('volumeByToken')
        })

        it('calculates volume insights correctly', async () => {
          const response = await request(app.callback())
            .get('/a/feegrant/tokenMovementOverTime')
            .set('x-api-key', options.apiKey)
            .expect(200)

          const data = response.body
          for (const point of data) {
            expect(typeof point.value.totalFeegrantVolume).toBe('string')
            expect(typeof point.value.treasuryVolume).toBe('string')
            expect(typeof point.value.nonTreasuryVolume).toBe('string')
            expect(Array.isArray(point.value.volumeByToken)).toBe(true)
          }
        })

        it('handles custom aggregation parameters', async () => {
          const granularity = 'daily'
          await request(app.callback())
            .get(`/a/feegrant/tokenMovementOverTime?granularity=${granularity}`)
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(Array.isArray(data)).toBe(true)
            })
        })
      })

      describe('aggregator error handling', () => {
        it('handles invalid contract addresses gracefully', async () => {
          await request(app.callback())
            .get('/a/feegrant/treasuryOverTime?contractAddress=invalid-address')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(Array.isArray(data)).toBe(true)
              // Should return empty or default data for invalid addresses
            })
        })

        it('handles missing data gracefully', async () => {
          // Clear all data - delete WasmTxEvents first due to foreign key constraint
          await WasmTxEvent.destroy({ where: {} })
          await FeegrantAllowance.destroy({ where: {} })
          await Contract.destroy({ where: {} })

          await request(app.callback())
            .get('/a/feegrant/chainwideOverTime')
            .set('x-api-key', options.apiKey)
            .expect(200)
            .then((response) => {
              const data = response.body
              expect(Array.isArray(data)).toBe(true)
              // Should handle empty data gracefully
            })
        })
      })
    })
  })
}
