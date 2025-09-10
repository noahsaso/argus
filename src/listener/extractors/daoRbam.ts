import { Contract } from '@/db'
import { WasmCodeService } from '@/services'
import {
  DataSourceData,
  ExtractorDataSource,
  ExtractorHandler,
  ExtractorHandlerOutput,
  ExtractorSyncEnv,
} from '@/types'
import { getContractInfo } from '@/utils'

import {
  WasmEventData,
  WasmEventDataSource,
  WasmInstantiateOrMigrateData,
  WasmInstantiateOrMigrateDataSource,
} from '../sources'
import { Extractor } from './base'

export class DaoRbamExtractor extends Extractor {
  static type = 'dao-rbam'

  // Data sources this extractor listens to.
  static sources: ExtractorDataSource[] = [
    // Any dao-rbam instantiation or migration.
    WasmInstantiateOrMigrateDataSource.source('instantiate', {
      codeIdsKeys: ['dao-rbam'],
    }),
    // Wasm executions with specific actions.
    WasmEventDataSource.source('execute', {
      key: 'action',
      value: ['create_role', 'update_role', 'assign', 'revoke'],
    }),
  ]

  // Handlers wire up to the sources above (by name).
  protected instantiate: ExtractorHandler<WasmInstantiateOrMigrateData> = ({
    address,
  }) => this.save(address)

  protected execute: ExtractorHandler<WasmEventData> = ({ address }) =>
    this.save(address)

  private async save(address: string): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const contract = await getContractInfo({ client, address })

    // Only process dao-rbam contracts.
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(contract.codeId, 'dao-rbam')
    ) {
      return []
    }

    // Fetch info needed for extractions.
    const [info, dao, assignments, roles] = await Promise.all([
      client.queryContractSmart(address, { info: {} }),
      client.queryContractSmart(address, { dao: {} }),
      client.queryContractSmart(address, { list_assignments: {} }),
      client.queryContractSmart(address, { list_roles: {} }),
    ])

    // Ensure the contract exists/updated in DB (matches new style).
    await Contract.upsert(
      {
        address: contract.address,
        codeId: contract.codeId,
        admin: contract.admin,
        creator: contract.creator,
        label: contract.label,
        txHash: this.env.txHash,
      },
      {
        fields: ['codeId', 'admin', 'creator', 'label'],
        returning: false,
      }
    )

    // Emit extractions (framework will handle block/time metadata).
    return [
      {
        address: contract.address,
        name: 'dao-rbam/info',
        data: info,
      },
      {
        address: contract.address,
        name: 'dao-rbam/dao',
        data: dao,
      },
      {
        address: contract.address,
        name: 'dao-rbam/list_assignments',
        data: assignments,
      },
      {
        address: contract.address,
        name: 'dao-rbam/list_roles',
        data: roles,
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

    const daoRbamCodeIds =
      WasmCodeService.instance.findWasmCodeIdsByKeys('dao-rbam')

    for (const codeId of daoRbamCodeIds) {
      const contracts = await client.getContracts(codeId)

      yield* contracts.map((address) =>
        WasmInstantiateOrMigrateDataSource.data({
          type: 'instantiate',
          address,
          codeId,
          codeIdsKeys: ['dao-rbam'],
        })
      )
    }
  }
}
