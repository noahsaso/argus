import type { Event } from '@cosmjs/stargate'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ExtractableTxInput } from '@/types'

import {
  FeegrantEventDataSource,
  type FeegrantEventDataSourceConfig,
} from './FeegrantEvent'

describe('FeegrantEventDataSource', () => {
  let dataSource: FeegrantEventDataSource

  const createMockExtractorInput = (events: Event[]): ExtractableTxInput => ({
    hash: 'test-hash',
    tx: {} as any,
    messages: [],
    events,
  })

  describe('basic configuration', () => {
    beforeEach(() => {
      const config: FeegrantEventDataSourceConfig = {
        action: 'set_feegrant',
      }
      dataSource = new FeegrantEventDataSource(config)
    })

    it('should have correct static type', () => {
      expect(FeegrantEventDataSource.type).toBe('feegrant/event')
    })

    it('should match message event with correct action', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'set_feegrant' },
            { key: 'granter', value: 'cosmos1granter123' },
            { key: 'grantee', value: 'cosmos1grantee123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toEqual([
        {
          action: 'set_feegrant',
          granter: 'cosmos1granter123',
          grantee: 'cosmos1grantee123',
          pruner: undefined,
          attributes: {
            action: ['set_feegrant'],
            granter: ['cosmos1granter123'],
            grantee: ['cosmos1grantee123'],
          },
          _attributes: [
            { key: 'action', value: 'set_feegrant' },
            { key: 'granter', value: 'cosmos1granter123' },
            { key: 'grantee', value: 'cosmos1grantee123' },
          ],
        },
      ])
    })

    it('should not match non-message events', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: 'action', value: 'set_feegrant' },
            { key: 'granter', value: 'cosmos1granter123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match message events with wrong action', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'send' },
            { key: 'sender', value: 'cosmos1sender123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match message events without action attribute', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'granter', value: 'cosmos1granter123' },
            { key: 'grantee', value: 'cosmos1grantee123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })
  })

  describe('different feegrant actions', () => {
    it('should match revoke_feegrant action', () => {
      const config: FeegrantEventDataSourceConfig = {
        action: 'revoke_feegrant',
      }
      dataSource = new FeegrantEventDataSource(config)

      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'revoke_feegrant' },
            { key: 'granter', value: 'cosmos1granter123' },
            { key: 'grantee', value: 'cosmos1grantee123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].action).toBe('revoke_feegrant')
    })

    it('should match use_feegrant action', () => {
      const config: FeegrantEventDataSourceConfig = {
        action: 'use_feegrant',
      }
      dataSource = new FeegrantEventDataSource(config)

      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'use_feegrant' },
            { key: 'granter', value: 'cosmos1granter123' },
            { key: 'grantee', value: 'cosmos1grantee123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].action).toBe('use_feegrant')
    })

    it('should match prune_feegrant action', () => {
      const config: FeegrantEventDataSourceConfig = {
        action: 'prune_feegrant',
      }
      dataSource = new FeegrantEventDataSource(config)

      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'prune_feegrant' },
            { key: 'pruner', value: 'cosmos1pruner123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].action).toBe('prune_feegrant')
      expect(result[0].pruner).toBe('cosmos1pruner123')
    })
  })

  describe('filtering by granter', () => {
    beforeEach(() => {
      const config: FeegrantEventDataSourceConfig = {
        action: 'set_feegrant',
        granter: 'cosmos1specificgranter',
      }
      dataSource = new FeegrantEventDataSource(config)
    })

    it('should match when granter matches filter', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'set_feegrant' },
            { key: 'granter', value: 'cosmos1specificgranter' },
            { key: 'grantee', value: 'cosmos1grantee123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].granter).toBe('cosmos1specificgranter')
    })

    it('should not match when granter does not match filter', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'set_feegrant' },
            { key: 'granter', value: 'cosmos1differentgranter' },
            { key: 'grantee', value: 'cosmos1grantee123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match when granter attribute is missing', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'set_feegrant' },
            { key: 'grantee', value: 'cosmos1grantee123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })
  })

  describe('filtering by grantee', () => {
    beforeEach(() => {
      const config: FeegrantEventDataSourceConfig = {
        action: 'set_feegrant',
        grantee: 'cosmos1specificgrantee',
      }
      dataSource = new FeegrantEventDataSource(config)
    })

    it('should match when grantee matches filter', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'set_feegrant' },
            { key: 'granter', value: 'cosmos1granter123' },
            { key: 'grantee', value: 'cosmos1specificgrantee' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].grantee).toBe('cosmos1specificgrantee')
    })

    it('should not match when grantee does not match filter', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'set_feegrant' },
            { key: 'granter', value: 'cosmos1granter123' },
            { key: 'grantee', value: 'cosmos1differentgrantee' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })
  })

  describe('filtering by both granter and grantee', () => {
    beforeEach(() => {
      const config: FeegrantEventDataSourceConfig = {
        action: 'use_feegrant',
        granter: 'cosmos1specificgranter',
        grantee: 'cosmos1specificgrantee',
      }
      dataSource = new FeegrantEventDataSource(config)
    })

    it('should match when both granter and grantee match filters', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'use_feegrant' },
            { key: 'granter', value: 'cosmos1specificgranter' },
            { key: 'grantee', value: 'cosmos1specificgrantee' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
    })

    it('should not match when only granter matches', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'use_feegrant' },
            { key: 'granter', value: 'cosmos1specificgranter' },
            { key: 'grantee', value: 'cosmos1wronggrantee' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match when only grantee matches', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'use_feegrant' },
            { key: 'granter', value: 'cosmos1wronggranter' },
            { key: 'grantee', value: 'cosmos1specificgrantee' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })
  })

  describe('multiple events and matches', () => {
    beforeEach(() => {
      const config: FeegrantEventDataSourceConfig = {
        action: 'set_feegrant',
      }
      dataSource = new FeegrantEventDataSource(config)
    })

    it('should handle multiple message events', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'set_feegrant' },
            { key: 'granter', value: 'cosmos1granter1' },
            { key: 'grantee', value: 'cosmos1grantee1' },
          ],
        },
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'set_feegrant' },
            { key: 'granter', value: 'cosmos1granter2' },
            { key: 'grantee', value: 'cosmos1grantee2' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(2)

      const firstMatch = result.find((r) => r.granter === 'cosmos1granter1')
      const secondMatch = result.find((r) => r.granter === 'cosmos1granter2')

      expect(firstMatch?.grantee).toBe('cosmos1grantee1')
      expect(secondMatch?.grantee).toBe('cosmos1grantee2')
    })

    it('should handle mixed event types', () => {
      const events: Event[] = [
        {
          type: 'bank',
          attributes: [{ key: 'action', value: 'send' }],
        },
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'set_feegrant' },
            { key: 'granter', value: 'cosmos1granter123' },
            { key: 'grantee', value: 'cosmos1grantee123' },
          ],
        },
        {
          type: 'wasm',
          attributes: [{ key: 'action', value: 'set_feegrant' }],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].granter).toBe('cosmos1granter123')
    })
  })

  describe('edge cases', () => {
    beforeEach(() => {
      const config: FeegrantEventDataSourceConfig = {
        action: 'set_feegrant',
      }
      dataSource = new FeegrantEventDataSource(config)
    })

    it('should handle empty events array', () => {
      const result = dataSource.match(createMockExtractorInput([]))
      expect(result).toHaveLength(0)
    })

    it('should handle message event with only action attribute', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [{ key: 'action', value: 'set_feegrant' }],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].granter).toBeUndefined()
      expect(result[0].grantee).toBeUndefined()
      expect(result[0].pruner).toBeUndefined()
    })

    it('should handle empty attributes array', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should handle duplicate attributes', () => {
      const events: Event[] = [
        {
          type: 'message',
          attributes: [
            { key: 'action', value: 'set_feegrant' },
            { key: 'granter', value: 'cosmos1granter123' },
            { key: 'granter', value: 'cosmos1granter456' }, // Duplicate key
            { key: 'grantee', value: 'cosmos1grantee123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].attributes.granter).toEqual(['cosmos1granter123', 'cosmos1granter456'])
    })
  })

  describe('isOurData method', () => {
    beforeEach(() => {
      const config: FeegrantEventDataSourceConfig = {
        action: 'set_feegrant',
        granter: 'cosmos1specificgranter',
      }
      dataSource = new FeegrantEventDataSource(config)
    })

    it('should return true for matching data', () => {
      const data = {
        action: 'set_feegrant',
        granter: 'cosmos1specificgranter',
        grantee: 'cosmos1grantee123',
        attributes: {},
        _attributes: [],
      }

      expect(dataSource.isOurData(data)).toBe(true)
    })

    it('should return false for wrong action', () => {
      const data = {
        action: 'revoke_feegrant',
        granter: 'cosmos1specificgranter',
        grantee: 'cosmos1grantee123',
        attributes: {},
        _attributes: [],
      }

      expect(dataSource.isOurData(data)).toBe(false)
    })

    it('should return false for wrong granter', () => {
      const data = {
        action: 'set_feegrant',
        granter: 'cosmos1wronggranter',
        grantee: 'cosmos1grantee123',
        attributes: {},
        _attributes: [],
      }

      expect(dataSource.isOurData(data)).toBe(false)
    })

    it('should return true when optional filters are not set', () => {
      const config: FeegrantEventDataSourceConfig = {
        action: 'set_feegrant',
      }
      dataSource = new FeegrantEventDataSource(config)

      const data = {
        action: 'set_feegrant',
        granter: 'cosmos1anygranter',
        grantee: 'cosmos1anygrantee',
        attributes: {},
        _attributes: [],
      }

      expect(dataSource.isOurData(data)).toBe(true)
    })
  })

  describe('static methods', () => {
    it('should have static source method', () => {
      const source = FeegrantEventDataSource.source('testHandler', {
        action: 'use_feegrant',
        granter: 'cosmos1granter123',
        grantee: 'cosmos1grantee123',
      })

      expect(source).toEqual({
        type: 'feegrant/event',
        handler: 'testHandler',
        config: {
          action: 'use_feegrant',
          granter: 'cosmos1granter123',
          grantee: 'cosmos1grantee123',
        },
      })
    })

    it('should have static handleable method', () => {
      const testData = {
        action: 'set_feegrant',
        granter: 'cosmos1granter123',
        grantee: 'cosmos1grantee123',
        attributes: {
          action: ['set_feegrant'],
          granter: ['cosmos1granter123'],
          grantee: ['cosmos1grantee123'],
        },
        _attributes: [
          { key: 'action', value: 'set_feegrant' },
          { key: 'granter', value: 'cosmos1granter123' },
          { key: 'grantee', value: 'cosmos1grantee123' },
        ],
      }

      const data = FeegrantEventDataSource.handleable('testHandler', testData)

      expect(data).toEqual({
        source: 'feegrant/event',
        handler: 'testHandler',
        data: testData,
      })
    })

    it('should have static data method', () => {
      const inputData = {
        action: 'revoke_feegrant',
        granter: 'cosmos1granter123',
        grantee: 'cosmos1grantee123',
        _attributes: [
          { key: 'action', value: 'revoke_feegrant' },
          { key: 'granter', value: 'cosmos1granter123' },
          { key: 'grantee', value: 'cosmos1grantee123' },
        ],
      }

      const result = FeegrantEventDataSource.data(inputData)

      expect(result).toEqual({
        source: 'feegrant/event',
        data: {
          action: 'revoke_feegrant',
          granter: 'cosmos1granter123',
          grantee: 'cosmos1grantee123',
          attributes: {
            action: ['revoke_feegrant'],
            granter: ['cosmos1granter123'],
            grantee: ['cosmos1grantee123'],
          },
          _attributes: [
            { key: 'action', value: 'revoke_feegrant' },
            { key: 'granter', value: 'cosmos1granter123' },
            { key: 'grantee', value: 'cosmos1grantee123' },
          ],
        },
      })
    })
  })
})
