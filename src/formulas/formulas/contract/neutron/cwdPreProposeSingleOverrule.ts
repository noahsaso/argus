import { ContractFormula } from '@/types'

export * from '../prePropose/daoPreProposeBase'

export const overruleProposalId: ContractFormula<
  number,
  {
    timelockAddress: string
    subdaoProposalId: string
  }
> = {
  docs: {
    description:
      'retrieves the overrule proposal ID for a given subDAO proposal ID and timelock address',
    args: [
      {
        name: 'timelockAddress',
        description: 'the address of the timelock contract',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'subdaoProposalId',
        description: 'the ID of the subDAO proposal',
        required: true,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  compute: async ({
    contractAddress,
    get,
    args: { timelockAddress, subdaoProposalId },
  }) => {
    if (!timelockAddress) {
      throw new Error('missing `timelockAddress`')
    }
    if (!subdaoProposalId) {
      throw new Error('missing `subdaoProposalId`')
    }

    const id = (
      await get(
        contractAddress,
        'overrule_proposals',
        Number(subdaoProposalId),
        timelockAddress
      )
    )?.valueJson

    if (typeof id !== 'number') {
      throw new Error('faled to get overrule proposal id')
    }

    return id
  },
}
