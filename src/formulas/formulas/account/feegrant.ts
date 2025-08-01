import { AccountFormula } from '@/types'

export const allowance: AccountFormula<any, { grantee: string }> = {
  docs: {
    description: 'retrieves the feegrant allowance for a specific grantee',
    args: [
      {
        name: 'grantee',
        description: 'address of the grantee to check allowance for',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({ address, getFeegrantAllowance, args: { grantee } }) => {
    if (!grantee) {
      throw new Error('missing `grantee`')
    }

    return await getFeegrantAllowance(address, grantee)
  },
}

export const allowances: AccountFormula<any[], { type?: 'granted' | 'received' }> = {
  docs: {
    description: 'retrieves all feegrant allowances for this account',
    args: [
      {
        name: 'type',
        description: 'type of allowances to retrieve: "granted" (default) or "received"',
        required: false,
        schema: {
          type: 'string',
          enum: ['granted', 'received'],
        },
      },
    ],
  },
  compute: async ({ address, getFeegrantAllowances, args: { type = 'granted' } }) => {
    if (type !== 'granted' && type !== 'received') {
      throw new Error('type must be "granted" or "received"')
    }

    return (await getFeegrantAllowances(address, type)) || []
  },
}

export const has: AccountFormula<boolean, { grantee: string }> = {
  docs: {
    description: 'checks if there is an active feegrant allowance for a specific grantee',
    args: [
      {
        name: 'grantee',
        description: 'address of the grantee to check allowance for',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({ address, hasFeegrantAllowance, args: { grantee } }) => {
    if (!grantee) {
      throw new Error('missing `grantee`')
    }

    return await hasFeegrantAllowance(address, grantee)
  },
}
