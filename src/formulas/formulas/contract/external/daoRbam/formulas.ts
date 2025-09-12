import { ContractFormula } from '@/types'

import { Assignment, Role } from './types'

export const dao: ContractFormula<string> = {
  docs: {
    description: 'retrieves the address of the DAO to execute actions on.',
  },
  compute: async ({
    contractAddress,
    getTransformationMatch,
    getExtraction,
  }) => {
    const dao = (await getTransformationMatch<string>(contractAddress, 'dao'))
      ?.value

    if (!dao) {
      // If not found in state, try to get from extraction.
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
  compute: async ({ contractAddress, getTransformationMap, getExtraction }) => {
    const assignmentsMap = await getTransformationMap<Assignment>(
      contractAddress,
      'assignment'
    )
    const assignments = assignmentsMap && Object.values(assignmentsMap)

    if (!assignments) {
      // If not found in state, try to get from extraction.
      const extraction = await getExtraction<{ assignments: Assignment[] }>(
        contractAddress,
        'dao-rbam/list_assignments'
      )
      if (extraction) {
        return extraction.data.assignments
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
  compute: async ({ contractAddress, getTransformationMap, getExtraction }) => {
    const rolesMap = await getTransformationMap<Role>(contractAddress, 'role')
    const roles = rolesMap && Object.values(rolesMap)

    if (!roles) {
      // If not found in state, try to get from extraction.
      const extraction = await getExtraction<{ roles: Role[] }>(
        contractAddress,
        'dao-rbam/list_roles'
      )
      if (extraction) {
        return extraction.data.roles
      }

      throw new Error(`no roles found for ${contractAddress}`)
    }

    return roles
  },
}

export const authorizations: ContractFormula = {
  docs: {
    description: 'retrieves the list of authorizations.',
  },
  compute: async ({ contractAddress, getTransformationMap }) =>
    Object.values(
      (await getTransformationMap(contractAddress, 'authorization')) || {}
    ),
}

export const actions: ContractFormula = {
  docs: {
    description: 'retrieves the action log.',
  },
  compute: async ({ contractAddress, getTransformationMap }) =>
    Object.values((await getTransformationMap(contractAddress, 'log')) || {}),
}
