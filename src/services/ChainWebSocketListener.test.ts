import { beforeEach, describe, expect, it, vi } from 'vitest'
import WS from 'vitest-websocket-mock'

import {
  BlockHeader,
  ChainWebSocketListener,
  EventType,
  NewBlockMessage,
  TxMessage,
} from './ChainWebSocketListener'

const newListener = (eventType: EventType | EventType[]) =>
  new ChainWebSocketListener(eventType, {
    rpc: 'http://localhost:26657',
  })

describe('ChainWebSocketListener', () => {
  let onConnectionStateChange: ReturnType<typeof vi.fn>
  let listener: ChainWebSocketListener
  let mockServer: WS

  beforeEach(() => {
    // close sockets
    WS.clean()
    mockServer = new WS('ws://localhost:26657/websocket')

    listener = newListener('NewBlock')
    onConnectionStateChange = vi.fn()
    listener.onConnectionStateChange(onConnectionStateChange)
  })

  describe('constructor', () => {
    it('should initialize with single event type', () => {
      const singleListener = new ChainWebSocketListener('NewBlock')
      expect(singleListener.eventTypes).toBe('NewBlock')
    })

    it('should initialize with multiple event types', () => {
      const multiListener = new ChainWebSocketListener(['NewBlock', 'Tx'])
      expect(multiListener.eventTypes).toEqual(['NewBlock', 'Tx'])
    })

    it('should use default RPC URL', () => {
      const defaultListener = new ChainWebSocketListener('NewBlock')
      expect(defaultListener).toBeDefined()
    })
  })

  describe('callback setters', () => {
    it('should set new block callback', () => {
      const callback = vi.fn()
      listener.onNewBlock(callback)
      expect(listener['_onNewBlock']).toBe(callback)
    })

    it('should set transaction callback', () => {
      const callback = vi.fn()
      listener.onTx(callback)
      expect(listener['_onTx']).toBe(callback)
    })

    it('should set connection state change callback', () => {
      const callback = vi.fn()
      listener.onConnectionStateChange(callback)
      expect(listener['_onConnectionStateChange']).toBe(callback)
    })
  })

  describe('connection properties', () => {
    it('should report not connected initially', () => {
      expect(listener.connected).toBe(false)
      expect(listener.connecting).toBe(false)
    })
  })

  describe('connect', () => {
    it('should not connect if already connecting', async () => {
      // @ts-expect-error private
      const attemptConnectionSpy = vi.spyOn(listener, '_attemptConnection')

      listener['_connecting'] = true
      await listener.connect({ skipWait: true })

      expect(attemptConnectionSpy).not.toHaveBeenCalled()
    })

    it('should subscribe to single event type on connection', async () => {
      await listener.connect({ skipWait: true })

      await mockServer.connected

      expect(mockServer).toReceiveMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'subscribe',
          id: 1,
          params: {
            query: "tm.event = 'NewBlock'",
          },
        })
      )
    })

    it('should subscribe to multiple event types', async () => {
      const multiListener = newListener(['NewBlock', 'Tx'])
      await multiListener.connect({ skipWait: true })

      await mockServer.connected

      await expect(mockServer).toReceiveMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'subscribe',
          id: 1,
          params: {
            query: "tm.event = 'NewBlock'",
          },
        })
      )
      await expect(mockServer).toReceiveMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'subscribe',
          id: 1,
          params: {
            query: "tm.event = 'Tx'",
          },
        })
      )
    })

    it('should handle connection error', async () => {
      await listener.connect({ skipWait: true, continuousReconnect: false })

      await mockServer.connected

      await mockServer.error({
        code: 1000,
        reason: 'Connection failed',
        wasClean: false,
      })

      expect(listener.connected).toBe(false)
      expect(onConnectionStateChange).toHaveBeenCalledWith({
        state: 'error',
        isReconnection: false,
        error: expect.any(Error),
      })
    })
  })

  describe('message handling', () => {
    let onNewBlock: ReturnType<typeof vi.fn>
    let onTx: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      onNewBlock = vi.fn()
      onTx = vi.fn()

      listener.onNewBlock(onNewBlock)
      listener.onTx(onTx)

      await listener.connect({ skipWait: true })
    })

    it('should handle NewBlock messages', async () => {
      const blockHeader: BlockHeader = {
        chain_id: 'juno-1',
        height: '12345',
        time: '2022-01-01T00:00:00Z',
      }

      const newBlockMessage: NewBlockMessage = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          query: "tm.event = 'NewBlock'",
          data: {
            type: 'tendermint/event/NewBlock',
            value: {
              block: {
                header: blockHeader,
              },
            },
          },
        },
      }

      mockServer.send(JSON.stringify(newBlockMessage))
      expect(onNewBlock).toHaveBeenCalledWith(blockHeader)
    })

    it('should handle Tx messages', async () => {
      const txMessage: TxMessage = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          query: "tm.event = 'Tx'",
          data: {
            type: 'tendermint/event/Tx',
            value: {
              TxResult: {
                height: '12345',
                tx: Buffer.from('mock-tx-data').toString('base64'),
                result: {
                  data: '',
                  gas_wanted: '200000',
                  gas_used: '150000',
                  events: [],
                },
              },
            },
          },
          events: {},
        },
      }

      mockServer.send(JSON.stringify(txMessage))
      expect(onTx).toHaveBeenCalledWith(
        expect.any(String), // hash
        txMessage.result.data.value.TxResult
      )
    })

    it('should ignore empty messages', async () => {
      const emptyMessage = {
        jsonrpc: '2.0',
        id: 1,
        result: {},
      }

      mockServer.send(JSON.stringify(emptyMessage))

      expect(onNewBlock).not.toHaveBeenCalled()
      expect(onTx).not.toHaveBeenCalled()
    })

    it('should ignore subscription confirmation messages', async () => {
      const confirmationMessage = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          query: "tm.event = 'NewBlock'",
        },
      }

      mockServer.send(JSON.stringify(confirmationMessage))

      expect(onNewBlock).not.toHaveBeenCalled()
      expect(onTx).not.toHaveBeenCalled()
    })

    it('should handle unknown message types', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const unknownMessage = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          query: "tm.event = 'Unknown'",
          data: {
            type: 'tendermint/event/Unknown',
            value: {},
          },
        },
      }

      mockServer.send(JSON.stringify(unknownMessage))

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Unknown WebSocket message type: tendermint/event/Unknown'
        )
      )

      consoleSpy.mockRestore()
    })

    it('should handle malformed JSON messages', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockServer.send('invalid json')

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error parsing WebSocket message'),
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })
  })

  describe('reconnection', () => {
    it('should emit connecting state', async () => {
      await listener.connect({ skipWait: true })

      // Should emit connecting state immediately
      expect(onConnectionStateChange).toHaveBeenNthCalledWith(1, {
        state: 'connecting',
        isReconnection: false,
        attempt: 0,
      })

      await mockServer.connected
    })

    it('should emit connected state on successful connection', async () => {
      await listener.connect({ skipWait: true })
      await mockServer.connected

      expect(onConnectionStateChange).toHaveBeenNthCalledWith(2, {
        state: 'connected',
        isReconnection: false,
        attempt: 0,
      })
    })

    it('should emit error state on error', async () => {
      await listener.connect({ skipWait: true, continuousReconnect: false })
      await mockServer.connected

      await mockServer.error({
        code: 1000,
        reason: 'Some error',
        wasClean: false,
      })

      expect(onConnectionStateChange).toHaveBeenNthCalledWith(3, {
        state: 'error',
        isReconnection: false,
        error: expect.any(Error),
      })
    })

    it('should attempt reconnection on error when connected', async () => {
      await listener.connect({ skipWait: true })
      await mockServer.connected

      await mockServer.error({
        code: 1000,
        reason: 'Connection failed',
        wasClean: false,
      })

      await new Promise((resolve) => setTimeout(resolve, 1500))

      expect(onConnectionStateChange).toHaveBeenNthCalledWith(3, {
        state: 'error',
        isReconnection: true,
        error: expect.any(Error),
      })

      expect(onConnectionStateChange).toHaveBeenNthCalledWith(4, {
        state: 'connecting',
        isReconnection: true,
        attempt: 1,
      })
    })

    it('should emit disconnected state on close', async () => {
      await listener.connect({ skipWait: true })
      await mockServer.connected

      // Now simulate close after being connected
      await mockServer.close({
        code: 1000,
        reason: 'Normal closure',
        wasClean: true,
      })

      await new Promise((resolve) => setTimeout(resolve, 1500))

      expect(onConnectionStateChange).toHaveBeenNthCalledWith(3, {
        state: 'disconnected',
        isReconnection: true,
      })

      expect(onConnectionStateChange).toHaveBeenNthCalledWith(4, {
        state: 'connecting',
        isReconnection: true,
        attempt: 1,
      })
    })
  })

  describe('disconnect', () => {
    it('should disconnect and terminate WebSocket', async () => {
      await listener.connect({ skipWait: true })
      await mockServer.connected

      listener.disconnect()
      await mockServer.closed

      expect(listener.connected).toBe(false)
    })

    it('should not disconnect if no WebSocket exists', () => {
      expect(listener.connected).toBe(false)
      listener.disconnect()
      // Should not throw error
      expect(listener.connected).toBe(false)
    })

    it('should emit disconnected state on manual disconnect', async () => {
      await listener.connect({ skipWait: true })
      await mockServer.connected

      listener.disconnect()
      await mockServer.closed

      expect(onConnectionStateChange).toHaveBeenNthCalledWith(3, {
        state: 'disconnected',
        isReconnection: false,
      })
    })
  })

  describe('exponential backoff', () => {
    it('should calculate correct reconnection delays', () => {
      // Access private method for testing
      const getDelay = () => listener['_reconnectDelay']

      listener['_reconnectAttempt'] = 1
      expect(getDelay()).toBe(1000) // 1 second

      listener['_reconnectAttempt'] = 2
      expect(getDelay()).toBe(2000) // 2 seconds

      listener['_reconnectAttempt'] = 3
      expect(getDelay()).toBe(4000) // 4 seconds

      listener['_reconnectAttempt'] = 10
      expect(getDelay()).toBe(30000) // Max 30 seconds
    })
  })
})
