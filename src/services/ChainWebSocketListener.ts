import * as net from 'net'

import { sha256 } from '@cosmjs/crypto'
import { fromBase64, toHex } from '@cosmjs/encoding'
import * as Sentry from '@sentry/node'
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
    code?: number
    log?: string
    codespace?: string
    data?: string // base64-encoded response data bytes
    gas_wanted?: string // gas requested
    gas_used?: string // gas actually used
    events?: {
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

  // Invalidate asynchronous work across disconnects and connection lifetimes.
  private _generation = 0
  private _cancelAttempt: (() => void) | null = null
  private _cancelRetry: (() => void) | null = null

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

    this._cancelRetry?.()
    this._cancelAttempt?.()
    const generation = ++this._generation
    this._connecting = true

    // Emit connecting state
    await this._emitConnectionEvent({
      state: 'connecting',
      isReconnection: this._reconnectAttempt > 0,
      attempt: this._reconnectAttempt,
    })

    while (this._connecting && generation === this._generation) {
      try {
        await this._singleConnectionAttempt({ skipWait, timeoutMs })
        if (generation !== this._generation) return
        // If we get here, connection was successful
        this._reconnectAttempt = 0
        this._connecting = false
        return
      } catch (error) {
        if (generation !== this._generation) return
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

          if (generation !== this._generation) return
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

        if (generation !== this._generation) return

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
        if (generation !== this._generation) return
        await this._waitBeforeRetry(this._reconnectDelay)
      }
    }

    if (generation === this._generation) this._connecting = false
  }

  /**
   * A cancellable delay also settles its waiter when disconnected.
   */
  private _waitBeforeRetry(delay: number): Promise<void> {
    this._cancelRetry?.()
    return new Promise((resolve) => {
      const cancel = () => {
        clearTimeout(timer)
        if (this._cancelRetry === cancel) this._cancelRetry = null
        resolve()
      }
      const timer = setTimeout(cancel, delay)
      this._cancelRetry = cancel
    })
  }

  /**
   * Detach application callbacks before closing. ws may emit an asynchronous
   * error when terminating a CONNECTING socket, so consume it until close.
   */
  private _closeSocket(socket: WebSocket) {
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null
    if (socket.readyState === WebSocket.CLOSED) return
    const ignoreError = () => {}
    const onClose = () => {
      socket.removeEventListener('error', ignoreError)
      socket.removeEventListener('close', onClose)
    }
    socket.addEventListener('error', ignoreError)
    socket.addEventListener('close', onClose)
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate()
    else socket.close()
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
    this._cancelAttempt?.()
    const generation = this._generation
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let socket: WebSocket | null = null
      let probe: net.Socket | null = null
      let portTimer: ReturnType<typeof setTimeout> | undefined

      const stopProbe = () => {
        clearTimeout(portTimer)
        if (probe) {
          probe.removeAllListeners('connect')
          probe.removeAllListeners('error')
          // A failed connect may already have queued an error event.
          const closingProbe = probe
          const ignoreError = () => {}
          closingProbe.on('error', ignoreError)
          closingProbe.once('close', () =>
            closingProbe.removeListener('error', ignoreError)
          )
          closingProbe.destroy()
          probe = null
        }
      }
      const cleanup = () => {
        clearTimeout(connectionTimeout)
        stopProbe()
        if (this._cancelAttempt === cancel) this._cancelAttempt = null
      }
      const active = () =>
        generation === this._generation && this.webSocket === socket
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        if (socket) {
          if (this.webSocket === socket) this.webSocket = null
          this._closeSocket(socket)
        }
        reject(error)
      }
      const cancel = () => fail(new Error('WebSocket connection cancelled'))
      this._cancelAttempt = cancel
      const connectionTimeout = setTimeout(
        () => fail(new Error('WebSocket connection timeout')),
        timeoutMs
      )

      const lostConnection = (
        state: 'error' | 'disconnected',
        error: Error
      ) => {
        if (!active()) return
        if (!settled) {
          fail(error)
          return
        }
        // Invalidate even saved callbacks before closing the owned socket.
        const nextGeneration = ++this._generation
        this._connected = false
        this._connecting = false
        this.webSocket = null
        this._closeSocket(socket!)
        if (this._shouldReconnect) {
          this._reconnectAttempt++
          this._waitBeforeRetry(1_000).then(() => {
            if (nextGeneration === this._generation && this._shouldReconnect) {
              this._attemptConnection({ skipWait, timeoutMs }).catch((error) =>
                console.error('WebSocket reconnection failed:', error)
              )
            }
          })
        }
        this._emitConnectionEvent({
          state,
          isReconnection: this._shouldReconnect,
          ...(state === 'error' ? { error } : {}),
        })
      }

      const createSocket = () => {
        if (settled || socket || generation !== this._generation) return
        stopProbe()
        try {
          socket = new WebSocket(this.rpc.replace(/^http/, 'ws') + '/websocket')
          this.webSocket = socket
          const ownedSocket = socket
          socket.onopen = () => {
            if (
              settled ||
              !active() ||
              ownedSocket.readyState !== WebSocket.OPEN
            )
              return
            try {
              // Never send through the mutable shared socket field.
              for (const type of [this.eventTypes].flat()) {
                ownedSocket.send(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'subscribe',
                    id: 1,
                    params: { query: `tm.event = '${type}'` },
                  })
                )
              }
            } catch (error) {
              fail(error instanceof Error ? error : new Error(String(error)))
              return
            }
            settled = true
            cleanup()
            this._connected = true
            resolve()
            this._emitConnectionEvent({
              state: 'connected',
              isReconnection: this._reconnectAttempt > 0,
              attempt: this._reconnectAttempt,
            })
            console.log(`[${new Date().toISOString()}] WebSocket connected.`)
          }

          // Listen for new blocks.
          socket.onmessage = async ({ data }) => {
            if (!active() || !this._connected) return
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
                  const hash = toHex(
                    sha256(fromBase64(result.tx))
                  ).toUpperCase()
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

          socket.onerror = ({ error }) =>
            lostConnection(
              'error',
              error instanceof Error
                ? error
                : new Error(String(error || 'Unknown error'))
            )
          socket.onclose = ({ code, reason }) =>
            lostConnection(
              'disconnected',
              new Error(
                `WebSocket closed during connection attempt: code=${code} reason=${
                  reason || '<empty>'
                }`
              )
            )
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
        }
      }

      // wait-port has no cancellation API. Own each TCP probe and its retry
      // timer instead, retaining its one-second probe/poll intervals and
      // IPv4-then-IPv6 fallback for hostnames. No settled wait can create a WS.
      if (skipWait) {
        createSocket()
      } else {
        try {
          console.log(
            `[${new Date().toISOString()}] Waiting for port to be available...`
          )
          const url = new URL(this.rpc)
          const host = url.hostname.replace(/^\[|\]$/g, '')
          const port = url.port
            ? Number(url.port)
            : url.protocol === 'https:'
            ? 443
            : 80
          const probePort = (family = net.isIP(host) === 6 ? 6 : 4) => {
            if (settled || generation !== this._generation) return
            try {
              probe = net.createConnection({ host, port, family })
              const retry = (error?: NodeJS.ErrnoException) => {
                stopProbe()
                if (settled) return
                if (
                  error &&
                  family === 4 &&
                  !['ECONNREFUSED', 'ECONNRESET'].includes(error.code || '')
                ) {
                  fail(error)
                } else if (family === 4 && !net.isIP(host)) {
                  probePort(6)
                } else {
                  portTimer = setTimeout(probePort, 1_000)
                }
              }
              probe.once('connect', createSocket)
              probe.once('error', retry)
              portTimer = setTimeout(retry, 1_000)
            } catch (error) {
              fail(error instanceof Error ? error : new Error(String(error)))
            }
          }
          probePort()
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
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
    // Attempt cancellation may clear/close the socket before notification.
    const socket = this.webSocket
    this._shouldReconnect = false
    this._generation++
    this._connecting = false
    this._connected = false
    this._cancelRetry?.()
    this._cancelAttempt?.()

    if (!socket) return
    if (this.webSocket === socket) {
      this.webSocket = null
      this._closeSocket(socket)
    }

    // Emit disconnected state for manual disconnection
    this._emitConnectionEvent({
      state: 'disconnected',
      isReconnection: false,
    })
  }
}
