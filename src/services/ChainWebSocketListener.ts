import { sha256 } from '@cosmjs/crypto'
import { fromBase64, toHex } from '@cosmjs/encoding'
import * as Sentry from '@sentry/node'
import waitPort from 'wait-port'
import { WebSocket } from 'ws'

import { State } from '@/db'
import { objectMatchesStructure } from '@/utils'

export type WebSocketMessage<
  Type extends string = string,
  Value = any,
  ExtraResult = {}
> = {
  jsonrpc: string
  id: number
  result: {
    query: string
    data: {
      type: Type
      value: Value
    }
  } & ExtraResult
}

export type NewBlockMessage = WebSocketMessage<
  'tendermint/event/NewBlock',
  {
    block: {
      header: BlockHeader
    }
  }
>

export type BlockHeader = {
  chain_id: string
  height: string
  time: string
}

export type TxMessage = WebSocketMessage<
  'tendermint/event/Tx',
  {
    TxResult: TxResult
  },
  {
    events: Record<string, string[]>
  }
>

export type TxResult = {
  height: string // block height
  tx: string // base64-encoded transaction bytes
  result: {
    data: string // base64-encoded response data bytes
    gas_wanted: string // gas requested
    gas_used: string // gas actually used
    events: {
      type: string // event type/category
      attributes: {
        key: string // base64 or UTF-8 string
        value: string // base64 or UTF-8 string
        index?: boolean // optional index flag
      }[] // list of attributes
    }[] // list of events emitted
  }
}

export type EventType = 'NewBlock' | 'Tx'

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export type ConnectionEvent = {
  state: ConnectionState
  isReconnection: boolean
  attempt?: number
  error?: Error
}

/**
 * A listener for events from the local node's WebSocket.
 */
export class ChainWebSocketListener {
  /**
   * The RPC URL.
   */
  private readonly rpc: string

  /**
   * The WebSocket.
   */
  private webSocket: WebSocket | null = null

  /**
   * Whether or not the WebSocket is connected.
   */
  private _connected = false

  /**
   * Whether the listener is actively trying to connect or reconnect.
   */
  private _connecting = false

  /**
   * Current reconnection attempt number.
   */
  private _reconnectAttempt = 0

  /**
   * Maximum reconnection delay in milliseconds.
   */
  private readonly _maxReconnectDelay = 30_000 // 30 seconds

  /**
   * Whether continuous reconnection is enabled.
   */
  private _shouldReconnect = true

  /**
   * New block callback.
   */
  private _onNewBlock: ((block: BlockHeader) => void | Promise<void>) | null =
    null

  /**
   * Transaction callback.
   */
  private _onTx: ((hash: string, tx: TxResult) => void | Promise<void>) | null =
    null

  /**
   * Connection state callback.
   */
  private _onConnectionStateChange:
    | ((event: ConnectionEvent) => void | Promise<void>)
    | null = null

  constructor(
    /**
     * Event type(s) to subscribe to.
     */
    public readonly eventTypes: EventType | EventType[],
    /**
     * Options.
     */
    options: {
      /**
       * The RPC URL. Defaults to `http://127.0.0.1:26657`.
       */
      rpc?: string
    } = {}
  ) {
    this.rpc = options.rpc ?? 'http://127.0.0.1:26657'
  }

  /**
   * Set the new block callback.
   */
  onNewBlock(onNewBlock: (block: BlockHeader) => void | Promise<void>) {
    this._onNewBlock = onNewBlock
  }

  /**
   * Set the transaction callback.
   */
  onTx(onTx: (hash: string, tx: TxResult) => void | Promise<void>) {
    this._onTx = onTx
  }

  /**
   * Set the connection state change callback.
   */
  onConnectionStateChange(
    onConnectionStateChange: (event: ConnectionEvent) => void | Promise<void>
  ) {
    this._onConnectionStateChange = onConnectionStateChange
  }

  /**
   * Whether or not the WebSocket is connected.
   */
  get connected() {
    return this._connected
  }

  /**
   * Whether the listener is actively trying to connect.
   */
  get connecting() {
    return this._connecting
  }

  /**
   * Calculate reconnection delay with exponential backoff.
   */
  private get _reconnectDelay() {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
    const delay = Math.min(
      1000 * Math.pow(2, this._reconnectAttempt - 1),
      this._maxReconnectDelay
    )
    return delay
  }

