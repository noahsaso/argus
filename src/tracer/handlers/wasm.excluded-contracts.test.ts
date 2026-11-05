import { toBase64, toBech32, toUtf8 } from '@cosmjs/encoding'
import { ContractInfo } from '@dao-dao/types/protobuf/codegen/cosmwasm/wasm/v1/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Block, Contract, WasmStateEvent } from '@/db'
import {
  ContractStateRecoveryQueue,
  WasmCodeTrackersQueue,
} from '@/queues/queues'
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
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  describe('process (already-queued export jobs)', () => {
    // Export jobs store events that were matched before the exclusion took
    // effect, and `process` runs them without matching again.
    const matchedWithoutExclusion = async () => {
      const handler = await makeHandler({})
      return batch.map((trace) => handler.match(trace)!)
    }

    const spyOnWrites = () => ({
      blocks: vi.spyOn(Block, 'createMany').mockResolvedValue([] as any),
      contracts: vi.spyOn(Contract, 'bulkCreate').mockResolvedValue([]),
      stateEvents: vi.spyOn(WasmStateEvent, 'bulkCreate').mockResolvedValue([]),
      recoveries: vi
        .spyOn(ContractStateRecoveryQueue, 'addDelayed')
        .mockResolvedValue(undefined as any),
      trackers: vi
        .spyOn(WasmCodeTrackersQueue, 'add')
        .mockResolvedValue(undefined as any),
    })

    it('writes and queues nothing for excluded contracts', async () => {
      const events = (await matchedWithoutExclusion()).filter(
        (event) =>
          (event.type === 'state'
            ? event.data.contractAddress
            : event.data.address) === excludedAddress
      )
      expect(events).toHaveLength(3)

      const writes = spyOnWrites()
      const handler = await makeHandler({
        excludedContractAddresses: [excludedAddress],
      })

      await expect(handler.process!(events)).resolves.toEqual([])
      for (const spy of Object.values(writes)) {
        expect(spy).not.toHaveBeenCalled()
      }
    })

    it('keeps included contracts in a mixed batch', async () => {
      // Excluded state and contract info plus included contract info, so the
      // included path stops before state event lookups.
      const events = (await matchedWithoutExclusion()).filter(
        (event) =>
          event.type === 'contract' ||
          event.data.contractAddress === excludedAddress
      )
      expect(events).toHaveLength(4)

      const writes = spyOnWrites()
      const handler = await makeHandler({
        excludedContractAddresses: [excludedAddress],
      })

      await expect(handler.process!(events)).resolves.toEqual([])
      expect(writes.blocks).toHaveBeenCalledTimes(1)
      expect(writes.recoveries).toHaveBeenCalledTimes(1)
      expect(writes.recoveries).toHaveBeenCalledWith({
        address: includedAddress,
        detectedBlockHeight: '100',
      })
      expect(writes.contracts).toHaveBeenCalledTimes(1)
      expect(
        writes.contracts.mock.calls[0][0].map(({ address }: any) => address)
      ).toEqual([includedAddress])
      expect(writes.trackers).toHaveBeenCalledTimes(1)
      const [, trackerData] = writes.trackers.mock.calls[0] as any[]
      expect(
        trackerData.contractEvents.map(({ address }: any) => address)
      ).toEqual([includedAddress])
      expect(trackerData.stateEventUpdates).toEqual([])
      expect(writes.stateEvents).not.toHaveBeenCalled()
    })
  })
})
