import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate'

import { retry } from './misc'

/**
 * A CosmWasmClient wrapper that automatically validates and revalidates the
 * client connection every `retryDelayMs`.
 */
export class AutoCosmWasmClient {
  private _chainId: string | undefined
  private _cosmWasmClient: CosmWasmClient | undefined
  private interval: NodeJS.Timeout | undefined

  constructor(
    private rpc: string,
    private retryDelayMs: number = 5 * 60 * 1_000
  ) {
    this.start()
  }

  static async create(
    rpc: string,
    retryDelayMs: number = 5 * 60 * 1_000
  ): Promise<AutoCosmWasmClient> {
    const client = new AutoCosmWasmClient(rpc, retryDelayMs)
    await client.update()
    return client
  }

  start() {
    if (this.interval) {
      return
    }

    this.interval = setInterval(this.update.bind(this), this.retryDelayMs)
  }

  stop() {
    if (!this.interval) {
      return
    }

    clearInterval(this.interval)
    this.interval = undefined
  }

  async update(): Promise<void> {
    // If the client is already connected, validate the connection.
    if (this._cosmWasmClient) {
      try {
        await retry(3, () => this._cosmWasmClient?.getChainId(), 1_000)
      } catch (err) {
        console.error(
          `CosmWasm client for RPC ${this.rpc} failed connection test.`,
          err
        )
        this._cosmWasmClient = undefined
        this._chainId = undefined
      }
    }

    // If the client is not connected, attempt to create it.
    if (!this._cosmWasmClient) {
      this._cosmWasmClient = await CosmWasmClient.connect(this.rpc).catch(
        (err) => {
          console.error(
            `Failed to create CosmWasm client for RPC ${this.rpc}.`,
            err
          )
          return undefined
        }
      )
      if (this._cosmWasmClient) {
        this._chainId = await this._cosmWasmClient.getChainId()
      }
    }
  }

  get client(): CosmWasmClient | undefined {
    return this._cosmWasmClient
  }

  get chainId(): string | undefined {
    return this._chainId
  }
}
