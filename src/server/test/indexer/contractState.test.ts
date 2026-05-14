import { toBech32 } from '@cosmjs/encoding'
import Router from '@koa/router'
import Koa from 'koa'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { createGetContractState } from '@/server/routes/indexer/contractState'

const config = {
  ...ConfigManager.load(),
  bech32Prefix: 'juno',
  remoteRpc: 'https://remote.example',
  localRpc: 'http://local.example',
}
const validAddress = toBech32('juno', new Uint8Array(20).fill(1))
const wrongPrefixAddress = toBech32('osmo', new Uint8Array(20).fill(1))

const loadConfig = vi.fn()
const connect = vi.fn()
const dump = vi.fn()
const fetchPage = vi.fn()
const disconnect = vi.fn()

const makeApp = () => {
  const app = new Koa()
  const router = new Router()
  router.get(
    '/contract/:address/state',
    createGetContractState({ loadConfig, connect, dump, fetchPage })
  )
  app.use(router.routes()).use(router.allowedMethods())
  return app
}

describe('GET /contract/:address/state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadConfig.mockReturnValue(config)
    connect.mockResolvedValue({
      getChainId: vi.fn().mockResolvedValue('juno-1'),
      disconnect,
    })
    dump.mockResolvedValue({
      count: 1,
      entries: [{ key: 'AQ==', value: 'Ag==' }],
    })
    fetchPage.mockReturnValue(vi.fn())
  })

  it('returns a live state dump from remote RPC by default', async () => {
    await request(makeApp().callback())
      .get(`/contract/${validAddress}/state`)
      .expect(200)
      .expect({
        chainId: 'juno-1',
        contractAddress: validAddress,
        rpc: 'remote',
        count: 1,
        entries: [{ key: 'AQ==', value: 'Ag==' }],
      })

    expect(connect).toHaveBeenCalledWith(config.remoteRpc)
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('disconnects the client when the state query fails', async () => {
    dump.mockRejectedValueOnce(new Error('rpc down'))

    await request(makeApp().callback())
      .get(`/contract/${validAddress}/state`)
      .expect(502)

    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('rejects a wrong address prefix', async () => {
    await request(makeApp().callback())
      .get(`/contract/${wrongPrefixAddress}/state`)
      .expect(400)
  })

  it('rejects local RPC when localRpc is not configured', async () => {
    loadConfig.mockReturnValueOnce({
      ...config,
      localRpc: undefined,
    })

    await request(makeApp().callback())
      .get(`/contract/${validAddress}/state?rpc=local`)
      .expect(400)
  })

  it('maps RPC query failures to 502', async () => {
    dump.mockRejectedValueOnce(new Error('rpc down'))

    await request(makeApp().callback())
      .get(`/contract/${validAddress}/state`)
      .expect(502)
  })
})
