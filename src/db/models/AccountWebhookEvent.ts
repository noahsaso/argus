import { createHmac } from 'crypto'

import * as Sentry from '@sentry/node'
import axios, { AxiosError } from 'axios'
import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  Table,
  Unique,
} from 'sequelize-typescript'

import type { ParsedWasmStateEvent, SerializedBlock } from '@/types'
import { eventKeyToBase64 } from '@/utils'

import { AccountWebhook } from './AccountWebhook'
import {
  AccountWebhookEventAttempt,
  AccountWebhookEventAttemptApiJson,
} from './AccountWebhookEventAttempt'

export type AccountWebhookEventApiJson = {
  uuid: string
  status: AccountWebhookEventStatus
  data: ParsedWasmStateEvent
  url: string
  attempts: AccountWebhookEventAttemptApiJson[]
}

type RequestBody = {
  webhook: {
    uuid: string
    attempt: number
  }
  block: SerializedBlock
  contractAddress: string
  codeId: number
  key: string
  value: any | null
  delete: boolean
}

export enum AccountWebhookEventStatus {
  Pending = 'pending',
  Success = 'success',
  Retrying = 'retrying',
  Failure = 'failure',
}

const MAX_ATTEMPTS = 3

@Table({
  timestamps: true,
})
export class AccountWebhookEvent extends Model {
  @AllowNull(false)
  @ForeignKey(() => AccountWebhook)
  @Column(DataType.INTEGER)
  declare webhookId: number

  @BelongsTo(() => AccountWebhook)
  declare webhook: AccountWebhook

  @HasMany(() => AccountWebhookEventAttempt, 'webhookEventId')
  declare attempts: AccountWebhookEventAttempt[]

  @AllowNull(false)
  @Unique
  @Column(DataType.STRING)
  declare uuid: string

  @AllowNull(false)
  @Default(AccountWebhookEventStatus.Pending)
  @Column(DataType.ENUM(...Object.values(AccountWebhookEventStatus)))
  declare status: AccountWebhookEventStatus

  @AllowNull
  @Column(DataType.DATE)
  declare succeededAt: Date | null

  @AllowNull
  @Column(DataType.DATE)
  declare failedAt: Date | null

  @AllowNull(false)
  @Column(DataType.STRING)
  declare url: string

  @AllowNull(false)
  @Column(DataType.JSONB)
  declare parsedEvent: ParsedWasmStateEvent

  async getApiJson(): Promise<AccountWebhookEventApiJson> {
    this.attempts ||= (await this.$get('attempts')) ?? []

    return {
      uuid: this.uuid,
      status: this.status,
      data: this.parsedEvent,
      url: this.url,
      attempts: this.attempts.map((attempt) => attempt.apiJson),
    }
  }

  // Sign request information for webhook verification header.
  async getRequestSignature(
    url: string,
    requestBody: RequestBody
  ): Promise<string> {
    const webhook = this.webhook || (await this.$get('webhook'))
    if (!webhook) {
      throw new Error('Webhook not found')
    }

    // Create string of URL with body keys and values, deterministically.
    const data =
      url +
      Object.keys(requestBody)
        .sort()
        .map(
          (key) =>
            `${key}=${JSON.stringify(requestBody[key as keyof RequestBody])}`
        )

    const signature = createHmac('sha256', webhook.secret)
      .update(data)
      .digest('base64')
    return signature
  }

  // Returns whether or not the webhook was successful.
  async fire(): Promise<AccountWebhookEventAttempt> {
    // Load attempts.
    this.attempts ||= (await this.$get('attempts')) ?? []

    const requestBody: RequestBody = {
      webhook: {
        uuid: this.uuid,
        attempt: this.attempts.length + 1,
      },
      block: {
        height: this.parsedEvent.blockHeight,
        timeUnixMs: this.parsedEvent.blockTimeUnixMs,
        timestamp: new Date(
          Number(this.parsedEvent.blockTimeUnixMs)
        ).toISOString(),
      },
      contractAddress: this.parsedEvent.contractAddress,
      codeId: this.parsedEvent.codeId,
      key: eventKeyToBase64(this.parsedEvent.key),
      value: this.parsedEvent.valueJson,
      delete: this.parsedEvent.delete,
    }

    // Sign request information for webhook verification header.
    const signature = await this.getRequestSignature(this.url, requestBody)
    const requestHeaders = {
      // Sending JSON.
      'Content-Type': 'application/json',
      // axios bug fix: https://stackoverflow.com/a/74735197
      'Accept-Encoding': 'gzip,deflate,compress',
      // Signature for webhook verification.
      'X-Webhook-Signature': signature,
    }

    let responseBody: any = null
    let responseHeaders: any = null
    let statusCode: number
    try {
      const response = await axios(this.url, {
        method: 'POST',
        headers: requestHeaders,
        data: requestBody,
      })

      responseBody = response.data
      responseHeaders = response.headers
      statusCode = response.status
    } catch (err) {
      statusCode = -1

      if (err instanceof AxiosError) {
        if (err.response) {
          responseBody = err.response.data
          responseHeaders = err.response.headers
          statusCode = err.response.status
        } else {
          // If no response, persist error message in response field.
          responseBody = err.message
        }
      }

      // Capture unexpected error.
      Sentry.captureException(err, {
        tags: {
          type: 'webhook_caught',
          accountWebhookEventId: this.id,
          uuid: this.uuid,
          url: this.url,
        },
      })
    }

    // Store attempt.
    const attempt = await this.$create<AccountWebhookEventAttempt>('attempt', {
      url: this.url,
      requestBody: JSON.stringify(requestBody),
      requestHeaders: JSON.stringify(requestHeaders),
      responseBody: responseBody && JSON.stringify(responseBody),
      responseHeaders: responseHeaders && JSON.stringify(responseHeaders),
      statusCode,
    })

    // Update status if has not yet succeeded. If it fails and they manually
    // fire, it should update the status if it succeeds.
    if (this.status !== AccountWebhookEventStatus.Success) {
      this.status = attempt.success
        ? AccountWebhookEventStatus.Success
        : this.attempts.length < MAX_ATTEMPTS
        ? AccountWebhookEventStatus.Retrying
        : AccountWebhookEventStatus.Failure

      if (this.status === AccountWebhookEventStatus.Success) {
        this.succeededAt = attempt.createdAt
      } else if (this.status === AccountWebhookEventStatus.Failure) {
        this.failedAt = attempt.createdAt
      }

      await this.save()
    }

    return attempt
  }
}
