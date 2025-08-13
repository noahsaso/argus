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
    // Take advantage of TimescaleDB SkipScan.
    {
      unique: true,
      fields: [
        'proposalId',
        {
          name: 'blockHeight',
          order: 'DESC',
        },
      ],
    },
  ],
})
export class GovProposal extends DependableEventModel {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare proposalId: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare blockHeight: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare blockTimeUnixMs: string

  @AllowNull(false)
  @Column(DataType.DATE)
  declare blockTimestamp: Date

  // Base64-encoded protobuf data.
  @AllowNull(false)
  @Column(DataType.TEXT)
  declare data: string

  get block(): Block {
    return {
      height: BigInt(this.blockHeight),
      timeUnixMs: BigInt(this.blockTimeUnixMs),
    }
  }

  get dependentKey(): string {
    return getDependentKey(GovProposal.dependentKeyNamespace, this.proposalId)
  }

  // Get the previous event for this proposalId. If this is the first event for
  // this proposalId, return null. Cache the result so it can be reused since
  // this shouldn't change.
  previousEvent?: GovProposal | null
  async getPreviousEvent(cache = true): Promise<GovProposal | null> {
    if (this.previousEvent === undefined || !cache) {
      this.previousEvent = await GovProposal.findOne({
        where: {
          proposalId: this.proposalId,
          blockHeight: {
            [Op.lt]: this.blockHeight,
          },
        },
        order: [['blockHeight', 'DESC']],
      })
    }

    return this.previousEvent
  }

  static dependentKeyNamespace = DependentKeyNamespace.GovProposal
  static blockHeightKey: string = 'blockHeight'
  static blockTimeUnixMsKey: string = 'blockTimeUnixMs'

  // Returns a where clause that will match all events that are described by the
  // dependent keys.
  static getWhereClauseForDependentKeys(
    dependentKeys: ComputationDependentKey[]
  ): WhereOptions {
    // If any dependent keys are prefixed or contain wildcards, just look for
    // any proposal, since you can't wildcard search a bigint (and it would make
    // no sense to do so). A formula will only ever need a specific proposal or
    // all proposals.
    if (
      dependentKeys.some(({ key, prefix }) => prefix || key.includes('*')) ||
      !dependentKeys.length
    ) {
      return {}
    }

    const exactKeys = dependentKeys
      .filter(({ key, prefix }) => !prefix && !key.includes('*'))
      .map(({ key }) =>
        key.replace(new RegExp(`^${this.dependentKeyNamespace}:`), '')
      )

    return {
      // Related logic in `makeComputationDependencyWhere` in `src/db/utils.ts`.
      proposalId: exactKeys,
    }
  }
}
