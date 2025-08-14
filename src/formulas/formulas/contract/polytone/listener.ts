import { ContractFormula } from '@/types'

import { makeSimpleContractFormula } from '../../utils'

export const note = makeSimpleContractFormula<string>({
  docs: {
    description:
      'retrieves the note contract address this listener is listening to',
  },
  key: 'note',
})

export const result: ContractFormula<
  any,
  { initiator: string; initiatorMsg: string }
> = {
  docs: {
    description:
      'retrieves the result for a given initiator and initiator message',
    args: [
      {
        name: 'initiator',
        description: 'address of the initiator',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'initiatorMsg',
        description: 'message (identifier) that was passed during execution',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({
    contractAddress,
    get,
    args: { initiator, initiatorMsg },
  }) => {
    if (!initiator) {
      throw new Error('Missing initiator')
    }
    if (!initiatorMsg) {
      throw new Error('Missing initiatorMsg')
    }

    return (
      (await get<string>(contractAddress, 'results', initiator, initiatorMsg))
        ?.valueJson ??
      // Return null if no result found.
      null
    )
  },
}
