import { Op, WhereOptions } from 'sequelize'
import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
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

import { Contract } from './Contract'

@Table({
  timestamps: true,
  indexes: [
    // Take advantage of TimescaleDB SkipScan. No need for a unique index since
    // the primary key is a composite key of these fields already.
    {
      fields: [
        'contractAddress',
        {
          name: 'name',
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
          name: 'name',
          operator: 'text_pattern_ops',
        },
        {
          name: 'blockHeight',
          order: 'DESC',
        },
      ],
    },
    {
      name: 'wasm_state_event_transformations_name_trgm_idx',
      // Speeds up queries. Use trigram index for string name to speed up
      // partial matches (LIKE).
      fields: [
        {
          name: 'name',
          operator: 'gin_trgm_ops',
        },
      ],
      concurrently: true,
      using: 'gin',
    },
  ],
})
export class WasmStateEventTransformation extends DependableEventModel {
  @PrimaryKey
  @AllowNull(false)
  @ForeignKey(() => Contract)
  @Column(DataType.STRING)
  declare contractAddress: string

  @BelongsTo(() => Contract)
  declare contract: Contract

  @PrimaryKey
  @AllowNull(false)
  @Column(DataType.TEXT)
  declare name: string

  @PrimaryKey
  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare blockHeight: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare blockTimeUnixMs: string

  @AllowNull
  @Column(DataType.JSONB)
  declare value: unknown | null

  get block(): Block {
    return {
      height: BigInt(this.blockHeight),
      timeUnixMs: BigInt(this.blockTimeUnixMs),
    }
  }

  get dependentKey(): string {
    return getDependentKey(
      WasmStateEventTransformation.dependentKeyNamespace,
      this.contractAddress,
      this.name
    )
  }

  // Get the previous event for this name. If this is the first event for this
  // name, return null. Cache the result so it can be reused since this
  // shouldn't change.
  previousEvent?: WasmStateEventTransformation | null
  async getPreviousEvent(
    cache = true
  ): Promise<WasmStateEventTransformation | null> {
    if (this.previousEvent === undefined || !cache) {
      this.previousEvent = await WasmStateEventTransformation.findOne({
        where: {
          contractAddress: this.contractAddress,
          name: this.name,
          blockHeight: {
            [Op.lt]: this.blockHeight,
          },
        },
        order: [['blockHeight', 'DESC']],
      })
    }

    return this.previousEvent
  }

  static dependentKeyNamespace =
    DependentKeyNamespace.WasmStateEventTransformation
  static blockHeightKey: string = 'blockHeight'
  static blockTimeUnixMsKey: string = 'blockTimeUnixMs'

  // Returns a where clause that will match all events that are described by the
  // dependent keys.
  static getWhereClauseForDependentKeys(
    dependentKeys: ComputationDependentKey[]
  ): WhereOptions {
    // Some keys (most likely those with wildcards) may not have a contract
    // address. It is fine to group these together.
    const dependentKeysByContract = dependentKeys.reduce(
      (acc, dependentKey) => {
        // 1. Remove namespace from key.
        let key = dependentKey.key.replace(
          new RegExp(`^${this.dependentKeyNamespace}:`),
          ''
        )

        // 2. Extract contract address from key. Dependent keys for any contract
        //    start with "*:".
        const contractAddress = key.startsWith('*:') ? '' : key.split(':')[0]

        key = key
          // 3. Remove contract address from key.
          .replace(new RegExp(`^${contractAddress || '\\*'}:`), '')
          // 4. Replace wildcard symbol with LIKE wildcard for database query.
          .replace(/\*/g, '%')

        return {
          ...acc,
          [contractAddress]: [
            ...(acc[contractAddress] ?? []),
            {
              key,
              prefix: dependentKey.prefix,
            },
          ],
        }
      },
      {} as Record<string, { key: string; prefix: boolean }[]>
    )

    return {
      [Op.or]: Object.entries(dependentKeysByContract).map(
        ([contractAddress, keys]) => {
          const exactKeys = keys
            .filter(({ key, prefix }) => !prefix && !key.includes('%'))
            .map(({ key }) => key)
          const wildcardKeys = keys
            .filter(({ key, prefix }) => prefix || key.includes('%'))
            .map(({ key, prefix }) => key + (prefix ? '%' : ''))

          return {
            // Only include if contract address is defined.
            ...(contractAddress && { contractAddress }),
            // Related logic in `makeComputationDependencyWhere` in
            // `src/db/utils.ts`.
            name: {
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
        }
      ),
    }
  }
}
