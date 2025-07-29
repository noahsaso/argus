import { beforeEach, describe, expect, it } from 'vitest'
import { Op } from 'sequelize'

import { FeegrantAllowance } from '@/db'
import { DependentKeyNamespace } from '@/types'
import { getDependentKey } from '@/utils'

describe('FeegrantAllowance', () => {
  const mockAllowance = {
    granter: 'xion1granter123',
    grantee: 'xion1grantee456',
    blockHeight: '100',
    blockTimeUnixMs: '1640995200000',
    blockTimestamp: new Date('2022-01-01T00:00:00.000Z'),
    allowanceData: 'base64encodeddata',
    allowanceType: 'BasicAllowance',
    active: true,
  }

  beforeEach(async () => {
    await FeegrantAllowance.destroy({ where: {} })
  })

  describe('model creation and retrieval', () => {
    it('creates allowance with historical tracking', async () => {
      const allowance = await FeegrantAllowance.create(mockAllowance)

      expect(allowance.granter).toBe(mockAllowance.granter)
      expect(allowance.grantee).toBe(mockAllowance.grantee)
      expect(allowance.blockHeight).toBe(mockAllowance.blockHeight)
      expect(allowance.active).toBe(true)
    })

    it('allows multiple records for same granter-grantee pair with different block heights', async () => {
      // Create first allowance
      await FeegrantAllowance.create(mockAllowance)

      // Create second allowance at different block height
      const secondAllowance = {
        ...mockAllowance,
        blockHeight: '200',
        active: false, // Revoked
      }
      await FeegrantAllowance.create(secondAllowance)

      const allAllowances = await FeegrantAllowance.findAll({
        where: {
          granter: mockAllowance.granter,
          grantee: mockAllowance.grantee,
        },
        order: [['blockHeight', 'ASC']],
      })

      expect(allAllowances).toHaveLength(2)
      expect(allAllowances[0].active).toBe(true)
      expect(allAllowances[1].active).toBe(false)
    })

    it('retrieves most recent allowance for granter-grantee pair', async () => {
      // Create multiple allowances at different block heights
      await FeegrantAllowance.create(mockAllowance)
      await FeegrantAllowance.create({
        ...mockAllowance,
        blockHeight: '200',
        allowanceData: 'updateddata',
      })

      const mostRecent = await FeegrantAllowance.findOne({
        where: {
          granter: mockAllowance.granter,
          grantee: mockAllowance.grantee,
        },
        order: [['blockHeight', 'DESC']],
      })

      expect(mostRecent?.blockHeight).toBe('200')
      expect(mostRecent?.allowanceData).toBe('updateddata')
    })
  })

  describe('getPreviousEvent', () => {
    it('returns null for first event', async () => {
      const allowance = await FeegrantAllowance.create(mockAllowance)
      const previous = await allowance.getPreviousEvent()
      expect(previous).toBeNull()
    })

    it('returns previous event correctly', async () => {
      // Create first allowance
      await FeegrantAllowance.create(mockAllowance)

      // Create second allowance
      const secondAllowance = await FeegrantAllowance.create({
        ...mockAllowance,
        blockHeight: '200',
        allowanceData: 'updateddata',
      })

      const previous = await secondAllowance.getPreviousEvent()
      expect(previous).not.toBeNull()
      expect(previous?.blockHeight).toBe('100')
      expect(previous?.allowanceData).toBe('base64encodeddata')
    })

    it('caches previous event result', async () => {
      await FeegrantAllowance.create(mockAllowance)
      const secondAllowance = await FeegrantAllowance.create({
        ...mockAllowance,
        blockHeight: '200',
      })

      // First call
      const previous1 = await secondAllowance.getPreviousEvent()
      // Second call should use cache
      const previous2 = await secondAllowance.getPreviousEvent()

      expect(previous1).toBe(previous2)
      expect(secondAllowance.previousEvent).toBeDefined()
    })
  })

  describe('dependentKey generation', () => {
    it('generates correct dependent key', async () => {
      const allowance = await FeegrantAllowance.create(mockAllowance)
      const expectedKey = getDependentKey(
        DependentKeyNamespace.FeegrantAllowance,
        mockAllowance.granter,
        mockAllowance.grantee
      )

      expect(allowance.dependentKey).toBe(expectedKey)
    })

    it('dependent key includes granter and grantee', () => {
      const key = getDependentKey(
        DependentKeyNamespace.FeegrantAllowance,
        'granter123',
        'grantee456'
      )

      expect(key).toContain('granter123')
      expect(key).toContain('grantee456')
    })
  })

  describe('getWhereClauseForDependentKeys', () => {
    it('handles single granter-grantee pair', () => {
      const dependentKeys = [
        {
          key: getDependentKey(
            DependentKeyNamespace.FeegrantAllowance,
            'granter1',
            'grantee1'
          ),
          prefix: false,
        },
      ]

      const whereClause = FeegrantAllowance.getWhereClauseForDependentKeys(
        dependentKeys
      )

      expect(whereClause).toEqual({
        [Op.or]: [
          {
            granter: 'granter1',
            grantee: {
              [Op.or]: [{ [Op.in]: ['grantee1'] }],
            },
          },
        ],
      })
    })

    it('handles multiple granter-grantee pairs', () => {
      const dependentKeys = [
        {
          key: getDependentKey(
            DependentKeyNamespace.FeegrantAllowance,
            'granter1',
            'grantee1'
          ),
          prefix: false,
        },
        {
          key: getDependentKey(
            DependentKeyNamespace.FeegrantAllowance,
            'granter2',
            'grantee2'
          ),
          prefix: false,
        },
      ]

      const whereClause = FeegrantAllowance.getWhereClauseForDependentKeys(
        dependentKeys
      )

      expect(whereClause).toEqual({
        [Op.or]: [
          {
            granter: 'granter1',
            grantee: {
              [Op.or]: [{ [Op.in]: ['grantee1'] }],
            },
          },
          {
            granter: 'granter2',
            grantee: {
              [Op.or]: [{ [Op.in]: ['grantee2'] }],
            },
          },
        ],
      })
    })

    it('handles wildcard granter keys', () => {
      const dependentKeys = [
        {
          key: getDependentKey(
            DependentKeyNamespace.FeegrantAllowance,
            '*',
            'grantee1'
          ),
          prefix: true,
        },
      ]

      const whereClause = FeegrantAllowance.getWhereClauseForDependentKeys(
        dependentKeys
      )

      expect(whereClause).toEqual({
        [Op.or]: [
          {
            grantee: {
              [Op.or]: [{ [Op.like]: 'grantee1%' }],
            },
          },
        ],
      })
    })

    it('handles empty dependent keys', () => {
      const whereClause = FeegrantAllowance.getWhereClauseForDependentKeys([])
      expect(whereClause).toEqual({})
    })
  })

  describe('block property', () => {
    it('returns correct block object', async () => {
      const allowance = await FeegrantAllowance.create(mockAllowance)
      const block = allowance.block

      expect(block.height).toBe(BigInt(mockAllowance.blockHeight))
      expect(block.timeUnixMs).toBe(BigInt(mockAllowance.blockTimeUnixMs))
    })
  })

  describe('static properties', () => {
    it('has correct dependent key namespace', () => {
      expect(FeegrantAllowance.dependentKeyNamespace).toBe(
        DependentKeyNamespace.FeegrantAllowance
      )
    })

    it('has correct block height key', () => {
      expect(FeegrantAllowance.blockHeightKey).toBe('blockHeight')
    })

    it('has correct block time key', () => {
      expect(FeegrantAllowance.blockTimeUnixMsKey).toBe('blockTimeUnixMs')
    })
  })
})
