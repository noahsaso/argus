import { ContractFormula } from '@/types'

export const status: ContractFormula = {
  docs: {
    description: 'retrieves the status of the token swap',
  },
  compute: async ({ contractAddress, get, prefetch }) => {
    await prefetch(contractAddress, 'counterparty_one', 'counterparty_two')

    const counterparty_one = (await get(contractAddress, 'counterparty_one'))
      ?.valueJson
    const counterparty_two = (await get(contractAddress, 'counterparty_two'))
      ?.valueJson

    return counterparty_one && counterparty_two
      ? {
          counterparty_one,
          counterparty_two,
        }
      : undefined
  },
}
