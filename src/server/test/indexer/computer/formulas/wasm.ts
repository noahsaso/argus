import request from 'supertest'
import { afterEach, beforeEach, describe, it } from 'vitest'

import { Block, State, WasmStateEvent } from '@/db'
import { dbKeyForKeys } from '@/utils'

import { app } from '../../app'
import { ComputerTestOptions } from '../types'

export const loadWasmTests = (options: ComputerTestOptions) => {
  describe('wasm', () => {
    beforeEach(async () => {
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
        compute: (env) => env.get(env.contractAddress, 'some_state'),
      })
    })

    afterEach(() => {
      options.unmockFormula()
    })

    it('returns correct formula response for a single block', async () => {
      await request(app.callback())
        .get('/contract/valid_contract/formula?block=1:1')
        .set('x-api-key', options.apiKey)
        .expect(200)
        .expect({ key1: 'value1', key2: 'value2' })

      // 204 with no body since the value was deleted in this block.
      await request(app.callback())
        .get('/contract/valid_contract/formula?block=2:2')
        .set('x-api-key', options.apiKey)
        .expect(204)
        .expect('')

      await request(app.callback())
        .get('/contract/valid_contract/formula?block=3:3')
        .set('x-api-key', options.apiKey)
        .expect(200)
        .expect({ key3: 'value3' })

      // Returns latest if no block.
      await request(app.callback())
        .get('/contract/valid_contract/formula')
        .set('x-api-key', options.apiKey)
        .expect(200)
        .expect({ key3: 'value3' })
    })

    // Computation caching is disabled, so this test does not currently apply.

    // it('caches computation and uses it in the future', async () => {
    //   const initialComputations = await Computation.count()

    //   const response = await request(app.callback())
    //     .get('/contract/valid_contract/formula')
    //     .set('x-api-key', options.apiKey)
    //     .expect(200)

    //   expect(await Computation.count()).toBe(initialComputations + 1)

    //   // Computation should cache the returned result.
    //   const computation = (await Computation.getLast())!
    //   expect(computation.targetAddress).toBe('valid_contract')
    //   expect(computation.blockHeight).toBe('3')
    //   expect(computation.blockTimeUnixMs).toBe('3')
    //   expect(computation.latestBlockHeightValid).toBe('3')
    //   expect(computation.validityExtendable).toBe(true)
    //   expect(computation.type).toBe(FormulaType.Contract)
    //   expect(computation.formula).toBe('formula')
    //   expect(computation.args).toBe('{}')
    //   expect(computation.dependencies.length).toBe(1)
    //   expect(computation.dependencies[0].key).toEqual(
    //     `${WasmStateEvent.dependentKeyNamespace}:valid_contract:${dbKeyForKeys(
    //       'some_state'
    //     )}`
    //   )
    //   expect(computation.dependencies[0].prefix).toBe(false)
    //   expect(computation.output).toEqual(JSON.stringify(response.body))

    //   // Repeating the same query should not create a new computation.
    //   await request(app.callback())
    //     .get('/contract/valid_contract/formula')
    //     .set('x-api-key', options.apiKey)
    //     .expect(200)

    //   expect(await Computation.count()).toBe(initialComputations + 1)
    // })

    it('returns correct formula response for 3 blocks', async () => {
      await request(app.callback())
        .get('/contract/valid_contract/formula?blocks=1:1..3:3')
        .set('x-api-key', options.apiKey)
        .expect(200)
        .expect([
          {
            value: { key1: 'value1', key2: 'value2' },
            blockHeight: 1,
            blockTimeUnixMs: 1,
          },
          {
            value: null,
            blockHeight: 2,
            blockTimeUnixMs: 2,
          },
          {
            value: { key3: 'value3' },
            blockHeight: 3,
            blockTimeUnixMs: 3,
          },
        ])
    })

    // it('caches computations over range and uses them in the future', async () => {
    //   const initialComputations = await Computation.count()

    //   await request(app.callback())
    //     .get('/contract/valid_contract/formula?blocks=1:1..3:3')
    //     .set('x-api-key', options.apiKey)
    //     .expect(200)

    //   expect(await Computation.count()).toBe(initialComputations + 3)

    //   // Repeating the same query should not create new computations.
    //   await request(app.callback())
    //     .get('/contract/valid_contract/formula')
    //     .set('x-api-key', options.apiKey)
    //     .expect(200)

    //   expect(await Computation.count()).toBe(initialComputations + 3)
    // })
  })
}
