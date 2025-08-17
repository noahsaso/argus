import { WasmCodeService } from '@/services'
import { ExtractorMatchInput } from '@/types'

import { DataSource } from './base'

export type WasmInstantiateDataSourceConfig = {
  codeIdKeys: string[]
}

export type WasmInstantiateDataSourceData = {
  /**
   * The address of the contract being instantiated.
   */
  address: string
  /**
   * The code ID of the contract being instantiated.
   */
  codeId: number
  /**
   * The code IDs keys containing the code ID of the contract being
   * instantiated.
   */
  codeIdsKeys: string[]
}

export class WasmInstantiateDataSource extends DataSource<
  WasmInstantiateDataSourceConfig,
  WasmInstantiateDataSourceData
> {
  static get type(): string {
    return 'wasm/instantiate'
  }

  /**
   * The code IDs to match.
   */
  private codeIds: number[]

  constructor(config: WasmInstantiateDataSourceConfig) {
    super(config)
    this.codeIds = WasmCodeService.getInstance().findWasmCodeIdsByKeys(
      ...config.codeIdKeys
    )
  }

  match({ events }: ExtractorMatchInput): WasmInstantiateDataSourceData[] {
    return events
      .filter(
        ({ type, attributes }) =>
          type === 'instantiate' &&
          attributes.some(
            ({ key, value }) =>
              key === 'code_id' &&
              !isNaN(Number(value)) &&
              this.codeIds.includes(Number(value))
          ) &&
          attributes.some(
            ({ key, value }) => key === '_contract_address' && value.length > 0
          )
      )
      .map(({ attributes }) => {
        const codeId = Number(
          attributes.find((a) => a.key === 'code_id')!.value
        )

        return {
          address: attributes.find((a) => a.key === '_contract_address')!.value,
          codeId,
          codeIdsKeys:
            WasmCodeService.getInstance().findWasmCodeKeysById(codeId),
        }
      })
  }
}
