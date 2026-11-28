import { Event } from '@cosmjs/stargate'
import { beforeEach, describe, expect, it } from 'vitest'

import { ExtractableTxInput } from '@/types'

import {
  BankTransferEventData,
  BankTransferEventDataSource,
  BankTransferEventDataSourceConfig,
} from './BankTransferEvent'

describe('BankTransferEventDataSource', () => {
  let dataSource: BankTransferEventDataSource

  const createMockExtractorInput = (events: Event[]): ExtractableTxInput => ({
    hash: 'test-hash',
    messages: [],
    events,
  })

  describe('basic configuration', () => {
    beforeEach(() => {
      const config: BankTransferEventDataSourceConfig = {}
      dataSource = new BankTransferEventDataSource(config)
    })

    it('should have correct static type', () => {
      expect(BankTransferEventDataSource.type).toBe('bank/transfer')
    })

    it('should match single bank transfer event', () => {
      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
            { key: 'msg_index', value: '0' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))

      expect(result).toEqual([
        {
          sender: 'juno1sender123',
          recipient: 'juno1recipient123',
          denom: 'ujuno',
          amount: '1000000',
        },
      ])
    })

    it('should not match non-transfer events', () => {
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

    it('should not match transfer events without sender', () => {
      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match transfer events without recipient', () => {
      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match transfer events without amount', () => {
      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match transfer events with empty sender', () => {
      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: '' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match transfer events with empty recipient', () => {
      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: '' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match transfer events with empty amount', () => {
      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })
  })

  describe('sender filter configuration', () => {
    it('should match when sender is in include list', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: {
          include: ['juno1sender123', 'juno1sender456'],
        },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].sender).toBe('juno1sender123')
    })

    it('should not match when sender is not in include list', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: {
          include: ['juno1sender456'],
        },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match when sender is in exclude list', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: {
          exclude: ['juno1sender123'],
        },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should match when sender is not in exclude list', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: {
          exclude: ['juno1sender456'],
        },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
    })

    it('should match when sender is in include and not in exclude', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: {
          include: ['juno1sender123', 'juno1sender456'],
          exclude: ['juno1sender456'],
        },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
    })
  })

  describe('recipient filter configuration', () => {
    it('should match when recipient is in include list', () => {
      const config: BankTransferEventDataSourceConfig = {
        recipient: {
          include: ['juno1recipient123'],
        },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].recipient).toBe('juno1recipient123')
    })

    it('should not match when recipient is not in include list', () => {
      const config: BankTransferEventDataSourceConfig = {
        recipient: {
          include: ['juno1recipient456'],
        },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match when recipient is in exclude list', () => {
      const config: BankTransferEventDataSourceConfig = {
        recipient: {
          exclude: ['juno1recipient123'],
        },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })
  })

  describe('denom filter configuration', () => {
    it('should match when denom is in include list', () => {
      const config: BankTransferEventDataSourceConfig = {
        denom: {
          include: ['ujuno', 'uatom'],
        },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].denom).toBe('ujuno')
    })

    it('should not match when denom is not in include list', () => {
      const config: BankTransferEventDataSourceConfig = {
        denom: {
          include: ['uatom'],
        },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match when denom is in exclude list', () => {
      const config: BankTransferEventDataSourceConfig = {
        denom: {
          exclude: ['ujuno'],
        },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should handle IBC denoms correctly', () => {
      const config: BankTransferEventDataSourceConfig = {
        denom: {
          include: [
            'ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9',
          ],
        },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            {
              key: 'amount',
              value:
                '1000000ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9',
            },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].denom).toBe(
        'ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9'
      )
    })
  })

  describe('combined filter configuration', () => {
    it('should match when all filters pass', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: { include: ['juno1sender123'] },
        recipient: { include: ['juno1recipient123'] },
        denom: { include: ['ujuno'] },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
    })

    it('should not match when sender filter fails', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: { include: ['juno1other'] },
        recipient: { include: ['juno1recipient123'] },
        denom: { include: ['ujuno'] },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match when recipient filter fails', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: { include: ['juno1sender123'] },
        recipient: { include: ['juno1other'] },
        denom: { include: ['ujuno'] },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should not match when denom filter fails', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: { include: ['juno1sender123'] },
        recipient: { include: ['juno1recipient123'] },
        denom: { include: ['uatom'] },
      }
      dataSource = new BankTransferEventDataSource(config)

      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })
  })

  describe('multiple events', () => {
    beforeEach(() => {
      const config: BankTransferEventDataSourceConfig = {}
      dataSource = new BankTransferEventDataSource(config)
    })

    it('should handle multiple transfer events', () => {
      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient456' },
            { key: 'sender', value: 'juno1sender456' },
            { key: 'amount', value: '2000000uatom' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(2)

      const junoTransfer = result.find((r) => r.denom === 'ujuno')
      const atomTransfer = result.find((r) => r.denom === 'uatom')

      expect(junoTransfer).toEqual({
        sender: 'juno1sender123',
        recipient: 'juno1recipient123',
        denom: 'ujuno',
        amount: '1000000',
      })
      expect(atomTransfer).toEqual({
        sender: 'juno1sender456',
        recipient: 'juno1recipient456',
        denom: 'uatom',
        amount: '2000000',
      })
    })

    it('should handle mixed event types', () => {
      const events: Event[] = [
        {
          type: 'wasm',
          attributes: [
            { key: '_contract_address', value: 'juno1contract123' },
            { key: 'action', value: 'execute' },
          ],
        },
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno' },
          ],
        },
        {
          type: 'message',
          attributes: [
            { key: 'action', value: '/cosmos.bank.v1beta1.MsgSend' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].sender).toBe('juno1sender123')
    })
  })

  describe('edge cases', () => {
    beforeEach(() => {
      const config: BankTransferEventDataSourceConfig = {}
      dataSource = new BankTransferEventDataSource(config)
    })

    it('should handle empty events array', () => {
      const result = dataSource.match(createMockExtractorInput([]))
      expect(result).toHaveLength(0)
    })

    it('should handle empty attributes array', () => {
      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should handle invalid amount format (no coin parsed)', () => {
      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: 'invalid_amount' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(0)
    })

    it('should parse only the first coin from amount with multiple coins', () => {
      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '1000000ujuno,500000uatom' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].denom).toBe('ujuno')
      expect(result[0].amount).toBe('1000000')
    })

    it('should handle large amounts', () => {
      const events: Event[] = [
        {
          type: 'transfer',
          attributes: [
            { key: 'recipient', value: 'juno1recipient123' },
            { key: 'sender', value: 'juno1sender123' },
            { key: 'amount', value: '999999999999999999999ujuno' },
          ],
        },
      ]

      const result = dataSource.match(createMockExtractorInput(events))
      expect(result).toHaveLength(1)
      expect(result[0].amount).toBe('999999999999999999999')
    })
  })

  describe('isOurData', () => {
    it('should return true when all filters match', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: { include: ['juno1sender123'] },
        recipient: { include: ['juno1recipient123'] },
        denom: { include: ['ujuno'] },
      }
      dataSource = new BankTransferEventDataSource(config)

      const data: BankTransferEventData = {
        sender: 'juno1sender123',
        recipient: 'juno1recipient123',
        denom: 'ujuno',
        amount: '1000000',
      }

      expect(dataSource.isOurData(data)).toBe(true)
    })

    it('should return false when sender filter is missing from config', () => {
      const config: BankTransferEventDataSourceConfig = {
        recipient: { include: ['juno1recipient123'] },
        denom: { include: ['ujuno'] },
      }
      dataSource = new BankTransferEventDataSource(config)

      const data: BankTransferEventData = {
        sender: 'juno1sender123',
        recipient: 'juno1recipient123',
        denom: 'ujuno',
        amount: '1000000',
      }

      expect(dataSource.isOurData(data)).toBe(false)
    })

    it('should return false when recipient filter is missing from config', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: { include: ['juno1sender123'] },
        denom: { include: ['ujuno'] },
      }
      dataSource = new BankTransferEventDataSource(config)

      const data: BankTransferEventData = {
        sender: 'juno1sender123',
        recipient: 'juno1recipient123',
        denom: 'ujuno',
        amount: '1000000',
      }

      expect(dataSource.isOurData(data)).toBe(false)
    })

    it('should return false when denom filter is missing from config', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: { include: ['juno1sender123'] },
        recipient: { include: ['juno1recipient123'] },
      }
      dataSource = new BankTransferEventDataSource(config)

      const data: BankTransferEventData = {
        sender: 'juno1sender123',
        recipient: 'juno1recipient123',
        denom: 'ujuno',
        amount: '1000000',
      }

      expect(dataSource.isOurData(data)).toBe(false)
    })

    it('should return false when sender does not match', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: { include: ['juno1other'] },
        recipient: { include: ['juno1recipient123'] },
        denom: { include: ['ujuno'] },
      }
      dataSource = new BankTransferEventDataSource(config)

      const data: BankTransferEventData = {
        sender: 'juno1sender123',
        recipient: 'juno1recipient123',
        denom: 'ujuno',
        amount: '1000000',
      }

      expect(dataSource.isOurData(data)).toBe(false)
    })

    it('should return false when recipient does not match', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: { include: ['juno1sender123'] },
        recipient: { include: ['juno1other'] },
        denom: { include: ['ujuno'] },
      }
      dataSource = new BankTransferEventDataSource(config)

      const data: BankTransferEventData = {
        sender: 'juno1sender123',
        recipient: 'juno1recipient123',
        denom: 'ujuno',
        amount: '1000000',
      }

      expect(dataSource.isOurData(data)).toBe(false)
    })

    it('should return false when denom does not match', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: { include: ['juno1sender123'] },
        recipient: { include: ['juno1recipient123'] },
        denom: { include: ['uatom'] },
      }
      dataSource = new BankTransferEventDataSource(config)

      const data: BankTransferEventData = {
        sender: 'juno1sender123',
        recipient: 'juno1recipient123',
        denom: 'ujuno',
        amount: '1000000',
      }

      expect(dataSource.isOurData(data)).toBe(false)
    })

    it('should handle exclude filters correctly', () => {
      const config: BankTransferEventDataSourceConfig = {
        sender: { exclude: ['juno1blocked'] },
        recipient: { exclude: ['juno1blocked'] },
        denom: { exclude: ['blockedtoken'] },
      }
      dataSource = new BankTransferEventDataSource(config)

      const validData: BankTransferEventData = {
        sender: 'juno1sender123',
        recipient: 'juno1recipient123',
        denom: 'ujuno',
        amount: '1000000',
      }

      // Note: isOurData requires all filters to be present, but exclude-only filters
      // with empty include arrays will pass the filter check
      expect(dataSource.isOurData(validData)).toBe(true)

      const blockedSenderData: BankTransferEventData = {
        sender: 'juno1blocked',
        recipient: 'juno1recipient123',
        denom: 'ujuno',
        amount: '1000000',
      }

      expect(dataSource.isOurData(blockedSenderData)).toBe(false)
    })
  })

  describe('static methods', () => {
    it('should have static source method', () => {
      const source = BankTransferEventDataSource.source('testHandler', {
        sender: { include: ['juno1sender123'] },
        recipient: { exclude: ['juno1blocked'] },
      })

      expect(source).toEqual({
        type: 'bank/transfer',
        handler: 'testHandler',
        config: {
          sender: { include: ['juno1sender123'] },
          recipient: { exclude: ['juno1blocked'] },
        },
      })
    })

    it('should have static handleable method', () => {
      const testData: BankTransferEventData = {
        sender: 'juno1sender123',
        recipient: 'juno1recipient123',
        denom: 'ujuno',
        amount: '1000000',
      }

      const handleable = BankTransferEventDataSource.handleable(
        'testHandler',
        testData
      )

      expect(handleable).toEqual({
        source: 'bank/transfer',
        handler: 'testHandler',
        data: testData,
      })
    })

    it('should have static data method', () => {
      const testData: BankTransferEventData = {
        sender: 'juno1sender123',
        recipient: 'juno1recipient123',
        denom: 'ujuno',
        amount: '1000000',
      }

      const data = BankTransferEventDataSource.data(testData)

      expect(data).toEqual({
        source: 'bank/transfer',
        data: testData,
      })
    })
  })
})
