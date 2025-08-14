import { ContractFormula } from '@/types'

import { makeSimpleContractFormula } from '../../utils'

export const config = makeSimpleContractFormula({
  docs: {
    description: 'retrieves the configuration of the contract',
  },
  key: 'config',
})

export const proposal: ContractFormula<any, { id: string }> = {
  docs: {
    description: 'retrieves a proposal',
    args: [
      {
        name: 'id',
        description: 'ID of the proposal to retrieve',
        required: true,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  compute: async ({ contractAddress, get, args: { id } }) => {
    if (!id || isNaN(Number(id)) || Number(id) < 0) {
      throw new Error('missing `id`')
    }

    const proposal = (await get(contractAddress, 'proposals', Number(id)))
      ?.valueJson

    if (!proposal) {
      throw new Error('proposal not found')
    }

    return proposal
  },
}

export const listProposals: ContractFormula<
  any[],
  {
    limit?: string
    startAfter?: string
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
        description: 'ID to start listing proposals after',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  compute: async (env) => {
    const {
      contractAddress,
      getMap,
      args: { limit, startAfter },
    } = env

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity
    const startAfterNum = startAfter
      ? Math.max(0, Number(startAfter))
      : -Infinity

    const proposals = Object.entries(
      (await getMap<number, any>(contractAddress, 'proposals', {
        keyType: 'number',
      })) || {}
    )
      // Ascending by proposal ID.
      .sort(([a], [b]) => Number(a) - Number(b))
      .filter(([id]) => Number(id) > startAfterNum)
      .slice(0, limitNum)
      .map(([, proposal]) => proposal)

    return proposals
  },
}

export const proposalExecutionError: ContractFormula<any, { id: string }> = {
  docs: {
    description: 'retrieves the execution error for a specific proposal',
    args: [
      {
        name: 'id',
        description: 'ID of the proposal to retrieve the execution error for',
        required: true,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  compute: async ({ contractAddress, get, args: { id } }) => {
    if (!id || isNaN(Number(id)) || Number(id) < 0) {
      throw new Error('missing `id`')
    }

    return (
      (await get(contractAddress, 'proposal_execution_errors', Number(id)))
        ?.valueJson ?? null
    )
  },
}
