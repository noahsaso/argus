import { Contract, CosmWasmClient } from '@cosmjs/cosmwasm-stargate'
import { QueryClient, createProtobufRpcClient } from '@cosmjs/stargate'
import { QueryContractInfoRequest } from 'cosmjs-types/cosmwasm/wasm/v1/query'
import { ContractInfo } from 'cosmjs-types/cosmwasm/wasm/v1/types'

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
      throw new Error('CosmWasm client not connected')
    }
    return this._cosmWasmClient
  }

  async getValidChainId(): Promise<string> {
    if (this._chainId) {
      return this._chainId
    }
    await this.update()
    if (!this._chainId) {
      throw new Error('CosmWasm client not connected')
    }
    return this._chainId
  }
}
