import {
  DataSourceData,
  ExtractableTxInput,
  ExtractorDataSource,
  ExtractorHandleableData,
} from '@/types'

import { DataSource } from './base'

export type IndexedWasmEventDataSourceConfig = {
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

export type IndexedWasmEventData = {
  /**
   * The address of the contract that emitted the event.
   */
  address: string
  /**
   * The key of the matched attribute.
   */
  key: string
  /**
   * The value of the matched attribute.
   */
  value: string
  /**
   * The position of the wasm event within the transaction.
   */
  eventIndex: number
  /**
   * A map of attribute key to all values.
   */
  attributes: Partial<Record<string, string[]>>
  /**
   * The raw event attributes.
   */
  _attributes: {
    key: string
    value: string
  }[]
}

export class IndexedWasmEventDataSource extends DataSource<
  IndexedWasmEventDataSourceConfig,
  IndexedWasmEventData
> {
  static get type(): string {
    return 'wasm/indexed-event'
  }

  static source(
    handler: string,
    config: IndexedWasmEventDataSourceConfig
  ): ExtractorDataSource<IndexedWasmEventDataSourceConfig> {
    return {
      type: this.type,
      handler,
      config,
    }
  }

  static handleable(
    handler: string,
    data: IndexedWasmEventData
  ): ExtractorHandleableData<IndexedWasmEventData> {
    return {
      source: this.type,
      handler,
      data,
    }
  }

  static data(
    data: Omit<IndexedWasmEventData, 'attributes'>
  ): DataSourceData<IndexedWasmEventData> {
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

  private equalsOrContains(a: string | string[], b: string): boolean {
    return Array.isArray(a) ? a.includes(b) : a === b
  }

  match({ events }: ExtractableTxInput): IndexedWasmEventData[] {
    return events.flatMap(({ type, attributes }, eventIndex) =>
      type === 'wasm' &&
      attributes.some(
        ({ key, value }) => key === '_contract_address' && value.length > 0
      ) &&
      (!this.config.otherAttributes ||
        this.config.otherAttributes.every((otherKey) =>
          attributes.some(({ key }) => key === otherKey)
        ))
        ? attributes.flatMap(({ key, value }) =>
            this.equalsOrContains(this.config.key, key) &&
            this.equalsOrContains(this.config.value, value)
              ? {
                  address: attributes.find(
                    ({ key }) => key === '_contract_address'
                  )!.value,
                  key,
                  value,
                  eventIndex,
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

  isOurData(data: IndexedWasmEventData): boolean {
    return (
      this.equalsOrContains(this.config.key, data.key) &&
      this.equalsOrContains(this.config.value, data.value) &&
      (!this.config.otherAttributes ||
        this.config.otherAttributes.every(
          (otherKey) =>
            otherKey in data.attributes &&
            Array.isArray(data.attributes[otherKey]) &&
            data.attributes[otherKey]!.length > 0
        ))
    )
  }
}
