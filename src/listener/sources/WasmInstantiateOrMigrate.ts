import { WasmCodeService } from '@/services'
import {
  ExtractableTxInput,
  ExtractorDataSource,
  ExtractorHandleableData,
} from '@/types'

import { DataSource } from './base'

export type WasmInstantiateOrMigrateDataSourceConfig = {
  /**
   * Instantiate, migrate, or both. Defaults to both.
   */
  type?: 'instantiate' | 'migrate' | 'both'
  /**
   * Optionally filter by code ID keys.
   */
  codeIdsKeys?: string[]
}

export type WasmInstantiateOrMigrateData = {
  /**
   * The type of event that was matched.
   */
  type: 'instantiate' | 'migrate'
  /**
   * The address of the contract that was instantiated or migrated.
   */
  address: string
  /**
   * The code ID of the contract that was instantiated or migrated.
   */
  codeId: number
  /**
   * The code IDs keys containing the code ID of the contract that was
   * instantiated or migrated.
   */
  codeIdsKeys: string[]
}

export class WasmInstantiateOrMigrateDataSource extends DataSource<
  WasmInstantiateOrMigrateDataSourceConfig,
  WasmInstantiateOrMigrateData
> {
  static get type(): string {
    return 'wasm/instantiate-or-migrate'
  }

  static source(
    handler: string,
    config: WasmInstantiateOrMigrateDataSourceConfig
  ): ExtractorDataSource<WasmInstantiateOrMigrateDataSourceConfig> {
    return {
      type: this.type,
      handler,
      config,
    }
  }

  static handleable(
    handler: string,
    data: WasmInstantiateOrMigrateData
  ): ExtractorHandleableData<WasmInstantiateOrMigrateData> {
    return {
      source: this.type,
      handler,
      data,
    }
  }

  /**
   * The code IDs to match.
   */
  private codeIds?: number[]

  constructor(config: WasmInstantiateOrMigrateDataSourceConfig) {
    config.type ??= 'both'
    super(config)
    this.codeIds =
      config.codeIdsKeys &&
      WasmCodeService.instance.findWasmCodeIdsByKeys(...config.codeIdsKeys)
  }

  match({ events }: ExtractableTxInput): WasmInstantiateOrMigrateData[] {
    return events
      .filter(
        ({ type, attributes }) =>
          // Instantiate or migrate.
          (((this.config.type === 'both' ||
            this.config.type === 'instantiate') &&
            type === 'instantiate') ||
            ((this.config.type === 'both' || this.config.type === 'migrate') &&
              type === 'migrate')) &&
          // Code ID.
          attributes.some(
            ({ key, value }) =>
              key === 'code_id' &&
              (!this.codeIds ||
                (!isNaN(Number(value)) && this.codeIds.includes(Number(value))))
          ) &&
          // Contract address.
          attributes.some(
            ({ key, value }) => key === '_contract_address' && value.length > 0
          )
      )
      .map(({ type, attributes }) => {
        const codeId = Number(
          attributes.find((a) => a.key === 'code_id')!.value
        )

        return {
          type: type as 'instantiate' | 'migrate',
          address: attributes.find((a) => a.key === '_contract_address')!.value,
          codeId,
          codeIdsKeys: WasmCodeService.instance.findWasmCodeKeysById(codeId),
        }
      })
  }
}
