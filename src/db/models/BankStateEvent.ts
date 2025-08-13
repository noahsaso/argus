import { Op, WhereOptions } from 'sequelize'
import { AllowNull, Column, DataType, Table } from 'sequelize-typescript'

import {
  Block,
  ComputationDependentKey,
  DependableEventModel,
  DependentKeyNamespace,
} from '@/types'
import { getDependentKey } from '@/utils'

@Table({
  timestamps: true,
  indexes: [
    // Take advantage of TimescaleDB SkipScan.
    {
      unique: true,
      fields: [
        'address',
        'denom',
        {
          name: 'blockHeight',
          order: 'DESC',
        },
      ],
    },
    {
      fields: [
        'address',
        {
          name: 'blockHeight',
          order: 'DESC',
        },
      ],
    },
  ],
})
export class BankStateEvent extends DependableEventModel {
  @AllowNull(false)
  @Column(DataType.TEXT)
  declare address: string

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare denom: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare blockHeight: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare blockTimeUnixMs: string

  @AllowNull(false)
  @Column(DataType.DATE)
  declare blockTimestamp: Date

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare balance: string

  get block(): Block {
    return {
      height: BigInt(this.blockHeight),
      timeUnixMs: BigInt(this.blockTimeUnixMs),
    }
  }

  get dependentKey(): string {
    return getDependentKey(
      BankStateEvent.dependentKeyNamespace,
      this.address,
      this.denom
    )
  }

  // Get the previous event for this denom. If this is the first event for this
  // denom, return null. Cache the result so it can be reused since this
  // shouldn't change.
  previousEvent?: BankStateEvent | null
  async getPreviousEvent(cache = true): Promise<BankStateEvent | null> {
    if (this.previousEvent === undefined || !cache) {
      this.previousEvent = await BankStateEvent.findOne({
        where: {
          address: this.address,
          denom: this.denom,
          blockHeight: {
            [Op.lt]: this.blockHeight,
          },
        },
        order: [['blockHeight', 'DESC']],
      })
    }

    return this.previousEvent
  }

  static dependentKeyNamespace = DependentKeyNamespace.BankStateEvent
  static blockHeightKey: string = 'blockHeight'
  static blockTimeUnixMsKey: string = 'blockTimeUnixMs'

  // Returns a where clause that will match all events that are described by the
  // dependent keys.
  static getWhereClauseForDependentKeys(
    dependentKeys: ComputationDependentKey[]
  ): WhereOptions {
    // Some keys (most likely those with wildcards) may not have an address. It
    // is fine to group these together.
    const dependentKeysByAddress = dependentKeys.reduce((acc, dependentKey) => {
      // 1. Remove namespace from key.
      let key = dependentKey.key.replace(
        new RegExp(`^${this.dependentKeyNamespace}:`),
        ''
      )

      // 2. Extract address from key.
      // Dependent keys for any address start with "*:".
      const address = key.startsWith('*:') ? '' : key.split(':')[0]

      key = key
        // 3. Remove address from key.
        .replace(new RegExp(`^${address || '\\*'}:`), '')
        // 4. Replace wildcard symbol with LIKE wildcard for database query.
        .replace(/\*/g, '%')

      return {
        ...acc,
        [address]: [
          ...(acc[address] ?? []),
          {
            key,
            prefix: dependentKey.prefix,
          },
        ],
      }
    }, {} as Record<string, { key: string; prefix: boolean }[]>)

    return {
      [Op.or]: Object.entries(dependentKeysByAddress).map(([address, keys]) => {
        const exactKeys = keys
          .filter(({ key, prefix }) => !prefix && !key.includes('%'))
          .map(({ key }) => key)
        const wildcardKeys = keys
          .filter(({ key, prefix }) => prefix || key.includes('%'))
          .map(({ key, prefix }) => key + (prefix ? '%' : ''))

        return {
          // Only include if address is defined.
          ...(address && { address }),
          // Related logic in `makeComputationDependencyWhere` in
          // `src/db/utils.ts`.
          denom: {
            [Op.or]: [
              // Exact matches.
              ...(exactKeys.length > 0 ? [{ [Op.in]: exactKeys }] : []),
              // Wildcards. May or may not be prefixes.
              ...wildcardKeys.map((key) => ({
                [Op.like]: key,
              })),
            ],
          },
        }
      }),
    }
  }
}
