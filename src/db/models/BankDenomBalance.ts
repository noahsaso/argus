import { Op, WhereOptions } from 'sequelize'
import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  PrimaryKey,
  Table,
} from 'sequelize-typescript'

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
    {
      unique: true,
      fields: ['address', 'denom'],
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
export class BankDenomBalance extends DependableEventModel {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: string

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare address: string

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare denom: string

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare balance: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare blockHeight: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare blockTimeUnixMs: string

  @AllowNull(false)
  @Column(DataType.DATE)
  declare blockTimestamp: Date

  get block(): Block {
    return {
      height: BigInt(this.blockHeight),
      timeUnixMs: BigInt(this.blockTimeUnixMs),
    }
  }

  get dependentKey(): string {
    return getDependentKey(
      BankDenomBalance.dependentKeyNamespace,
      this.address,
      this.denom
    )
  }

  // Only one event per address/denom pair.
  async getPreviousEvent(): Promise<BankDenomBalance | null> {
    return null
  }

  static dependentKeyNamespace = DependentKeyNamespace.BankDenomBalance
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

      const denom = key
        // 3. Remove address from key.
        .replace(new RegExp(`^${address || '\\*'}:`), '')
        // 4. Replace wildcard symbol with LIKE wildcard for database query.
        .replace(/\*/g, '%')

      return {
        ...acc,
        [address]: [
          ...(acc[address] ?? []),
          {
            denom,
            prefix: dependentKey.prefix,
          },
        ],
      }
    }, {} as Record<string, { denom: string; prefix: boolean }[]>)

    return {
      [Op.or]: Object.entries(dependentKeysByAddress).map(([address, keys]) => {
        const exactKeys = keys
          .filter(({ denom, prefix }) => !prefix && !denom.includes('%'))
          .map(({ denom }) => denom)
        const wildcardKeys = keys
          .filter(({ denom, prefix }) => prefix || denom.includes('%'))
          .map(({ denom, prefix }) => denom + (prefix ? '%' : ''))

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
