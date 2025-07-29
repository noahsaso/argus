import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FeegrantAllowance } from '@/db'
import { DependentKeyNamespace } from '@/types'
import { getDependentKey } from '@/utils'
import { getEnv } from './env'

// Mock dependencies
vi.mock('@/db', () => ({
  FeegrantAllowance: {
    findOne: vi.fn(),
    findAll: vi.fn(),
    dependentKeyNamespace: 'FeegrantAllowance',
  },
}))

describe('feegrant formula functions', () => {
  const mockBlock = {
    height: BigInt(100),
    timeUnixMs: BigInt(1640995200000),
  }

  const mockEnvOptions = {
    chainId: 'xion-testnet-1',
    block: mockBlock,
    useBlockDate: false,
  }

  let env: any
  let dependentKeys: any[]
  let onFetch: any

  beforeEach(() => {
    vi.clearAllMocks()
    dependentKeys = []
    onFetch = vi.fn()
    
    env = getEnv({
      ...mockEnvOptions,
      dependentKeys,
      onFetch,
    })
  })

  describe('getFeegrantAllowance', () => {
    it('returns allowance for valid granter-grantee pair', async () => {
      const mockAllowance = {
        granter: 'xion1granter123',
        grantee: 'xion1grantee456',
        blockHeight: '100',
        blockTimeUnixMs: '1640995200000',
        blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
        allowanceData: 'base64data',
        allowanceType: 'BasicAllowance',
        active: true,
      } as any

      vi.mocked(FeegrantAllowance.findOne).mockResolvedValueOnce(mockAllowance)

      const result = await env.getFeegrantAllowance('xion1granter123', 'xion1grantee456')

      expect(result).toEqual({
        granter: 'xion1granter123',
        grantee: 'xion1grantee456',
        allowanceData: 'base64data',
        allowanceType: 'BasicAllowance',
        blockHeight: '100',
        blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
        active: true,
      })

      // Check that dependent key was added
      expect(dependentKeys).toHaveLength(1)
      expect(dependentKeys[0].key).toBe(
        getDependentKey(DependentKeyNamespace.FeegrantAllowance, 'xion1granter123', 'xion1grantee456')
      )
      expect(dependentKeys[0].prefix).toBe(false)

      // Check that onFetch was called
      expect(onFetch).toHaveBeenCalledWith([mockAllowance])
    })

    it('returns undefined for non-existent allowance', async () => {
      vi.mocked(FeegrantAllowance.findOne).mockResolvedValueOnce(null)

      const result = await env.getFeegrantAllowance('xion1granter123', 'xion1grantee456')

      expect(result).toBeUndefined()
      expect(onFetch).not.toHaveBeenCalled()
    })

    it('uses cache when available', async () => {
      const mockAllowance = {
        granter: 'xion1granter123',
        grantee: 'xion1grantee456',
        blockHeight: '100',
        blockTimeUnixMs: '1640995200000',
        blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
        allowanceData: 'base64data',
        allowanceType: 'BasicAllowance',
        active: true,
      }

      // Create env with cache
      const cache = {
        events: {
          [getDependentKey(DependentKeyNamespace.FeegrantAllowance, 'xion1granter123', 'xion1grantee456')]: [mockAllowance as any],
        },
        contracts: {},
      } as any

      const envWithCache = getEnv({
        ...mockEnvOptions,
        dependentKeys,
        onFetch,
        cache,
      })

      const result = await envWithCache.getFeegrantAllowance('xion1granter123', 'xion1grantee456')

      expect(result).toEqual({
        granter: 'xion1granter123',
        grantee: 'xion1grantee456',
        allowanceData: 'base64data',
        allowanceType: 'BasicAllowance',
        blockHeight: '100',
        blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
        active: true,
      })

      // Should not call database when using cache
      expect(FeegrantAllowance.findOne).not.toHaveBeenCalled()
      expect(onFetch).toHaveBeenCalledWith([mockAllowance])
    })
  })

  describe('getFeegrantAllowances', () => {
    it('returns allowances granted by address', async () => {
      const mockAllowances = [
        {
          granter: 'xion1granter123',
          grantee: 'xion1grantee456',
          blockHeight: '100',
          blockTimeUnixMs: '1640995200000',
          blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
          allowanceData: 'data1',
          allowanceType: 'BasicAllowance',
          active: true,
        },
        {
          granter: 'xion1granter123',
          grantee: 'xion1grantee789',
          blockHeight: '100',
          blockTimeUnixMs: '1640995200000',
          blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
          allowanceData: 'data2',
          allowanceType: 'PeriodicAllowance',
          active: true,
        },
      ]

      vi.mocked(FeegrantAllowance.findAll).mockResolvedValueOnce(mockAllowances as any)

      const result = await env.getFeegrantAllowances('xion1granter123', 'granted')

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        granter: 'xion1granter123',
        grantee: 'xion1grantee456',
        allowanceData: 'data1',
        allowanceType: 'BasicAllowance',
        blockHeight: '100',
        blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
        active: true,
      })

      // Check that dependent key was added with wildcard
      expect(dependentKeys).toHaveLength(1)
      expect(dependentKeys[0].key).toBe(
        getDependentKey(DependentKeyNamespace.FeegrantAllowance, 'xion1granter123', '*')
      )
      expect(dependentKeys[0].prefix).toBe(true)

      expect(onFetch).toHaveBeenCalledWith(mockAllowances)
    })

    it('returns allowances received by address', async () => {
      const mockAllowances = [
        {
          granter: 'xion1granter123',
          grantee: 'xion1grantee456',
          blockHeight: '100',
          blockTimeUnixMs: '1640995200000',
          blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
          allowanceData: 'data1',
          allowanceType: 'BasicAllowance',
          active: true,
        },
      ]

      vi.mocked(FeegrantAllowance.findAll).mockResolvedValueOnce(mockAllowances as any)

      const result = await env.getFeegrantAllowances('xion1grantee456', 'received')

      expect(result).toHaveLength(1)
      expect(result[0].grantee).toBe('xion1grantee456')

      // Check that dependent key was added with wildcard for grantee
      expect(dependentKeys[0].key).toBe(
        getDependentKey(DependentKeyNamespace.FeegrantAllowance, '*', 'xion1grantee456')
      )
    })

    it('filters out inactive allowances', async () => {
      const mockAllowances = [
        {
          granter: 'xion1granter123',
          grantee: 'xion1grantee456',
          blockHeight: '100',
          blockTimeUnixMs: '1640995200000',
          blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
          allowanceData: 'data1',
          allowanceType: 'BasicAllowance',
          active: true,
        },
        {
          granter: 'xion1granter123',
          grantee: 'xion1grantee789',
          blockHeight: '100',
          blockTimeUnixMs: '1640995200000',
          blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
          allowanceData: 'data2',
          allowanceType: 'BasicAllowance',
          active: false, // Inactive
        },
      ]

      vi.mocked(FeegrantAllowance.findAll).mockResolvedValueOnce(mockAllowances as any)

      const result = await env.getFeegrantAllowances('xion1granter123', 'granted')

      expect(result).toHaveLength(1)
      expect(result[0].grantee).toBe('xion1grantee456')
    })

    it('returns undefined for no allowances', async () => {
      vi.mocked(FeegrantAllowance.findAll).mockResolvedValueOnce([])

      const result = await env.getFeegrantAllowances('xion1granter123', 'granted')

      expect(result).toBeUndefined()
      expect(onFetch).not.toHaveBeenCalled()
    })

    it('defaults to granted type', async () => {
      const mockAllowances = [
        {
          granter: 'xion1granter123',
          grantee: 'xion1grantee456',
          blockHeight: '100',
          blockTimeUnixMs: '1640995200000',
          blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
          allowanceData: 'data1',
          allowanceType: 'BasicAllowance',
          active: true,
        },
      ]

      vi.mocked(FeegrantAllowance.findAll).mockResolvedValueOnce(mockAllowances as any)

      // Call without type parameter
      const result = await env.getFeegrantAllowances('xion1granter123')

      expect(result).toHaveLength(1)
      expect(dependentKeys[0].key).toBe(
        getDependentKey(DependentKeyNamespace.FeegrantAllowance, 'xion1granter123', '*')
      )
    })
  })

  describe('hasFeegrantAllowance', () => {
    it('returns true for active allowance', async () => {
      const mockAllowance = {
        granter: 'xion1granter123',
        grantee: 'xion1grantee456',
        blockHeight: '100',
        blockTimeUnixMs: '1640995200000',
        blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
        allowanceData: 'base64data',
        allowanceType: 'BasicAllowance',
        active: true,
      }

      vi.mocked(FeegrantAllowance.findOne).mockResolvedValueOnce(mockAllowance as any)

      const result = await env.hasFeegrantAllowance('xion1granter123', 'xion1grantee456')

      expect(result).toBe(true)
    })

    it('returns false for inactive allowance', async () => {
      const mockAllowance = {
        granter: 'xion1granter123',
        grantee: 'xion1grantee456',
        blockHeight: '100',
        blockTimeUnixMs: '1640995200000',
        blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
        allowanceData: 'base64data',
        allowanceType: 'BasicAllowance',
        active: false,
      }

      vi.mocked(FeegrantAllowance.findOne).mockResolvedValueOnce(mockAllowance as any)

      const result = await env.hasFeegrantAllowance('xion1granter123', 'xion1grantee456')

      expect(result).toBe(false)
    })

    it('returns false for non-existent allowance', async () => {
      vi.mocked(FeegrantAllowance.findOne).mockResolvedValueOnce(null)

      const result = await env.hasFeegrantAllowance('xion1granter123', 'xion1grantee456')

      expect(result).toBe(false)
    })
  })

  describe('block height filtering', () => {
    it('applies block height filter correctly', async () => {
      await env.getFeegrantAllowance('xion1granter123', 'xion1grantee456')

      expect(FeegrantAllowance.findOne).toHaveBeenCalledWith({
        where: {
          granter: 'xion1granter123',
          grantee: 'xion1grantee456',
          blockHeight: { $lte: BigInt(100) },
        },
        order: [['blockHeight', 'DESC']],
      })
    })

    it('applies block height filter to findAll queries', async () => {
      await env.getFeegrantAllowances('xion1granter123', 'granted')

      expect(FeegrantAllowance.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            granter: 'xion1granter123',
            blockHeight: { $lte: BigInt(100) },
          }),
        })
      )
    })
  })
})
