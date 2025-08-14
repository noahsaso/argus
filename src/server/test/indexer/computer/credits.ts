import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Block, Contract, State, WasmStateEvent } from '@/db'
import { dbKeyForKeys } from '@/utils'

import { app } from '../app'
import { ComputerTestOptions } from './types'

export const loadCreditsTests = (options: ComputerTestOptions) => {
  describe('credits', () => {
    beforeEach(async () => {
      await Contract.create({ address: 'valid_contract', codeId: 1 })

      const date = new Date()
      await WasmStateEvent.bulkCreate([
        {
          contractAddress: 'valid_contract',
          blockHeight: 1,
          blockTimeUnixMs: 1,
          blockTimestamp: date,
          key: dbKeyForKeys('some_state'),
          value: '{"key1":"value1", "key2": "value2"}',
          valueJson: { key1: 'value1', key2: 'value2' },
          delete: false,
        },
        {
          contractAddress: 'valid_contract',
          blockHeight: 2,
          blockTimeUnixMs: 2,
          blockTimestamp: new Date(date.getTime() + 1000),
          key: dbKeyForKeys('some_state'),
          value: '',
          valueJson: null,
          delete: true,
        },
        {
          contractAddress: 'valid_contract',
          blockHeight: 3,
          blockTimeUnixMs: 3,
          blockTimestamp: new Date(date.getTime() + 2000),
          key: dbKeyForKeys('some_state'),
          value: '{"key3":"value3"}',
          valueJson: { key3: 'value3' },
          delete: false,
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
      ])

      await State.updateSingleton({
        latestBlockHeight: 3,
        latestBlockTimeUnixMs: 3,
      })

      options.mockFormula({
        compute: (env) =>
          env.get(env.contractAddress, 'some_state').then((e) => e?.valueJson),
      })
    })

    afterEach(() => {
      options.unmockFormula()
    })

    it('uses 1 credit to query a single block', async () => {
      expect(options.credit.used).toBe('0')
      expect(options.credit.hits).toBe('0')

      // Returns latest if no block.
      await request(app.callback())
        .get('/contract/valid_contract/formula')
        .set('x-api-key', options.apiKey)
        .expect(200)

      await options.credit.reload()
      expect(options.credit.used).toBe('1')
      expect(options.credit.hits).toBe('1')

      await request(app.callback())
        .get('/contract/valid_contract/formula?block=1:1')
        .set('x-api-key', options.apiKey)
        .expect(200)

      await options.credit.reload()
      expect(options.credit.used).toBe('2')
      expect(options.credit.hits).toBe('2')
    })

    it('uses 1 credit to query a single time', async () => {
      expect(options.credit.used).toBe('0')
      expect(options.credit.hits).toBe('0')

      await request(app.callback())
        .get('/contract/valid_contract/formula?time=1')
        .set('x-api-key', options.apiKey)
        .expect(200)

      await options.credit.reload()
      expect(options.credit.used).toBe('1')
      expect(options.credit.hits).toBe('1')
    })

    it('errors when insufficient credits for a single block', async () => {
      expect(options.credit.used).toBe('0')
      expect(options.credit.hits).toBe('0')

      // Use all the credits.
      for (const _ of Array(Number(options.credit.amount))) {
        await request(app.callback())
          .get('/contract/valid_contract/formula')
          .set('x-api-key', options.apiKey)
          .expect(200)
      }

      await options.credit.reload()
      expect(options.credit.used).toBe(options.credit.amount)
      expect(options.credit.hits).toBe(options.credit.amount)

      await request(app.callback())
        .get('/contract/valid_contract/formula')
        .set('x-api-key', options.apiKey)
        .expect(402)
        .expect('insufficient credits')

      // Ensure no credits were used.
      await options.credit.reload()
      expect(options.credit.used).toBe(options.credit.amount)
      expect(options.credit.hits).toBe(options.credit.amount)
    })

    it('uses 2 credits to query 3 blocks', async () => {
      expect(options.credit.used).toBe('0')
      expect(options.credit.hits).toBe('0')

      await request(app.callback())
        .get('/contract/valid_contract/formula?blocks=1:1..3:3')
        .set('x-api-key', options.apiKey)
        .expect(200)

      await options.credit.reload()
      expect(options.credit.used).toBe('2')
      expect(options.credit.hits).toBe('1')
    })

    it('uses 2 credits to query 3 blocks via times', async () => {
      expect(options.credit.used).toBe('0')
      expect(options.credit.hits).toBe('0')

      await request(app.callback())
        .get('/contract/valid_contract/formula?times=1..3')
        .set('x-api-key', options.apiKey)
        .expect(200)

      await options.credit.reload()
      expect(options.credit.used).toBe('2')
      expect(options.credit.hits).toBe('1')
    })

    it('errors when insufficient credits for a blocks/times range', async () => {
      expect(options.credit.used).toBe('0')
      expect(options.credit.hits).toBe('0')

      // Use all the credits.
      for (const _ of Array(Number(options.credit.amount))) {
        await request(app.callback())
          .get('/contract/valid_contract/formula')
          .set('x-api-key', options.apiKey)
          .expect(200)
      }

      await options.credit.reload()
      expect(options.credit.used).toBe(options.credit.amount)
      expect(options.credit.hits).toBe(options.credit.amount)

      await request(app.callback())
        .get('/contract/valid_contract/formula?blocks=1:1..3:3')
        .set('x-api-key', options.apiKey)
        .expect(402)
        .expect('insufficient credits')

      // Ensure no credits were used.
      await options.credit.reload()
      expect(options.credit.used).toBe(options.credit.amount)
      expect(options.credit.hits).toBe(options.credit.amount)

      await request(app.callback())
        .get('/contract/valid_contract/formula?times=1')
        .set('x-api-key', options.apiKey)
        .expect(402)
        .expect('insufficient credits')

      // Ensure no credits were used.
      await options.credit.reload()
      expect(options.credit.used).toBe(options.credit.amount)
      expect(options.credit.hits).toBe(options.credit.amount)

      await request(app.callback())
        .get('/contract/valid_contract/formula?times=1..3')
        .set('x-api-key', options.apiKey)
        .expect(402)
        .expect('insufficient credits')

      // Ensure no credits were used.
      await options.credit.reload()
      expect(options.credit.used).toBe(options.credit.amount)
      expect(options.credit.hits).toBe(options.credit.amount)
    })
  })
}
