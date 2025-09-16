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

export class DaoExtractor extends Extractor {
  static type = 'dao'
  static sources: ExtractorDataSource[] = [
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
  }) => this.save(address, true)
  protected execute: ExtractorHandler<WasmEventData> = ({ address, value }) =>
    this.save(address, value === 'execute_update_proposal_modules')

  private async save(
    address: string,
    saveProposalModules: boolean
  ): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const contract = await getContractInfo({ client, address })

    // Only process if the contract is a dao-dao-core contract.
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        contract.codeId,
        'dao-dao-core'
      )
    ) {
      return []
    }

    const [{ info }, dumpState, config] = await Promise.all([
      client.queryContractSmart(address, {
        info: {},
      }),
      client.queryContractSmart(address, {
        dump_state: {},
      }),
      client.queryContractSmart(address, {
        config: {},
      }),
    ])

    const isV1 = info.version === '0.1.0'

    // Ensure contract exists in the DB.
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
      {
        address: contract.address,
        name: 'dao-dao-core/config',
        data: config,
      },
      ...(saveProposalModules
        ? dumpState.proposal_modules.map((proposalModule: any) => ({
            address: contract.address,
            name: `proposalModule:${
              isV1 ? proposalModule : proposalModule.address
            }`,
            data: isV1
              ? {
                  address: proposalModule,
                  // V1 modules don't have a prefix.
                  prefix: '',
                  // V1 modules are always enabled.
                  status: 'Enabled' as const,
                }
              : proposalModule,
          }))
        : []),
    ]
  }

  static async *sync({
    autoCosmWasmClient,
  }: ExtractorSyncEnv): AsyncGenerator<DataSourceData, void, undefined> {
    const client = autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const daoDaoCoreCodeIds =
      WasmCodeService.instance.findWasmCodeIdsByKeys('dao-dao-core')

    // Find all DAO contracts on the chain.
    for (const codeId of daoDaoCoreCodeIds) {
      const contracts = await client.getContracts(codeId)

      yield* contracts.map((address) =>
        WasmInstantiateOrMigrateDataSource.data({
          type: 'instantiate',
          address,
          codeId,
          codeIdsKeys: ['dao-dao-core'],
        })
      )

      // Get the voting module and proposal modules for each DAO in batches of
      // 10.
      for (let i = 0; i < contracts.length; i += 10) {
        const batchContracts = contracts.slice(i, i + 10)

        const data = (
          await Promise.all(
            batchContracts.map(
              async (
                address
              ): Promise<DataSourceData<WasmInstantiateOrMigrateData>[]> => {
                const [{ info }, { voting_module, proposal_modules }] =
                  await Promise.all([
                    client.queryContractSmart(address, {
                      info: {},
                    }),
                    client.queryContractSmart(address, {
                      dump_state: {},
                    }),
                  ])

                const { codeId: votingModuleCodeId } = await getContractInfo({
                  client,
                  address: voting_module,
                })

                return [
                  // Voting module.
                  WasmInstantiateOrMigrateDataSource.data({
                    type: 'instantiate',
                    address: voting_module,
                    codeId: votingModuleCodeId,
                    codeIdsKeys:
                      WasmCodeService.instance.findWasmCodeKeysById(
                        votingModuleCodeId
                      ),
                  }),
                  // Proposal modules.
                  ...(await Promise.all(
                    proposal_modules.map(async (proposalModule: any) => {
                      // V1 modules are just an address.
                      const address =
                        info.version === '0.1.0'
                          ? proposalModule
                          : proposalModule.address

                      const { codeId } = await getContractInfo({
                        client,
                        address,
                      })

                      return WasmInstantiateOrMigrateDataSource.data({
                        type: 'instantiate',
                        address,
                        codeId,
                        codeIdsKeys:
                          WasmCodeService.instance.findWasmCodeKeysById(codeId),
                      })
                    })
                  )),
                ]
              }
            )
          )
        ).flat()

        yield* data
      }
    }
  }
}