  /**
   * Connect to the WebSocket if not already connected or connecting.
   */
  async connect({
    skipWait = false,
    timeoutMs = 10_000,
    continuousReconnect = true,
  }: {
    /**
     * Whether or not to skip waiting for the WebSocket port to be open. This is
     * likely only useful on local RPCs bound to a local port.
     *
     * Defaults to `false`.
     */
    skipWait?: boolean
    /**
     * The timeout in milliseconds for the connection attempt.
     *
     * Defaults to 10 seconds.
     */
    timeoutMs?: number
    /**
     * Whether to continuously attempt reconnection on failures.
     *
     * Defaults to `true`.
     */
    continuousReconnect?: boolean
  } = {}) {
    if (this.webSocket || this._connecting) {
      return
    }

    this._shouldReconnect = continuousReconnect

    return this._attemptConnection({ skipWait, timeoutMs })
  }

  /**
   * Internal method to attempt a single connection with retry logic.
   */
  private async _attemptConnection({
    skipWait = false,
    timeoutMs = 10_000,
  }: {
    skipWait?: boolean
    timeoutMs?: number
  }): Promise<void> {
    if (this.webSocket || this._connecting) {
      return
    }

    this._connecting = true

    // Emit connecting state
    await this._emitConnectionEvent({
      state: 'connecting',
      isReconnection: this._reconnectAttempt > 0,
      attempt: this._reconnectAttempt,
    })

    while (this._connecting) {
      try {
        await this._singleConnectionAttempt({ skipWait, timeoutMs })
        // If we get here, connection was successful
        this._reconnectAttempt = 0
        this._connecting = false
        return
      } catch (error) {
        if (!this._shouldReconnect) {
          // Emit error state
          await this._emitConnectionEvent({
            state: 'error',
            isReconnection: false,
            error:
              error instanceof Error
                ? error
                : new Error(String(error || 'Unknown error')),
          })

          this._connecting = false
          throw error
        }

        this._reconnectAttempt++

        console.error(
          `[${new Date().toISOString()}] WebSocket connection attempt ${
            this._reconnectAttempt
          } failed, retrying in ${this._reconnectDelay / 1000}s...`,
          error
        )

        Sentry.captureException(error, {
          tags: {
            type: 'websocket-connection-failed',
            script: 'export',
            attempt: this._reconnectAttempt,
            chainId:
              (await State.getSingleton().catch(() => null))?.chainId ??
              'unknown',
          },
        })

        // Emit error state
        await this._emitConnectionEvent({
          state: 'error',
          isReconnection: true,
          error:
            error instanceof Error
              ? error
              : new Error(String(error || 'Unknown error')),
          attempt: this._reconnectAttempt,
        })

        // Wait before retrying
        await new Promise((resolve) =>
          setTimeout(resolve, this._reconnectDelay)
        )
      }
    }

    this._connecting = false
  }

  /**
   * Attempt a single WebSocket connection.
   */
  private async _singleConnectionAttempt({
    skipWait = false,
    timeoutMs = 10_000,
  }: {
    skipWait?: boolean
    timeoutMs?: number
  }): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      // Set up a timeout for the connection attempt
      const connectionTimeout = setTimeout(() => {
        console.error(
          `[${new Date().toISOString()}] WebSocket connection timeout after ${timeoutMs.toLocaleString()}ms`
        )
        reject(new Error('WebSocket connection timeout'))
      }, timeoutMs)

      const cleanup = () => {
        clearTimeout(connectionTimeout)
      }

      // Connect to local RPC WebSocket once ready. We need to read from the
      // trace as the server is starting but not start processing the queue
      // until the WebSocket block listener has connected. This is because the
      // trace blocks the server from starting, but we can only listen for new
      // blocks once the WebSocket is connected at some point after the server
      // has started. We have to read from the trace to allow the server to
      // start up.
      if (!skipWait) {
        console.log(
          `[${new Date().toISOString()}] Waiting for port to be available...`
        )
        const url = new URL(this.rpc)
        const { open } = await waitPort({
          host: url.hostname,
          port: url.port
            ? Number(url.port)
            : url.protocol === 'https:'
            ? 443
            : 80,
          output: 'silent',
        })

        if (!open) {
          console.error('Failed to connect to RPC WebSocket.')

          Sentry.captureMessage(
            'Failed to connect to RPC WebSocket (not open).',
            {
              tags: {
                type: 'failed-websocket-connection',
                script: 'export',
                chainId:
                  (await State.getSingleton().catch(() => null))?.chainId ??
                  'unknown',
              },
            }
          )

          cleanup()
          return reject(new Error('Failed to connect to RPC WebSocket.'))
        }
      }

      // Create WebSocket.
      this.webSocket = new WebSocket(
        this.rpc.replace(/^http/, 'ws') + '/websocket'
      )

