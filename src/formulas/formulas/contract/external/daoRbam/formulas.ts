import { ContractFormula } from '@/types'

import { Assignment, Role } from './types'

export const dao: ContractFormula<string> = {
  docs: {
    description: 'retrieves the address of the DAO to execute actions on.',
  },
  compute: async ({ contractAddress, get, getExtraction }) => {
    const dao = (await get<string>(contractAddress, 'dao'))?.valueJson

    if (!dao) {
      // If no dao found in state, try to get from extraction.
      const extraction = await getExtraction(contractAddress, 'dao-rbam/dao')
      if (extraction) {
        return (extraction.data as { dao: string }).dao
      }

      throw new Error(`no dao found for ${contractAddress}`)
    }

    return dao
  },
}

export const assignments: ContractFormula<Assignment[]> = {
  docs: {
    description: 'retrieves the list of assignments.',
  },
  compute: async ({ contractAddress, getMap, getExtraction }) => {
    const assignmentsMap = await getMap<number, Assignment>(
      contractAddress,
      'assignments',
      {
        keyType: 'number',
      }
    )
    const assignments = assignmentsMap && Object.values(assignmentsMap)

    if (!assignments) {
      const extraction = await getExtraction(
        contractAddress,
        'dao-rbam/list_assignments'
      )
      if (extraction) {
        return extraction.data as Assignment[]
      }

      throw new Error(`no assignments found for ${contractAddress}`)
    }

    return assignments
  },
}

export const roles: ContractFormula<Role[]> = {
  docs: {
    description: 'retrieves the list of roles.',
  },
  compute: async ({ contractAddress, getMap, getExtraction }) => {
    const rolesMap = await getMap<number, Role>(contractAddress, 'roles', {
      keyType: 'number',
    })

    const roles = rolesMap && Object.values(rolesMap)

    if (!roles) {
      // If no dao found in state, try to get from extraction.
      const extraction = await getExtraction(
        contractAddress,
        'dao-rbam/list_roles'
      )
      if (extraction) {
        return extraction.data as Role[]
      }

      throw new Error(`no roles found for ${contractAddress}`)
    }

    return roles
  },
}
