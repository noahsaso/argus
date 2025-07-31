import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Block, FeegrantAllowance, State } from '@/db'

import { feegrant } from '../../../../../tracer/handlers/feegrant'

// Mock dependencies
vi.mock('@/db', () => ({
  Block: {
    createMany: vi.fn(),
  },
  FeegrantAllowance: {
    create: vi.fn(),
  },
  State: {
    updateSingleton: vi.fn(),
  },
}))

describe('feegrant handler', () => {
  const mockConfig = {
    bech32Prefix: 'xion',
    home: '/tmp',
    localRpc: 'http://localhost:26657',
    remoteRpc: 'http://localhost:26657',
    db: {
      data: {
        host: 'localhost',
        port: 5432,
        database: 'test',
        username: 'test',
        password: 'test',
      },
      accounts: {
        host: 'localhost',
        port: 5432,
        database: 'test',
        username: 'test',
        password: 'test',
      },
    },
  }

  let handler: any

  beforeEach(async () => {
    vi.clearAllMocks()
    handler = await feegrant({
      config: mockConfig,
      sendWebhooks: false,
      autoCosmWasmClient: {} as any,
    })
  })

  describe('match function', () => {
    it('processes grant events correctly', () => {
      // Create a valid feegrant key: 0x00 || len(granter) || granter || len(grantee) || grantee
      const granterBytes = Buffer.from('xion1granter123')
      const granteeBytes = Buffer.from('xion1grantee456')

      const keyData = Buffer.concat([
        Buffer.from([0x00]), // prefix
        Buffer.from([granterBytes.length]), // granter length
        granterBytes, // granter
        Buffer.from([granteeBytes.length]), // grantee length
        granteeBytes, // grantee
      ])

      const trace = {
        key: Buffer.from(keyData).toString('base64'),
        value: 'allowancedata',
        operation: 'write',
        metadata: {
          blockHeight: '100',
        },
        blockTimeUnixMs: 1640995200000,
      }

      const result = handler.match(trace)

      expect(result).toBeDefined()
      expect(result.granter).toBe('xion1granter123')
      expect(result.grantee).toBe('xion1grantee456')
      expect(result.blockHeight).toBe('100')
      expect(result.active).toBe(true)
      expect(result.allowanceData).toBe('allowancedata')
    })

    it('processes revoke events correctly', () => {
      const granterBytes = Buffer.from('xion1granter123')
      const granteeBytes = Buffer.from('xion1grantee456')

      const keyData = Buffer.concat([
        Buffer.from([0x00]),
        Buffer.from([granterBytes.length]),
        granterBytes,
        Buffer.from([granteeBytes.length]),
        granteeBytes,
      ])

      const trace = {
        key: Buffer.from(keyData).toString('base64'),
        value: '',
        operation: 'delete',
        metadata: {
          blockHeight: '200',
        },
        blockTimeUnixMs: 1640995300000,
      }

      const result = handler.match(trace)

      expect(result).toBeDefined()
      expect(result.granter).toBe('xion1granter123')
      expect(result.grantee).toBe('xion1grantee456')
      expect(result.active).toBe(false)
      expect(result.allowanceData).toBe('')
    })

    it('ignores invalid keys with wrong prefix', () => {
      const keyData = Buffer.from([0x01, 0x05, 0x67, 0x72, 0x61, 0x6e, 0x74]) // wrong prefix

      const trace = {
        key: Buffer.from(keyData).toString('base64'),
        value: 'data',
        operation: 'write',
        metadata: {
          blockHeight: '100',
        },
        blockTimeUnixMs: 1640995200000,
      }

      const result = handler.match(trace)
      expect(result).toBeUndefined()
    })

    it('ignores keys that are too short', () => {
      const keyData = Buffer.from([0x00, 0x01]) // too short

      const trace = {
        key: Buffer.from(keyData).toString('base64'),
        value: 'data',
        operation: 'write',
        metadata: {
          blockHeight: '100',
        },
        blockTimeUnixMs: 1640995200000,
      }

      const result = handler.match(trace)
      expect(result).toBeUndefined()
    })

    it('handles malformed keys gracefully', () => {
      const keyData = Buffer.from([0x00, 0x20, 0x67, 0x72]) // length mismatch

      const trace = {
        key: Buffer.from(keyData).toString('base64'),
        value: 'data',
        operation: 'write',
        metadata: {
          blockHeight: '100',
        },
        blockTimeUnixMs: 1640995200000,
      }

      const result = handler.match(trace)
      expect(result).toBeUndefined()
    })

    it('generates correct event ID', () => {
      const granterBytes = Buffer.from('xion1granter123')
      const granteeBytes = Buffer.from('xion1grantee456')

      const keyData = Buffer.concat([
        Buffer.from([0x00]),
        Buffer.from([granterBytes.length]),
        granterBytes,
        Buffer.from([granteeBytes.length]),
        granteeBytes,
      ])

      const trace = {
        key: Buffer.from(keyData).toString('base64'),
        value: 'data',
        operation: 'write',
        metadata: {
          blockHeight: '100',
        },
        blockTimeUnixMs: 1640995200000,
      }

      const result = handler.match(trace)
      expect(result.id).toBe('100:xion1granter123:xion1grantee456')
    })
  })

  describe('process function', () => {
    it('creates blocks and allowances correctly', async () => {
      const events = [
        {
          id: '100:xion1granter1:xion1grantee1',
          granter: 'xion1granter1',
          grantee: 'xion1grantee1',
          blockHeight: '100',
          blockTimeUnixMs: '1640995200000',
          blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
          allowanceData: 'data1',
          allowanceType: null,
          active: true,
        },
        {
          id: '100:xion1granter2:xion1grantee2',
          granter: 'xion1granter2',
          grantee: 'xion1grantee2',
          blockHeight: '100',
          blockTimeUnixMs: '1640995200000',
          blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
          allowanceData: 'data2',
          allowanceType: null,
          active: true,
        },
      ]

      const mockAllowances = events.map((event) => ({
        ...event,
        toJSON: () => event,
      }))
      vi.mocked(FeegrantAllowance.create).mockResolvedValueOnce(
        mockAllowances[0] as any
      )
      vi.mocked(FeegrantAllowance.create).mockResolvedValueOnce(
        mockAllowances[1] as any
      )

      const result = await handler.process(events)

      // Check that blocks were created
      expect(Block.createMany).toHaveBeenCalledWith([
        {
          height: '100',
          timeUnixMs: '1640995200000',
        },
      ])

      // Check that allowances were created
      expect(FeegrantAllowance.create).toHaveBeenCalledTimes(2)
      expect(FeegrantAllowance.create).toHaveBeenCalledWith({
        granter: 'xion1granter1',
        grantee: 'xion1grantee1',
        blockHeight: '100',
        blockTimeUnixMs: '1640995200000',
        blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
        allowanceData: 'data1',
        allowanceType: null,
        active: true,
      })

      // Check that state was updated
      expect(State.updateSingleton).toHaveBeenCalled()

      expect(result).toEqual(mockAllowances)
    })

    it('handles multiple blocks correctly', async () => {
      const events = [
        {
          id: '100:xion1granter1:xion1grantee1',
          granter: 'xion1granter1',
          grantee: 'xion1grantee1',
          blockHeight: '100',
          blockTimeUnixMs: '1640995200000',
          blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
          allowanceData: 'data1',
          allowanceType: null,
          active: true,
        },
        {
          id: '200:xion1granter2:xion1grantee2',
          granter: 'xion1granter2',
          grantee: 'xion1grantee2',
          blockHeight: '200',
          blockTimeUnixMs: '1640995300000',
          blockTimestamp: new Date('2022-01-01T00:01:40.000Z'),
          allowanceData: 'data2',
          allowanceType: null,
          active: false,
        },
      ]

      const mockAllowances = events.map((event) => ({
        ...event,
        toJSON: () => event,
      }))
      vi.mocked(FeegrantAllowance.create).mockResolvedValueOnce(
        mockAllowances[0] as any
      )
      vi.mocked(FeegrantAllowance.create).mockResolvedValueOnce(
        mockAllowances[1] as any
      )

      await handler.process(events)

      // Check that both blocks were created
      expect(Block.createMany).toHaveBeenCalledWith([
        {
          height: '100',
          timeUnixMs: '1640995200000',
        },
        {
          height: '200',
          timeUnixMs: '1640995300000',
        },
      ])
    })

    it('updates state with latest block information', async () => {
      const events = [
        {
          id: '100:xion1granter1:xion1grantee1',
          granter: 'xion1granter1',
          grantee: 'xion1grantee1',
          blockHeight: '100',
          blockTimeUnixMs: '1640995200000',
          blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
          allowanceData: 'data1',
          allowanceType: null,
          active: true,
        },
        {
          id: '50:xion1granter2:xion1grantee2',
          granter: 'xion1granter2',
          grantee: 'xion1grantee2',
          blockHeight: '50',
          blockTimeUnixMs: '1640995100000',
          blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
          allowanceData: 'data2',
          allowanceType: null,
          active: true,
        },
      ]

      const mockAllowances = events.map((event) => ({
        ...event,
        toJSON: () => event,
      }))
      vi.mocked(FeegrantAllowance.create).mockResolvedValueOnce(
        mockAllowances[0] as any
      )
      vi.mocked(FeegrantAllowance.create).mockResolvedValueOnce(
        mockAllowances[1] as any
      )

      await handler.process(events)

      // Should use the latest block height (100) for state update
      const stateUpdateCall = vi.mocked(State.updateSingleton).mock.calls[0][0]
      expect(stateUpdateCall).toMatchObject({
        lastFeegrantBlockHeightExported: expect.any(Object),
        latestBlockHeight: expect.any(Object),
        latestBlockTimeUnixMs: expect.any(Object),
      })
    })
  })

  describe('handler properties', () => {
    it('has correct store name', () => {
      expect(handler.storeName).toBe('feegrant')
    })

    it('exports match and process functions', () => {
      expect(typeof handler.match).toBe('function')
      expect(typeof handler.process).toBe('function')
    })
  })
})
