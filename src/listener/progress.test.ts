import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'
import { Tx } from '@dao-dao/types/protobuf/codegen/cosmos/tx/v1beta1/tx'
import { Sequelize } from 'sequelize'
import {
  MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import WS from 'vitest-websocket-mock'

import { State } from '@/db'
import { ExtractQueue } from '@/queues/queues'
import { BlockIterator } from '@/services'
import { AutoCosmWasmClient } from '@/utils'

import { dispatchTxToExtractors } from './dispatch'
import { getListenerStartHeight, saveListenerProcessedHeight } from './progress'

const TXS_PER_BLOCK = 2

const txBytes = (height: number, index: number) =>
  new Uint8Array([height % 256, Math.floor(height / 256), index])
const txHash = (height: number, index: number) =>
  toHex(sha256(txBytes(height, index))).toUpperCase()

// Stand-in for the tracer, which advances the shared latest block height
// independently of the listener.
const tracerAdvancesTo = (height: number) =>
  State.updateSingleton({
    latestBlockHeight: Sequelize.fn(
      'GREATEST',
      Sequelize.col('latestBlockHeight'),
      height
    ),
  })

describe('listener progress', () => {
  describe('getListenerStartHeight', () => {
    it('falls back to the latest block height before the listener has recorded one', () => {
      expect(
        getListenerStartHeight({
          latestBlockHeight: '500',
          listenerLatestBlockHeight: null,
        })
      ).toBe(500)
    })

    it('resumes after the listener height, even when the shared height is ahead', () => {
      expect(
        getListenerStartHeight({
          latestBlockHeight: '520',
          listenerLatestBlockHeight: '499',
        })
      ).toBe(500)
    })
  })

  describe('saveListenerProcessedHeight', () => {
    it('starts empty and is not touched by the shared height updates', async () => {
      await tracerAdvancesTo(1000)

      const state = await State.mustGetSingleton()
      expect(state.latestBlockHeight).toBe('1000')
      expect(state.listenerLatestBlockHeight).toBeNull()
    })

    it('records the height, never moving it backwards, independently of the shared height', async () => {
      await saveListenerProcessedHeight(200)
      await saveListenerProcessedHeight(150)
      await tracerAdvancesTo(1000)

      const state = await State.mustGetSingleton()
      expect(state.listenerLatestBlockHeight).toBe('200')
      expect(state.latestBlockHeight).toBe('1000')
      expect(getListenerStartHeight(state)).toBe(201)
    })
  })

  describe('crash and restart', () => {
    // An extractor that matches every TX, so every TX the listener sees is
    // queued.
    const matchAll = {
      type: 'matchAll',
      match: ({ hash }: { hash: string }) => [
        { source: 'test', handler: 'test', data: { hash } },
      ],
    } as any

    let mockServer: WS
    let blockResults: (height: number) => Promise<any>
    let addBulk: MockInstance<typeof ExtractQueue['addBulk']>

    const mockAutoCosmWasmClient = () => {
      const client = {
        forceGetCometClient: () => ({
          status: async () => ({ syncInfo: { earliestBlockHeight: 1 } }),
          block: async (height: number) => ({
            block: {
              header: {
                version: { block: 11, app: 0 },
                chainId: 'xion-mainnet-1',
                height,
                time: new Date(1_700_000_000_000 + height * 1_000),
              },
              txs: Array.from({ length: TXS_PER_BLOCK }, (_, i) =>
                txBytes(height, i)
              ),
            },
          }),
          blockResults: (height: number) => blockResults(height),
        }),
        getHeight: async () => 10_000,
      }
      return {
        update: async () => {},
        getValidClient: async () => client,
        client,
      } as unknown as AutoCosmWasmClient
    }

    const okResults = async (height: number) => ({
      height,
      results: Array.from({ length: TXS_PER_BLOCK }, () => ({
        code: 0,
        events: [],
      })),
    })

    // Run the listener's block processing from the start height it would
    // compute on boot, the way `src/scripts/listener.ts` does.
    const runListener = async (endHeight: number) => {
      const state = await State.mustGetSingleton()
      const startHeight = getListenerStartHeight(state)

      WS.clean()
      mockServer = new WS('ws://localhost:26657/websocket')

      const iterator = new BlockIterator({
        rpcUrl: 'http://localhost:26657',
        autoCosmWasmClient: mockAutoCosmWasmClient(),
        startHeight,
        endHeight,
        bufferSize: 5,
        // Give up on transient errors quickly, so the run crashes the way the
        // production listener did.
        transientRetry: {
          initialDelayMs: 5,
          maxDelayMs: 5,
          maxDurationMs: 50,
        },
      })

      const done = iterator.iterate({
        onBlock: async ({ height }) => {
          // Like the listener, advance the shared height as blocks arrive.
          await tracerAdvancesTo(Number(height))
          // The tracer is far ahead of the listener.
          await tracerAdvancesTo(Number(height) + 15)
        },
        onTx: (tx, block) => dispatchTxToExtractors(tx, block, [matchAll]),
        onBlockProcessed: ({ height }) =>
          saveListenerProcessedHeight(Number(height)),
      })

      await mockServer.connected
      mockServer.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            query: "tm.event = 'NewBlock'",
            data: {
              type: 'tendermint/event/NewBlock',
              value: {
                block: { header: { height: String(endHeight + 1) } },
              },
            },
          },
        })
      )

      return { startHeight, done }
    }

    // Heights of every queued TX, grouped by TX hash.
    const queuedTxs = () =>
      addBulk.mock.calls.flatMap(([jobs]) =>
        (jobs as any[]).map((job) => ({
          hash: job.data.env.txHash as string,
          height: Number(job.data.env.block.height),
        }))
      )

    const expectedTxs = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => from + i).flatMap(
        (height) =>
          Array.from({ length: TXS_PER_BLOCK }, (_, index) => ({
            hash: txHash(height, index),
            height,
          }))
      )

    beforeEach(async () => {
      vi.spyOn(Tx, 'decode').mockImplementation(
        () => ({ body: { messages: [] } } as any)
      )
      addBulk = vi.spyOn(ExtractQueue, 'addBulk').mockResolvedValue([] as any)
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      blockResults = okResults

      // The listener and tracer were at block 99 before this listener version
      // was deployed.
      await State.updateSingleton({ latestBlockHeight: 100 })
    })

    afterEach(() => {
      vi.mocked(Tx.decode).mockRestore()
      addBulk.mockRestore()
      vi.mocked(console.log).mockRestore()
      vi.mocked(console.warn).mockRestore()
      WS.clean()
    })

    it('resumes from the listener height so every block reaches the extractors exactly once', async () => {
      // First run: block 105's results stay unavailable, so the listener gives
      // up on it and crashes.
      blockResults = (height) =>
        height === 105
          ? Promise.reject(
              new Error(
                '{"code":-32603,"message":"Internal error","data":"could not find results for height #105"}'
              )
            )
          : okResults(height)

      const first = await runListener(125)
      expect(first.startHeight).toBe(100)
      await expect(first.done).rejects.toThrow(
        'could not find results for height #105'
      )

      const crashed = await State.mustGetSingleton()
      // The listener fully processed 100 to 104.
      expect(crashed.listenerLatestBlockHeight).toBe('104')
      // The shared height moved past the failed block. Resuming from it, as
      // the listener did before, would skip blocks 105 to 118.
      expect(Number(crashed.latestBlockHeight)).toBeGreaterThan(105)
      expect(Number(crashed.latestBlockHeight)).toBe(119)

      // Restart: the RPC serves block 105 again.
      blockResults = okResults
      const second = await runListener(125)
      expect(second.startHeight).toBe(105)
      await second.done

      // Every TX in 100 to 125 was queued exactly once, in order.
      expect(queuedTxs()).toEqual(expectedTxs(100, 125))
      expect((await State.mustGetSingleton()).listenerLatestBlockHeight).toBe(
        '125'
      )
    })

    it('re-processes a block that crashed part way through, so no TX is lost', async () => {
      // First run: queueing the second TX of block 103 fails (for example
      // Redis is down), which crashes the listener.
      const failingHash = txHash(103, 1)
      let failed = false
      const queued: string[] = []
      addBulk.mockImplementation(async (jobs) => {
        if (!failed && jobs[0].data.env.txHash === failingHash) {
          failed = true
          throw new Error('Connection is closed.')
        }
        queued.push(...jobs.map((job) => job.data.env.txHash))
        return [] as any
      })

      const first = await runListener(125)
      await expect(first.done).rejects.toThrow('Connection is closed.')
      expect((await State.mustGetSingleton()).listenerLatestBlockHeight).toBe(
        '102'
      )

      const second = await runListener(125)
      expect(second.startHeight).toBe(103)
      await second.done

      // Every TX was queued. The only duplicate is the first TX of block 103,
      // queued before the crash and again on restart. Re-processing it is
      // safe because extractions are upserted on (address, name, blockHeight).
      const counts = new Map<string, number>()
      queued.forEach((hash) => counts.set(hash, (counts.get(hash) ?? 0) + 1))
      for (const { hash } of expectedTxs(100, 125)) {
        expect(counts.get(hash)).toBe(hash === txHash(103, 0) ? 2 : 1)
      }
      expect(counts.size).toBe(expectedTxs(100, 125).length)
    })
  })
})
