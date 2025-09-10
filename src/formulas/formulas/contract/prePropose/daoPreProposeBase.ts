import { ContractFormula } from '@/types'

import { makeSimpleContractFormula } from '../../utils'

export const proposalModule = makeSimpleContractFormula<string>({
  docs: {
    description: 'retrieves the proposal module address',
  },
  key: 'proposal_module',
})

export const dao = makeSimpleContractFormula<string>({
  docs: {
    description: 'retrieves the DAO address',
  },
  key: 'dao',
})

export const config = makeSimpleContractFormula<any>({
  docs: {
    description: 'retrieves the configuration for the pre-propose module',
  },
  key: 'config',
})

export const depositInfo: ContractFormula<any, { proposalId: string }> = {
  docs: {
    description: 'retrieves deposit information for a given proposal ID',
    args: [
      {
        name: 'proposalId',
        description: 'ID of the proposal to retrieve deposit information for',
        required: true,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  compute: async ({ contractAddress, get, args: { proposalId } }) => {
    if (!proposalId) {
      throw new Error('missing `proposalId`')
    }

    const data = (
      await get<[any, string]>(contractAddress, 'deposits', Number(proposalId))
    )?.valueJson

    if (!data || !Array.isArray(data) || data.length !== 2) {
      throw new Error('invalid proposal ID or deposit info')
    }

    return {
      deposit_info: data[0],
      proposer: data[1],
    }
  },
}
