import { toBase64, toBech32, toUtf8 } from '@cosmjs/encoding'
import { ContractInfo } from '@dao-dao/types/protobuf/codegen/cosmwasm/wasm/v1/types'
import { describe, expect, it } from 'vitest'

import { Config, TracedEventWithBlockTime } from '@/types'
import { AutoCosmWasmClient } from '@/utils'

import { wasm } from './wasm'

const CONTRACT_KEY_PREFIX = 0x02
const CONTRACT_STORE_PREFIX = 0x03

const excludedBytes = new Uint8Array(32).fill(1)
const includedBytes = new Uint8Array(32).fill(2)
const excludedAddress = toBech32('juno', excludedBytes)
const includedAddress = toBech32('juno', includedBytes)

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const stateTrace = (
  contractBytes: Uint8Array,
  operation: 'write' | 'delete' = 'write'
): TracedEventWithBlockTime => ({
  operation,
  key: toBase64(
    concat(
      new Uint8Array([CONTRACT_STORE_PREFIX]),
      contractBytes,
      toUtf8('config')
    )
  ),
  value: operation === 'delete' ? '' : toBase64(toUtf8('{"a":1}')),
  metadata: { blockHeight: 100 },
  blockTimeUnixMs: 1_000,
})

const contractInfoTrace = (
  contractBytes: Uint8Array
): TracedEventWithBlockTime => ({
  operation: 'write',
  key: toBase64(concat(new Uint8Array([CONTRACT_KEY_PREFIX]), contractBytes)),
  value: toBase64(
    ContractInfo.encode(
      ContractInfo.fromPartial({
        codeId: 1738n,
        creator: 'juno1creator',
        admin: '',
        label: 'label',
      })
    ).finish()
  ),
  metadata: { blockHeight: 100 },
  blockTimeUnixMs: 1_000,
})

const makeHandler = (config: Partial<Config>) =>
  wasm({
    chainId: 'test-1',
    config: { bech32Prefix: 'juno', ...config } as Config,
    sendWebhooks: false,
    autoCosmWasmClient: {
      chainId: 'test-1',
    } as unknown as AutoCosmWasmClient,
  })

const batch = [
  stateTrace(excludedBytes),
  stateTrace(includedBytes),
  stateTrace(excludedBytes, 'delete'),
  stateTrace(includedBytes, 'delete'),
  contractInfoTrace(excludedBytes),
  contractInfoTrace(includedBytes),
]

describe('wasm handler excludedContractAddresses', () => {
  it('drops state and contract info events only for excluded contracts in a mixed batch', async () => {
    const handler = await makeHandler({
      excludedContractAddresses: [excludedAddress],
    })

    const matched = batch.map((trace) => handler.match(trace))

    expect(matched.map((event) => event?.type)).toEqual([
      undefined,
      'state',
      undefined,
      'state',
      undefined,
      'contract',
    ])
    for (const event of matched.filter(Boolean)) {
      const data = event!.data as Record<string, unknown>
      expect(data.contractAddress ?? data.address).toBe(includedAddress)
    }
  })

  it('does not exclude other contracts with the same code ID', async () => {
    // Both contract info traces use code ID 1738; only the address matters.
    const handler = await makeHandler({
      excludedContractAddresses: [excludedAddress],
    })

    expect(handler.match(contractInfoTrace(includedBytes))).toMatchObject({
      type: 'contract',
      data: { address: includedAddress, codeId: 1738 },
    })
  })

  it.each([
    ['absent', {}],
    ['empty', { excludedContractAddresses: [] }],
  ])(
    'matches every contract when the option is %s',
    async (_, config: Partial<Config>) => {
      const handler = await makeHandler(config)

      expect(batch.map((trace) => handler.match(trace)?.type)).toEqual([
        'state',
        'state',
        'state',
        'state',
        'contract',
        'contract',
      ])
    }
  )

  it('fails to start with a malformed option', async () => {
    await expect(
      makeHandler({ excludedContractAddresses: excludedAddress as any })
    ).rejects.toThrow(/excludedContractAddresses/)
  })
})
