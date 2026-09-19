import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { State } from '@/db'
import { serializeBlock } from '@/utils'
import * as utils from '@/utils'
import { version } from '@/version'

import { app } from './app'

const BLOCK_TIME_UNIX_MS = new Date('2026-09-19T00:00:00Z').getTime()

describe('GET /status', () => {
  // The route modules are imported by the global test setup before this file
  // runs, so mock the stargate clients by spying on the module namespace
  // rather than with `vi.mock`.
  const getStargateClientSpy = vi.spyOn(utils, 'getStargateClient')

  it('returns the status', async () => {
    const state = (await State.getSingleton())!
    expect(state).toBeDefined()
    await request(app.callback())
      .get('/status')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect({
        version,
        chainId: state.chainId,
        latestBlock: serializeBlock(state.latestBlock),
        lastStakingBlockHeightExported:
          state.lastStakingBlockHeightExported?.toString() || null,
        lastWasmBlockHeightExported:
          state.lastWasmBlockHeightExported?.toString() || null,
        lastBankBlockHeightExported:
          state.lastBankBlockHeightExported?.toString() || null,
        lastGovBlockHeightExported:
          state.lastGovBlockHeightExported?.toString() || null,
        lastDistributionBlockHeightExported:
          state.lastDistributionBlockHeightExported?.toString() || null,
        // Fresh state initializes every pipeline at height 0, so the trace
        // watermark is 0 and no pipeline lags the latest block.
        lastFeegrantBlockHeightExported: '0',
        lastTraceExportedBlockHeight: '0',
        localRpc: {
          configured: false,
          healthy: null,
          error: null,
          block: null,
        },
        pipelineLag: {
          trace: 0,
          wasm: 0,
          bank: 0,
          gov: 0,
          distribution: 0,
          feegrant: 0,
        },
      })
  })

  it('exposes trace pipeline lag when the trace pipelines trail the listener head', async () => {
    // This reproduces the Sept 15-19 xion-testnet-2 outage shape: the
    // remote-connected listener advanced the latest block to the tip while
    // the local-node-dependent trace pipelines stalled behind.
    await State.updateSingleton({
      chainId: 'test-1',
      latestBlockHeight: '1000',
      latestBlockTimeUnixMs: BLOCK_TIME_UNIX_MS.toString(),
      lastWasmBlockHeightExported: '400',
      lastBankBlockHeightExported: '450',
      lastGovBlockHeightExported: '500',
      lastDistributionBlockHeightExported: '350',
      lastFeegrantBlockHeightExported: '480',
    })

    await request(app.callback())
      .get('/status')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect((res) => {
        expect(res.body.chainId).toBe('test-1')
        expect(res.body.latestBlock.height).toBe('1000')
        expect(res.body.lastWasmBlockHeightExported).toBe('400')
        // The gov pipeline reports its own head, not the bank head.
        expect(res.body.lastGovBlockHeightExported).toBe('500')
        // The trace watermark is the furthest-behind trace pipeline.
        expect(res.body.lastTraceExportedBlockHeight).toBe('350')
        expect(res.body.pipelineLag).toEqual({
          trace: 650,
          wasm: 600,
          bank: 550,
          gov: 500,
          distribution: 650,
          feegrant: 520,
        })
      })
  })

  it('reports unhealthy local RPC when configured but unreachable', async () => {
    const config = ConfigManager.load()
    const previousLocalRpc = config.localRpc
    config.localRpc = 'http://localhost:26657'

    getStargateClientSpy.mockRejectedValue(new Error('connection refused'))

    try {
      await request(app.callback())
        .get('/status')
        .expect(200)
        .expect((res) => {
          expect(res.body.localRpc).toEqual({
            configured: true,
            healthy: false,
            error: expect.stringContaining('connection refused'),
            block: null,
          })
        })
    } finally {
      config.localRpc = previousLocalRpc
      getStargateClientSpy.mockReset()
    }
  })

  it('reports healthy local RPC with the local tip block', async () => {
    const config = ConfigManager.load()
    const previousLocalRpc = config.localRpc
    config.localRpc = 'http://localhost:26657'

    getStargateClientSpy.mockResolvedValue({
      getBlock: async () => ({
        header: {
          height: 900,
          time: new Date(BLOCK_TIME_UNIX_MS).toISOString(),
        },
      }),
    } as any)

    try {
      await request(app.callback())
        .get('/status')
        .expect(200)
        .expect((res) => {
          expect(res.body.localRpc).toEqual({
            configured: true,
            healthy: true,
            error: null,
            block: {
              height: '900',
              timeUnixMs: BLOCK_TIME_UNIX_MS.toString(),
              timestamp: new Date(BLOCK_TIME_UNIX_MS).toISOString(),
            },
          })
        })

      // Only the local RPC is probed.
      expect(getStargateClientSpy).toHaveBeenCalledTimes(1)
      expect(getStargateClientSpy).toHaveBeenCalledWith('local')
    } finally {
      config.localRpc = previousLocalRpc
      getStargateClientSpy.mockReset()
    }
  })
})
