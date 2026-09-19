import type { StargateClient } from '@cosmjs/stargate'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { State } from '@/db'
import * as utils from '@/utils'

import { app } from './app'

const BLOCK_TIME_UNIX_MS = new Date('2026-09-19T00:00:00Z').getTime()

const makeMockClient = (height: number) =>
  ({
    getBlock: async () => ({
      header: {
        height,
        time: new Date(BLOCK_TIME_UNIX_MS).toISOString(),
      },
    }),
  } as unknown as StargateClient)

describe('GET /up', () => {
  // The route modules are imported by the global test setup before this file
  // runs, so mock the stargate clients by spying on the module namespace
  // rather than with `vi.mock`.
  const getStargateClientSpy = vi.spyOn(utils, 'getStargateClient')

  let restoreLocalRpc: () => void = () => {}

  // The indexer under test is configured with an optional local RPC.
  const setLocalRpc = (rpc: string | undefined) => {
    const config = ConfigManager.load()
    const previous = config.localRpc
    config.localRpc = rpc
    restoreLocalRpc = () => {
      config.localRpc = previous
    }
  }

  // Set the state singleton to the given heads. Heights not provided default
  // to the values `State.createSingletonIfMissing` initializes them with.
  const setState = async ({
    latestBlockHeight = 1000n,
    lastWasmBlockHeightExported,
  }: {
    latestBlockHeight?: bigint
    lastWasmBlockHeightExported?: bigint
  }) => {
    await State.createSingletonIfMissing('test-1')
    await State.updateSingleton({
      chainId: 'test-1',
      latestBlockHeight: latestBlockHeight.toString(),
      latestBlockTimeUnixMs: BLOCK_TIME_UNIX_MS.toString(),
      ...(lastWasmBlockHeightExported !== undefined && {
        lastWasmBlockHeightExported: lastWasmBlockHeightExported.toString(),
      }),
    })
  }

  afterEach(() => {
    restoreLocalRpc()
    restoreLocalRpc = () => {}
    getStargateClientSpy.mockReset()
  })

  it('is degraded and not caught up when the configured local RPC is unreachable, even if the exported block is at remote tip', async () => {
    // This reproduces the Sept 15-19 xion-testnet-2 outage: the local chain
    // node was down while the remote-connected listener kept advancing the
    // exported block to the remote tip, so the old remote-only fallback
    // reported healthy.
    setLocalRpc('http://localhost:26657')
    await setState({
      latestBlockHeight: 1000n,
      lastWasmBlockHeightExported: 500n,
    })

    getStargateClientSpy.mockImplementation(async (type) => {
      if (type === 'local') {
        throw new Error('local node down')
      }
      return makeMockClient(1000)
    })

    const res = await request(app.callback()).get('/up')

    expect(res.status).toBe(412)
    expect(res.body.caughtUp).toBe(false)
    expect(res.body.localRpcConfigured).toBe(true)
    expect(res.body.degraded).toBe(true)
    expect(res.body.degradationReasons).toHaveLength(1)
    expect(res.body.degradationReasons[0]).toContain('local node down')
    // Legacy fields remain present and truthful.
    expect(res.body.localBlock).toEqual({
      error: expect.stringContaining('local node down'),
    })
    expect(res.body.exportedBlock.height).toBe(1000)
    expect(res.body.remoteBlock.height).toBe(1000)
    expect(res.body.version).toBeTypeOf('string')
    expect(res.body.chainId).toBe('test-1')
    expect(res.body.timing).toBeDefined()
  })

  it('is caught up and not degraded when the local RPC is healthy and at remote tip', async () => {
    setLocalRpc('http://localhost:26657')
    await setState({ latestBlockHeight: 1000n })

    getStargateClientSpy.mockImplementation(async (type) =>
      makeMockClient(type === 'local' ? 999 : 1000)
    )

    const res = await request(app.callback()).get('/up')

    expect(res.status).toBe(200)
    expect(res.body.caughtUp).toBe(true)
    expect(res.body.localRpcConfigured).toBe(true)
    expect(res.body.degraded).toBe(false)
    expect(res.body.degradationReasons).toEqual([])
    expect(res.body.localBlock.height).toBe(999)
  })

  it('is not caught up when the local node trails the remote tip', async () => {
    setLocalRpc('http://localhost:26657')
    await setState({ latestBlockHeight: 900n })

    getStargateClientSpy.mockImplementation(async (type) =>
      makeMockClient(type === 'local' ? 900 : 1000)
    )

    const res = await request(app.callback()).get('/up')

    expect(res.status).toBe(412)
    expect(res.body.caughtUp).toBe(false)
    expect(res.body.degraded).toBe(false)
    expect(res.body.degradationReasons).toEqual([])
  })

  it('falls back to comparing the exported block to the remote tip when no local RPC is configured', async () => {
    setLocalRpc(undefined)
    await setState({ latestBlockHeight: 1000n })

    getStargateClientSpy.mockImplementation(async (type) => {
      if (type === 'local') {
        throw new Error('local node down')
      }
      return makeMockClient(1000)
    })

    const res = await request(app.callback()).get('/up')

    expect(res.status).toBe(200)
    expect(res.body.caughtUp).toBe(true)
    expect(res.body.localRpcConfigured).toBe(false)
    expect(res.body.degraded).toBe(false)
    expect(res.body.degradationReasons).toEqual([])
    expect(res.body.localBlock).toBeNull()
  })
})
