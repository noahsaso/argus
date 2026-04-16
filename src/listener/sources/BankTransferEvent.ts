import { parseCoins } from '@cosmjs/amino'

import {
  DataSourceData,
  ExtractableTxInput,
  ExtractorDataSource,
  ExtractorHandleableData,
} from '@/types'

import { DataSource } from './base'

type Filter = {
  /**
   * Must be one of the included values.
   */
  include?: string[]
  /**
   * Must not be one of the excluded values.
   */
  exclude?: string[]
}

export type BankTransferEventDataSourceConfig = {
  /**
   * Filter on the sender address.
   */
  sender?: Filter
  /**
   * Filter on the recipient address.
   */
  recipient?: Filter
  /**
   * Filter on the denom.
   */
  denom?: Filter
}

export type BankTransferEventData = {
  /**
   * The sender address.
   */
  sender: string
  /**
   * The recipient address.
   */
  recipient: string
  /**
   * The denom being transferred.
   */
  denom: string
  /**
   * The amount being transferred.
   */
  amount: string
}

export class BankTransferEventDataSource extends DataSource<
  BankTransferEventDataSourceConfig,
  BankTransferEventData
> {
  static get type(): string {
    return 'bank/transfer'
  }

  static source(
    handler: string,
    config: BankTransferEventDataSourceConfig
  ): ExtractorDataSource<BankTransferEventDataSourceConfig> {
    return {
      type: this.type,
      handler,
      config,
    }
  }

  static handleable(
    handler: string,
    data: BankTransferEventData
  ): ExtractorHandleableData<BankTransferEventData> {
    return {
      source: this.type,
      handler,
      data,
    }
  }

  static data(
    data: BankTransferEventData
  ): DataSourceData<BankTransferEventData> {
    return {
      source: this.type,
      data,
    }
  }

  private _filter(a: Filter, b: string): boolean {
    return (
      (!a.include || a.include.includes(b)) &&
      (!a.exclude || !a.exclude.includes(b))
    )
  }

  match({ events }: ExtractableTxInput): BankTransferEventData[] {
    return events.flatMap(({ type, attributes }) => {
      if (
        type !== 'transfer' ||
        !attributes.some(
          ({ key, value }) => key === 'sender' && value.length > 0
        ) ||
        !attributes.some(
          ({ key, value }) => key === 'recipient' && value.length > 0
        ) ||
        !attributes.some(
          ({ key, value }) => key === 'amount' && value.length > 0
        )
      ) {
        return []
      }

      const sender = attributes.find(({ key }) => key === 'sender')!.value
      if (this.config.sender && !this._filter(this.config.sender, sender)) {
        return []
      }

      const recipient = attributes.find(({ key }) => key === 'recipient')!.value
      if (
        this.config.recipient &&
        !this._filter(this.config.recipient, recipient)
      ) {
        return []
      }

      const amount = attributes.find(({ key }) => key === 'amount')!.value
      let coin
      try {
        coin = parseCoins(amount)[0]
      } catch {
        // parseCoins throws on invalid coin strings
      }
      if (!coin) {
        return []
      }

      if (this.config.denom && !this._filter(this.config.denom, coin.denom)) {
        return []
      }

      return {
        sender,
        recipient,
        denom: coin.denom,
        amount: coin.amount,
      }
    })
  }

  isOurData(data: BankTransferEventData): boolean {
    return (
      !!this.config.sender &&
      this._filter(this.config.sender, data.sender) &&
      !!this.config.recipient &&
      this._filter(this.config.recipient, data.recipient) &&
      !!this.config.denom &&
      this._filter(this.config.denom, data.denom)
    )
  }
}
