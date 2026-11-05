import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Extraction } from '@/db'
import {
  Config,
  ExtractorEnv,
  ExtractorHandleableData,
  ExtractorHandler,
} from '@/types'

import {
  WasmEventDataSource,
  WasmInstantiateOrMigrateDataSource,
} from '../sources'
import { Extractor } from './base'

const handlerSpy = vi.fn()

class TestExtractor extends Extractor {
  static type = 'test'
  static sources = []

  handle: ExtractorHandler<any> = async (data) => {
    handlerSpy(data)
    return []
  }
}

const makeExtractor = (config: Partial<Config>) =>
  new TestExtractor({
    config: config as Config,
    sendWebhooks: false,
    autoCosmWasmClient: {} as ExtractorEnv['autoCosmWasmClient'],
    txHash: 'hash',
    block: { height: '1', timeUnixMs: '1', timestamp: '1970-01-01T00:00:00Z' },
  })

const data: ExtractorHandleableData[] = [
  {
    source: WasmEventDataSource.type,
    handler: 'handle',
    data: { address: 'juno1excluded' },
  },
  {
    source: WasmInstantiateOrMigrateDataSource.type,
    handler: 'handle',
    data: { address: 'juno1excluded' },
  },
  {
    source: WasmEventDataSource.type,
    handler: 'handle',
    data: { address: 'juno1included' },
  },
  {
    source: WasmInstantiateOrMigrateDataSource.type,
    handler: 'handle',
    data: { address: 'juno1included' },
  },
  // Unknown non-contract source: never filtered by address.
  {
    source: 'other',
    handler: 'handle',
    data: { address: 'juno1excluded' },
  },
]

describe('Extractor.extract excludedContractAddresses', () => {
  beforeEach(() => {
    handlerSpy.mockReset()
    vi.spyOn(Extraction, 'bulkCreate').mockResolvedValue([])
  })

  it('skips handlers for excluded contracts and keeps the rest', async () => {
    await makeExtractor({
      excludedContractAddresses: ['juno1excluded'],
    }).extract(data)

    expect(handlerSpy.mock.calls.map(([d]) => d.address)).toEqual([
      'juno1included',
      'juno1included',
      'juno1excluded',
    ])
  })

  it('handles every item when the option is absent or empty', async () => {
    await makeExtractor({}).extract(data)
    expect(handlerSpy).toHaveBeenCalledTimes(data.length)

    handlerSpy.mockReset()
    await makeExtractor({ excludedContractAddresses: [] }).extract(data)
    expect(handlerSpy).toHaveBeenCalledTimes(data.length)
  })
})
