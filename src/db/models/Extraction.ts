import { Op, WhereOptions } from 'sequelize'
import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
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

import { Contract } from './Contract'

@Table({
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: [
        'address',
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
      name: 'extractions_name_trgm_idx',
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
export class Extraction extends DependableEventModel {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: string

  /**
   * The relevant address for this extraction. This may be a contract, a wallet,
   * etc. If no relevant address, this will be an empty string (since primary
   * keys cannot contain null).
   */
  @AllowNull(false)
  @Column(DataType.TEXT)
  declare address: string

  /**
   * The contract that this extraction is related to, if any.
   */
  @BelongsTo(() => Contract, {
    foreignKey: 'address',
    // Don't enforce this on the database level, since the address may not refer
    // to a contract.
    constraints: false,
  })
  declare contract: Contract | null

  /**
   * The name of the extraction.
   */
  @AllowNull(false)
  @Column(DataType.TEXT)
  declare name: string

  /**
   * The block height.
   */
  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare blockHeight: string

  /**
   * The block time in unix milliseconds.
   */
  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare blockTimeUnixMs: string

  /**
   * The hash of the transaction that triggered the extraction.
   */
  @AllowNull(false)
  @Column(DataType.TEXT)
  declare txHash: string

  /**
   * The data that was extracted.
   */
  @AllowNull(false)
  @Column(DataType.JSONB)
  declare data: unknown

  get block(): Block {
    return {
      height: BigInt(this.blockHeight),
      timeUnixMs: BigInt(this.blockTimeUnixMs),
    }
  }

  get dependentKey(): string {
    return getDependentKey(
      Extraction.dependentKeyNamespace,
      this.address,
      this.name
    )
  }

  // Get the previous event for this name. If this is the first event for this
  // name, return null. Cache the result so it can be reused since this
  // shouldn't change.
  previousEvent?: Extraction | null
  async getPreviousEvent(cache = true): Promise<Extraction | null> {
    if (this.previousEvent === undefined || !cache) {
      this.previousEvent = await Extraction.findOne({
        where: {
          address: this.address,
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

  /**
   * Get the contract that this extraction is related to, if any.
   */
  async getContract(): Promise<Contract | null> {
    if (!this.address) {
      return null
    }
    this.contract ??= await Contract.findByPk(this.address)
    return this.contract
  }

  static dependentKeyNamespace = DependentKeyNamespace.Extraction
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

      // 2. Extract address from key, which may be a wildcard or empty string.
      const address = key.split(':')[0]

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
          // Only include if address is not wildcard, which matches any.
          ...(address !== '*' && { address }),
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
      }),
    }
  }
}
