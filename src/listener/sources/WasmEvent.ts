import {
  DataSourceData,
  ExtractableTxInput,
  ExtractorDataSource,
  ExtractorHandleableData,
} from '@/types'

import { DataSource } from './base'

export type WasmEventDataSourceConfig = {
  /**
   * The key or keys to match.
   */
  key: string | string[]
  /**
   * The value or values to match.
   */
  value: string | string[]
  /**
   * The contract address or addresses to match. If not provided, all contract
   * addresses are matched.
   */
  contractAddress?: string | string[]
  /**
   * Other attributes to ensure are present, optionally matching values.
   */
  otherAttributes?: (string | { key: string; value: string | string[] })[]
}

export type WasmEventData = {
  /**
   * The address of the contract that emitted the event.
   */
  address: string
  /**
   * The key of the event that matched.
   */
  key: string
  /**
   * The value of the event that matched.
   */
  value: string
  /**
   * A map of attribute key to all values (since there can be multiple values
   * for the same key).
   */
  attributes: Partial<Record<string, string[]>>
  /**
   * The attributes of the event.
   */
  _attributes: {
    /**
     * The key of the attribute.
     */
    key: string
    /**
     * The value of the attribute.
     */
    value: string
  }[]
}

export class WasmEventDataSource extends DataSource<
  WasmEventDataSourceConfig,
  WasmEventData
> {
  static get type(): string {
    return 'wasm/event'
  }

  static source(
    handler: string,
    config: WasmEventDataSourceConfig
  ): ExtractorDataSource<WasmEventDataSourceConfig> {
    return {
      type: this.type,
      handler,
      config,
    }
  }

  static handleable(
    handler: string,
    data: WasmEventData
  ): ExtractorHandleableData<WasmEventData> {
    return {
      source: this.type,
      handler,
      data,
    }
  }

  static data(
    data: Omit<WasmEventData, 'attributes'>
  ): DataSourceData<WasmEventData> {
    return {
      source: this.type,
      data: {
        ...data,
        attributes: data._attributes.reduce(
          (acc, { key, value }) => ({
            ...acc,
            [key]: [...(acc[key] || []), value],
          }),
          {} as Record<string, string[]>
        ),
      },
    }
  }

  private _equalsOrContains(a: string | string[], b: string): boolean {
    return Array.isArray(a) ? a.includes(b) : a === b
  }

  match({ events }: ExtractableTxInput): WasmEventData[] {
    return events.flatMap(({ type, attributes }) => {
      if (type !== 'wasm') {
        return []
      }

      // Cache contract address lookup.
      const contractAddress = attributes.find(
        ({ key }) => key === '_contract_address'
      )?.value
      if (!contractAddress) {
        return []
      }

      // Check contract address filter.
      if (
        this.config.contractAddress &&
        !this._equalsOrContains(this.config.contractAddress, contractAddress)
      ) {
        return []
      }

      // Check other attributes.
      if (
        this.config.otherAttributes &&
        !this.config.otherAttributes.every((otherKey) =>
          attributes.some(({ key, value }) =>
            typeof otherKey === 'string'
              ? key === otherKey
              : key === otherKey.key &&
                this._equalsOrContains(otherKey.value, value)
          )
        )
      ) {
        return []
      }

      // Match key/value pairs.
      return attributes.flatMap(({ key, value }) =>
        this._equalsOrContains(this.config.key, key) &&
        this._equalsOrContains(this.config.value, value)
          ? {
              address: contractAddress,
              key,
              value,
              attributes: attributes.reduce(
                (acc, { key, value }) => ({
                  ...acc,
                  [key]: [...(acc[key] || []), value],
                }),
                {} as Record<string, string[]>
              ),
              _attributes: [...attributes],
            }
          : []
      )
    })
  }

  isOurData(data: WasmEventData): boolean {
    return (
      this._equalsOrContains(this.config.key, data.key) &&
      this._equalsOrContains(this.config.value, data.value) &&
      // Contract address filter.
      (!this.config.contractAddress ||
        this._equalsOrContains(this.config.contractAddress, data.address)) &&
      // Other attributes.
      (!this.config.otherAttributes ||
        this.config.otherAttributes.every((otherKey) => {
          const key = typeof otherKey === 'string' ? otherKey : otherKey.key
          const values = data.attributes[key]
          return (
            values &&
            Array.isArray(values) &&
            values.length > 0 &&
            (typeof otherKey === 'string' ||
              values.some((value) =>
                this._equalsOrContains(otherKey.value, value)
              ))
          )
        }))
    )
  }
}
