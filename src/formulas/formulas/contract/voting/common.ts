import { ContractFormula } from '@/types'

export const activeThreshold: ContractFormula = {
  docs: {
    description: 'retrieves the active threshold for the contract',
  },
  compute: async ({ contractAddress, get, getTransformationMatch }) =>
    (await getTransformationMatch(contractAddress, 'activeThreshold'))?.value ||
    (await get(contractAddress, 'active_threshold'))?.valueJson,
}
