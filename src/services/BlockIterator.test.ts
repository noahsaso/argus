import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'
import { Block, IndexedTx } from '@cosmjs/stargate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WS from 'vitest-websocket-mock'

import { AutoCosmWasmClient } from '@/utils'

import { BlockIterator, BlockIteratorErrorType } from './BlockIterator'

describe('BlockIterator', () => {
  let mockAutoCosmWasmClient: AutoCosmWasmClient
  let mockClient: any
  let blockIterator: BlockIterator
  let mockServer: WS

  let txMap: Record<string, IndexedTx> = {}

  const createMockBlock = (height: number): Block => {
    const txs = [
      createMockTx(height, 0),
      createMockTx(height, 1),
      createMockTx(height, 2),
    ]

    txs.forEach((tx) => {
      txMap[tx.hash] = tx
    })

    return {
      id: `block-${height}`,
      header: {
        version: { block: '11', app: '0' },
        chainId: 'juno-1',
        height: height,
        time: new Date(1640995200000 + height * 1000).toISOString(),
      },
      txs: txs.map(({ tx }) => tx),
    }
  }

  const createMockTx = (height: number, index: number): IndexedTx => ({
    height: height,
    txIndex: index,
    hash: toHex(sha256(new Uint8Array([height, index]))).toUpperCase(),
    code: 0,
    events: [],
    rawLog: '',
    tx: new Uint8Array([height, index]),
    msgResponses: [],
    gasUsed: 100000n,
    gasWanted: 200000n,
  })

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

    mockClient = {
      forceGetCometClient: vi.fn(() => ({
        status: vi.fn().mockResolvedValue({
          syncInfo: {
            earliestBlockHeight: 1,
          },
        }),
      })),
      // Mock successful block and tx fetching
      getBlock: vi
        .fn()
        .mockImplementation((height: number) =>
          Promise.resolve(createMockBlock(height))
        ),
      getTx: vi
        .fn()
        .mockImplementation((hash: string) => Promise.resolve(txMap[hash])),
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

    it('should handle missing earliest block height', async () => {
      mockClient.forceGetCometClient.mockReturnValue({
        status: vi.fn().mockResolvedValue({
          syncInfo: {
            earliestBlockHeight: undefined,
          },
        }),
      })

      await expect(
        blockIterator.iterate({
          onBlock: vi.fn(),
        })
      ).rejects.toThrow('Earliest block height is not available')
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

      onBlock.mockImplementation((block: Block) => {
        blockHeights.push(block.header.height)
      })

      onTx.mockImplementation((tx: IndexedTx) => {
        txHeights.push(tx.height)
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
      mockClient.getBlock.mockRejectedValue(new Error('Block fetch failed'))

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

      await iteratePromise

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

    it('should handle transaction-level errors', async () => {
      const onBlock = vi.fn()
      const onTx = vi.fn()
      const onError = vi.fn()

      // Mock failing tx fetch
      mockClient.getTx.mockRejectedValue(new Error('Transaction fetch failed'))

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

      await iteratePromise

      // Block should still be processed
      expect(onBlock).toHaveBeenCalled()
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          type: BlockIteratorErrorType.Tx,
          cause: expect.objectContaining({
            message: 'Transaction fetch failed',
          }),
          blockHeight: 100,
          txHash: expect.any(String),
        })
      )
    })

    it('should retry when block height is too high', async () => {
      const onBlock = vi.fn()
      let callCount = 0

      mockClient.getBlock.mockImplementation((height: number) => {
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

      onBlock.mockImplementation((block: Block) => {
        blockHeights.push(block.header.height)
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

  describe('stopIterating', () => {
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
      iterator.stopIterating()

      await iteratePromise

      // Should complete without processing many blocks
      expect(onBlock).toHaveBeenCalledTimes(0) // May not process any blocks if stopped quickly
    })
  })
})
