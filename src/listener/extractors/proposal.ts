import { Contract } from '@/db'
import { WasmCodeService } from '@/services'
import {
  DataSourceData,
  ExtractorDataSource,
  ExtractorHandler,
  ExtractorHandlerOutput,
  ExtractorSyncEnv,
} from '@/types'

import {
  WasmEventData,
  WasmEventDataSource,
  WasmInstantiateOrMigrateData,
  WasmInstantiateOrMigrateDataSource,
} from '../sources'
import { Extractor } from './base'

export class ProposalExtractor extends Extractor {
  static type = 'proposal'
  static sources: ExtractorDataSource[] = [
    WasmInstantiateOrMigrateDataSource.source('instantiate', {
      type: 'instantiate',
      codeIdsKeys: ['dao-proposal-single', 'dao-proposal-multiple'],
    }),
    WasmEventDataSource.source('config', {
      key: 'action',
      value: 'update_config',
      otherAttributes: ['sender'],
    }),
    WasmEventDataSource.source('proposal', {
      key: 'action',
      value: ['propose', 'execute', 'vote', 'close'],
      otherAttributes: ['sender', 'proposal_id'],
    }),
    WasmEventDataSource.source('proposal', {
      key: 'action',
      value: 'veto',
      otherAttributes: ['proposal_id'],
    }),
  ]

  // Handlers.
  protected instantiate: ExtractorHandler<WasmInstantiateOrMigrateData> = ({
    address,
  }) => this.saveConfig(address)
  protected config: ExtractorHandler<WasmEventData> = ({ address }) =>
    this.saveConfig(address)
  protected proposal: ExtractorHandler<WasmEventData> = ({
    address,
    attributes,
  }) => this.saveProposal(address, attributes)

  private async saveConfig(address: string): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const [contract, config] = await Promise.all([
      client.getContract(address),
      client.queryContractSmart(address, {
        config: {},
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
        txHash: this.env.txHash,
      },
      {
        // Update these fields if already exists.
        fields: ['codeId', 'admin', 'creator', 'label'],
        returning: false,
      }
    )

    return [
      {
        address,
        name: 'config',
        data: config,
      },
    ]
  }

  private async saveProposal(
    address: string,
    attributes: Partial<Record<string, string[]>>
  ): Promise<ExtractorHandlerOutput[]> {
    const client = this.env.autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    // Should always be set.
    const proposalId = Number(attributes.proposal_id?.[0])
    if (isNaN(proposalId)) {
      throw new Error('missing `proposalId`')
    }

    // Whether or not this is being proposed.
    const isProposing = attributes.action![0] === 'propose'

    // Not set for veto, which is fine because we only need it when a vote is
    // cast.
    const sender = attributes.sender?.[0]

    // Set if vote is cast during propose or vote action.
    const voteCast = !!sender && !!attributes.position?.[0]

    const contract = await client.getContract(address)

    // Only process if the contract is a dao-proposal-single or
    // dao-proposal-multiple contract.
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        contract.codeId,
        'dao-proposal-single',
        'dao-proposal-multiple'
      )
    ) {
      return []
    }

    const {
      info: { version },
    } = await client.queryContractSmart(address, {
      info: {},
    })

