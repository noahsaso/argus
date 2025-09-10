import { fromBech32 } from '@cosmjs/encoding'

import { ContractFormula } from '@/types'

import { Expiration } from '../../types'
import { makeSimpleContractFormula } from '../../utils'
import { dao } from '../voting/daoVotingCw20Staked'

interface TokenInfo {
  name: string
  symbol: string
  decimals: number
  total_supply: string
}

interface TokenInfoResponse extends TokenInfo {
  mint?: {
    minter: string
    cap?: string
  }
}

interface AllowanceResponse {
  allowance: string
  expires: Expiration
}

interface OwnerAllowanceInfo extends AllowanceResponse {
  spender: string
}

interface SpenderAllowanceInfo extends AllowanceResponse {
  owner: string
}

interface AccountBalance {
  address: string
  balance: string
}

export const balance: ContractFormula<string, { address: string }> = {
  docs: {
    description: 'retrieves the balance of a given address',
    args: [
      {
        name: 'address',
        description: 'address to check the balance for',
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
    contractMatchesCodeIdKeys,
    args: { address },
  }) => {
    if (!address) {
      throw new Error('missing `address`')
    }

    // cw20-base before v0.6.0-alpha3 stores addresses as raw bech32 data
    // instead of addr strings
    const isLegacy = await contractMatchesCodeIdKeys(
      contractAddress,
      'cw20-base-legacy'
    )
    const addressData = isLegacy ? fromBech32(address).data : address

    const balance = (await get<string>(contractAddress, 'balance', addressData))
      ?.valueJson
    if (!balance) {
      throw new Error(`no balance found for ${address}`)
    }

    return balance
  },
}

export const tokenInfo = makeSimpleContractFormula<TokenInfo>({
  docs: {
    description: 'retrieves the token info',
  },
  transformation: 'tokenInfo',
  transform: (r) => ({
    ...r,
    // Not present in normal TokenInfoResponse.
    mint: undefined,
  }),
})

export const minter = makeSimpleContractFormula<
  TokenInfoResponse,
  Required<TokenInfoResponse>['mint'] | null
>({
  docs: {
    description: 'retrieves the minter info',
  },
  transformation: 'tokenInfo',
  transform: ({ mint }) => mint || null,
})

export const allowance: ContractFormula<
  AllowanceResponse,
  { owner: string; spender: string }
> = {
  docs: {
    description: 'retrieves the allowance for a spender from an owner',
    args: [
      {
        name: 'owner',
        description: 'address of the token owner',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'spender',
        description: 'address of the spender',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({ contractAddress, get, args: { owner, spender } }) => {
    if (!owner) {
      throw new Error('missing `owner`')
    }
    if (!spender) {
      throw new Error('missing `spender`')
    }

    return (
      (
        await get<AllowanceResponse>(
          contractAddress,
          'allowance',
          owner,
          spender
        )
      )?.valueJson ?? {
        allowance: '0',
        expires: { never: {} },
      }
    )
  },
}

export const ownerAllowances: ContractFormula<
  OwnerAllowanceInfo[],
  {
    owner: string
    limit?: string
    startAfter?: string
  }
> = {
  docs: {
    description: 'retrieves all allowances granted by an owner',
    args: [
      {
        name: 'owner',
        description: 'address of the token owner',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'limit',
        description: 'maximum number of allowances to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startAfter',
        description: 'address to start listing after',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({
    contractAddress,
    getMap,
    args: { owner, limit, startAfter },
  }) => {
    if (!owner) {
      throw new Error('missing `owner`')
    }

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    const allowancesMap =
      (await getMap<string, AllowanceResponse>(contractAddress, [
        'allowance',
        owner,
      ])) ?? {}
    const allowances = Object.entries(allowancesMap)
      // Ascending by spender address.
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(
        ([address]) => !startAfter || address.localeCompare(startAfter) > 0
      )
      .slice(0, limitNum)

    return allowances.map(([spender, allowance]) => ({
      spender,
      ...allowance,
    }))
  },
}

export const spenderAllowances: ContractFormula<
  SpenderAllowanceInfo[],
  {
    spender: string
    limit?: string
    startAfter?: string
  }
> = {
  docs: {
    description: 'retrieves all allowances granted to a spender',
    args: [
      {
        name: 'spender',
        description: 'address of the spender',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'limit',
        description: 'maximum number of allowances to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startAfter',
        description: 'address to start listing after',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({
    contractAddress,
    getMap,
    args: { spender, limit, startAfter },
  }) => {
    if (!spender) {
      throw new Error('missing `spender`')
    }

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    const allowancesMap =
      (await getMap<string, AllowanceResponse>(contractAddress, [
        'allowance_spender',
        spender,
      ])) ?? {}
    const allowances = Object.entries(allowancesMap)
      // Ascending by owner address.
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(
        ([address]) => !startAfter || address.localeCompare(startAfter) > 0
      )
      .slice(0, limitNum)

    return allowances.map(([owner, allowance]) => ({
      owner,
      ...allowance,
    }))
  },
}

export const allAccounts: ContractFormula<
  string[],
  {
    limit?: string
    startAfter?: string
  }
> = {
  docs: {
    description: 'retrieves all accounts that hold this token',
    args: [
      {
        name: 'limit',
        description: 'maximum number of accounts to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startAfter',
        description: 'address to start listing after',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({ contractAddress, getMap, args: { limit, startAfter } }) => {
    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    const balancesMap = (await getMap<string>(contractAddress, 'balance')) ?? {}
    const accounts = Object.keys(balancesMap)
      // Ascending by address.
      .sort((a, b) => a.localeCompare(b))
      .filter((address) => !startAfter || address.localeCompare(startAfter) > 0)
      .slice(0, limitNum)

    return accounts
  },
}

export const topAccountBalances: ContractFormula<
  AccountBalance[],
  {
    limit?: string
  }
> = {
  docs: {
    description: 'retrieves the top account balances',
    args: [
      {
        name: 'limit',
        description: 'maximum number of account balances to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  compute: async ({ contractAddress, getMap, args: { limit } }) => {
    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    const balancesMap =
      (await getMap<string, string>(contractAddress, 'balance')) ?? {}
    const accounts = Object.entries(balancesMap)
      // Descending by balance.
      .sort(([, a], [, b]) => Number(b) - Number(a))
      .slice(0, limitNum)

    return accounts.map(([address, balance]) => ({
      address,
      balance,
    }))
  },
}

export const marketingInfo = makeSimpleContractFormula({
  docs: {
    description: 'retrieves the marketing info',
  },
  key: 'marketing_info',
  fallback: {},
})

// Returns null if no logo URL found.
export const logoUrl = makeSimpleContractFormula<
  { url: string | undefined | null },
  string | null
>({
  docs: {
    description: 'retrieves the logo URL',
  },
  key: 'logo',
  fallback: null,
  transform: (logo) => (logo && 'url' in logo && logo.url) || null,
})

// Get DAOs that use this cw20 as their governance token.
export const daos: ContractFormula<string[]> = {
  docs: {
    description:
      'retrieves the DAOs that use this token as their governance token',
  },
  compute: async (env) => {
    const { contractAddress, getTransformationMatches, getCodeIdsForKeys } = env

    // Get dao-voting-cw20-staked contracts that use this token contract.
    const daoVotingCw20StakedContracts =
      (
        await getTransformationMatches(
          undefined,
          'token',
          contractAddress,
          getCodeIdsForKeys('dao-voting-cw20-staked')
        )
      )?.map(({ contractAddress }) => contractAddress) ?? []

    // Get the DAO for each voting contract.
    const daos = (
      await Promise.all(
        daoVotingCw20StakedContracts.map((contractAddress) =>
          dao.compute({
            ...env,
            contractAddress,
          })
        )
      )
    ).filter(Boolean) as string[]

    return daos
  },
}
