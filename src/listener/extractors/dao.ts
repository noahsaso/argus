import { Contract } from '@/db'
import { WasmCodeService } from '@/services'
import {
  ExtractorDataSource,
  ExtractorHandler,
  ExtractorHandlerOutput,
} from '@/types'

import {
  WasmEventData,
  WasmEventDataSource,
  WasmInstantiateOrMigrateData,
  WasmInstantiateOrMigrateDataSource,
} from '../sources'
import { Extractor } from './base'

export class DaoExtractor extends Extractor {
  static get type(): string {
    return 'dao'
  }

  sources: ExtractorDataSource[] = [
    WasmInstantiateOrMigrateDataSource.source('instantiate', {
      codeIdsKeys: ['dao-dao-core'],
    }),
    WasmEventDataSource.source('execute', {
      key: 'action',
      value: [
        'execute_proposal_hook',
        'execute_update_voting_module',
        'execute_update_proposal_modules',
      ],
    }),
    WasmEventDataSource.source('execute', {
      key: 'action',
      value: 'execute_update_config',
      otherAttributes: ['name', 'description', 'image_url'],
    }),
    WasmEventDataSource.source('execute', {
      key: 'action',
      value: 'execute_accept_admin_nomination',
      otherAttributes: ['new_admin'],
    }),
  ]

  // Handlers.
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

    const contract = await client.getContract(address)

    // Only process if the contract is a dao-dao-core contract.
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        contract.codeId,
        'dao-dao-core'
      )
    ) {
      return []
    }

    const [{ info }, dumpState] = await Promise.all([
      client.queryContractSmart(address, {
        info: {},
      }),
      client.queryContractSmart(address, {
        dump_state: {},
      }),
    ])

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
        data: info,
      },
      {
        address: contract.address,
        name: 'dao-dao-core/dump_state',
        data: dumpState,
      },
    ]
  }

  async _sync() {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const daoDaoCoreCodeIds =
      WasmCodeService.instance.findWasmCodeIdsByKeys('dao-dao-core')

    // Find all DAO contracts on the chain.
    const addresses: string[] = []
    for (const codeId of daoDaoCoreCodeIds) {
      const contracts = await client.getContracts(codeId)
      addresses.push(...contracts)
    }

    return addresses.map((address) =>
      WasmInstantiateOrMigrateDataSource.data({
        type: 'instantiate',
        address,
        codeId: 0,
        codeIdsKeys: [],
      })
    )
  }
}
