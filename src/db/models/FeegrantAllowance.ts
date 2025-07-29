import { WhereOptions } from 'sequelize'
import {
  AllowNull,
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
      fields: ['granter', 'grantee'],
      unique: true,
    },
    {
      fields: ['granter'],
    },
    {
      fields: ['grantee'],
    },
    {
      fields: ['active'],
    },
  ],
})
export class FeegrantAllowance extends DependableEventModel {
  @PrimaryKey
  @AllowNull(false)
  @Column(DataType.TEXT)
  declare granter: string

  @PrimaryKey
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

  get block(): Block {
    return {
      height: BigInt(this.blockHeight),
      timeUnixMs: BigInt(this.blockTimeUnixMs),
    }
  }

  get dependentKey(): string {
    return getDependentKey(
      FeegrantAllowance.dependentKeyNamespace,
      `${this.granter}:${this.grantee}`
    )
  }

  // Only one event per granter-grantee pair.
  async getPreviousEvent(): Promise<FeegrantAllowance | null> {
    return null
  }

  static dependentKeyNamespace = DependentKeyNamespace.FeegrantAllowance
  static blockHeightKey: string = 'blockHeight'
  static blockTimeUnixMsKey: string = 'blockTimeUnixMs'

  // Returns a where clause that will match all events that are described by the
  // dependent keys.
  static getWhereClauseForDependentKeys(
    dependentKeys: ComputationDependentKey[]
  ): WhereOptions {
    // Parse granter:grantee pairs from dependent keys
    const granterGranteePairs = new Set<{ granter: string; grantee: string }>()
    
    for (const dependentKey of dependentKeys) {
      const key = dependentKey.key.replace(
        new RegExp(`^${this.dependentKeyNamespace}:`),
        ''
      )
      const [granter, grantee] = key.split(':')
      if (granter && grantee) {
        granterGranteePairs.add({ granter, grantee })
      }
    }

    if (granterGranteePairs.size === 0) {
      return {}
    }

    // Convert to OR conditions for each granter-grantee pair
    const pairs = Array.from(granterGranteePairs)
    if (pairs.length === 1) {
      return {
        granter: pairs[0].granter,
        grantee: pairs[0].grantee,
      }
    }

    return {
      $or: pairs.map(({ granter, grantee }) => ({
        granter,
        grantee,
      })),
    }
  }
}
