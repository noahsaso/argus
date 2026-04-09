import type Redis from 'ioredis'
import {
  AfterDestroy,
  AfterSave,
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript'

import { getRedis, getRedisConfig } from '@/config'

import { Account } from './Account'

export type AccountDepositWebhookRegistrationApiJson = {
  id: number
  description: string | null
  endpointUrl: string
  authHeader: string | null
  authToken: string | null
  watchedWallets: string[]
  allowedNativeDenoms: string[]
  allowedCw20Contracts: string[]
  enabled: boolean
}

type ActiveRegistrationsCache = {
  cachedAt: number
  registrations: AccountDepositWebhookRegistration[]
}

@Table({
  timestamps: true,
})
export class AccountDepositWebhookRegistration extends Model {
  static readonly activeRegistrationsCacheInvalidationChannel =
    'account-deposit-webhook-registrations:invalidate'

  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number

  @AllowNull(false)
  @ForeignKey(() => Account)
  @Column(DataType.STRING)
  declare accountPublicKey: string

  @BelongsTo(() => Account)
  declare account: Account

  @AllowNull
  @Column(DataType.STRING)
  declare description: string | null

  @AllowNull(false)
  @Column(DataType.STRING)
  declare endpointUrl: string

  @AllowNull
  @Column(DataType.STRING)
  declare authHeader: string | null

  @AllowNull
  @Column(DataType.STRING)
  declare authToken: string | null

  @AllowNull(false)
  @Default([])
  @Column(DataType.ARRAY(DataType.STRING))
  declare watchedWallets: string[]

  @AllowNull(false)
  @Default([])
  @Column(DataType.ARRAY(DataType.STRING))
  declare allowedNativeDenoms: string[]

  @AllowNull(false)
  @Default([])
  @Column(DataType.ARRAY(DataType.STRING))
  declare allowedCw20Contracts: string[]

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  declare enabled: boolean

  get apiJson(): AccountDepositWebhookRegistrationApiJson {
    return {
      id: this.id,
      description: this.description,
      endpointUrl: this.endpointUrl,
      authHeader: this.authHeader,
      authToken: this.authToken,
      watchedWallets: this.watchedWallets || [],
      allowedNativeDenoms: this.allowedNativeDenoms || [],
      allowedCw20Contracts: this.allowedCw20Contracts || [],
      enabled: this.enabled,
    }
  }

  matchesNativeDeposit(wallet: string, denom: string): boolean {
    return (
      this.enabled &&
      (this.watchedWallets || []).includes(wallet) &&
      (this.allowedNativeDenoms || []).includes(denom)
    )
  }

  matchesCw20Deposit(wallet: string, contractAddress: string): boolean {
    return (
      this.enabled &&
      (this.watchedWallets || []).includes(wallet) &&
      (this.allowedCw20Contracts || []).includes(contractAddress)
    )
  }

  private static activeRegistrationsCache?: ActiveRegistrationsCache
  private static activeRegistrationsCacheTtlMs = 5_000
  private static activeRegistrationsCacheSubscriber?: Redis
  private static activeRegistrationsCacheSubscriberReady?: Promise<void>

  static invalidateActiveRegistrationsCache() {
    this.activeRegistrationsCache = undefined
  }

  static async ensureActiveRegistrationsCacheSubscription(): Promise<void> {
    if (this.activeRegistrationsCacheSubscriberReady) {
      await this.activeRegistrationsCacheSubscriberReady
      return
    }

    if (!getRedisConfig()) {
      return
    }

    const subscriber = getRedis()
    subscriber.on('error', (error) => {
      console.error(
        'Error in deposit webhook registration cache invalidation subscriber:',
        error
      )
    })
    subscriber.on('message', (channel) => {
      if (channel === this.activeRegistrationsCacheInvalidationChannel) {
        this.invalidateActiveRegistrationsCache()
      }
    })

    this.activeRegistrationsCacheSubscriber = subscriber
    this.activeRegistrationsCacheSubscriberReady = subscriber
      .subscribe(this.activeRegistrationsCacheInvalidationChannel)
      .then(() => undefined)
      .catch((error) => {
        this.activeRegistrationsCacheSubscriber = undefined
        this.activeRegistrationsCacheSubscriberReady = undefined
        subscriber.disconnect()
        console.error(
          'Error subscribing to deposit webhook registration cache invalidation:',
          error
        )
      })

    await this.activeRegistrationsCacheSubscriberReady
  }

  static async closeActiveRegistrationsCacheSubscription(): Promise<void> {
    const subscriber = this.activeRegistrationsCacheSubscriber
    this.activeRegistrationsCacheSubscriber = undefined
    this.activeRegistrationsCacheSubscriberReady = undefined

    if (!subscriber) {
      return
    }

    await subscriber.quit().catch(() => {
      subscriber.disconnect()
    })
  }

  static async publishActiveRegistrationsCacheInvalidation(): Promise<void> {
    if (!getRedisConfig()) {
      return
    }

    const publisher = getRedis()

    try {
      await publisher.publish(
        this.activeRegistrationsCacheInvalidationChannel,
        Date.now().toString()
      )
      await publisher.quit()
    } catch (error) {
      publisher.disconnect()
      console.error(
        'Error publishing deposit webhook registration cache invalidation:',
        error
      )
    }
  }

  static async getEnabledCached(): Promise<
    AccountDepositWebhookRegistration[]
  > {
    if (
      this.activeRegistrationsCache &&
      Date.now() - this.activeRegistrationsCache.cachedAt <
        this.activeRegistrationsCacheTtlMs
    ) {
      return this.activeRegistrationsCache.registrations
    }

    const registrations = await this.findAll({
      where: {
        enabled: true,
      },
      order: [['id', 'ASC']],
    })

    this.activeRegistrationsCache = {
      cachedAt: Date.now(),
      registrations,
    }

    return registrations
  }

  static async findEnabledByPk(
    id: number
  ): Promise<AccountDepositWebhookRegistration | null> {
    return await this.findOne({
      where: {
        id,
        enabled: true,
      },
    })
  }

  @AfterSave
  static async afterSaveHook() {
    this.invalidateActiveRegistrationsCache()
    await this.publishActiveRegistrationsCacheInvalidation()
  }

  @AfterDestroy
  static async afterDestroyHook() {
    this.invalidateActiveRegistrationsCache()
    await this.publishActiveRegistrationsCacheInvalidation()
  }
}
