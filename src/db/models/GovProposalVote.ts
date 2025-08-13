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
        'proposalId',
        'voterAddress',
        {
          name: 'blockHeight',
          order: 'DESC',
        },
      ],
    },
  ],
})
export class GovProposalVote extends DependableEventModel {
  @AllowNull(false)
  @Column(DataType.STRING)
  declare voterAddress: string

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
    return getDependentKey(
      GovProposalVote.dependentKeyNamespace,
      this.proposalId,
      this.voterAddress
    )
  }

  // Get the previous event for this proposalId. If this is the first event for
  // this proposalId, return null. Cache the result so it can be reused since
  // this shouldn't change.
  previousEvent?: GovProposalVote | null
  async getPreviousEvent(cache = true): Promise<GovProposalVote | null> {
    if (this.previousEvent === undefined || !cache) {
      this.previousEvent = await GovProposalVote.findOne({
        where: {
          proposalId: this.proposalId,
          voterAddress: this.voterAddress,
          blockHeight: {
            [Op.lt]: this.blockHeight,
          },
        },
        order: [['blockHeight', 'DESC']],
      })
    }

    return this.previousEvent
  }

  static dependentKeyNamespace = DependentKeyNamespace.GovProposalVote
  static blockHeightKey: string = 'blockHeight'
  static blockTimeUnixMsKey: string = 'blockTimeUnixMs'

  // Returns a where clause that will match all events that are described by the
  // dependent keys.
  static getWhereClauseForDependentKeys(
    dependentKeys: ComputationDependentKey[]
  ): WhereOptions {
    const dependentKeysByProposalId = dependentKeys.reduce(
      (acc, dependentKey) => {
        // 1. Remove namespace from key.
        const key = dependentKey.key.replace(
          new RegExp(`^${this.dependentKeyNamespace}:`),
          ''
        )

        // 2. Extract proposalId from key.
        // Dependent keys for any proposal start with "*:".
        const proposalId = key.startsWith('*:') ? '' : key.split(':')[0]

        const voterAddress = key
          // 3. Remove proposalId from key.
          .replace(new RegExp(`^${proposalId || '\\*'}:`), '')
          // 4. Replace wildcard symbol with LIKE wildcard for database query.
          .replace(/\*/g, '%')

        return {
          ...acc,
          [proposalId]: [
            ...(acc[proposalId] ?? []),
            {
              voterAddress,
              prefix: dependentKey.prefix,
            },
          ],
        }
      },
      {} as Record<string, { voterAddress: string; prefix: boolean }[]>
    )

    return {
      [Op.or]: Object.entries(dependentKeysByProposalId).map(
        ([proposalId, keys]) => {
          const exactKeys = keys
            .filter(
              ({ voterAddress, prefix }) =>
                !prefix && !voterAddress.includes('%')
            )
            .map(({ voterAddress }) => voterAddress)
          const wildcardKeys = keys
            .filter(
              ({ voterAddress, prefix }) => prefix || voterAddress.includes('%')
            )
            .map(
              ({ voterAddress, prefix }) => voterAddress + (prefix ? '%' : '')
            )

          return {
            // Only include if proposalId is defined.
            ...(proposalId && { proposalId }),
            // Related logic in `makeComputationDependencyWhere` in
            // `src/db/computation.ts`.
            voterAddress: {
              [Op.or]: [
                // Exact matches.
                ...(exactKeys.length > 0 ? [{ [Op.in]: exactKeys }] : []),
                // Wildcards. May or may not be prefixes.
                ...wildcardKeys.map((voterAddress) => ({
                  [Op.like]: voterAddress,
                })),
              ],
            },
          }
        }
      ),
    }
  }
}
