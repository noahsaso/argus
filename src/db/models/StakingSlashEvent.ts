import { Op, WhereOptions } from 'sequelize'
import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Table,
} from 'sequelize-typescript'

import {
  Block,
  ComputationDependentKey,
  DependableEventModel,
  DependentKeyNamespace,
} from '@/types'
import { getDependentKey } from '@/utils'

import { Validator } from './Validator'

@Table({
  timestamps: true,
  indexes: [
    // This unique index is used to ensure that we don't duplicate events during
    // export or re-export. Validators are jailed when a slash occurs, so they
    // won't be slashed multiple times for the same infraction.
    {
      // Postgres truncates names to 63 characters, so name the index explicitly
      // with the truncated name. Otherwise sync does not recognize the existing
      // index and tries to create it again.
      name: 'staking_slash_events_validator_operator_address_registered_bloc',
      unique: true,
      fields: [
        'validatorOperatorAddress',
        'registeredBlockHeight',
        'infractionBlockHeight',
      ],
    },
    {
      // Speed up ordering queries.
      fields: ['registeredBlockHeight'],
    },
    {
      // Speed up ordering queries.
      fields: ['registeredBlockTimeUnixMs'],
    },
  ],
})
export class StakingSlashEvent extends DependableEventModel {
  @AllowNull(false)
  @ForeignKey(() => Validator)
  @Column(DataType.STRING)
  declare validatorOperatorAddress: string

  @BelongsTo(() => Validator)
  declare validator: Validator

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare registeredBlockHeight: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare registeredBlockTimeUnixMs: string

  @AllowNull(false)
  @Column(DataType.DATE)
  declare registeredBlockTimestamp: Date

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare infractionBlockHeight: string

  @AllowNull(false)
  @Column(DataType.STRING)
  declare slashFactor: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare amountSlashed: string

  @AllowNull(false)
  @Column(DataType.STRING)
  declare effectiveFraction: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare stakedTokensBurned: string

  get block(): Block {
    return {
      height: BigInt(this.registeredBlockHeight),
      timeUnixMs: BigInt(this.registeredBlockTimeUnixMs),
    }
  }

  get dependentKey(): string {
    return getDependentKey(
      StakingSlashEvent.dependentKeyNamespace,
      this.validatorOperatorAddress,
      this.registeredBlockHeight,
      this.infractionBlockHeight
    )
  }

  static dependentKeyNamespace = DependentKeyNamespace.StakingSlash
  static blockHeightKey: string = 'registeredBlockHeight'
  static blockTimeUnixMsKey: string = 'registeredBlockTimeUnixMs'

  // Returns a where clause that will match all events that are described by the
  // dependent keys.
  static getWhereClauseForDependentKeys(
    dependentKeys: ComputationDependentKey[]
  ): WhereOptions {
    const dependentKeysByValidator = dependentKeys.reduce(
      (acc, { key }) => {
        const dependentKey = key.replace(
          new RegExp(`^${this.dependentKeyNamespace}:`),
          ''
        )

        const [
          validatorOperatorAddress,
          registeredBlockHeight,
          infractionBlockHeight,
        ] = dependentKey.split(':')

        return {
          ...acc,
          [validatorOperatorAddress]: [
            ...(acc[validatorOperatorAddress] ?? []),
            {
              registeredBlockHeight,
              infractionBlockHeight,
            },
          ],
        }
      },
      {} as Record<
        string,
        {
          registeredBlockHeight: string | undefined
          infractionBlockHeight: string | undefined
        }[]
      >
    )

    return {
      [Op.or]: Object.entries(dependentKeysByValidator).map(
        ([
          validatorOperatorAddress,
          infractionBlockHeightsAndBlockHeights,
        ]) => ({
          validatorOperatorAddress,
          // Related logic in `makeComputationDependencyWhere` in
          // `src/db/utils.ts`.
          [Op.or]: infractionBlockHeightsAndBlockHeights.map(
            ({ registeredBlockHeight, infractionBlockHeight }) => ({
              // Exact and wildcard matches.
              ...(!registeredBlockHeight || registeredBlockHeight === '*'
                ? {}
                : { registeredBlockHeight }),
              // Exact and wildcard matches.
              ...(!infractionBlockHeight || infractionBlockHeight === '*'
                ? {}
                : { infractionBlockHeight }),
            })
          ),
        })
      ),
    }
  }
}
