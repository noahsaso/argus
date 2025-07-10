import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript'

import { AccountKey } from './AccountKey'

export enum AccountKeyCreditPaymentSource {
  // cw-receipt contract.
  CwReceipt = 'cw-receipt',
  // Manually credited.
  Manual = 'manual',
}

export type AccountKeyCreditApiJson = {
  paymentSource: AccountKeyCreditPaymentSource
  paymentId: string
  paidFor: boolean
  paidAt: string | null
  amount: string // serialized bigint
  used: string // serialized bigint
}

@Table({
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['paymentSource', 'paymentId'],
    },
    {
      fields: ['amount'],
    },
  ],
})
export class AccountKeyCredit extends Model {
  @AllowNull(false)
  @ForeignKey(() => AccountKey)
  @Column(DataType.INTEGER)
  declare accountKeyId: number

  @BelongsTo(() => AccountKey)
  declare accountKey: AccountKey

  @AllowNull(false)
  @Column(DataType.STRING)
  declare paymentSource: AccountKeyCreditPaymentSource

  @AllowNull(false)
  @Column(DataType.STRING)
  declare paymentId: string

  // Null if not yet paid.
  @AllowNull
  @Column(DataType.DATE)
  declare paidAt: Date | null

  // Postgres integer type is 32-bit, which has a max of 2147483648, so use
  // bigint which is 64-bit instead.

  // Total number of credits allowed.
  @AllowNull(false)
  @Default(0n)
  @Column(DataType.BIGINT)
  declare amount: string

  // Total number of credits used.
  @AllowNull(false)
  @Default(0n)
  @Column(DataType.BIGINT)
  declare used: string

  // Total number of times this credit has been used.
  @AllowNull(false)
  @Default(0n)
  @Column(DataType.BIGINT)
  declare hits: string

  get paidFor(): boolean {
    return this.paidAt !== null
  }

  get remaining(): bigint {
    return BigInt(this.amount) - BigInt(this.used)
  }

  get apiJson(): AccountKeyCreditApiJson {
    return {
      paymentSource: this.paymentSource,
      paymentId: this.paymentId,
      paidFor: this.paidFor,
      paidAt: this.paidAt?.toISOString() || null,
      amount: this.amount.toString(),
      used: this.used.toString(),
    }
  }

  async addCredits(amount: number): Promise<void> {
    await this.increment('amount', { by: amount })
    await this.update({
      // Keep original paidAt if already exists.
      paidAt: this.paidAt || new Date(),
    })
  }

  // Compute the number of credits needed to query a range of blocks.
  //
  // Use 1 credit for the query, and 1 credit for every 10,000 blocks. Querying
  // 1 block uses 1 credit, 2-10,000 blocks uses 2 credits, 10,001-20,000 uses
  // 3, etc. Round up to the nearest credit.
  static creditsForBlockInterval(blockInterval: bigint): number {
    if (blockInterval <= 0n) {
      return 0
    } else if (blockInterval === 1n) {
      return 1
    }

    return Number(
      1n + blockInterval / 10000n + (blockInterval % 10000n === 0n ? 0n : 1n)
    )
  }

  static creditsForWebhook = 20
}
