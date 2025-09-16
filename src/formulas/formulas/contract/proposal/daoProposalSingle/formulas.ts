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
import { Ballot, Config, SingleChoiceProposal } from './types'

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
      key: 'config_v2',
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
  ProposalResponse<SingleChoiceProposal>,
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

    const { proposal, v2 = false } = (await getProposal(env, id)) ?? {}
    if (!proposal) {
      throw new Error('proposal not found')
    }

    return {
      ...(await intoResponse(env, proposal, id, { v2 })),
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
  ProposalResponse<SingleChoiceProposal>[],
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
      getTransformationMap,
      getMap,
      args: { limit, startAfter },
    } = env

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity
    const startAfterNum = startAfter
      ? Math.max(0, Number(startAfter))
      : -Infinity

    let proposals = await getTransformationMap<SingleChoiceProposal>(
      contractAddress,
      'proposal'
    )

    // Fallback to events.
    let v2 = false
    if (!proposals) {
      // V2.
      const proposalsV2 = await getMap<number, SingleChoiceProposal>(
        contractAddress,
        'proposals_v2',
        { keyType: 'number' }
      )
      if (proposalsV2) {
        proposals = proposalsV2
        v2 = true
      } else {
        // V1.
        proposals = await getMap<number, SingleChoiceProposal>(
          contractAddress,
          'proposals',
          { keyType: 'number' }
        )
      }
    }

    if (!proposals) {
      return []
    }

    const proposalIds = Object.keys(proposals)
      .map(Number)
      // Ascending by proposal ID.
      .sort((a, b) => a - b)
      .filter((id) => id > startAfterNum)
      .slice(0, limitNum)

    const proposalResponses = (
      await Promise.all(
        proposalIds.map((id) => intoResponse(env, proposals![id], id, { v2 }))
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
  ProposalResponse<SingleChoiceProposal>[],
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
      getTransformationMap,
      getMap,
      args: { limit, startBefore },
    } = env

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity
    const startBeforeNum = startBefore
      ? Math.max(0, Number(startBefore))
      : Infinity

    let proposals = await getTransformationMap<SingleChoiceProposal>(
      contractAddress,
      'proposal'
    )

    // Fallback to events.
    let v2 = false
    if (!proposals) {
      // V2.
      const proposalsV2 = await getMap<number, SingleChoiceProposal>(
        contractAddress,
        'proposals_v2',
        { keyType: 'number' }
      )
      if (proposalsV2) {
        proposals = proposalsV2
        v2 = true
      } else {
        // V1.
        proposals = await getMap<number, SingleChoiceProposal>(
          contractAddress,
          'proposals',
          { keyType: 'number' }
        )
      }
    }

    if (!proposals) {
      return []
    }

    const proposalIds = Object.keys(proposals)
      .map(Number)
      // Descending by proposal ID.
      .sort((a, b) => b - a)
      .filter((id) => id < startBeforeNum)
      .slice(0, limitNum)

    const proposalResponses = await Promise.all(
      proposalIds.map((id) => intoResponse(env, proposals![id], id, { v2 }))
    )

    return proposalResponses
  },
}

export const proposalCount = makeSimpleContractFormula<number>({
  docs: {
    description: 'retrieves the number of proposals',
  },
  key: 'proposal_count',
  // V1 may have no proposal_count set, so default to 0.
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
      (
        await getTransformationMatch<VoteCast<Ballot>>(
          contractAddress,
          `voteCast:${voter}:${proposalId}`
        )
      )?.value ??
      // Fallback to extraction.
      (
        await getExtraction<VoteCast<Ballot>>(
          contractAddress,
          `voteCast:${voter}:${proposalId}`
        )
      )?.data

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
    getTransformationMatches,
    getMap,
    getDateKeyModified,
    args: { proposalId, limit, startAfter },
  }) => {
    if (!proposalId || isNaN(Number(proposalId)) || Number(proposalId) < 0) {
      throw new Error('missing `proposalId`')
    }

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    let votesCast = (
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

    const { proposal } = (await getProposal(env, Number(id))) ?? {}
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
      (await getDateKeyFirstSet(contractAddress, 'proposals_v2', Number(id))) ??
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
  (ProposalResponse<SingleChoiceProposal> & { voted?: boolean })[],
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
      ? await Promise.all(
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
            voted: !!openProposalVotes[index],
          }))
        : openProposals

    return openProposalsWithVotes
  },
}

// Helpers

const getProposal = async (
  env: ContractEnv,
  id: number
): Promise<{ proposal: SingleChoiceProposal; v2: boolean } | null> => {
  let proposal: SingleChoiceProposal | undefined | null = (
    await env.getTransformationMatch<SingleChoiceProposal>(
      env.contractAddress,
      `proposal:${id}`
    )
  )?.value

  // Fallback to extraction.
  if (!proposal) {
    proposal = (
      await env.getExtraction<SingleChoiceProposal>(
        env.contractAddress,
        `proposal:${id}`
      )
    )?.data
  }

  // Fallback to events.
  let v2 = false
  if (!proposal) {
    // V2.
    const proposalV2 = (
      await env.get<SingleChoiceProposal>(
        env.contractAddress,
        'proposals_v2',
        id
      )
    )?.valueJson
    if (proposalV2) {
      proposal = proposalV2
      v2 = true
    } else {
      // V1.
      proposal = (
        await env.get<SingleChoiceProposal>(
          env.contractAddress,
          'proposals',
          id
        )
      )?.valueJson
    }
  }

  return proposal ? { proposal, v2 } : null
}

// https://github.com/DA0-DA0/dao-contracts/blob/e1f46b48cc72d4e48bf6afcb44432979347e594c/contracts/proposal/dao-proposal-single/src/proposal.rs#L50
const intoResponse = async (
  env: ContractEnv,
  proposal: SingleChoiceProposal,
  id: number,
  { v2 }: { v2: boolean }
): Promise<ProposalResponse<SingleChoiceProposal>> => {
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
        [v2 ? 'proposals_v2' : 'proposals', id],
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
        [v2 ? 'proposals_v2' : 'proposals', id],
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
          [v2 ? 'proposals_v2' : 'proposals', id],
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
