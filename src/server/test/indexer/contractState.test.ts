import { toBech32 } from '@cosmjs/encoding'
import Router from '@koa/router'
import Koa from 'koa'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { createRecoverContractState } from '@/server/routes/indexer/contractState'

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
const recover = vi.fn()
const fetchPage = vi.fn()
const getContractInfo = vi.fn()
const disconnect = vi.fn()
const auth = Buffer.from('exporter:exporter').toString('base64')

const recoverRequest = (app: Koa, address = validAddress, query = '') =>
  request(app.callback())
    .post(`/contract/${address}/state/recover${query}`)
    .set('Authorization', `Basic ${auth}`)

const makeApp = () => {
  const app = new Koa()
  const router = new Router()
  router.post(
    '/contract/:address/state/recover',
    createRecoverContractState({
      loadConfig,
      connect,
      recover,
      fetchPage,
      getContractInfo,
    })
  )
  app.use(router.routes()).use(router.allowedMethods())
  return app
}

describe('POST /contract/:address/state/recover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadConfig.mockReturnValue(config)
    connect.mockResolvedValue({
      getChainId: vi.fn().mockResolvedValue('juno-1'),
      getBlock: vi.fn().mockResolvedValue({
        header: { height: 123n, time: '1970-01-01T00:07:36.000Z' },
      }),
      disconnect,
    })
    getContractInfo.mockResolvedValue({ codeId: 7 })
    recover.mockResolvedValue({
      count: 1,
      events: 1,
      transformations: 1,
    })
    fetchPage.mockReturnValue(vi.fn())
  })

  it('requires basic auth', async () => {
    await request(makeApp().callback())
      .post(`/contract/${validAddress}/state/recover`)
      .expect(401)
  })

  it('recovers live state through the events pipeline from remote RPC by default', async () => {
    await recoverRequest(makeApp()).expect(200).expect({
      chainId: 'juno-1',
      contractAddress: validAddress,
      rpc: 'remote',
      blockHeight: '123',
      blockTimeUnixMs: '456000',
      count: 1,
      events: 1,
      transformations: 1,
    })

    expect(connect).toHaveBeenCalledWith(config.remoteRpc)
    expect(recover).toHaveBeenCalledWith({
      address: validAddress,
      codeId: 7,
      blockHeight: '123',
      blockTimeUnixMs: '456000',
      pageLimit: 1000,
      fetchPage: expect.any(Function),
    })
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('disconnects the client when the state recovery fails', async () => {
    recover.mockRejectedValueOnce(new Error('database down'))

    await recoverRequest(makeApp()).expect(500)

    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('rejects a wrong address prefix', async () => {
    await recoverRequest(makeApp(), wrongPrefixAddress).expect(400)
  })

  it('rejects local RPC when localRpc is not configured', async () => {
    loadConfig.mockReturnValueOnce({
      ...config,
      localRpc: undefined,
    })

    await recoverRequest(makeApp(), validAddress, '?rpc=local').expect(400)
  })

  it('maps internal recovery failures to 500', async () => {
    recover.mockRejectedValueOnce(new Error('database down'))

    await recoverRequest(makeApp()).expect(500)
  })

  it('maps RPC query failures to 502', async () => {
    getContractInfo.mockRejectedValueOnce(new Error('rpc down'))

    await recoverRequest(makeApp()).expect(502)
  })
})
