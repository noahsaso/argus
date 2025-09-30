import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'
import {
  BlockResponse,
  BlockResultsResponse,
  Header,
} from '@cosmjs/tendermint-rpc'
import { Tx } from '@dao-dao/types/protobuf/codegen/cosmos/tx/v1beta1/tx'
import { MockInstance, beforeEach, describe, expect, it, vi } from 'vitest'
import WS from 'vitest-websocket-mock'

import { AutoCosmWasmClient } from '@/utils'
import * as utils from '@/utils'

import { BlockIterator, BlockIteratorErrorType, TxData } from './BlockIterator'

describe('BlockIterator', () => {
  let mockAutoCosmWasmClient: AutoCosmWasmClient
  let mockClient: any
  let mockGetBlock: MockInstance
  let mockGetBlockResults: MockInstance
  let mockTxDecode: MockInstance
  let blockIterator: BlockIterator
  let mockServer: WS

  let txMap: Record<string, TxData> = {}

  const createMockBlock = (height: number): BlockResponse => {
    const txs = [
      createMockTx(height, 0),
      createMockTx(height, 1),
      createMockTx(height, 2),
    ]

    return {
      blockId: {
        hash: new Uint8Array([height]),
        parts: {
          total: 1,
          hash: new Uint8Array([height]),
        },
      },
      block: {
        header: {
          version: { block: 11, app: 0 },
          chainId: 'juno-1',
          height: height,
          time: new Date(1640995200000 + height * 1000),
          lastBlockId: null,
          lastCommitHash: new Uint8Array([]),
          dataHash: new Uint8Array([]),
          validatorsHash: new Uint8Array([]),
          nextValidatorsHash: new Uint8Array([]),
          consensusHash: new Uint8Array([]),
          appHash: new Uint8Array([]),
          lastResultsHash: new Uint8Array([]),
          evidenceHash: new Uint8Array([]),
          proposerAddress: new Uint8Array([]),
        },
        lastCommit: null,
        txs: txs.map(({ tx }) => tx),
        evidence: [],
      },
    }
  }

  const createMockBlockResults = (height: number): BlockResultsResponse => {
    const txs = [
      createMockTx(height, 0),
      createMockTx(height, 1),
      createMockTx(height, 2),
    ]

    return {
      height,
      results: txs.map(() => ({
        code: 0,
        events: [],
        gasWanted: 0n,
        gasUsed: 0n,
      })),
      validatorUpdates: [],
      beginBlockEvents: [],
      endBlockEvents: [],
    }
  }

  const createMockTx = (height: number, index: number): TxData => {
    const txData = new Uint8Array([height, index])
    const tx = {
      height: height,
      hash: toHex(sha256(txData)).toUpperCase(),
      index,
      code: 0,
      codespace: '',
      log: '',
      messages: [],
      events: [],
      responseData: new Uint8Array([]),
      tx: txData,
    }

    txMap[tx.hash] = tx

    return tx
  }

  const sendBlockPastEndHeight = async () => {
    // Wait for WebSocket connection
    await mockServer.connected

    // Send block past the end height so it fetches all before it.
    mockServer.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          query: "tm.event = 'NewBlock'",
          data: {
            type: 'tendermint/event/NewBlock',
            value: {
              block: {
                header: {
                  height: (blockIterator.endHeight! + 1).toString(),
                },
              },
            },
          },
        },
      })
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()

    const originalRetry = utils.retry
    // Never retry during tests.
    vi.spyOn(utils, 'retry').mockImplementation((_, ...params) => {
      return originalRetry(1, ...params)
    })

    mockTxDecode = vi.fn().mockImplementation((tx: Uint8Array): Tx => {
      const hash = toHex(sha256(tx)).toUpperCase()
      const txData = txMap[hash]
      if (!txData) {
        throw new Error(`TX ${hash} not found`)
      }
      return {
        body: {
          messages: txData.messages,
          memo: '',
          timeoutHeight: 0n,
          extensionOptions: [],
          nonCriticalExtensionOptions: [],
        },
        signatures: [],
      }
    })
    vi.spyOn(Tx, 'decode').mockImplementation(mockTxDecode as any)

    mockGetBlock = vi
      .fn()
      .mockImplementation((height: number) =>
        Promise.resolve(createMockBlock(height))
      )
    mockGetBlockResults = vi
      .fn()
      .mockImplementation((height: number) =>
        Promise.resolve(createMockBlockResults(height))
      )
    mockClient = {
      forceGetCometClient: vi.fn(() => ({
        status: vi.fn().mockResolvedValue({
          syncInfo: {
            earliestBlockHeight: 1,
          },
        }),
        block: mockGetBlock,
        blockResults: mockGetBlockResults,
      })),
      getHeight: vi.fn().mockResolvedValue(1000),
    }

    mockAutoCosmWasmClient = {
      update: vi.fn().mockResolvedValue(undefined),
      getValidClient: vi.fn().mockResolvedValue(mockClient),
      client: mockClient,
    } as any

    blockIterator = new BlockIterator({
      rpcUrl: 'http://localhost:26657',
      autoCosmWasmClient: mockAutoCosmWasmClient,
      startHeight: 100,
      endHeight: 105,
      bufferSize: 3,
    })

    WS.clean()
    mockServer = new WS('ws://localhost:26657/websocket')
  })

  describe('constructor', () => {
    it('should initialize with correct parameters', () => {
      const iterator = new BlockIterator({
        rpcUrl: 'http://localhost:26657',
        autoCosmWasmClient: mockAutoCosmWasmClient,
        startHeight: 50,
        endHeight: 100,
        bufferSize: 5,
      })

      expect(iterator).toBeDefined()
    })

    it('should use default values when not provided', () => {
      const iterator = new BlockIterator({
        rpcUrl: 'http://localhost:26657',
        autoCosmWasmClient: mockAutoCosmWasmClient,
      })

      expect(iterator).toBeDefined()
      expect(iterator.startHeight).toBe(0)
      expect(iterator.endHeight).toBe(undefined)
      expect(iterator.bufferSize).toBe(10)
    })
  })

  describe('iterate', () => {
    it('should throw error when no callbacks provided', async () => {
      await expect(blockIterator.iterate({})).rejects.toThrow(
        'No callbacks provided'
      )
    })

    it('should throw error when client is not initialized', async () => {
      const iterator = new BlockIterator({
        rpcUrl: 'http://localhost:26657',
        autoCosmWasmClient: {
          ...mockAutoCosmWasmClient,
          client: undefined,
          getValidClient: vi
            .fn()
            .mockRejectedValue(new Error('Client is not initialized')),
        } as any,
      })

      await expect(
        iterator.iterate({
          onBlock: vi.fn(),
        })
      ).rejects.toThrow('Client is not initialized')
    })

    it('should throw error when end height is less than start height', async () => {
      const iterator = new BlockIterator({
        rpcUrl: 'http://localhost:26657',
        autoCosmWasmClient: mockAutoCosmWasmClient,
        startHeight: 100,
        endHeight: 50, // Less than start height
      })

      await expect(
        iterator.iterate({
          onBlock: vi.fn(),
        })
      ).rejects.toThrow('End height 50 is less than start height 100')
    })

    it('should adjust start height when too low', async () => {
      const onError = vi.fn()
      const onBlock = vi.fn()

      const lowStartIterator = new BlockIterator({
        rpcUrl: 'http://localhost:26657',
        autoCosmWasmClient: mockAutoCosmWasmClient,
        startHeight: 5, // Too low
        endHeight: 15,
        bufferSize: 2,
      })

      // Start processing
      const iteratePromise = lowStartIterator.iterate({
        onBlock,
        onError,
      })

      await sendBlockPastEndHeight()

      await iteratePromise

      // Should have adjusted start height to 11, 10 blocks past the earliest
      // block height returned by the client.
      expect(lowStartIterator.startHeight).toBe(11)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          type: BlockIteratorErrorType.StartHeightTooLow,
          cause: expect.objectContaining({
            message: expect.stringContaining(
              'Start height 5 is too low, using 11'
            ),
          }),
        })
      )
    })

    it('should process blocks sequentially', async () => {
      const onBlock = vi.fn()
      const onTx = vi.fn()
      const blockHeights: number[] = []
      const txHeights: number[] = []

      onBlock.mockImplementation((block: Header) => {
        blockHeights.push(block.height)
      })

      onTx.mockImplementation((_: TxData, block: Header) => {
        txHeights.push(block.height)
      })

      // Start processing
      const iteratePromise = blockIterator.iterate({
        onBlock,
        onTx,
      })

      await sendBlockPastEndHeight()

      await iteratePromise

      // Should process blocks in order
      expect(blockHeights.length).toBeGreaterThan(0)
      for (let i = 1; i < blockHeights.length; i++) {
        expect(blockHeights[i]).toBe(blockHeights[i - 1] + 1)
      }

      // Should process transactions in order, either part of the past block or
      // a new one.
      expect(txHeights.length).toBeGreaterThan(0)
      for (let i = 1; i < txHeights.length; i++) {
        expect(txHeights[i]).toBeOneOf([txHeights[i - 1], txHeights[i - 1] + 1])
      }
    })

    it('should handle block-level errors', async () => {
      const onBlock = vi.fn()
      const onError = vi.fn()

      // Mock block fetch failure
      mockGetBlock.mockRejectedValue(new Error('Block fetch failed'))

      const iterator = new BlockIterator({
        rpcUrl: 'http://localhost:26657',
        autoCosmWasmClient: mockAutoCosmWasmClient,
        startHeight: 100,
        endHeight: 102,
        bufferSize: 2,
      })

      // Start processing
      const iteratePromise = iterator.iterate({
        onBlock,
        onError,
      })

      await sendBlockPastEndHeight()

      await expect(iteratePromise).rejects.toThrow('Block fetch failed')

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          type: BlockIteratorErrorType.Block,
          cause: expect.objectContaining({
            message: 'Block fetch failed',
          }),
          blockHeight: 100,
        })
      )
    })

    it('should handle block results-level errors', async () => {
      const onBlock = vi.fn()
      const onError = vi.fn()

      // Mock block fetch failure
      mockGetBlockResults.mockRejectedValue(
        new Error('Block results fetch failed')
      )

      const iterator = new BlockIterator({
        rpcUrl: 'http://localhost:26657',
        autoCosmWasmClient: mockAutoCosmWasmClient,
        startHeight: 100,
        endHeight: 102,
        bufferSize: 2,
      })

      // Start processing
      const iteratePromise = iterator.iterate({
        onBlock,
        onError,
      })

      await sendBlockPastEndHeight()

      await expect(iteratePromise).rejects.toThrow('Block results fetch failed')

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          type: BlockIteratorErrorType.Block,
          cause: expect.objectContaining({
            message: 'Block results fetch failed',
          }),
          blockHeight: 100,
        })
      )
    })

    it('should handle transaction-level errors', async () => {
      const onBlock = vi.fn()
      const onTx = vi.fn()
      const onError = vi.fn()

      mockTxDecode.mockImplementation(() => {
        throw new Error('TX decoding failed')
      })

      const iterator = new BlockIterator({
        rpcUrl: 'http://localhost:26657',
        autoCosmWasmClient: mockAutoCosmWasmClient,
        startHeight: 100,
        endHeight: 102,
        bufferSize: 2,
      })

      // Start processing
      const iteratePromise = iterator.iterate({
        onBlock,
        onTx,
        onError,
      })

      await sendBlockPastEndHeight()

      await expect(iteratePromise).rejects.toThrow('TX decoding failed')

      // Block should still be processed
      expect(onBlock).toHaveBeenCalled()
      expect(onTx).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          type: BlockIteratorErrorType.Tx,
          cause: expect.objectContaining({
            message: 'TX decoding failed',
          }),
          blockHeight: 100,
          txHash: expect.any(String),
        })
      )
    })

    it('should retry when block height is too high', async () => {
      const onBlock = vi.fn()
      let callCount = 0

      mockGetBlock.mockImplementation((height: number) => {
        callCount++
        if (callCount === 1) {
          // First call fails with height too high error
          throw new Error(
            'must be less than or equal to the current blockchain height'
          )
        }
        // Second call succeeds
        return Promise.resolve(createMockBlock(height))
      })

      const iterator = new BlockIterator({
        rpcUrl: 'http://localhost:26657',
        autoCosmWasmClient: mockAutoCosmWasmClient,
        startHeight: 100,
        endHeight: 101,
        bufferSize: 2,
      })

      // Start processing
      const iteratePromise = iterator.iterate({
        onBlock,
      })

      await sendBlockPastEndHeight()

      await iteratePromise

      expect(callCount).toBeGreaterThan(1) // Should have retried
      expect(onBlock).toHaveBeenCalled() // Should eventually succeed
    })

    it('should stop when end height is reached', async () => {
      const onBlock = vi.fn()
      const blockHeights: number[] = []

      onBlock.mockImplementation((block: Header) => {
        blockHeights.push(block.height)
      })

      const iterator = new BlockIterator({
        rpcUrl: 'http://localhost:26657',
        autoCosmWasmClient: mockAutoCosmWasmClient,
        startHeight: 100,
        endHeight: 103, // Limited range
        bufferSize: 2,
      })

      const iteratePromise = iterator.iterate({
        onBlock,
      })

      await sendBlockPastEndHeight()

      await iteratePromise

      // Should process blocks 100, 101, 102, 103
      expect(blockHeights).toEqual([100, 101, 102, 103])
    })
  })

  describe('stopFetching', () => {
    it('should stop the iterator', async () => {
      const onBlock = vi.fn()

      const iterator = new BlockIterator({
        rpcUrl: 'http://localhost:26657',
        autoCosmWasmClient: mockAutoCosmWasmClient,
        startHeight: 100,
        bufferSize: 2,
      })

      // Start processing
      const iteratePromise = iterator.iterate({
        onBlock,
      })

      await sendBlockPastEndHeight()

      // Stop immediately
      iterator.stopFetching()

      await iteratePromise

      // Should complete without processing many blocks
      expect(onBlock).toHaveBeenCalledTimes(0) // May not process any blocks if stopped quickly
    })
  })
})
