import { randomUUID } from 'crypto'

import jwt from 'jsonwebtoken'
import { Transaction } from 'sequelize'
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

  @HasMany(() => AccountCodeIdSet, 'accountPublicKey')
  declare codeIdSets: AccountCodeIdSet[]

  /**
   * Finds or creates the account and adds a new operator-issued key with a
   * manual credit to it, all in one transaction (so a failed key creation does
   * not leave behind a new empty account). See `addManualKey`.
   */
  public static async issueKey({
    accountPublicKey,
    ...options
  }: {
    accountPublicKey: string
  } & Omit<Parameters<Account['addManualKey']>[0], 'transaction'>) {
    const publicKey = accountPublicKey?.trim()
    if (!publicKey) {
      throw new Error('Missing account.')
    }

    return await this.sequelize!.transaction(async (transaction) => {
      const [account, accountCreated] = await Account.findOrCreate({
        where: { publicKey },
        transaction,
      })

      return {
        account,
        accountCreated,
        ...(await account.addManualKey({ ...options, transaction })),
      }
    })
  }

  /**
   * Adds a new infinite key to this account.
   */
  public async addInfiniteKey({ name }: { name: string }) {
    const { apiKey } = await this.addManualKey({ name })
    return {
      apiKey,
    }
  }

  /**
   * Adds a new operator-issued key to this account with a paid-for manual
   * credit. The key and credit are created in one transaction.
   *
   * The plaintext API key is returned to the caller and never stored; only its
   * hash is saved.
   *
   * Throws an error if the name/description are invalid, the credit amount is
   * invalid, or a key with the same name already exists on this account.
   */
  public async addManualKey({
    name: _name,
    description: _description,
    credits = -1,
    transaction,
  }: {
    name: string
    description?: string | null
    /**
     * Credit amount. -1 means unlimited. Defaults to unlimited.
     */
    credits?: number
    /**
     * Optional existing transaction to run in. If not provided, a new one is
     * created.
     */
    transaction?: Transaction
  }): Promise<{
    apiKey: string
    accountKey: AccountKey
    credit: AccountKeyCredit
  }> {
    const name = _name?.trim()
    if (!name) {
      throw new Error('Missing name.')
    }
    if (name.length > 255) {
      throw new Error('Name too long.')
    }

    const description = _description?.trim() || null
    if (description && description.length > 255) {
      throw new Error('Description too long.')
    }

    if (credits !== -1 && (!Number.isSafeInteger(credits) || credits <= 0)) {
      throw new Error('Credits must be a positive integer or -1 (unlimited).')
    }

    const create = async (transaction: Transaction) => {
      if (
        await this.$count('keys', {
          where: { name },
          transaction,
        })
      ) {
        throw new Error(
          `A key named "${name}" already exists for account ${this.publicKey}.`
        )
      }

      const { key: apiKey, hash: hashedKey } = AccountKey.generateKeyAndHash()

      const accountKey = await this.$create<AccountKey>(
        'key',
        {
          name,
          description,
          hashedKey,
        },
        { transaction }
      )

      const credit = await accountKey.$create<AccountKeyCredit>(
        'credit',
        {
          paymentSource: AccountKeyCreditPaymentSource.Manual,
          paymentId: randomUUID(),
          amount: String(credits),
          paidAt: new Date(),
        },
        { transaction }
      )

      return {
        apiKey,
        accountKey,
        credit,
      }
    }

    return transaction
      ? await create(transaction)
      : await this.sequelize.transaction(create)
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
