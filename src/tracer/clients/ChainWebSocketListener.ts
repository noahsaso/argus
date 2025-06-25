import * as Sentry from '@sentry/node'
import waitPort from 'wait-port'
import { WebSocket } from 'ws'

import { State } from '@/db'
import { objectMatchesStructure } from '@/utils'

export type BlockHeader = {
  chain_id: string
  height: string
  time: string
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
   * Whether or not the WebSocket is disconnecting.
   */
  private disconnecting = false

  /**
   * New block callback.
   */
  private _onNewBlock: ((block: BlockHeader) => void | Promise<void>) | null =
    null

  constructor(
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
   * Whether or not the WebSocket is connected.
   */
  get connected() {
    return this._connected
  }

  /**
   * Connect to the WebSocket if not already connected.
   */
  async connect() {
    if (this.webSocket) {
      return
    }

    // Connect to local RPC WebSocket once ready. We need to read from the trace
    // as the server is starting but not start processing the queue until the
    // WebSocket block listener has connected. This is because the trace blocks
    // the server from starting, but we can only listen for new blocks once the
    // WebSocket is connected at some point after the server has started. We
    // have to read from the trace to allow the server to start up.
    const { open } = await waitPort({
      host: 'localhost',
      port: 26657,
      output: 'silent',
    })

    if (!open) {
      console.error(
        'Failed to connect to local RPC WebSocket. Queries may be slower as block times will be fetched from a remote RPC.'
      )

      Sentry.captureMessage(
        'Failed to connect to local RPC WebSocket (not open).',
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

      return
    }

    // Get new-block WebSocket.
    this.webSocket = new WebSocket(
      this.rpc.replace(/^http/, 'ws') + '/websocket'
    )

    this.webSocket.on('open', () => {
      // Subscribe to new blocks.
      this.webSocket?.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'subscribe',
          id: 1,
          params: ["tm.event = 'NewBlock'"],
        })
      )

      this._connected = true
      console.log(`[${new Date().toISOString()}] WebSocket connected.`)
    })

    // Listen for new blocks.
    this.webSocket.on('message', async (data) => {
      try {
        const { result } = JSON.parse(data.toString())
        if (
          !objectMatchesStructure(result, {
            data: {
              value: {
                block: {
                  header: {
                    chain_id: {},
                    height: {},
                    time: {},
                  },
                },
              },
            },
          })
        ) {
          return
        }

        // Execute callback with block data.
        await this._onNewBlock?.(result.data.value.block.header)
      } catch (error) {
        console.error(
          `[${new Date().toISOString()}] Error parsing WebSocket new block message or callback:`,
          error
        )
      }
    })

    // Log error and ignore.
    this.webSocket.on('error', async (error) => {
      // If already disconnected, do nothing.
      if (!this.connected) {
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

      setTimeout(this.connect, 1_000)
    })

    this.webSocket.on('close', () => {
      // If already disconnected, do nothing.
      if (!this.connected) {
        return
      }

      this.disconnect()

      // On close and not disconnecting, reconnect.
      console.error(
        `[${new Date().toISOString()}] WebSocket closed, reconnecting in 1 second...`
      )

      setTimeout(this.connect, 1_000)
    })
  }

  disconnect() {
    if (!this.webSocket) {
      return
    }

    this.disconnecting = true
    this._connected = false
    this.webSocket.terminate()
    this.webSocket = null
    this.disconnecting = false
  }
}
