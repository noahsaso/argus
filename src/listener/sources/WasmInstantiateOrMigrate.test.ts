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
import { ExtractableTxInput } from '@/types'

import {
  WasmInstantiateOrMigrateDataSource,
  WasmInstantiateOrMigrateDataSourceConfig,
} from './WasmInstantiateOrMigrate'

describe('WasmInstantiateOrMigrateDataSource', () => {
  let dataSource: WasmInstantiateOrMigrateDataSource
  let mockWasmCodeService: {
    findWasmCodeIdsByKeys: MockInstance
    findWasmCodeKeysById: MockInstance
  }

  const createMockExtractorInput = (events: Event[]): ExtractableTxInput => ({
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

    vi.spyOn(WasmCodeService, 'getInstance').mockReturnValue(
      mockWasmCodeService as any
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor and basic configuration', () => {
    beforeEach(() => {
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        codeIdsKeys: ['dao-dao-core', 'dao-proposal-single'],
      }

      // Mock findWasmCodeIdsByKeys to return specific code IDs
      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123, 456, 789])

      dataSource = new WasmInstantiateOrMigrateDataSource(config)
    })

    it('should have correct static type', () => {
      expect(WasmInstantiateOrMigrateDataSource.type).toBe(
        'wasm/instantiate-or-migrate'
      )
    })

    it('should call WasmCodeService with correct keys during construction', () => {
      expect(mockWasmCodeService.findWasmCodeIdsByKeys).toHaveBeenCalledWith(
        'dao-dao-core',
        'dao-proposal-single'
      )
    })

    it('should store the correct config', () => {
      expect(dataSource.config).toEqual({
        type: 'both',
        codeIdsKeys: ['dao-dao-core', 'dao-proposal-single'],
      })
    })
  })

  describe('match function - basic matching', () => {
    beforeEach(() => {
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        codeIdsKeys: ['dao-dao-core'],
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

      dataSource = new WasmInstantiateOrMigrateDataSource(config)
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
        type: 'instantiate',
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
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        codeIdsKeys: ['dao-dao-core', 'dao-proposal'],
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

      dataSource = new WasmInstantiateOrMigrateDataSource(config)
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
        type: 'instantiate',
        address: 'juno1contract123',
        codeId: 123,
        codeIdsKeys: ['dao-dao-core'],
      })

      expect(secondMatch).toEqual({
        type: 'instantiate',
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
        type: 'instantiate',
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
      expect(result.every((r) => r.type === 'instantiate')).toBe(true)
    })
  })

  describe('edge cases and error handling', () => {
    beforeEach(() => {
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        codeIdsKeys: ['dao-dao-core'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123])
      mockWasmCodeService.findWasmCodeKeysById.mockReturnValue(['dao-dao-core'])

      dataSource = new WasmInstantiateOrMigrateDataSource(config)
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
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        codeIdsKeys: ['dao-dao-core'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([
        Number.MAX_SAFE_INTEGER,
      ])
      mockWasmCodeService.findWasmCodeKeysById.mockReturnValue(['dao-dao-core'])

      dataSource = new WasmInstantiateOrMigrateDataSource(config)

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
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        codeIdsKeys: [],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([])

      dataSource = new WasmInstantiateOrMigrateDataSource(config)

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
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        codeIdsKeys: ['non-existent-key'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([])

      dataSource = new WasmInstantiateOrMigrateDataSource(config)

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
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        codeIdsKeys: ['dao-dao-core'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123])
      mockWasmCodeService.findWasmCodeKeysById.mockReturnValue(['dao-dao-core'])

      dataSource = new WasmInstantiateOrMigrateDataSource(config)

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
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        codeIdsKeys: [
          'dao-dao-core',
          'dao-proposal-single',
          'dao-voting-cw20-staked',
        ],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([100, 200, 300])

      dataSource = new WasmInstantiateOrMigrateDataSource(config)

      expect(mockWasmCodeService.findWasmCodeIdsByKeys).toHaveBeenCalledWith(
        'dao-dao-core',
        'dao-proposal-single',
        'dao-voting-cw20-staked'
      )
    })

    it('should handle WasmCodeService returning overlapping code IDs', () => {
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        codeIdsKeys: ['key1', 'key2'],
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

      dataSource = new WasmInstantiateOrMigrateDataSource(config)

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
        type: 'instantiate',
        address: 'juno1contract123',
        codeId: 123,
        codeIdsKeys: ['key1', 'key2'],
      })
    })
  })

  describe('migrate event matching', () => {
    beforeEach(() => {
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        type: 'migrate',
        codeIdsKeys: ['dao-dao-core'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123, 456])
      mockWasmCodeService.findWasmCodeKeysById.mockImplementation(
        (codeId: number) => {
          if (codeId === 123) return ['dao-dao-core', 'legacy-dao']
          if (codeId === 456) return ['dao-dao-core']
          return []
        }
      )

      dataSource = new WasmInstantiateOrMigrateDataSource(config)
    })

    it('should match migrate event with correct code_id', () => {
      const events: Event[] = [
        {
          type: 'migrate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'old_code_id', value: '100' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        type: 'migrate',
        address: 'juno1contract123',
        codeId: 123,
        codeIdsKeys: ['dao-dao-core', 'legacy-dao'],
      })
    })

    it('should not match instantiate events when configured for migrate only', () => {
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

    it('should handle multiple migrate events', () => {
      const events: Event[] = [
        {
          type: 'migrate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
        {
          type: 'migrate',
          attributes: [
            { key: 'code_id', value: '456' },
            { key: '_contract_address', value: 'juno1contract456' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(2)
      expect(result.every((r) => r.type === 'migrate')).toBe(true)
    })
  })

  describe('type configuration', () => {
    it('should default to "both" when type is not specified', () => {
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        codeIdsKeys: ['dao-dao-core'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123])
      mockWasmCodeService.findWasmCodeKeysById.mockReturnValue(['dao-dao-core'])

      dataSource = new WasmInstantiateOrMigrateDataSource(config)

      expect(dataSource.config.type).toBe('both')
    })

    it('should match only instantiate events when type is "instantiate"', () => {
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        type: 'instantiate',
        codeIdsKeys: ['dao-dao-core'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123])
      mockWasmCodeService.findWasmCodeKeysById.mockReturnValue(['dao-dao-core'])

      dataSource = new WasmInstantiateOrMigrateDataSource(config)

      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
        {
          type: 'migrate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract456' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        type: 'instantiate',
        address: 'juno1contract123',
        codeId: 123,
        codeIdsKeys: ['dao-dao-core'],
      })
    })

    it('should match only migrate events when type is "migrate"', () => {
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        type: 'migrate',
        codeIdsKeys: ['dao-dao-core'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123])
      mockWasmCodeService.findWasmCodeKeysById.mockReturnValue(['dao-dao-core'])

      dataSource = new WasmInstantiateOrMigrateDataSource(config)

      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
        {
          type: 'migrate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract456' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        type: 'migrate',
        address: 'juno1contract456',
        codeId: 123,
        codeIdsKeys: ['dao-dao-core'],
      })
    })

    it('should match both instantiate and migrate events when type is "both"', () => {
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        type: 'both',
        codeIdsKeys: ['dao-dao-core'],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([123])
      mockWasmCodeService.findWasmCodeKeysById.mockReturnValue(['dao-dao-core'])

      dataSource = new WasmInstantiateOrMigrateDataSource(config)

      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract123' },
          ],
        },
        {
          type: 'migrate',
          attributes: [
            { key: 'code_id', value: '123' },
            { key: '_contract_address', value: 'juno1contract456' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(2)

      const instantiateMatch = result.find((r) => r.type === 'instantiate')
      const migrateMatch = result.find((r) => r.type === 'migrate')

      expect(instantiateMatch).toEqual({
        type: 'instantiate',
        address: 'juno1contract123',
        codeId: 123,
        codeIdsKeys: ['dao-dao-core'],
      })

      expect(migrateMatch).toEqual({
        type: 'migrate',
        address: 'juno1contract456',
        codeId: 123,
        codeIdsKeys: ['dao-dao-core'],
      })
    })
  })

  describe('optional codeIdsKeys configuration', () => {
    it('should match all instantiate events when codeIdsKeys is not specified', () => {
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        type: 'instantiate',
      }

      dataSource = new WasmInstantiateOrMigrateDataSource(config)
      mockWasmCodeService.findWasmCodeKeysById.mockReturnValue([])

      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '999' }, // Any code ID should match
            { key: '_contract_address', value: 'juno1contract999' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        type: 'instantiate',
        address: 'juno1contract999',
        codeId: 999,
        codeIdsKeys: [],
      })
    })

    it('should match all migrate events when codeIdsKeys is not specified', () => {
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        type: 'migrate',
      }

      dataSource = new WasmInstantiateOrMigrateDataSource(config)
      mockWasmCodeService.findWasmCodeKeysById.mockReturnValue([])

      const events: Event[] = [
        {
          type: 'migrate',
          attributes: [
            { key: 'code_id', value: '888' }, // Any code ID should match
            { key: '_contract_address', value: 'juno1contract888' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        type: 'migrate',
        address: 'juno1contract888',
        codeId: 888,
        codeIdsKeys: [],
      })
    })

    it('should handle empty codeIdsKeys array (no matches)', () => {
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        type: 'both',
        codeIdsKeys: [],
      }

      mockWasmCodeService.findWasmCodeIdsByKeys.mockReturnValue([])
      dataSource = new WasmInstantiateOrMigrateDataSource(config)
      mockWasmCodeService.findWasmCodeKeysById.mockReturnValue([])

      const events: Event[] = [
        {
          type: 'instantiate',
          attributes: [
            { key: 'code_id', value: '777' },
            { key: '_contract_address', value: 'juno1contract777' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      // With empty codeIdsKeys array, the codeIds becomes [], which means
      // no code IDs will match (empty array is truthy but includes() returns false)
      expect(result).toHaveLength(0)
    })
  })

  describe('static methods', () => {
    it('should have static source method', () => {
      const source = WasmInstantiateOrMigrateDataSource.source('testHandler', {
        type: 'both',
        codeIdsKeys: ['dao-dao-core'],
      })

      expect(source).toEqual({
        type: 'wasm/instantiate-or-migrate',
        handler: 'testHandler',
        config: {
          type: 'both',
          codeIdsKeys: ['dao-dao-core'],
        },
      })
    })

    it('should have static data method', () => {
      const testData = {
        type: 'instantiate' as const,
        address: 'juno1test123',
        codeId: 123,
        codeIdsKeys: ['dao-dao-core'],
      }

      const data = WasmInstantiateOrMigrateDataSource.data(testData)

      expect(data).toEqual({
        type: 'wasm/instantiate-or-migrate',
        data: testData,
      })
    })
  })

  describe('complex scenarios', () => {
    beforeEach(() => {
      const config: WasmInstantiateOrMigrateDataSourceConfig = {
        codeIdsKeys: ['dao-dao-core', 'dao-proposal'],
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

      dataSource = new WasmInstantiateOrMigrateDataSource(config)
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
        type: 'instantiate',
        address: 'juno1dao123',
        codeId: 123,
        codeIdsKeys: ['dao-dao-core'],
      })

      expect(daoProposal).toEqual({
        type: 'instantiate',
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
      expect(result.every((r) => r.type === 'instantiate')).toBe(true)
    })

    it('should handle mixed instantiate and migrate events', () => {
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
          type: 'migrate',
          attributes: [
            { key: 'code_id', value: '456' },
            { key: '_contract_address', value: 'juno1proposal456' },
            { key: 'old_code_id', value: '400' },
          ],
        },
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'execute' },
            { key: '_contract_address', value: 'juno1other789' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toHaveLength(2)

      const instantiateMatch = result.find((r) => r.type === 'instantiate')
      const migrateMatch = result.find((r) => r.type === 'migrate')

      expect(instantiateMatch).toEqual({
        type: 'instantiate',
        address: 'juno1dao123',
        codeId: 123,
        codeIdsKeys: ['dao-dao-core'],
      })

      expect(migrateMatch).toEqual({
        type: 'migrate',
        address: 'juno1proposal456',
        codeId: 456,
        codeIdsKeys: ['dao-proposal'],
      })
    })
  })
})
