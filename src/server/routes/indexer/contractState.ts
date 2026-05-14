import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate'
import { fromBech32 } from '@cosmjs/encoding'
import Router from '@koa/router'
import { DefaultContext, DefaultState } from 'koa'

import { ConfigManager } from '@/config'
import {
  dumpContractState,
  fetchContractStatePage,
} from '@/services/contract-state-dump'
import { Config } from '@/types'

const DEFAULT_PAGE_LIMIT = 1000
const MAX_PAGE_LIMIT = 5000

type RpcTarget = 'remote' | 'local'

type ContractStateResponse =
  | {
      chainId: string
      contractAddress: string
      rpc: RpcTarget
      count: number
      entries: { key: string; value: string }[]
    }
  | { error: string }

type ContractStateDeps = {
  loadConfig: () => Config
  connect: typeof CosmWasmClient.connect
  dump: typeof dumpContractState
  fetchPage: typeof fetchContractStatePage
}

const getQueryString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

export const createGetContractState = ({
  loadConfig,
  connect,
  dump,
  fetchPage,
}: ContractStateDeps): Router.Middleware<
  DefaultState,
  DefaultContext,
  ContractStateResponse
> => async (ctx) => {
  const config = loadConfig()
  const address = ctx.params.address

  try {
    const decoded = fromBech32(address)
    if (decoded.prefix !== config.bech32Prefix) {
      ctx.status = 400
      ctx.body = { error: `address prefix must be ${config.bech32Prefix}` }
      return
    }
  } catch {
    ctx.status = 400
    ctx.body = { error: 'invalid contract address' }
    return
  }

  const rpc = (getQueryString(ctx.query.rpc) || 'remote') as RpcTarget
  if (rpc !== 'remote' && rpc !== 'local') {
    ctx.status = 400
    ctx.body = { error: 'rpc must be remote or local' }
    return
  }

  const rpcUrl = rpc === 'remote' ? config.remoteRpc : config.localRpc
  if (!rpcUrl) {
    ctx.status = 400
    ctx.body = { error: `${rpc} RPC is not configured` }
    return
  }

  const pageLimit = Number(
    getQueryString(ctx.query.pageLimit) || DEFAULT_PAGE_LIMIT
  )
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > MAX_PAGE_LIMIT) {
    ctx.status = 400
    ctx.body = {
      error: `pageLimit must be an integer from 1 to ${MAX_PAGE_LIMIT}`,
    }
    return
  }

  try {
    const client = await connect(rpcUrl)
    const [chainId, stateDump] = await Promise.all([
      client.getChainId(),
      dump({
        address,
        pageLimit,
        fetchPage: fetchPage(client),
      }),
    ])

    ctx.status = 200
    ctx.body = {
      chainId,
      contractAddress: address,
      rpc,
      ...stateDump,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : `${err}`
    ctx.status = /not found|no contract/i.test(message) ? 404 : 502
    ctx.body = { error: message }
  }
}

export const getContractState = createGetContractState({
  loadConfig: () => ConfigManager.load(),
  connect: CosmWasmClient.connect,
  dump: dumpContractState,
  fetchPage: fetchContractStatePage,
})
