import { fromUtf8, toUtf8 } from '@cosmjs/encoding'

import { Contract } from '@/db'
import {
  DataSourceData,
  ExtractorDataSource,
  ExtractorHandler,
  ExtractorHandlerOutput,
  ExtractorSyncEnv,
} from '@/types'
import { getContractInfo } from '@/utils'

import {
  WasmInstantiateOrMigrateData,
  WasmInstantiateOrMigrateDataSource,
} from '../sources'
import { Extractor } from './base'

export class ContractExtractor extends Extractor {
  static type = 'contract'
  static sources: ExtractorDataSource[] = [
    WasmInstantiateOrMigrateDataSource.source('instantiate', {}),
  ]

  // Handlers.
  instantiate: ExtractorHandler<WasmInstantiateOrMigrateData> = async ({
    address,
  }): Promise<ExtractorHandlerOutput[]> => {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const [contract, response] = await Promise.all([
      getContractInfo({ client, address }),
      // Skip redundant getContract query in the normal
      // queryContractRaw.
      client['forceGetQueryClient']().wasm.queryContractRaw(
        address,
        toUtf8('contract_info')
      ),
    ])

    if (!response?.data.length) {
      return []
    }

    // Ensure contract exists in the DB.
    await Contract.upsert(
      {
        address: contract.address,
        codeId: contract.codeId,
        admin: contract.admin,
        creator: contract.creator,
        label: contract.label,
        instantiatedAtBlockHeight: this.env.block.height,
        instantiatedAtBlockTimeUnixMs: this.env.block.timeUnixMs,
        instantiatedAtBlockTimestamp: this.env.block.timestamp,
        txHash: this.env.txHash,
      },
      {
        // Update these fields if already exists.
        fields: ['codeId', 'admin', 'creator', 'label'],
        returning: false,
      }
    )

    // Return extractions.
    return [
      {
        address: contract.address,
        name: 'info',
        data: JSON.parse(fromUtf8(response.data)),
      },
    ]
  }

  static async *sync({
    autoCosmWasmClient,
  }: ExtractorSyncEnv): AsyncGenerator<DataSourceData, void, undefined> {
    const client = autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    // Find all code IDs on the chain.
    const codes = await client.getCodes()

    // Find all contracts on the chain.
    for (const { id } of codes) {
      const contracts = await client.getContracts(id)

      yield* contracts.map((address) =>
        WasmInstantiateOrMigrateDataSource.data({
          type: 'instantiate',
          address,
          codeId: id,
          codeIdsKeys: [],
        })
      )
    }
  }
}
