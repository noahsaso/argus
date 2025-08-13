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
  FeegrantAllowanceJson,
} from '@/types'
import { getDependentKey, serializeBlock } from '@/utils'

@Table({
  timestamps: true,
  indexes: [
    // Take advantage of TimescaleDB SkipScan.
    {
      unique: true,
      fields: [
        'granter',
        'grantee',
        {
          name: 'blockHeight',
          order: 'DESC',
        },
      ],
    },
    {
      fields: [
        {
          name: 'granter',
          operator: 'text_pattern_ops',
        },
        {
          name: 'blockHeight',
          order: 'DESC',
        },
      ],
    },
    {
      fields: [
        {
          name: 'grantee',
          operator: 'text_pattern_ops',
        },
        {
          name: 'blockHeight',
          order: 'DESC',
        },
      ],
    },
    // Speeds up transform script queries iterating over all events in order of
    // block height.
    {
      fields: ['blockHeight'],
    },
  ],
})
export class FeegrantAllowance extends DependableEventModel {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: string

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare granter: string

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare grantee: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare blockHeight: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare blockTimeUnixMs: string

  @AllowNull(false)
  @Column(DataType.DATE)
  declare blockTimestamp: Date

  // Store the raw allowance data (base64 protobuf)
  @AllowNull(false)
  @Column(DataType.TEXT)
  declare allowanceData: string

  // Optional: parsed allowance type for easier querying
  @AllowNull(true)
  @Column(DataType.TEXT)
  declare allowanceType: string | null

  // Track if this allowance is active (false when revoked/expired)
  @AllowNull(false)
  @Column(DataType.BOOLEAN)
  declare active: boolean

  get json(): FeegrantAllowanceJson {
    return {
      granter: this.granter,
      grantee: this.grantee,
      allowanceData: this.allowanceData,
      allowanceType: this.allowanceType,
      active: this.active,
      block: serializeBlock(this.block),
    }
  }

  get block(): Block {
    return {
      height: BigInt(this.blockHeight),
      timeUnixMs: BigInt(this.blockTimeUnixMs),
    }
  }

  get dependentKey(): string {
    return getDependentKey(
      FeegrantAllowance.dependentKeyNamespace,
      this.granter,
      this.grantee
    )
  }

  // Get the previous event for this granter-grantee pair. If this is the first event for this
  // pair, return null. Cache the result so it can be reused since this shouldn't
  // change.
  previousEvent?: FeegrantAllowance | null
  async getPreviousEvent(cache = true): Promise<FeegrantAllowance | null> {
    if (this.previousEvent === undefined || !cache) {
      this.previousEvent = await FeegrantAllowance.findOne({
        where: {
          granter: this.granter,
          grantee: this.grantee,
          blockHeight: {
            [Op.lt]: this.blockHeight,
          },
        },
        order: [['blockHeight', 'DESC']],
      })
    }

    return this.previousEvent
  }

  static dependentKeyNamespace = DependentKeyNamespace.FeegrantAllowance
  static blockHeightKey: string = 'blockHeight'
  static blockTimeUnixMsKey: string = 'blockTimeUnixMs'

  // Returns a where clause that will match all events that are described by the
  // dependent keys.
  static getWhereClauseForDependentKeys(
    dependentKeys: ComputationDependentKey[]
  ): WhereOptions {
    // Handle empty dependent keys array
    if (dependentKeys.length === 0) {
      return {}
    }

    // Some keys (most likely those with wildcards) may not have a granter
    // address. It is fine to group these together.
    const dependentKeysByGranter = dependentKeys.reduce((acc, dependentKey) => {
      // 1. Remove namespace from key.
      let key = dependentKey.key.replace(
        new RegExp(`^${this.dependentKeyNamespace}:`),
        ''
      )

      // 2. Extract granter address from key.
      // Dependent keys for any granter start with "*:".
      const granter = key.startsWith('*:') ? '' : key.split(':')[0]

      key = key
        // 3. Remove granter address from key.
        .replace(new RegExp(`^${granter || '\\*'}:`), '')
        // 4. Replace wildcard symbol with LIKE wildcard for database query.
        .replace(/\*/g, '%')

      return {
        ...acc,
        [granter]: [
          ...(acc[granter] ?? []),
          {
            key,
            prefix: dependentKey.prefix,
          },
        ],
      }
    }, {} as Record<string, { key: string; prefix: boolean }[]>)

    return {
      [Op.or]: Object.entries(dependentKeysByGranter).map(([granter, keys]) => {
        const exactKeys = keys
          .filter(({ key, prefix }) => !prefix && !key.includes('%'))
          .map(({ key }) => key)
        const wildcardKeys = keys
          .filter(({ key, prefix }) => prefix || key.includes('%'))
          .map(({ key, prefix }) => key + (prefix ? '%' : ''))

        return {
          // Only include if granter address is defined.
          ...(granter && { granter }),
          // Related logic in `makeComputationDependencyWhere` in
          // `src/db/utils.ts`.
          grantee: {
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
