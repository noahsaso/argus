import { ExtractableTxInput, ExtractorData, ExtractorDataSource } from '@/types'

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
   * Other attributes to ensure are present.
   */
  otherAttributes?: string[]
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

  static data(data: WasmEventData): ExtractorData<WasmEventData> {
    return {
      type: this.type,
      data,
    }
  }

  private _equalsOrContains(a: string | string[], b: string): boolean {
    return Array.isArray(a) ? a.includes(b) : a === b
  }

  match({ events }: ExtractableTxInput): WasmEventData[] {
    return events.flatMap(({ type, attributes }) =>
      type === 'wasm' &&
      attributes.some(
        ({ key, value }) => key === '_contract_address' && value.length > 0
      ) &&
      (!this.config.otherAttributes ||
        this.config.otherAttributes.every((otherKey) =>
          attributes.some(({ key }) => key === otherKey)
        ))
        ? attributes.flatMap(({ key, value }) =>
            this._equalsOrContains(this.config.key, key) &&
            this._equalsOrContains(this.config.value, value)
              ? {
                  address: attributes.find(
                    ({ key }) => key === '_contract_address'
                  )!.value,
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
        : []
    )
  }
}
