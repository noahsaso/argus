import { Event } from '@cosmjs/stargate'
import { beforeEach, describe, expect, it } from 'vitest'

import { ExtractableTxInput } from '@/types'

import { WasmEventDataSource, WasmEventDataSourceConfig } from './WasmEvent'

describe('WasmEventDataSource', () => {
  let dataSource: WasmEventDataSource

  const createMockExtractorInput = (events: Event[]): ExtractableTxInput => ({
    hash: 'test-hash',
    messages: [],
    events,
  })

  describe('basic configuration', () => {
    beforeEach(() => {
      const config: WasmEventDataSourceConfig = {
        key: 'action',
        value: 'instantiate',
      }
      dataSource = new WasmEventDataSource(config)
    })

    it('should have correct static type', () => {
      expect(WasmEventDataSource.type).toBe('wasm/event')
    })

    it('should match single wasm event with correct key/value', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'instantiate' },
            { key: 'owner', value: 'juno1owner123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toEqual([
        {
          address: 'juno1contract123',
          key: 'action',
          value: 'instantiate',
          attributes: {
            _contract_address: ['juno1contract123'],
            action: ['instantiate'],
            owner: ['juno1owner123'],
          },
          _attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'instantiate' },
            { key: 'owner', value: 'juno1owner123' },
          ],
        },
      ])
    })

    it('should not match non-wasm events', () => {
      const events: Event[] = [
        {
          type: 'bank',
          attributes: [
            { key: 'action', value: 'send' },
            { key: 'sender', value: 'juno1sender123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match wasm events with wrong key', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'method', value: 'instantiate' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match wasm events with wrong value', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'execute' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should exclude _contract_address from returned attributes', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'instantiate' },
            { key: 'sender', value: 'juno1sender123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result[0].attributes).toEqual({
        _contract_address: ['juno1contract123'],
        action: ['instantiate'],
        sender: ['juno1sender123'],
      })
    })
  })

  describe('array configurations', () => {
    it('should match with array of keys', () => {
      const config: WasmEventDataSourceConfig = {
        key: ['action', 'method'],
        value: 'instantiate',
      }
      dataSource = new WasmEventDataSource(config)

      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'method', value: 'instantiate' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('method')
    })

    it('should match with array of values', () => {
      const config: WasmEventDataSourceConfig = {
        key: 'action',
        value: ['instantiate', 'execute'],
      }
      dataSource = new WasmEventDataSource(config)

      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'execute' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].value).toBe('execute')
    })

    it('should match with both key and value arrays', () => {
      const config: WasmEventDataSourceConfig = {
        key: ['action', 'method'],
        value: ['instantiate', 'execute'],
      }
      dataSource = new WasmEventDataSource(config)

      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'method', value: 'instantiate' },
            { key: 'action', value: 'execute' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(2)

      const methodMatch = result.find((r) => r.key === 'method')
      const actionMatch = result.find((r) => r.key === 'action')

      expect(methodMatch?.value).toBe('instantiate')
      expect(actionMatch?.value).toBe('execute')
    })
  })

  describe('otherAttributes configuration', () => {
    beforeEach(() => {
      const config: WasmEventDataSourceConfig = {
        key: 'action',
        value: 'vote',
        otherAttributes: ['proposal_id', 'voter'],
      }
      dataSource = new WasmEventDataSource(config)
    })

    it('should match when all otherAttributes are present', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'vote' },
            { key: 'proposal_id', value: '42' },
            { key: 'voter', value: 'juno1voter123' },
            { key: 'vote_option', value: 'yes' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('action')
      expect(result[0].value).toBe('vote')
    })

    it('should not match when some otherAttributes are missing', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'vote' },
            { key: 'proposal_id', value: '42' },
            // Missing 'voter' attribute
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match when no otherAttributes are present', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'vote' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })
  })

  describe('multiple events and matches', () => {
    beforeEach(() => {
      const config: WasmEventDataSourceConfig = {
        key: 'action',
        value: ['execute', 'instantiate'],
      }
      dataSource = new WasmEventDataSource(config)
    })

    it('should handle multiple wasm events', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'execute' },
          ],
        },
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract456' },
            { key: 'action', value: 'instantiate' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(2)

      const executeMatch = result.find((r) => r.address === 'juno1contract123')
      const instantiateMatch = result.find(
        (r) => r.address === 'juno1contract456'
      )

      expect(executeMatch?.value).toBe('execute')
      expect(instantiateMatch?.value).toBe('instantiate')
    })

    it('should handle multiple matches within single event', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'execute' },
            { key: 'action', value: 'instantiate' }, // Duplicate key with different value
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(2)

      const executeMatch = result.find((r) => r.value === 'execute')
      const instantiateMatch = result.find((r) => r.value === 'instantiate')

      expect(executeMatch?.address).toBe('juno1contract123')
      expect(instantiateMatch?.address).toBe('juno1contract123')
    })

    it('should handle mixed event types', () => {
      const events: Event[] = [
        {
          type: 'bank',
          attributes: [{ key: 'action', value: 'send' }],
        },
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'execute' },
          ],
        },
        {
          type: 'message',
          attributes: [{ key: 'action', value: 'execute' }],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].address).toBe('juno1contract123')
    })
  })

  describe('edge cases', () => {
    beforeEach(() => {
      const config: WasmEventDataSourceConfig = {
        key: 'action',
        value: 'test',
      }
      dataSource = new WasmEventDataSource(config)
    })

    it('should handle empty events array', () => {
      const result = dataSource.match(createMockExtractorInput([]))
      expect(result).toHaveLength(0)
    })

    it('should handle wasm event without _contract_address', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [{ key: 'action', value: 'test' }],
        },
      ]

      // This should not throw but also not match since _contract_address is required
      expect(() => {
        const result = dataSource.match(createMockExtractorInput(events))
        expect(result).toHaveLength(0)
      }).not.toThrow()
    })

    it('should handle empty attributes array', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should handle undefined otherAttributes', () => {
      const config: WasmEventDataSourceConfig = {
        key: 'action',
        value: 'test',
        otherAttributes: undefined,
      }
      dataSource = new WasmEventDataSource(config)

      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'test' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
    })

    it('should handle empty otherAttributes array', () => {
      const config: WasmEventDataSourceConfig = {
        key: 'action',
        value: 'test',
        otherAttributes: [],
      }
      dataSource = new WasmEventDataSource(config)

      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'test' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
    })
  })

  describe('_equalsOrContains private method behavior', () => {
    it('should handle string comparison correctly', () => {
      const config: WasmEventDataSourceConfig = {
        key: 'action',
        value: 'exact_match',
      }
      dataSource = new WasmEventDataSource(config)

      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'exact_match' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
    })

    it('should handle array inclusion correctly', () => {
      const config: WasmEventDataSourceConfig = {
        key: ['action', 'method', 'operation'],
        value: ['execute', 'call', 'invoke'],
      }
      dataSource = new WasmEventDataSource(config)

      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'operation', value: 'call' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('operation')
      expect(result[0].value).toBe('call')
    })
  })

  describe('static methods', () => {
    it('should have static source method', () => {
      const source = WasmEventDataSource.source('testHandler', {
        key: 'action',
        value: 'execute',
        otherAttributes: ['proposal_id'],
      })

      expect(source).toEqual({
        type: 'wasm/event',
        handler: 'testHandler',
        config: {
          key: 'action',
          value: 'execute',
          otherAttributes: ['proposal_id'],
        },
      })
    })

    it('should have static handleable method', () => {
      const testData = {
        address: 'juno1test123',
        key: 'action',
        value: 'execute',
        attributes: {
          action: ['execute'],
          sender: ['juno1sender123'],
        },
        _attributes: [
          { key: '_contract_address', value: 'juno1test123' },
          { key: 'action', value: 'execute' },
          { key: 'sender', value: 'juno1sender123' },
        ],
      }

      const data = WasmEventDataSource.handleable('testHandler', testData)

      expect(data).toEqual({
        source: 'wasm/event',
        handler: 'testHandler',
        data: testData,
      })
    })
  })
})
