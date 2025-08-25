import request from 'supertest'
import { beforeEach, describe, it } from 'vitest'

import { BankDenomBalance, BankStateEvent, Block, Contract, State } from '@/db'
import { WasmCodeService } from '@/services'
import { BANK_HISTORY_CODE_IDS_KEYS } from '@/tracer/handlers/bank'

import { app } from '../../app'
import { ComputerTestOptions } from '../types'

export const loadBankTests = (options: ComputerTestOptions) => {
  describe('bank', () => {
    describe('history', () => {
      beforeEach(async () => {
        const blockTimestamp = new Date()

        await Contract.create({
          address: 'address',
          // Code ID that we keep bank history for.
          codeId: WasmCodeService.instance.findWasmCodeIdsByKeys(
            BANK_HISTORY_CODE_IDS_KEYS[0]
          )[0],
          instantiatedAtBlockHeight: 1,
          instantiatedAtBlockTimeUnixMs: 1,
          instantiatedAtBlockTimestamp: new Date(),
        })

        await BankStateEvent.bulkCreate([
          {
            address: 'address',
            denom: 'utest',
            blockHeight: 1,
            blockTimeUnixMs: 1,
            blockTimestamp,
            balance: '1000',
          },
          {
            address: 'address',
            denom: 'utest',
            blockHeight: 2,
            blockTimeUnixMs: 2,
            blockTimestamp,
            balance: '2000',
          },
          {
            address: 'address',
            denom: 'uanother',
            blockHeight: 3,
            blockTimeUnixMs: 3,
            blockTimestamp,
            balance: '3000',
          },
          {
            address: 'address',
            denom: 'uagain',
            blockHeight: 4,
            blockTimeUnixMs: 4,
            blockTimestamp,
            balance: '4000',
          },
        ])

        await Block.createMany([
          {
            height: 1,
            timeUnixMs: 1,
          },
          {
            height: 2,
            timeUnixMs: 2,
          },
          {
            height: 3,
            timeUnixMs: 3,
          },
          {
            height: 4,
            timeUnixMs: 4,
          },
        ])

        await State.updateSingleton({
          latestBlockHeight: 4,
          latestBlockTimeUnixMs: 4,
          lastBankBlockHeightExported: 4,
        })
      })

      it('returns correct balance response for a single block', async () => {
        await request(app.callback())
          .get('/account/address/bank/balance?block=1:1&denom=utest')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect('"1000"')

        await request(app.callback())
          .get('/account/address/bank/balance?block=3:3&denom=utest')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect('"2000"')

        // Returns latest if no block.
        await request(app.callback())
          .get('/account/address/bank/balance?denom=utest')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect('"2000"')
      })

      it('returns correct balance response for multiple blocks', async () => {
        await request(app.callback())
          .get('/account/address/bank/balance?blocks=1:1..3:3&denom=utest')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              value: '1000',
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              value: '2000',
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])

        await request(app.callback())
          .get(
            '/account/address/bank/balance?blocks=1:1..3:3&blockStep=2&denom=utest'
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              at: '1',
              value: '1000',
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              at: '3',
              value: '2000',
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])
      })

      it('returns correct balance response for multiple times', async () => {
        await request(app.callback())
          .get('/account/address/bank/balance?times=1..3&denom=utest')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              value: '1000',
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              value: '2000',
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])

        await request(app.callback())
          .get(
            '/account/address/bank/balance?times=1..3&timeStep=2&denom=utest'
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              at: '1',
              value: '1000',
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              at: '3',
              value: '2000',
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
          ])
      })

      it('returns correct balances response for a single block', async () => {
        await request(app.callback())
          .get('/account/address/bank/balances?block=1:1')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            utest: '1000',
          })

        await request(app.callback())
          .get('/account/address/bank/balances?block=3:3')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            utest: '2000',
            uanother: '3000',
          })

        // Returns latest if no block.
        await request(app.callback())
          .get('/account/address/bank/balances')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            utest: '2000',
            uanother: '3000',
            uagain: '4000',
          })
      })

      it('returns correct balances response for multiple blocks', async () => {
        await request(app.callback())
          .get('/account/address/bank/balances?blocks=1:1..3:3')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              value: {
                utest: '1000',
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              value: {
                utest: '2000',
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
            {
              value: {
                utest: '2000',
                uanother: '3000',
              },
              blockHeight: 3,
              blockTimeUnixMs: 3,
            },
          ])

        await request(app.callback())
          .get('/account/address/bank/balances?blocks=1:1..3:3&blockStep=2')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              at: '1',
              value: {
                utest: '1000',
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              at: '3',
              value: {
                utest: '2000',
                uanother: '3000',
              },
              blockHeight: 3,
              blockTimeUnixMs: 3,
            },
          ])
      })

      it('returns correct balances response for multiple times', async () => {
        await request(app.callback())
          .get('/account/address/bank/balances?times=1..3')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              value: {
                utest: '1000',
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              value: {
                utest: '2000',
              },
              blockHeight: 2,
              blockTimeUnixMs: 2,
            },
            {
              value: {
                utest: '2000',
                uanother: '3000',
              },
              blockHeight: 3,
              blockTimeUnixMs: 3,
            },
          ])

        await request(app.callback())
          .get('/account/address/bank/balances?times=1..3&timeStep=2')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              at: '1',
              value: {
                utest: '1000',
              },
              blockHeight: 1,
              blockTimeUnixMs: 1,
            },
            {
              at: '3',
              value: {
                utest: '2000',
                uanother: '3000',
              },
              blockHeight: 3,
              blockTimeUnixMs: 3,
            },
          ])
      })
    })

    describe('no history', () => {
      beforeEach(async () => {
        await BankDenomBalance.bulkCreate([
          {
            address: 'address',
            denom: 'utest',
            balance: '2000',
            blockHeight: 2,
            blockTimeUnixMs: 2,
            blockTimestamp: new Date(),
          },
          {
            address: 'address',
            denom: 'uanother',
            balance: '3000',
            blockHeight: 3,
            blockTimeUnixMs: 3,
            blockTimestamp: new Date(),
          },
          {
            address: 'address',
            denom: 'uagain',
            balance: '4000',
            blockHeight: 4,
            blockTimeUnixMs: 4,
            blockTimestamp: new Date(),
          },
        ])

        await Block.createOne({
          height: 4,
          timeUnixMs: 4,
        })

        await State.updateSingleton({
          latestBlockHeight: 4,
          latestBlockTimeUnixMs: 4,
          lastBankBlockHeightExported: 4,
        })
      })

      it('returns nothing for a block before the balance was last updated', async () => {
        await request(app.callback())
          .get('/account/address/bank/balance?block=1:1&denom=utest')
          .set('x-api-key', options.apiKey)
          .expect(400)
          .expect('missing balance')

        await request(app.callback())
          .get('/account/address/bank/balances?block=1:1')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({})
      })

      it('returns correct balance response', async () => {
        await request(app.callback())
          .get('/account/address/bank/balance?denom=utest')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect('"2000"')

        await request(app.callback())
          .get('/account/address/bank/balance?denom=uanother')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect('"3000"')

        await request(app.callback())
          .get('/account/address/bank/balances')
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect({
            utest: '2000',
            uanother: '3000',
            uagain: '4000',
          })
      })
    })

    // Real data from DAO DAO DAO.
    describe('real data', () => {
      beforeEach(async () => {
        await Contract.create({
          address:
            'juno10h0hc64jv006rr8qy0zhlu4jsxct8qwa0vtaleayh0ujz0zynf2s2r7v8q',
          // Code ID that we keep bank history for.
          codeId: WasmCodeService.instance.findWasmCodeIdsByKeys(
            BANK_HISTORY_CODE_IDS_KEYS[0]
          )[0],
          instantiatedAtBlockHeight: 1,
          instantiatedAtBlockTimeUnixMs: 1,
          instantiatedAtBlockTimestamp: new Date(),
        })

        // Set up bank.
        await BankStateEvent.bulkCreate([
          {
            address:
              'juno10h0hc64jv006rr8qy0zhlu4jsxct8qwa0vtaleayh0ujz0zynf2s2r7v8q',
            denom:
              'ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9',
            blockHeight: '11302166',
            blockTimeUnixMs: '1699018686709',
            blockTimestamp: 1699018686709,
            balance: '84300',
          },
          {
            address:
              'juno10h0hc64jv006rr8qy0zhlu4jsxct8qwa0vtaleayh0ujz0zynf2s2r7v8q',
            denom: 'ujuno',
            blockHeight: '11393241',
            blockTimeUnixMs: '1699334426599',
            blockTimestamp: 1699334426599,
            balance: '65479049',
          },
          {
            address:
              'juno10h0hc64jv006rr8qy0zhlu4jsxct8qwa0vtaleayh0ujz0zynf2s2r7v8q',
            denom:
              'ibc/EAC38D55372F38F1AFD68DF7FE9EF762DCF69F26520643CF3F9D292A738D8034',
            blockHeight: '11745184',
            blockTimeUnixMs: '1700544956761',
            blockTimestamp: 1700544956761,
            balance: '2982105',
          },
          {
            address:
              'juno10h0hc64jv006rr8qy0zhlu4jsxct8qwa0vtaleayh0ujz0zynf2s2r7v8q',
            denom: 'ujuno',
            blockHeight: '12090598',
            blockTimeUnixMs: '1701717323952',
            blockTimestamp: 1701717323952,
            balance: '69005049',
          },
        ])

        await Block.createMany([
          {
            height: 11302166,
            timeUnixMs: 1699018686709,
          },
          {
            height: 11393241,
            timeUnixMs: 1699334426599,
          },
          {
            height: 11745184,
            timeUnixMs: 1700544956761,
          },
          {
            height: 12090598,
            timeUnixMs: 1701717323952,
          },
        ])

        await State.updateSingleton({
          latestBlockHeight: 12090598,
          latestBlockTimeUnixMs: 1701717323952,
          lastBankBlockHeightExported: 12090598,
        })
      })

      it('returns correct balance response for a block range', async () => {
        await request(app.callback())
          .get(
            '/account/juno10h0hc64jv006rr8qy0zhlu4jsxct8qwa0vtaleayh0ujz0zynf2s2r7v8q/bank/balances?times=1700544956761..1701717323952'
          )
          .set('x-api-key', options.apiKey)
          .expect(200)
          .expect([
            {
              value: {
                'ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9':
                  '84300',
                'ibc/EAC38D55372F38F1AFD68DF7FE9EF762DCF69F26520643CF3F9D292A738D8034':
                  '2982105',
                ujuno: '65479049',
              },
              blockHeight: 11745184,
              blockTimeUnixMs: 1700544956761,
            },
            {
              value: {
                'ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9':
                  '84300',
                'ibc/EAC38D55372F38F1AFD68DF7FE9EF762DCF69F26520643CF3F9D292A738D8034':
                  '2982105',
                ujuno: '69005049',
              },
              blockHeight: 12090598,
              blockTimeUnixMs: 1701717323952,
            },
          ])
      })
    })
  })
}
