import {
  DataSourceData,
  ExtractableTxInput,
  ExtractorDataSource,
  ExtractorHandleableData,
} from '@/types'

import { DataSource } from './base'

export type StargateMessageDataSourceConfig = {
  /**
   * The type URL or URLs to match.
   */
  typeUrl: string | string[]
}

export type StargateMessageData = {
  /**
   * The protobuf type URL.
   */
  typeUrl: string
  /**
   * The decoded message value.
   */
  value: Record<string, unknown>
  /**
   * The position of the message within the transaction.
   */
  messageIndex: number
}

type DecodedMessage = {
  typeUrl: string
  value: Record<string, unknown>
}

export class StargateMessageDataSource extends DataSource<
  StargateMessageDataSourceConfig,
  StargateMessageData
> {
  static get type(): string {
    return 'stargate/message'
  }

  static source(
    handler: string,
    config: StargateMessageDataSourceConfig
  ): ExtractorDataSource<StargateMessageDataSourceConfig> {
    return {
      type: this.type,
      handler,
      config,
    }
  }

  static handleable(
    handler: string,
    data: StargateMessageData
  ): ExtractorHandleableData<StargateMessageData> {
    return {
      source: this.type,
      handler,
      data,
    }
  }

  static data(data: StargateMessageData): DataSourceData<StargateMessageData> {
    return {
      source: this.type,
      data,
    }
  }

  private equalsOrContains(a: string | string[], b: string): boolean {
    return Array.isArray(a) ? a.includes(b) : a === b
  }

  private isDecodedMessage(message: unknown): message is DecodedMessage {
    return (
      !!message &&
      typeof message === 'object' &&
      'typeUrl' in message &&
      typeof message.typeUrl === 'string' &&
      'value' in message &&
      !!message.value &&
      typeof message.value === 'object' &&
      !Array.isArray(message.value)
    )
  }

  match({ messages }: ExtractableTxInput): StargateMessageData[] {
    return messages.flatMap((message, messageIndex) =>
      this.isDecodedMessage(message) &&
      this.equalsOrContains(this.config.typeUrl, message.typeUrl)
        ? {
            typeUrl: message.typeUrl,
            value: message.value,
            messageIndex,
          }
        : []
    )
  }

  isOurData(data: StargateMessageData): boolean {
    return this.equalsOrContains(this.config.typeUrl, data.typeUrl)
  }
}
