import { ContractFormula } from '@/types'

import { makeSimpleContractFormula } from '../../utils'

export * from './daoPreProposeBase'

export const preProposeApprovalContract = makeSimpleContractFormula<string>({
  docs: {
    description: 'retrieves the pre-propose approval contract address',
  },
  key: 'pre_propose_approval_contract',
})

export const preProposeApprovalIdForApproverProposalId: ContractFormula<
  number,
  { id: string }
> = {
  docs: {
    description: 'retrieves the approval ID for a given approver proposal ID',
    args: [
      {
        name: 'id',
        description: 'approver proposal ID',
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

    const proposalId = (
      await get(contractAddress, 'proposal_to_pre_propose', Number(id))
    )?.valueJson

    if (typeof proposalId !== 'number') {
      throw new Error('proposal not found')
    }

    return Number(id)
  },
}

export const approverProposalIdForPreProposeApprovalId: ContractFormula<
  number,
  { id: string }
> = {
  docs: {
    description: 'retrieves the approver proposal ID for a given approval ID',
    args: [
      {
        name: 'id',
        description: 'approval proposal ID',
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

    const proposalId = (
      await get(contractAddress, 'pre_propose_to_proposal', Number(id))
    )?.valueJson

    if (typeof proposalId !== 'number') {
      throw new Error('proposal not found')
    }

    return Number(id)
  },
}
