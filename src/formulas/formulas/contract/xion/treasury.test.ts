import { describe, expect, it, vi } from 'vitest'

import { ContractEnv } from '@/types'

import { admin, all, feeConfig, grantConfigs, params } from './treasury'

// Build a minimal env that returns "no stored state" for every key.
// Anything the treasury formulas read (`get`, `getMap`, `getBalances`,
// `getTransformationMatch`) resolves to `undefined`/empty, matching the
// shape an indexer sees for a contract it has never indexed.
const makeEmptyEnv = (
  contractAddress = 'xion1jjztzhx3vm67a002y6s0af9kpzkzn0a87a2mvxetqekym0gqt63s2zjq7p'
): ContractEnv =>
  ({
    contractAddress,
    args: {},
    get: vi.fn().mockResolvedValue(undefined),
    getMap: vi.fn().mockResolvedValue(undefined),
    getBalances: vi.fn().mockResolvedValue(undefined),
    getTransformationMatch: vi.fn().mockResolvedValue(undefined),
    getExtraction: vi.fn().mockResolvedValue(undefined),
  } as unknown as ContractEnv)

describe('xion/treasury formulas — defensive emptiness checks', () => {
  it('all.compute throws for an unindexed contract instead of returning the all-defaults shape', async () => {
    await expect(all.compute(makeEmptyEnv())).rejects.toThrow(
      'treasury not found'
    )
  })

  it.each([
    ['grantConfigs', grantConfigs],
    ['feeConfig', feeConfig],
    ['admin', admin],
    ['params', params],
  ])('%s.compute throws for an unindexed contract', async (_name, formula) => {
    await expect(formula.compute(makeEmptyEnv())).rejects.toThrow(
      'treasury not found'
    )
  })

  it('all.compute returns the populated shape when admin is set', async () => {
    const env = {
      contractAddress: 'xion1real',
      args: {},
      get: vi.fn((_addr: string, key: string) => {
        if (key === 'admin') {
          return Promise.resolve({ valueJson: 'xion1admin' })
        }
        if (key === 'fee_config') {
          return Promise.resolve({
            valueJson: { allowance: { basic: { spend_limit: [] } } },
          })
        }
        if (key === 'params') {
          return Promise.resolve({ valueJson: { redirect_url: 'https://x' } })
        }
        return Promise.resolve(undefined)
      }),
      getMap: vi.fn().mockResolvedValue({
        '/cosmos.bank.v1beta1.MsgSend': { authorization: {} },
      }),
      getBalances: vi.fn().mockResolvedValue({ uxion: '1000' }),
      getTransformationMatch: vi.fn().mockResolvedValue(undefined),
      getExtraction: vi.fn().mockResolvedValue(undefined),
    } as unknown as ContractEnv

    const result = await all.compute(env)
    expect(result.admin).toBe('xion1admin')
    expect(result.grantConfigs).toMatchObject({
      '/cosmos.bank.v1beta1.MsgSend': { authorization: {} },
    })
    expect(result.balances).toEqual({ uxion: '1000' })
  })
})
