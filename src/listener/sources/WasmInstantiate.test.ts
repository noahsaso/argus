import { Event } from '@cosmjs/stargate'
import {
  MockInstance,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { WasmCodeService } from '@/services'
import { ExtractorMatchInput } from '@/types'

import {
  WasmInstantiateDataSource,
  WasmInstantiateDataSourceConfig,
} from './WasmInstantiate'

// Mock the WasmCodeService
vi.mock('@/services', () => ({
  WasmCodeService: {
    getInstance: vi.fn(),
  },
}))

describe('WasmInstantiateDataSource', () => {
  let dataSource: WasmInstantiateDataSource
  let mockWasmCodeService: {
    findWasmCodeIdsByKeys: MockInstance
    findWasmCodeKeysById: MockInstance
  }

  const createMockExtractorInput = (events: Event[]): ExtractorMatchInput => ({
    hash: 'test-hash',
    tx: {} as any,
    messages: [],
    events,
  })

  beforeAll(() => {
    // Setup mock WasmCodeService
    mockWasmCodeService = {
      findWasmCodeIdsByKeys: vi.fn(),
      findWasmCodeKeysById: vi.fn(),
    }

    vi.mocked(WasmCodeService.getInstance).mockReturnValue(
      mockWasmCodeService as any
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor and basic configuration', () => {
    beforeEach(() => {
      const config: WasmInstantiateDataSourceConfig = {
        codeIdKeys: ['dao-dao-core', 'dao-proposal-single'],
      }

      // Mock findWasmCodeIdsByKeys to return specific code IDs
      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123, 456, 789])

      dataSource = new WasmInstantiateDataSource(config)
    })

    it('should have correct static type', () => {
      expect(WasmInstantiateDataSource.type).toBe('wasm/instantiate')
    })

    it('should call WasmCodeService with correct keys during construction', () => {
      expect(mockWasmCodeService.findWasmCodeIdsByKeys).toHaveBeenCalledWith(
        'dao-dao-core',
        'dao-proposal-single'
      )
    })

    it('should store the correct config', () => {
      expect(dataSource.config).toEqual({
        codeIdKeys: ['dao-dao-core', 'dao-proposal-single'],
      })
    })
  })

  describe('match function - basic matching', () => {
    beforeEach(() => {
      const config: WasmInstantiateDataSourceConfig = {
        codeIdKeys: ['dao-dao-core'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123, 456])
      mockWasmCodeService.findWasmCodeKeysById.mockImplementation(
        (codeId: number) => {
          if (codeId === 123) {
            return ['dao-dao-core', 'legacy-dao']
          }
          if (codeId === 456) {
            return ['dao-dao-core']
          }
          return []
        }
      )

      dataSource = new WasmInstantiateDataSource(config)
    })

    it('should match instantiate event with correct code_id', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'creator', value: 'juno1creator123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        address: 'juno1contract123',
        codeId: 123,
        codeIdsKeys: ['dao-dao-core', 'legacy-dao'],
      })
    })

    it('should not match instantiate event with wrong code_id', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '999' }, // Not in our tracked code IDs
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match non-instantiate events', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match events without code_id', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'creator', value: 'juno1creator123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match events without _contract_address', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: 'creator', value: 'juno1creator123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match events with empty _contract_address', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: '' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match events with invalid code_id (NaN)', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: 'not-a-number' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })
  })

  describe('match function - multiple events', () => {
    beforeEach(() => {
      const config: WasmInstantiateDataSourceConfig = {
        codeIdKeys: ['dao-dao-core', 'dao-proposal'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123, 456, 789])
      mockWasmCodeService.findWasmCodeKeysById.mockImplementation(
        (codeId: number) => {
          switch (codeId) {
            case 123:
              return ['dao-dao-core']
            case 456:
              return ['dao-proposal']
            case 789:
              return ['dao-dao-core', 'dao-proposal']
            default:
              return []
          }
        }
      )

      dataSource = new WasmInstantiateDataSource(config)
    })

    it('should match multiple instantiate events', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '456' },
            { key: '_contract_address', value: 'juno1contract456' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(2)

      const firstMatch = result.find((r) => r.address === 'juno1contract123')
      const secondMatch = result.find((r) => r.address === 'juno1contract456')

      expect(firstMatch).toEqual({
        address: 'juno1contract123',
        codeId: 123,
        codeIdsKeys: ['dao-dao-core'],
      })

      expect(secondMatch).toEqual({
        address: 'juno1contract456',
        codeId: 456,
        codeIdsKeys: ['dao-proposal'],
      })
    })

    it('should handle mixed event types correctly', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'execute' },
            { key: '_contract_address', value: 'juno1existing123' },
          ],
        },
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
        {
          type: 'bank',
          attributes: [{ key: 'recipient', value: 'juno1recipient123' }],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        address: 'juno1contract123',
        codeId: 123,
        codeIdsKeys: ['dao-dao-core'],
      })
    })

    it('should filter out non-matching code IDs while keeping matching ones', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' }, // Matches
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '999' }, // Doesn't match
            { key: '_contract_address', value: 'juno1contract999' },
          ],
        },
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '789' }, // Matches
            { key: '_contract_address', value: 'juno1contract789' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(2)
      expect(result.map((r) => r.codeId)).toEqual(
        expect.arrayContaining([123, 789])
      )
      expect(result.map((r) => r.codeId)).not.toContain(999)
    })
  })

  describe('edge cases and error handling', () => {
    beforeEach(() => {
      const config: WasmInstantiateDataSourceConfig = {
        codeIdKeys: ['dao-dao-core'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123])
      mockWasmCodeService.findWasmCodeKeysById.mockReturnValue(['dao-dao-core'])

      dataSource = new WasmInstantiateDataSource(config)
    })

    it('should handle empty events array', () => {
      const result = dataSource.match(createMockExtractorInput([]))
      expect(result).toHaveLength(0)
    })

    it('should handle events with no attributes', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should handle zero code_id', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '0' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should handle negative code_id', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '-123' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should handle floating point code_id', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123.45' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should handle very large code_id', () => {
      const config: WasmInstantiateDataSourceConfig = {
        codeIdKeys: ['dao-dao-core'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([
        Number.MAX_SAFE_INTEGER,
      ])
      mockWasmCodeService.findWasmCodeKeysById.mockReturnValue(['dao-dao-core'])

      dataSource = new WasmInstantiateDataSource(config)

      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: String(Number.MAX_SAFE_INTEGER) },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].codeId).toBe(Number.MAX_SAFE_INTEGER)
    })
  })

  describe('WasmCodeService integration', () => {
    it('should handle empty codeIdKeys array', () => {
      const config: WasmInstantiateDataSourceConfig = {
        codeIdKeys: [],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([])

      dataSource = new WasmInstantiateDataSource(config)

      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should handle WasmCodeService returning empty array', () => {
      const config: WasmInstantiateDataSourceConfig = {
        codeIdKeys: ['non-existent-key'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([])

      dataSource = new WasmInstantiateDataSource(config)

      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should call findWasmCodeKeysById with correct codeId', () => {
      const config: WasmInstantiateDataSourceConfig = {
        codeIdKeys: ['dao-dao-core'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123])
      mockWasmCodeService.findWasmCodeKeysById.mockReturnValue(['dao-dao-core'])

      dataSource = new WasmInstantiateDataSource(config)

      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
      ]

      dataSource.match(createMockExtractorInput(events))

      expect(mockWasmCodeService.findWasmCodeKeysById).toHaveBeenCalledWith(123)
    })

    it('should handle multiple codeIdKeys correctly', () => {
      const config: WasmInstantiateDataSourceConfig = {
        codeIdKeys: [
          'dao-dao-core',
          'dao-proposal-single',
          'dao-voting-cw20-staked',
        ],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([100, 200, 300])

      dataSource = new WasmInstantiateDataSource(config)

      expect(mockWasmCodeService.findWasmCodeIdsByKeys).toHaveBeenCalledWith(
        'dao-dao-core',
        'dao-proposal-single',
        'dao-voting-cw20-staked'
      )
    })

    it('should handle WasmCodeService returning overlapping code IDs', () => {
      const config: WasmInstantiateDataSourceConfig = {
        codeIdKeys: ['key1', 'key2'],
      }

      // Simulate overlapping code IDs from different keys
      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123, 456, 123]) // 123 appears twice
      mockWasmCodeService.findWasmCodeKeysById.mockImplementation(
        (codeId: number) => {
          if (codeId === 123) return ['key1', 'key2'] // Both keys reference same code ID
          if (codeId === 456) return ['key2']
          return []
        }
      )

      dataSource = new WasmInstantiateDataSource(config)

      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        address: 'juno1contract123',
        codeId: 123,
        codeIdsKeys: ['key1', 'key2'],
      })
    })
  })

  describe('complex scenarios', () => {
    beforeEach(() => {
      const config: WasmInstantiateDataSourceConfig = {
        codeIdKeys: ['dao-dao-core', 'dao-proposal'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123, 456])
      mockWasmCodeService.findWasmCodeKeysById.mockImplementation(
        (codeId: number) => {
          switch (codeId) {
            case 123:
              return ['dao-dao-core']
            case 456:
              return ['dao-proposal']
            default:
              return []
          }
        }
      )

      dataSource = new WasmInstantiateDataSource(config)
    })

    it('should handle transaction with multiple contract instantiations', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1dao123' },
            { key: 'label', value: 'DAO Core' },
          ],
        },
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '456' },
            { key: '_contract_address', value: 'juno1proposal456' },
            { key: 'label', value: 'DAO Proposal Single' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(2)

      const daoCore = result.find((r) => r.address === 'juno1dao123')
      const daoProposal = result.find((r) => r.address === 'juno1proposal456')

      expect(daoCore).toEqual({
        address: 'juno1dao123',
        codeId: 123,
        codeIdsKeys: ['dao-dao-core'],
      })

      expect(daoProposal).toEqual({
        address: 'juno1proposal456',
        codeId: 456,
        codeIdsKeys: ['dao-proposal'],
      })
    })

    it('should handle mixed instantiate events with some matches and some misses', () => {
      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' }, // Match
            { key: '_contract_address', value: 'juno1dao123' },
          ],
        },
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '999' }, // No match
            { key: '_contract_address', value: 'juno1other999' },
          ],
        },
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '456' }, // Match
            { key: '_contract_address', value: 'juno1proposal456' },
          ],
        },
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: 'invalid' }, // Invalid
            { key: '_contract_address', value: 'juno1invalid' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(2)
      expect(result.map((r) => r.codeId)).toEqual(
        expect.arrayContaining([123, 456])
      )
      expect(result.map((r) => r.address)).toEqual(
        expect.arrayContaining(['juno1dao123', 'juno1proposal456'])
      )
    })
  })
})
