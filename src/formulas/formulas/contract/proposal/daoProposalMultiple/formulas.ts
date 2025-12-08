import { Op } from 'sequelize'

import { ContractEnv, ContractFormula } from '@/types'

import { VoteCast, VoteInfo } from '../../../types'
import {
  expirationPlusDuration,
  isExpirationExpired,
  makeSimpleContractFormula,
} from '../../../utils'
import { item, proposalModules } from '../../daoCore/base'
import { ListProposalFilter, ProposalResponse, StatusEnum } from '../types'
import { isPassed, isRejected } from './status'
import { Ballot, Config, MultipleChoiceProposal } from './types'

export * from '../base'

export const config = makeSimpleContractFormula<Config>({
  docs: {
    description: 'retrieves the configuration of the proposal module',
  },
  sources: [
    {
      type: 'extraction',
      name: 'config',
    },
    {
      type: 'transformation',
      name: 'config',
    },
    {
      type: 'event',
      key: 'config',
    },
  ],
})

export const dao: ContractFormula<string> = {
  docs: {
    description:
      'retrieves the DAO address associated with the proposal module',
  },
  compute: async (env) => (await config.compute(env)).dao,
}

export const proposal: ContractFormula<
  ProposalResponse<MultipleChoiceProposal>,
  { id: string }