      this.webSocket.onopen = () => {
        cleanup()
        this._connected = true

        // Emit connected state
        this._emitConnectionEvent({
          state: 'connected',
          isReconnection: this._reconnectAttempt > 0,
          attempt: this._reconnectAttempt,
        })

        // Subscribe to all event types.
        const types = [this.eventTypes].flat()
        types.forEach((type) =>
          this.webSocket?.send(
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'subscribe',
              id: 1,
              params: {
                query: `tm.event = '${type}'`,
              },
            })
          )
        )

        console.log(`[${new Date().toISOString()}] WebSocket connected.`)

        resolve()
      }

      // Listen for new blocks.
      this.webSocket.onmessage = async ({ data }) => {
        try {
          const msg = JSON.parse(data.toString()) as WebSocketMessage
          // Ignore empty messages, such as the subscription confirmation.
          if (
            !objectMatchesStructure(msg, {
              result: {
                data: {
                  type: {},
                },
              },
            })
          ) {
            return
          }

          switch (msg.result.data.type) {
            case 'tendermint/event/NewBlock':
              await this._onNewBlock?.(
                (msg as NewBlockMessage).result.data.value.block.header
              )
              break
            case 'tendermint/event/Tx':
              const result = (msg as TxMessage).result.data.value.TxResult
              const hash = toHex(sha256(fromBase64(result.tx))).toUpperCase()
              await this._onTx?.(hash, result)
              break
            default:
              console.error(
                `[${new Date().toISOString()}] Unknown WebSocket message type: ${
                  msg.result.data.type
                }`
              )
              break
          }
        } catch (error) {
          console.error(
            `[${new Date().toISOString()}] Error parsing WebSocket message or callback:`,
            error
          )
        }
      }

      // Log error and handle reconnection.
      this.webSocket.onerror = async ({ error }) => {
        cleanup()

        // If we're in the middle of initial connection, reject connection
        // attempt so it retries or fails if retry is disabled.
        if (!this._connected) {
          reject(
            error instanceof Error
              ? error
              : new Error(String(error || 'Unknown error'))
          )
          return
        }

        // If we were connected and then errored, maybe initiate reconnection.

        // Reset connection state.
        this._connected = false
        this.webSocket?.close()
        this.webSocket = null

        console.error(
          `[${new Date().toISOString()}] WebSocket errored, will reconnect...`,
          error
        )

        // Emit error state
        await this._emitConnectionEvent({
          state: 'error',
          isReconnection: this._shouldReconnect,
          error:
            error instanceof Error
              ? error
              : new Error(String(error || 'Unknown error')),
        })

        // Reconnect if enabled
        if (this._shouldReconnect) {
          this._reconnectAttempt++
          setTimeout(
            () => this._attemptConnection({ skipWait, timeoutMs }),
            1_000
          )
        }
      }

      this.webSocket.onclose = ({ code, reason }) => {
        cleanup()

        // If we're in the middle of initial connection, reject connection
        // attempt so it retries or fails if retry is disabled.
        if (!this._connected) {
          reject(
            new Error(
              `WebSocket closed during connection attempt: code=${code} reason=${
                reason || '<empty>'
              }`
            )
          )
          return
        }

        // If we were connected and then closed, maybe initiate reconnection.

        // Reset connection state.
        this._connected = false
        this.webSocket = null

        console.error(
          `[${new Date().toISOString()}] WebSocket closed (code=${code} reason=${
            reason || '<empty>'
          }), will reconnect...`
        )

        // Emit disconnected state
        this._emitConnectionEvent({
          state: 'disconnected',
          isReconnection: this._shouldReconnect,
        })

        // Reconnect if enabled
        if (this._shouldReconnect) {
          this._reconnectAttempt++
          setTimeout(
            () => this._attemptConnection({ skipWait, timeoutMs }),
            1_000
          )
        }
      }
    })
  }

  /**
   * Emit a connection state change event.
   */
  private async _emitConnectionEvent(event: ConnectionEvent) {
    try {
      await this._onConnectionStateChange?.(event)
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error in connection state callback:`,
        error
      )
    }
  }

  /**
   * Disconnect from the WebSocket and stop reconnection attempts.
   */
  disconnect() {
    this._shouldReconnect = false

    if (!this.webSocket) {
      return
    }

    this._connected = false
    this.webSocket.close()
    this.webSocket = null

    // Emit disconnected state for manual disconnection
    this._emitConnectionEvent({
      state: 'disconnected',
      isReconnection: false,
    })
  }
}
