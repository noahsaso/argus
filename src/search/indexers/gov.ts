import { Sequelize } from 'sequelize'

import { GovProposal, GovProposalVote } from '@/db'
import {
  FormulaType,
  MeilisearchIndexUpdate,
  MeilisearchIndexer,
} from '@/types'

export const govProposals: MeilisearchIndexer = {
  id: 'gov-proposals',
  index: 'gov-proposals',
  automatic: true,
  filterableAttributes: [
    'value.id',
    'value.title',
    'value.description',
    'value.status',
  ],
  sortableAttributes: [
    'value.id',
    'value.submitTime',
    'value.depositEndTime',
    'value.votingStartTime',
    'value.votingEndTime',
  ],
  matches: ({ event }) => {
    if (!(event instanceof GovProposal)) {
      return
    }

    return {
      id: event.proposalId,
      formula: {
        type: FormulaType.Generic,
        name: 'gov/decodedProposal',
        targetAddress: '_',
        args: {
          id: event.proposalId,
        },
      },
    }
  },
  getBulkUpdates: async () => {
    const events = await GovProposal.findAll({
      attributes: [
        // DISTINCT ON is not directly supported by Sequelize, so we need to
        // cast to unknown and back to string to insert this at the beginning of
        // the query. This ensures we use the most recent version of the name
        // for each contract.
        Sequelize.literal(
          'DISTINCT ON("proposalId") \'\''
        ) as unknown as string,
        // Include `id` so that Sequelize doesn't prepend it to the query before
        // the DISTINCT ON, which must come first.
        'id',
        'proposalId',
      ],
      order: [
        // Needs to be first so we can use DISTINCT ON.
        ['proposalId', 'ASC'],
        ['blockHeight', 'DESC'],
      ],
    })

    return events.map(
      ({ proposalId }): MeilisearchIndexUpdate => ({
        id: proposalId,
        formula: {
          type: FormulaType.Generic,
          name: 'gov/decodedProposal',
          targetAddress: '_',
          args: {
            id: proposalId,
          },
        },
      })
    )
  },
}

export const govProposalVotes: MeilisearchIndexer = {
  id: 'gov-proposal-votes',
  index: 'gov-proposal-votes',
  automatic: true,
  filterableAttributes: [
    'value.id',
    'value.voter',
    'value.vote',
    'value.weightedOptions',
    'value.metadata',
  ],
  sortableAttributes: ['value.id', 'value.voter'],
  matches: ({ event }) => {
    if (!(event instanceof GovProposalVote)) {
      return
    }

    return {
      id: [event.proposalId, event.voterAddress].join('_'),
      formula: {
        type: FormulaType.Generic,
        name: 'gov/decodedVote',
        targetAddress: '_',
        args: {
          id: event.proposalId,
          voter: event.voterAddress,
        },
      },
    }
  },
  getBulkUpdates: async () => {
    const events = await GovProposalVote.findAll({
      attributes: [
        // DISTINCT ON is not directly supported by Sequelize, so we need to
        // cast to unknown and back to string to insert this at the beginning of
        // the query. This ensures we use the most recent version of the name
        // for each contract.
        Sequelize.literal(
          'DISTINCT ON("proposalId", "voterAddress") \'\''
        ) as unknown as string,
        // Include `id` so that Sequelize doesn't prepend it to the query before
        // the DISTINCT ON, which must come first.
        'id',
        'proposalId',
        'voterAddress',
      ],
      order: [
        // Needs to be first so we can use DISTINCT ON.
        ['proposalId', 'ASC'],
        ['voterAddress', 'ASC'],
        ['blockHeight', 'DESC'],
      ],
    })

    return events.map(
      ({ proposalId, voterAddress }): MeilisearchIndexUpdate => ({
        id: [proposalId, voterAddress].join('_'),
        formula: {
          type: FormulaType.Generic,
          name: 'gov/decodedVote',
          targetAddress: '_',
          args: {
            id: proposalId,
            voter: voterAddress,
          },
        },
      })
    )
  },
}
