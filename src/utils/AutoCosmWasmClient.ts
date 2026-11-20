import { Contract, CosmWasmClient } from '@cosmjs/cosmwasm-stargate'
import { QueryClient, createProtobufRpcClient } from '@cosmjs/stargate'
import { QueryContractInfoRequest } from 'cosmjs-types/cosmwasm/wasm/v1/query'
import { ContractInfo } from 'cosmjs-types/cosmwasm/wasm/v1/types'

import { retry } from './misc'
import {
  BackoffOptions,
  getBackoffDelayMs,
  isTransientRpcError,
} from './transient'

export type AutoCosmWasmClientConnectRetryOptions = BackoffOptions & {
  /**
   * Stop retrying transient connection errors after this long and leave the
   * client disconnected. Default 10 minutes.
   */
  maxDurationMs?: number
  /**
   * Log a warning on each failed attempt once connecting has taken this long.
   * Default 1 minute.
   */
  warnAfterMs?: number
}

export type AutoCosmWasmClientOptions = {
  /**
   * Retry client creation with exponential backoff when it fails with a
   * transient RPC error (HTTP 5xx, timeouts, connection resets). When not set,
   * a failed connection attempt leaves the client disconnected right away.
   */
  connectRetry?: AutoCosmWasmClientConnectRetryOptions
}

/**
 * A CosmWasmClient wrapper that automatically validates and revalidates the
 * client connection every `retryDelayMs`.
 */
export class AutoCosmWasmClient {
  private _chainId: string | undefined
  private _cosmWasmClient: CosmWasmClient | undefined
  private interval: NodeJS.Timeout | undefined
  /**
   * The update in progress, shared by concurrent callers so that only one
   * connection attempt (and retry loop) runs at a time.
   */
  private updating: Promise<void> | undefined
  /**
   * The error from the most recent failed connection attempt.
   */
  private lastConnectError: unknown

  constructor(
    private rpc: string,
    private retryDelayMs: number = 5 * 60 * 1_000,
    private options: AutoCosmWasmClientOptions = {}
  ) {
    this.start()
  }

  static async create(
    rpc: string,
    retryDelayMs: number = 5 * 60 * 1_000,
    options: AutoCosmWasmClientOptions = {}
  ): Promise<AutoCosmWasmClient> {
    const client = new AutoCosmWasmClient(rpc, retryDelayMs, options)
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
    if (!this.updating) {
      this.updating = this._update().finally(() => {
        this.updating = undefined
      })
    }
    return this.updating
  }

  private async _update(): Promise<void> {
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
      await this.connect()
    }
  }

  /**
   * Create the client, retrying transient errors with backoff if enabled.
   */
  private async connect(): Promise<void> {
    const { connectRetry } = this.options
    const {
      maxDurationMs = 10 * 60 * 1_000,
      warnAfterMs = 60 * 1_000,
      ...backoff
    } = connectRetry || {}
    const startedAt = Date.now()

    for (let attempt = 1; ; attempt++) {
      try {
        const client = await CosmWasmClient.connect(this.rpc)
        this._chainId = await client.getChainId()
        this._cosmWasmClient = client
        this.lastConnectError = undefined

        if (attempt > 1) {
          console.log(
            `[${new Date().toISOString()}] Connected CosmWasm client for RPC ${
              this.rpc
            } after ${attempt} attempts.`
          )
        }
        return
      } catch (err) {
        this.lastConnectError = err
        this._cosmWasmClient = undefined
        this._chainId = undefined

        const elapsedMs = Date.now() - startedAt
        if (
          !connectRetry ||
          !isTransientRpcError(err) ||
          elapsedMs >= maxDurationMs
        ) {
          console.error(
            `Failed to create CosmWasm client for RPC ${this.rpc}${
              attempt > 1 ? ` after ${attempt} attempts` : ''
            }.`,
            err
          )
          return
        }

        const delayMs = Math.min(
          getBackoffDelayMs(attempt, backoff),
          maxDurationMs - elapsedMs
        )
        const log = elapsedMs >= warnAfterMs ? console.warn : console.log
        log(
          `[${new Date().toISOString()}] Failed to create CosmWasm client for RPC ${
            this.rpc
          } (attempt ${attempt}, ${Math.round(
            elapsedMs / 1_000
          )}s so far), retrying in ${delayMs}ms: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }

  get client(): CosmWasmClient | undefined {
    return (
      this._cosmWasmClient &&
      new Proxy(this._cosmWasmClient, {
        get(target, prop) {
          let value = Reflect.get(target, prop, target)

          // Make sure to call functions with original target since query client
          // has private fields it needs to access.
          if (typeof value === 'function') {
            value = value.bind(target)

            // Pass a function to track the dependency to `fetchQuery`, which is
            // patched to call if it exists.
            if (prop === 'getContract') {
              return async (address: string): Promise<Contract> => {
                try {
                  return await value(address)
                } catch (err) {
                  // If contractInfo incomplete error (Terra Classic), fallback
                  // to direct ContractInfo decoding.
                  if (
                    err instanceof Error &&
                    err.message === 'contractInfo incomplete'
                  ) {
                    const cometClient = target['forceGetCometClient']()
                    const rpc = createProtobufRpcClient(
                      new QueryClient(cometClient)
                    )
                    const response = ContractInfo.decode(
                      await rpc.request(
                        'cosmwasm.wasm.v1.Query',
                        'ContractInfo',
                        QueryContractInfoRequest.encode({
                          address,
                        }).finish()
                      )
                    )
                    return {
                      address,
                      codeId: Number(response.codeId),
                      creator: response.creator,
                      admin: response.admin || undefined,
                      label: response.label,
                      ibcPortId: response.ibcPortId || undefined,
                    }
                  } else {
                    throw err
                  }
                }
              }
            }
          }

          return value
        },
      })
    )
  }

  get chainId(): string | undefined {
    return this._chainId
  }

  async getValidClient(): Promise<CosmWasmClient> {
    if (this._cosmWasmClient) {
      return this._cosmWasmClient
    }
    await this.update()
    if (!this._cosmWasmClient) {
      throw this.notConnectedError()
    }
    return this._cosmWasmClient
  }

  async getValidChainId(): Promise<string> {
    if (this._chainId) {
      return this._chainId
    }
    await this.update()
    if (!this._chainId) {
      throw this.notConnectedError()
    }
    return this._chainId
  }

  /**
   * The error thrown when the client is not connected. Its cause is the last
   * connection error, so callers can tell whether it was transient.
   */
  private notConnectedError(): Error {
    return new Error('CosmWasm client not connected', {
      cause: this.lastConnectError,
    })
  }
}