    const [{ proposal }, { vote }] = await Promise.all([
      client.queryContractSmart(address, {
        proposal: {
          proposal_id: proposalId,
        },
      }),
      voteCast
        ? client.queryContractSmart(address, {
            [version === '0.1.0' ? 'vote' : 'get_vote']: {
              proposal_id: proposalId,
              voter: sender,
            },
          })
        : { vote: null },
    ])

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
        name: `proposal:${proposalId}`,
        data: proposal,
      },
      // Map from `voteCast:<VOTER>:<PROPOSAL ID>` to vote, if vote is cast.
      ...(vote
        ? [
            {
              address: contract.address,
              name: `voteCast:${sender}:${proposalId}`,
              data: {
                ...vote,
                votedAt: this.env.block.timestamp,
              },
            },
          ]
        : []),
      // Map from `proposalVetoer:<VETOER>:<PROPOSAL ID>` to proposal ID, if
      // vetoer exists. Only do this the first time a proposal is proposed.
      ...(isProposing && proposal.veto?.vetoer
        ? [
            {
              address: contract.address,
              name: `proposalVetoer:${proposal.veto.vetoer}:${proposalId}`,
              data: proposalId,
            },
          ]
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
      if (contracts.length === 0) {
        continue
      }

      yield* contracts.map((address) =>
        WasmInstantiateOrMigrateDataSource.data({
          type: 'instantiate',
          address,
          codeId,
          codeIdsKeys: ['dao-dao-core'],
        })
      )

      // Get the proposal modules for each DAO in batches of 10.
      for (let i = 0; i < contracts.length; i += 10) {
        const batchContracts = contracts.slice(i, i + 10)

        const data = (
          await Promise.all(
            batchContracts.map(
              async (
                address
              ): Promise<DataSourceData<WasmInstantiateOrMigrateData>[]> => {
                const [{ info }, { proposal_modules }] = await Promise.all([
                  client.queryContractSmart(address, {
                    info: {},
                  }),
                  client.queryContractSmart(address, {
                    dump_state: {},
                  }),
                ])

                return await Promise.all(
                  proposal_modules.map(async (proposalModule: any) => {
                    // V1 modules are just an address.
                    const address =
                      info.version === '0.1.0'
                        ? proposalModule
                        : proposalModule.address

                    const { codeId } = await client.getContract(address)

                    return WasmInstantiateOrMigrateDataSource.data({
                      type: 'instantiate',
                      address,
                      codeId,
                      codeIdsKeys:
                        WasmCodeService.instance.findWasmCodeKeysById(codeId),
                    })
                  })
                )
              }
            )
          )
        ).flat()

        yield* data

        // Yield all proposals and votes for each proposal module.
        for (const {
          data: { address: proposalModuleAddress, codeIdsKeys },
        } of data) {
          // Ignore unless this is a dao-proposal-* contract.
          if (!codeIdsKeys.some((key) => key.startsWith('dao-proposal-'))) {
            continue
          }

          // Paginate all proposals for this contract.
          const limit = 30
          let startAfter: number | undefined
          while (true) {
            const { proposals: proposalsPage } =
              await client.queryContractSmart(proposalModuleAddress, {
                list_proposals: {
                  start_after: startAfter,
                  limit,
                },
              })

            // Yield all proposals.
            yield* proposalsPage.map(({ id }: { id: number }) =>
              WasmEventDataSource.data({
                address: proposalModuleAddress,
                key: 'action',
                value: 'propose',
                _attributes: [
                  {
                    key: 'action',
                    value: 'propose',
                  },
                  {
                    key: 'proposal_id',
                    value: id.toString(),
                  },
                  {
                    key: 'sender',
                    value: 'placeholder',
                  },
                  {
                    key: 'sender',
                    // Only the presence of this key is needed for filtering.
                    value: 'placeholder',
                  },
                ],
              })
            )

            // Fetch voters for each proposal.
            for (const { id } of proposalsPage) {
              let startAfter: string | undefined
              while (true) {
                const { votes: votesPage } = await client.queryContractSmart(
                  proposalModuleAddress,
                  {
                    list_votes: {
                      proposal_id: id,
                      start_after: startAfter,
                      limit: 30,
                    },
                  }
                )

                // Yield all votes.
                yield* votesPage.map(({ voter }: { voter: string }) =>
                  WasmEventDataSource.data({
                    address: proposalModuleAddress,
                    key: 'action',
                    value: 'vote',
                    _attributes: [
                      {
                        key: 'action',
                        value: 'vote',
                      },
                      {
                        key: 'proposal_id',
                        value: id.toString(),
                      },
                      {
                        key: 'sender',
                        value: voter,
                      },
                      {
                        key: 'position',
                        // Only the presence of this key is needed for
                        // filtering. The actual vote will be queried from the
                        // contract.
                        value: 'placeholder',
                      },
                    ],
                  })
                )

                // Stop if there are no more votes.
                if (votesPage.length < limit) {
                  break
                }

                startAfter =
                  votesPage.length > 0
                    ? votesPage[votesPage.length - 1].voter
                    : undefined
              }
            }

            // Stop if there are no more proposals.
            if (proposalsPage.length < limit) {
              break
            }

            startAfter =
              proposalsPage.length > 0
                ? proposalsPage[proposalsPage.length - 1].id
                : undefined
          }
        }
      }
    }
  }
}
