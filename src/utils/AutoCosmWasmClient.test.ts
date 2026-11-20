import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AutoCosmWasmClient } from './AutoCosmWasmClient'

describe('AutoCosmWasmClient', () => {
  const rpc = 'http://localhost:26657'
  const fakeClient = {
    getChainId: vi.fn().mockResolvedValue('xion-testnet-2'),
  } as unknown as CosmWasmClient

  // Fast retries so tests run quickly.
  const connectRetry = {
    initialDelayMs: 5,
    maxDelayMs: 20,
    maxDurationMs: 5_000,
  }

  let clients: AutoCosmWasmClient[] = []
  const createClient = (
    ...params: ConstructorParameters<typeof AutoCosmWasmClient>
  ) => {
    const client = new AutoCosmWasmClient(...params)
    clients.push(client)
    return client
  }

  let spies: { mockRestore: () => void }[] = []

  beforeEach(() => {
    spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
    ]
  })

  afterEach(() => {
    clients.forEach((client) => client.stop())
    clients = []
    // Only restore the spies created here, not the global console.error mock
    // from the test setup.
    spies.forEach((spy) => spy.mockRestore())
    vi.mocked(CosmWasmClient.connect).mockRestore?.()
  })

  it('retries a 502 at startup with backoff, then connects', async () => {
    const connect = vi
      .spyOn(CosmWasmClient, 'connect')
      .mockRejectedValueOnce(new Error('Bad status on response: 502'))
      .mockRejectedValueOnce(new Error('Bad status on response: 502'))
      .mockResolvedValue(fakeClient)

    const client = createClient(rpc, undefined, { connectRetry })
    await client.update()

    expect(connect).toHaveBeenCalledTimes(3)
    expect(await client.getValidClient()).toBe(fakeClient)
    expect(client.chainId).toBe('xion-testnet-2')
  })

  it('retries when getting the chain ID fails transiently', async () => {
    const getChainId = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValue('xion-mainnet-1')
    const connect = vi
      .spyOn(CosmWasmClient, 'connect')
      .mockResolvedValue({ getChainId } as unknown as CosmWasmClient)

    const client = createClient(rpc, undefined, { connectRetry })

    expect(await client.getValidChainId()).toBe('xion-mainnet-1')
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('reconnects with backoff after the connection test fails', async () => {
    const connect = vi
      .spyOn(CosmWasmClient, 'connect')
      // Initial connection.
      .mockResolvedValueOnce({
        getChainId: vi
          .fn()
          .mockResolvedValueOnce('xion-mainnet-1')
          .mockRejectedValue(new Error('read ECONNRESET')),
      } as unknown as CosmWasmClient)
      // Reconnection: two 502s, then success.
      .mockRejectedValueOnce(new Error('Bad status on response: 502'))
      .mockRejectedValueOnce(new Error('Bad status on response: 502'))
      .mockResolvedValue(fakeClient)

    const client = createClient(rpc, undefined, { connectRetry })
    await client.update()
    expect(connect).toHaveBeenCalledTimes(1)

    // The connection test retries 3 times, 1 second apart, before
    // reconnecting.
    await client.update()

    expect(connect).toHaveBeenCalledTimes(4)
    expect(await client.getValidClient()).toBe(fakeClient)
  })

  it('shares one retry loop between concurrent callers', async () => {
    const connect = vi
      .spyOn(CosmWasmClient, 'connect')
      .mockRejectedValueOnce(new Error('Bad status on response: 503'))
      .mockResolvedValue(fakeClient)

    const client = createClient(rpc, undefined, { connectRetry })
    const results = await Promise.all(
      Array.from({ length: 5 }, () => client.getValidClient())
    )

    expect(results).toEqual(Array(5).fill(fakeClient))
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-transient errors', async () => {
    const connect = vi
      .spyOn(CosmWasmClient, 'connect')
      .mockRejectedValue(new Error('Bad status on response: 401'))

    const client = createClient(rpc, undefined, { connectRetry })

    await expect(client.getValidClient()).rejects.toThrow(
      'CosmWasm client not connected'
    )
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('gives up after the maximum duration and reports the cause', async () => {
    const connect = vi
      .spyOn(CosmWasmClient, 'connect')
      .mockRejectedValue(new Error('Bad status on response: 502'))

    const client = createClient(rpc, undefined, {
      connectRetry: { ...connectRetry, maxDurationMs: 100 },
    })

    const error = await client.getValidClient().catch((err) => err)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('CosmWasm client not connected')
    expect(error.cause.message).toBe('Bad status on response: 502')
    expect(connect.mock.calls.length).toBeGreaterThan(1)
  })

  it('does not retry when connect retry is not enabled', async () => {
    const connect = vi
      .spyOn(CosmWasmClient, 'connect')
      .mockRejectedValue(new Error('Bad status on response: 502'))

    const client = createClient(rpc)

    await expect(client.getValidClient()).rejects.toThrow(
      'CosmWasm client not connected'
    )
    expect(connect).toHaveBeenCalledTimes(1)
  })
})
