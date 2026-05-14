import { describe, expect, it, vi } from 'vitest'

import { dumpContractState } from './contract-state-dump'

describe('dumpContractState', () => {
  it('base64 encodes all key/value entries', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({
      models: [
        { key: Uint8Array.from([1, 2]), value: Uint8Array.from([3, 4]) },
      ],
      nextKey: undefined,
    })

    await expect(
      dumpContractState({
        address: 'juno1contract',
        pageLimit: 1000,
        fetchPage,
      })
    ).resolves.toEqual({
      entries: [{ key: 'AQI=', value: 'AwQ=' }],
      count: 1,
    })
  })

  it('fetches pages until nextKey is empty', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        models: [{ key: Uint8Array.from([1]), value: Uint8Array.from([2]) }],
        nextKey: Uint8Array.from([9]),
      })
      .mockResolvedValueOnce({
        models: [{ key: Uint8Array.from([3]), value: Uint8Array.from([4]) }],
        nextKey: new Uint8Array(),
      })

    const result = await dumpContractState({
      address: 'juno1contract',
      pageLimit: 1000,
      fetchPage,
    })

    expect(fetchPage).toHaveBeenNthCalledWith(1, {
      address: 'juno1contract',
      pageLimit: 1000,
      nextKey: undefined,
    })
    expect(fetchPage).toHaveBeenNthCalledWith(2, {
      address: 'juno1contract',
      pageLimit: 1000,
      nextKey: Uint8Array.from([9]),
    })
    expect(result).toEqual({
      entries: [
        { key: 'AQ==', value: 'Ag==' },
        { key: 'Aw==', value: 'BA==' },
      ],
      count: 2,
    })
  })
})