> = {
  docs: {
    description: 'retrieves a proposal',
    args: [
      {
        name: 'id',
        description: 'proposal ID to retrieve',
        required: true,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  // This formula depends on the block height/time to check expiration.
  dynamic: true,
  compute: async (env) => {
    if (!env.args.id || isNaN(Number(env.args.id)) || Number(env.args.id) < 0) {
      throw new Error('missing `id`')
    }

    const id = Number(env.args.id)

    const daoAddress = await dao.compute(env)
    const [hideFromSearch, daoProposalModules] = daoAddress
      ? await Promise.all([
          item
            .compute({
              ...env,
              contractAddress: daoAddress,
              args: {
                key: 'hideFromSearch',
              },
            })
            .catch(() => false),
          proposalModules.compute({
            ...env,
            contractAddress: daoAddress,
          }),
        ])
      : [undefined, undefined]
    const proposalModule = daoProposalModules?.find(
      (m) => m.address === env.contractAddress
    )

    const proposal = await getProposal(env, id)
    if (!proposal) {
      throw new Error('proposal not found')
    }

    return {
      ...(await intoResponse(env, proposal, id)),
      ...(proposalModule && {
        proposalModule,
        daoProposalId: `${proposalModule.prefix}${id}`,
      }),
      ...(daoAddress && {
        dao: daoAddress,
        hideFromSearch: !!hideFromSearch,
      }),
    }
  },
}

export const listProposals: ContractFormula<
  ProposalResponse<MultipleChoiceProposal>[],
  {
    limit?: string
    startAfter?: string
    // Filter by status.
    filter?: ListProposalFilter
  }
> = {
  docs: {
    description: 'retrieves a list of proposals',
    args: [
      {
        name: 'limit',
        description: 'maximum number of proposals to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startAfter',
        description: 'proposal ID to start after',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      // Filter by status.
      {
        name: 'filter',
        description:
          'set to `passed` to filter by proposals that were passed, including those that were executed',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  // This formula depends on the block height/time to check expiration.
  dynamic: true,
  compute: async (env) => {
    const {
      contractAddress,
      getExtractionMap,
      getTransformationMap,
      getMap,
      args: { limit, startAfter },
    } = env

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity
    const startAfterNum = startAfter
      ? Math.max(0, Number(startAfter))
      : -Infinity

    const proposals =
      // Try extractions first.
      (await getExtractionMap<MultipleChoiceProposal>(
        contractAddress,
        'proposal'
      )) ??
      // Fallback to transformations.
      (await getTransformationMap<MultipleChoiceProposal>(
        contractAddress,
        'proposal'
      )) ??
      // Fallback to events.
      (await getMap<number, MultipleChoiceProposal>(
        contractAddress,
        'proposals',
        { keyType: 'number' }
      )) ??
      {}

    const proposalIds = Object.keys(proposals)
      .map(Number)
      // Ascending by proposal ID.
      .sort((a, b) => a - b)
      .filter((id) => id > startAfterNum)
      .slice(0, limitNum)

    const proposalResponses = (
      await Promise.all(
        proposalIds.map((id) => intoResponse(env, proposals[id], id))
      )
    ).filter(({ proposal }) =>
      env.args.filter === 'passed'
        ? proposal.status === StatusEnum.Passed ||
          proposal.status === StatusEnum.Executed ||
          proposal.status === StatusEnum.ExecutionFailed
        : true
    )

    return proposalResponses
  },
}

export const reverseProposals: ContractFormula<
  ProposalResponse<MultipleChoiceProposal>[],
  {
    limit?: string
    startBefore?: string
  }
> = {
  docs: {
    description: 'retrieves a list of proposals in reverse order',
    args: [
      {
        name: 'limit',
        description: 'maximum number of proposals to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startBefore',
        description: 'proposal ID to start before',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  // This formula depends on the block height/time to check expiration.
  dynamic: true,
  compute: async (env) => {
    const {
      contractAddress,
      getExtractionMap,
      getTransformationMap,
      getMap,
      args: { limit, startBefore },
    } = env

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity
    const startBeforeNum = startBefore
      ? Math.max(0, Number(startBefore))
      : Infinity

    const proposals =
      // Try extractions first.
      (await getExtractionMap<MultipleChoiceProposal>(
        contractAddress,
        'proposal'
      )) ??
      // Fallback to transformations.
      (await getTransformationMap<MultipleChoiceProposal>(
        contractAddress,
        'proposal'
      )) ??
      // Fallback to events.
      (await getMap<number, MultipleChoiceProposal>(
        contractAddress,
        'proposals',
        { keyType: 'number' }
      )) ??
      {}

    const proposalIds = Object.keys(proposals)
      .map(Number)
      // Descending by proposal ID.
      .sort((a, b) => b - a)
      .filter((id) => id < startBeforeNum)
      .slice(0, limitNum)

    const proposalResponses = await Promise.all(
      proposalIds.map((id) => intoResponse(env, proposals[id], id))
    )

    return proposalResponses
  },
}

export const proposalCount = makeSimpleContractFormula<number>({
  docs: {
    description: 'retrieves the number of proposals',
  },
  key: 'proposal_count',
  fallback: 0,
})

export const nextProposalId: ContractFormula<number> = {
  docs: {
    description: 'retrieves the next proposal ID',
  },
  compute: async (env) => (await proposalCount.compute(env)) + 1,
}

export const vote: ContractFormula<
  VoteInfo<Ballot>,
  { proposalId: string; voter: string }
> = {
  docs: {
    description: 'retrieves the vote for a given proposal and voter',
    args: [
      {
        name: 'proposalId',
        description: 'ID of the proposal',
        required: true,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'voter',
        description: 'address of the voter',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({
    contractAddress,
    getTransformationMatch,
    get,
    getDateKeyModified,
    getExtraction,
    args: { proposalId, voter },
  }) => {
    if (!proposalId) {
      throw new Error('missing `proposalId`')
    }
    if (!voter) {
      throw new Error('missing `voter`')
    }

    let voteCast =
      // Try extraction first.
      (
        await getExtraction<VoteCast<Ballot>>(
          contractAddress,
          `voteCast:${voter}:${proposalId}`
        )
      )?.data ??
      // Fallback to transformation.
      (
        await getTransformationMatch<VoteCast<Ballot>>(
          contractAddress,
          `voteCast:${voter}:${proposalId}`
        )
      )?.value

    // Falback to events.
    if (!voteCast) {
      const ballot = (
        await get<Ballot>(contractAddress, 'ballots', Number(proposalId), voter)
      )?.valueJson

      if (ballot) {
        const votedAt = (
          await getDateKeyModified(
            contractAddress,
            'ballots',
            Number(proposalId),
            voter
          )
        )?.toISOString()

        voteCast = {
          voter,
          vote: ballot,
          votedAt,
        }
      }
    }

    if (!voteCast) {
      throw new Error('vote not found')
    }

    return {
      voter,
      ...voteCast.vote,
      votedAt: voteCast.votedAt,
    }
  },
}

export const listVotes: ContractFormula<
  VoteInfo<Ballot>[],
  {
    proposalId: string
    limit?: string
    startAfter?: string
  }
> = {
  docs: {
    description: 'retrieves a list of votes for a given proposal',
    args: [
      {
        name: 'proposalId',
        description: 'ID of the proposal',
        required: true,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'limit',
        description: 'maximum number of votes to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startAfter',
        description: 'voter address to start after',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({
    contractAddress,
    getExtractions,
    getTransformationMatches,
    getMap,
    getDateKeyModified,
    args: { proposalId, limit, startAfter },
  }) => {
    if (!proposalId || isNaN(Number(proposalId)) || Number(proposalId) < 0) {
      throw new Error('missing `proposalId`')
    }

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    let votesCast =
      // Try extractions first.
      (
        await getExtractions<VoteCast<Ballot>>(
          contractAddress,
          `voteCast:*:${proposalId}`,
          undefined,
          startAfter
            ? {
                [Op.gt]: `voteCast:${startAfter}:${proposalId}`,
              }
            : undefined,
          limit ? limitNum : undefined
        )
      )?.map(({ data }) => data) ??
      (
        await getTransformationMatches<VoteCast<Ballot>>(
          contractAddress,
          `voteCast:*:${proposalId}`,
          undefined,
          undefined,
          startAfter
            ? {
                [Op.gt]: `voteCast:${startAfter}:${proposalId}`,
              }
            : undefined,
          limit ? limitNum : undefined
        )
      )?.map(({ value }) => value)

    // Fallback to events.
    if (!votesCast) {
      const ballots =
        (await getMap<string, Ballot>(contractAddress, [
          'ballots',
          Number(proposalId),
        ])) ?? {}
      const voters = Object.keys(ballots)
        // Ascending by voter address.
        .sort((a, b) => a.localeCompare(b))
        .filter((voter) => !startAfter || voter.localeCompare(startAfter) > 0)
        .slice(0, limitNum)

      const votesCastAt =
        voters.length <= 50
          ? await Promise.all(
              voters.map((voter) =>
                getDateKeyModified(
                  contractAddress,
                  'ballots',
                  Number(proposalId),
                  voter
                )
              )
            )
          : undefined

      votesCast = voters.map((voter, index) => ({
        voter,
        vote: ballots[voter],
        votedAt: votesCastAt?.[index]?.toISOString(),
      }))
    }

    return votesCast.map(
      ({ voter, vote, votedAt }): VoteInfo<Ballot> => ({
        voter,
        ...vote,
        votedAt,
      })
    )
  },
}

export const proposalCreatedAt: ContractFormula<string, { id: string }> = {
  docs: {
    description: 'retrieves the creation date of a proposal',
    args: [
      {
        name: 'id',
        description: 'ID of the proposal',
        required: true,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  compute: async (env) => {
    const {
      contractAddress,
      getDateFirstTransformed,
      getDateKeyFirstSet,
      getDateFirstExtracted,
      getBlock,
      args: { id },
    } = env

    if (!id || isNaN(Number(id)) || Number(id) < 0) {
      throw new Error('missing `id`')
    }

    const proposal = await getProposal(env, Number(id))
    if (!proposal) {
      throw new Error('proposal not found')
    }

    // Use proposal start block if available.
    const date = (
      (await getBlock(proposal.start_height).then(
        (b) => b && new Date(Number(b.timeUnixMs))
      )) ??
      // Fallback to transformation.
      (await getDateFirstTransformed(contractAddress, `proposal:${id}`)) ??
      // Fallback to extraction.
      (await getDateFirstExtracted(contractAddress, `proposal:${id}`)) ??
      // Fallback to events.
      (await getDateKeyFirstSet(contractAddress, 'proposals', Number(id)))
    )?.toISOString()

    if (!date) {
      throw new Error('failed to get proposal creation date')
    }

    return date
  },
}

// Return open proposals. If an address is passed, adds a flag indicating if
// they've voted or not.
export const openProposals: ContractFormula<
  (ProposalResponse<MultipleChoiceProposal> & { voted?: boolean })[],
  { address?: string }
> = {
  docs: {
    description: 'retrieves a list of open proposals',
    args: [
      {
        name: 'address',
        description: 'optional address to check if they have voted',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  // This formula depends on the block height/time to check expiration.
  dynamic: true,
  compute: async (env) => {
    const openProposals = (
      await listProposals.compute({
        ...env,
        args: {},
      })
    ).filter(({ proposal }) => proposal.status === StatusEnum.Open)

    // Get votes for the given address for each open proposal. If no address,
    // don't filter by vote.
    const openProposalVotes = env.args.address
      ? await Promise.allSettled(
          openProposals.map(({ id }) =>
            vote.compute({
              ...env,
              args: {
                proposalId: id.toString(),
                voter: env.args.address!,
              },
            })
          )
        )
      : undefined

    // Filter out proposals with votes if address provided.
    const openProposalsWithVotes =
      env.args.address && openProposalVotes
        ? openProposals.map((proposal, index) => ({
            ...proposal,
            voted: openProposalVotes[index].status === 'fulfilled',
          }))
        : openProposals

    return openProposalsWithVotes
  },
}

// Helpers

const getProposal = async (
  env: ContractEnv,
  id: number
): Promise<MultipleChoiceProposal | null> =>
  // Try extraction first.
  (
    await env.getExtraction<MultipleChoiceProposal>(
      env.contractAddress,
      `proposal:${id}`
    )
  )?.data ||
  // Fallback to transformation.
  (
    await env.getTransformationMatch<MultipleChoiceProposal>(
      env.contractAddress,
      `proposal:${id}`
    )
  )?.value ||
  // Fallback to events.
  (await env.get<MultipleChoiceProposal>(env.contractAddress, 'proposals', id))
    ?.valueJson ||
  null

// https://github.com/DA0-DA0/dao-contracts/blob/fa567797e2f42e70296a2d6f889f341ff80f0695/contracts/proposal/dao-proposal-single/src/proposal.rs#L50
const intoResponse = async (
  env: ContractEnv,
  proposal: MultipleChoiceProposal,
  id: number
): Promise<ProposalResponse<MultipleChoiceProposal>> => {
  // Update status.
  if (proposal.status === StatusEnum.Open) {
    if (isPassed(env, proposal)) {
      if (proposal.veto) {
        const expiration = expirationPlusDuration(
          proposal.expiration,
          proposal.veto.timelock_duration
        )

        if (isExpirationExpired(env, expiration)) {
          proposal.status = StatusEnum.Passed
        } else {
          proposal.status = {
            veto_timelock: {
              expiration,
            },
          }
        }
      } else {
        proposal.status = StatusEnum.Passed
      }
    } else if (
      isExpirationExpired(env, proposal.expiration) ||
      isRejected(env, proposal)
    ) {
      proposal.status = StatusEnum.Rejected
    }
  } else if (
    typeof proposal.status === 'object' &&
    'veto_timelock' in proposal.status
  ) {
    if (isExpirationExpired(env, proposal.status.veto_timelock.expiration)) {
      proposal.status = StatusEnum.Passed
    }
  }

  const createdAt =
    (await env
      .getBlock(proposal.start_height)
      .then((b) => b && new Date(Number(b.timeUnixMs)).toISOString())) ??
    (await proposalCreatedAt.compute({
      ...env,
      args: {
        id: id.toString(),
      },
    }))

  let executedAt: string | undefined
  if (
    proposal.status === StatusEnum.Executed ||
    proposal.status === StatusEnum.ExecutionFailed
  ) {
    executedAt = (
      (await env.getDateFirstTransformed(
        env.contractAddress,
        `proposal:${id}`,
        {
          status: {
            [Op.in]: ['executed', 'execution_failed'],
          },
        }
      )) ??
      // Fallback to extraction.
      (await env.getDateFirstExtracted(env.contractAddress, `proposal:${id}`, {
        status: {
          [Op.in]: ['executed', 'execution_failed'],
        },
      })) ??
      // Fallback to events.
      (await env.getDateKeyFirstSetWithValueMatch(
        env.contractAddress,
        ['proposals', id],
        {
          status: {
            [Op.in]: ['executed', 'execution_failed'],
          },
        }
      ))
    )?.toISOString()
  }

  let closedAt: string | undefined
  if (proposal.status === StatusEnum.Closed) {
    closedAt = (
      (await env.getDateFirstTransformed(
        env.contractAddress,
        `proposal:${id}`,
        {
          status: 'closed',
        }
      )) ??
      // Fallback to extraction.
      (await env.getDateFirstExtracted(env.contractAddress, `proposal:${id}`, {
        status: 'closed',
      })) ??
      // Fallback to events.
      (await env.getDateKeyFirstSetWithValueMatch(
        env.contractAddress,
        ['proposals', id],
        {
          status: 'closed',
        }
      ))
    )?.toISOString()
  }

  let completedAt: string | undefined
  if (proposal.status !== StatusEnum.Open) {
    completedAt =
      executedAt ||
      closedAt ||
      // If not yet executed nor closed, completed when it was passed/rejected.
      (
        (await env.getDateFirstTransformed(
          env.contractAddress,
          `proposal:${id}`,
          {
            status: {
              [Op.in]: ['passed', 'rejected'],
            },
          }
        )) ??
        // Fallback to extraction.
        (await env.getDateFirstExtracted(
          env.contractAddress,
          `proposal:${id}`,
          {
            status: {
              [Op.in]: ['passed', 'rejected'],
            },
          }
        )) ??
        // Fallback to events.
        (await env.getDateKeyFirstSetWithValueMatch(
          env.contractAddress,
          ['proposals', id],
          {
            status: {
              [Op.in]: ['passed', 'rejected'],
            },
          }
        ))
      )?.toISOString()
  }

  return {
    id,
    proposal,
    // Extra.
    createdAt,
    completedAt,
    executedAt,
    closedAt,
  }
}
