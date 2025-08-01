import request from 'supertest'
import { beforeEach, describe, it } from 'vitest'

import { Block, FeegrantAllowance, State } from '@/db'

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
  })
}
