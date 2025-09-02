import { makeSimpleContractFormula } from '../../utils'

export const dao = makeSimpleContractFormula<string>({
  docs: {
    description: 'retrieves the DAO address associated with the rbam module',
  },
  key: 'dao',
})
