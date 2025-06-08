import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate'
import { StargateClient } from '@cosmjs/stargate'
import {
  Comet38Client,
  HttpBatchClient,
  Tendermint34Client,
  Tendermint37Client,
  connectComet,
} from '@cosmjs/tendermint-rpc'

import { ConfigManager } from '@/config'

let stargateClient: Partial<Record<'remote' | 'local', StargateClient>> = {}
let lastRpc: Partial<Record<'remote' | 'local', string | undefined>> = {}

export const getStargateClient = async (
  type: 'remote' | 'local'
): Promise<StargateClient> => {
  if (!stargateClient[type]) {
    const config = ConfigManager.load()

    const rpc = type === 'remote' ? config.remoteRpc : config.localRpc
    if (!rpc) {
      throw new Error('RPC not configured')
    }

    stargateClient[type] = await StargateClient.connect(rpc)
    lastRpc[type] = rpc

    // Update the stargate client when the config changes.
    ConfigManager.instance.onChange(async (config) => {
      const newRpc = type === 'remote' ? config.remoteRpc : config.localRpc
      if (newRpc !== lastRpc[type]) {
        // Reset the stargate client if the RPC changes.
        lastRpc[type] = newRpc
        stargateClient[type] = undefined

        // Attempt to reconnect if the RPC is still configured. If this fails,
        // it should remain unset since it is no longer configured.
        if (newRpc) {
          stargateClient[type] = await StargateClient.connect(newRpc)
        }
      }
    })
  }

  return stargateClient[type]!
}

// Create CosmWasm client that batches requests.
export const getCosmWasmClient = async (
  rpc: string
): Promise<CosmWasmClient> => {
  const httpClient = new HttpBatchClient(rpc)
  const tmClient = await (
    (
      await connectComet(rpc)
    ).constructor as
      | typeof Tendermint34Client
      | typeof Tendermint37Client
      | typeof Comet38Client
  ).create(httpClient)
  // @ts-ignore
  return new CosmWasmClient(tmClient)
}
