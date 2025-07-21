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
   * New block callback.
   */
  private _onNewBlock: ((block: BlockHeader) => void | Promise<void>) | null =
    null

  /**
   * Transaction callback.
   */
  private _onTx: ((hash: string, tx: TxResult) => void | Promise<void>) | null =
    null

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
   * Whether or not the WebSocket is connected.
   */
  get connected() {
    return this._connected
  }

  /**
   * Connect to the WebSocket if not already connected.
   */
  async connect({
    skipWait = false,
    timeoutMs = 10_000,
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
  } = {}) {
    if (this.webSocket) {
      return
    }

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

      this.webSocket.on('open', () => {
        cleanup()
        resolve()

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

        this._connected = true
        console.log(`[${new Date().toISOString()}] WebSocket connected.`)
      })

      // Listen for new blocks.
      this.webSocket.on('message', async (data) => {
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
      })

      // Log error and ignore.
      this.webSocket.on('error', async (error) => {
        cleanup()

        // If already disconnected, do nothing.
        if (!this.connected) {
          // If this is the initial connection attempt, reject the promise
          reject(error)
          return
        }

        this.disconnect()

        // On error and not disconnecting, reconnect.
        console.error(
          `[${new Date().toISOString()}] WebSocket errored, reconnecting in 1 second...`,
          error
        )
        Sentry.captureException(error, {
          tags: {
            type: 'websocket-error',
            script: 'export',
            chainId:
              (await State.getSingleton().catch(() => null))?.chainId ??
              'unknown',
          },
        })

        // Reconnect.
        setTimeout(() => this.connect({ skipWait, timeoutMs }), 1_000)
      })

      this.webSocket.on('close', (code, reason) => {
        cleanup()

        // If already disconnected, do nothing.
        if (!this.connected) {
          // If this is the initial connection attempt, reject the promise
          reject(
            new Error(
              `WebSocket closed during connection attempt: ${code} ${reason}`
            )
          )
          return
        }

        this.disconnect()

        // On close and not disconnecting, reconnect.
        console.error(
          `[${new Date().toISOString()}] WebSocket closed, reconnecting in 1 second...`
        )

        // Reconnect.
        setTimeout(() => this.connect({ skipWait, timeoutMs }), 1_000)
      })
    })
  }

  disconnect() {
    if (!this.webSocket) {
      return
    }

    this._connected = false
    this.webSocket.terminate()
    this.webSocket = null
  }
}
