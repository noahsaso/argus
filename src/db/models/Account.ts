import { randomUUID } from 'crypto'

import jwt from 'jsonwebtoken'
import {
  AllowNull,
  Column,
  DataType,
  Default,
  HasMany,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript'

import { ConfigManager } from '@/config'

import { AccountCodeIdSet } from './AccountCodeIdSet'
import { AccountDepositWebhookRegistration } from './AccountDepositWebhookRegistration'
import { AccountKey } from './AccountKey'
import {
  AccountKeyCredit,
  AccountKeyCreditPaymentSource,
} from './AccountKeyCredit'
import { AccountWebhook } from './AccountWebhook'

// Stores the nonce for each public key, which is used to prevent replay
// attacks of past authenticated messages.
@Table({
  timestamps: true,
})
export class Account extends Model {
  @PrimaryKey
  @Column(DataType.STRING)
  declare publicKey: string

  @AllowNull(false)
  @Default(0)
  @Column(DataType.INTEGER)
  declare nonce: number

  @HasMany(() => AccountKey, 'accountPublicKey')
  declare keys: AccountKey[]

  @HasMany(() => AccountWebhook, 'accountPublicKey')
  declare webhooks: AccountWebhook[]

  @HasMany(() => AccountDepositWebhookRegistration, 'accountPublicKey')
  declare depositWebhookRegistrations: AccountDepositWebhookRegistration[]

  @HasMany(() => AccountCodeIdSet, 'accountPublicKey')
  declare codeIdSets: AccountCodeIdSet[]

  /**
   * Adds a new infinite key to this account.
   */
  public async addInfiniteKey({ name }: { name: string }) {
    const { key: apiKey, hash: hashedKey } = AccountKey.generateKeyAndHash()

    const accountKey = await this.$create<AccountKey>('key', {
      name,
      hashedKey,
    })

    await accountKey.$create<AccountKeyCredit>('credit', {
      paymentSource: AccountKeyCreditPaymentSource.Manual,
      paymentId: randomUUID(),
      amount: '-1',
      paidAt: new Date(),
    })

    return {
      apiKey,
    }
  }

  // Generates a random API key and creates a key on this account with it. Also
  // setup one credit for the key to accept payment.
  public async generateKey({
    name,
    description,
  }: Pick<AccountKey, 'name' | 'description'>) {
    // Generate key with hash, and create AccountKey.
    const { key: apiKey, hash: hashedKey } = AccountKey.generateKeyAndHash()

    const accountKey = await this.$create<AccountKey>('key', {
      name,
      description,
      hashedKey,
    })

    await accountKey.$create<AccountKeyCredit>('credit', {
      paymentSource: AccountKeyCreditPaymentSource.CwReceipt,
      paymentId: randomUUID(),
    })

    return {
      apiKey,
      accountKey,
    }
  }

  // Get JWT token for login. Expires in 30 days.
  public getAuthToken() {
    const { accountsJwtSecret } = ConfigManager.load()
    if (!accountsJwtSecret) {
      throw new Error('JWT not configured.')
    }

    return jwt.sign(
      {
        publicKey: this.publicKey,
      },
      accountsJwtSecret,
      {
        expiresIn: '30d',
      }
    )
  }
}
