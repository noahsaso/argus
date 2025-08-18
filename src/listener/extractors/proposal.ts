import { Contract } from '@/db'
import { WasmCodeService } from '@/services'
import {
  ExtractorDataSource,
  ExtractorHandleableData,
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

    const config = await client.queryContractSmart(address, {
      config: {},
    })

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
        name: `proposal:${proposalId}`,
        data: proposal,
      },
      // Map from `voteCast:<VOTER>:<PROPOSAL ID>` to vote, if vote is cast.
      ...(vote
        ? [
            {
              address: contract.address,
              name: `voteCast:${sender}:${proposalId}`,
              data: vote,
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

  static async sync({
    autoCosmWasmClient,
  }: ExtractorSyncEnv): Promise<ExtractorHandleableData[]> {
    const client = autoCosmWasmClient.client
    if (!client) {
      throw new Error('CosmWasm client not connected')
    }

    const daoProposalCodeIds = WasmCodeService.instance.findWasmCodeIdsByKeys(
      'dao-proposal-single',
      'dao-proposal-multiple'
    )

    // Find all proposals on the chain.
    const allProposals: {
      address: string
      proposals: {
        id: number
        voters: string[]
      }[]
    }[] = []

    for (const codeId of daoProposalCodeIds) {
      const contracts = await client.getContracts(codeId)
      for (const contract of contracts) {
        const moduleProposals: {
          id: number
          voters: string[]
        }[] = []

        // Paginate all proposals for this contract.
        const limit = 30
        while (true) {
          const { proposals: page } = await client.queryContractSmart(
            contract,
            {
              list_proposals: {
                start_after: moduleProposals[moduleProposals.length - 1]?.id,
                limit,
              },
            }
          )

          moduleProposals.push(
            ...page.map(({ id }: { id: number }) => ({ id, voters: [] }))
          )

          // Stop if there are no more proposals.
          if (page.length < limit) {
            break
          }
        }

        // Fetch voters for each proposal.
        for (const proposal of moduleProposals) {
          while (true) {
            const { votes: page } = await client.queryContractSmart(contract, {
              list_votes: {
                proposal_id: proposal.id,
                start_after:
                  proposal.voters.length > 0
                    ? proposal.voters[proposal.voters.length - 1]
                    : undefined,
                limit: 30,
              },
            })

            proposal.voters.push(
              ...page.map(({ voter }: { voter: string }) => voter)
            )

            // Stop if there are no more votes.
            if (page.length < limit) {
              break
            }
          }
        }

        allProposals.push({
          address: contract,
          proposals: moduleProposals,
        })
      }
    }

    return allProposals.flatMap(({ address, proposals }) => [
      WasmEventDataSource.handleable('config', {
        address,
        key: 'action',
        value: 'update_config',
        attributes: {
          action: ['update_config'],
          // Only the presence of this key is needed for filtering.
          sender: ['placeholder'],
        },
        // Not used.
        _attributes: [],
      }),
      ...proposals.flatMap(({ id, voters }) => [
        WasmEventDataSource.handleable('proposal', {
          address,
          key: 'action',
          value: 'propose',
          attributes: {
            action: ['propose'],
            proposal_id: [id.toString()],
            // Only the presence of this key is needed for filtering.
            sender: ['placeholder'],
          },
          // Not used.
          _attributes: [],
        }),
        ...voters.map((voter) =>
          WasmEventDataSource.handleable('proposal', {
            address,
            key: 'action',
            value: 'vote',
            attributes: {
              action: ['vote'],
              proposal_id: [id.toString()],
              sender: [voter],
              // Only the presence of this key is needed for filtering. The
              // actual vote will be queried from the contract.
              position: ['placeholder'],
            },
            // Not used.
            _attributes: [],
          })
        ),
      ]),
    ])
  }
}
