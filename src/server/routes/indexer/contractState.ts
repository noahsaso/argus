import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate'
import { fromBech32 } from '@cosmjs/encoding'
import Router from '@koa/router'
import { DefaultContext, DefaultState } from 'koa'

import { ConfigManager } from '@/config'
import { fetchContractStatePage } from '@/services/contract-state-dump'
import {
  getRecoveryContractInfo,
  recoverContractState,
} from '@/services/contract-state-recovery'
import { Config } from '@/types'

const DEFAULT_PAGE_LIMIT = 1000
const MAX_PAGE_LIMIT = 5000

type RpcTarget = 'remote' | 'local'

type ContractStateResponse =
  | {
      chainId: string
      contractAddress: string
      rpc: RpcTarget
      blockHeight: string
      blockTimeUnixMs: string
      count: number
      events: number
      transformations: number
    }
  | { error: string }

type ContractStateDeps = {
  loadConfig: () => Config
  connect: typeof CosmWasmClient.connect
  recover: typeof recoverContractState
  fetchPage: typeof fetchContractStatePage
  getContractInfo: typeof getRecoveryContractInfo
}

const getQueryString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const isAuthorized = (authorization: string | undefined, password: string) => {
  const [type, credentials] = authorization?.split(' ') ?? []
  if (type !== 'Basic' || !credentials) {
    return false
  }

  const [name, pass] = Buffer.from(credentials, 'base64').toString().split(':')
  return name === 'exporter' && pass === password
}

const isRpcError = (message: string): boolean =>
  /rpc|query|network|timeout|connection|fetch|request/i.test(message)

export const createRecoverContractState =
  ({
    loadConfig,
    connect,
    recover,
    fetchPage,
    getContractInfo,
  }: ContractStateDeps): Router.Middleware<
    DefaultState,
    DefaultContext,
    ContractStateResponse
  > =>
  async (ctx) => {
    const config = loadConfig()
    const address = ctx.params.address

    if (
      !isAuthorized(
        ctx.header.authorization,
        config.exporterDashboardPassword || 'exporter'
      )
    ) {
      ctx.status = 401
      ctx.set('WWW-Authenticate', 'Basic realm="contract-state-recovery"')
      ctx.body = { error: 'authentication required' }
      return
    }

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
    if (
      !Number.isInteger(pageLimit) ||
      pageLimit < 1 ||
      pageLimit > MAX_PAGE_LIMIT
    ) {
      ctx.status = 400
      ctx.body = {
        error: `pageLimit must be an integer from 1 to ${MAX_PAGE_LIMIT}`,
      }
      return
    }

    let client: Awaited<ReturnType<typeof connect>> | undefined

    try {
      client = await connect(rpcUrl)
      const [chainId, contractInfo, block] = await Promise.all([
        client.getChainId(),
        getContractInfo({ address, client }),
        client.getBlock(),
      ])
      const blockHeight = BigInt(block.header.height).toString()
      const blockTimeUnixMs = Date.parse(block.header.time).toString()
      let recovery: Awaited<ReturnType<typeof recover>>
      try {
        recovery = await recover({
          address,
          codeId: contractInfo.codeId,
          blockHeight,
          blockTimeUnixMs,
          pageLimit,
          fetchPage: fetchPage(client),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : `${err}`
        ctx.status = isRpcError(message) ? 502 : 500
        ctx.body = { error: message }
        return
      }

      ctx.status = 200
      ctx.body = {
        chainId,
        contractAddress: address,
        rpc,
        blockHeight,
        blockTimeUnixMs,
        ...recovery,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : `${err}`
      ctx.status = /not found|no contract/i.test(message) ? 404 : 502
      ctx.body = { error: message }
    } finally {
      client?.disconnect()
    }
  }

export const recoverContractStateHandler = createRecoverContractState({
  loadConfig: () => ConfigManager.load(),
  connect: CosmWasmClient.connect,
  recover: recoverContractState,
  fetchPage: fetchContractStatePage,
  getContractInfo: getRecoveryContractInfo,
})
