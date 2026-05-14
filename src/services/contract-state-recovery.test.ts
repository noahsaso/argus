import { describe, expect, it, vi } from 'vitest'

import { recoverContractState } from './contract-state-recovery'

describe('recoverContractState', () => {
  it('converts live state pages into wasm state events and transforms them', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({
      models: [
        {
          key: Uint8Array.from([1, 2]),
          value: Buffer.from(JSON.stringify({ count: 1 })),
        },
      ],
      nextKey: undefined,
    })
    const saveEvents = vi.fn(async (events) => events)
    const transformEvents = vi.fn(async () => [{ id: 1 }])

    const result = await recoverContractState({
      address: 'juno1contract',
      codeId: 7,
      blockHeight: '123',
      blockTimeUnixMs: '456000',
      pageLimit: 1000,
      fetchPage,
      ensureContract: vi.fn(),
      saveEvents,
      transformEvents: transformEvents as any,
      updateState: vi.fn(),
    })

    expect(saveEvents).toHaveBeenCalledWith([
      {
        type: 'state',
        codeId: 7,
        contractAddress: 'juno1contract',
        blockHeight: '123',
        blockTimeUnixMs: '456000',
        blockTimestamp: new Date(456000),
        key: '1,2',
        value: '{"count":1}',
        valueJson: { count: 1 },
        delete: false,
      },
    ])
    expect(transformEvents).toHaveBeenCalledWith([
      {
        type: 'state',
        codeId: 7,
        contractAddress: 'juno1contract',
        blockHeight: '123',
        blockTimeUnixMs: '456000',
        blockTimestamp: new Date(456000),
        key: '1,2',
        value: '{"count":1}',
        valueJson: { count: 1 },
        delete: false,
      },
    ])
    expect(result).toEqual({
      count: 1,
      events: 1,
      transformations: 1,
    })
  })

  it('preserves invalid UTF-8 raw values as base64', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({
      models: [{ key: Uint8Array.from([1]), value: Uint8Array.from([0xff]) }],
      nextKey: undefined,
    })
    const saveEvents = vi.fn(async (events) => events)

    await recoverContractState({
      address: 'juno1contract',
      codeId: 7,
      blockHeight: '123',
      blockTimeUnixMs: '456000',
      pageLimit: 1000,
      fetchPage,
      ensureContract: vi.fn(),
      saveEvents,
      transformEvents: vi.fn(async () => []) as any,
      updateState: vi.fn(),
    })

    expect(saveEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        key: '1',
        value: '/w==',
        valueJson: null,
      }),
    ])
  })

  it('fetches pages until nextKey is empty before saving and transforming', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        models: [{ key: Uint8Array.from([1]), value: Buffer.from('a') }],
        nextKey: Uint8Array.from([9]),
      })
      .mockResolvedValueOnce({
        models: [{ key: Uint8Array.from([2]), value: Buffer.from('b') }],
        nextKey: new Uint8Array(),
      })
    const saveEvents = vi.fn(async (events) => events)

    const result = await recoverContractState({
      address: 'juno1contract',
      codeId: 7,
      blockHeight: '123',
      blockTimeUnixMs: '456000',
      pageLimit: 1000,
      fetchPage,
      ensureContract: vi.fn(),
      saveEvents,
      transformEvents: vi.fn(async () => []) as any,
      updateState: vi.fn(),
    })

    expect(fetchPage).toHaveBeenNthCalledWith(2, {
      address: 'juno1contract',
      pageLimit: 1000,
      nextKey: Uint8Array.from([9]),
    })
    expect(saveEvents).toHaveBeenCalledWith([
      expect.objectContaining({ key: '1', value: 'a' }),
      expect.objectContaining({ key: '2', value: 'b' }),
    ])
    expect(result.count).toBe(2)
  })
})
