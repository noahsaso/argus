import { ContractFormula } from '@/types'

export const remoteAddress: ContractFormula<
  string | null,
  { address: string }
> = {
  docs: {
    description: 'retrieves the remote address for a given address',
    args: [
      {
        name: 'address',
        description: 'address to get the remote address for',
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
    args: { address },
  }) => {
    if (!address) {
      throw new Error('missing `address`')
    }

    return (
      (
        await getTransformationMatch<string>(
          contractAddress,
          `remoteAddress:${contractAddress}`
        )
      )?.value ??
      (await get<string>(contractAddress, 'polytone-account-map', address))
        ?.valueJson ??
      null
    )
  },
}
