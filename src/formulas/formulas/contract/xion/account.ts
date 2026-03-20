import type { Params } from '@burnt-labs/xion-types'

import { ContractFormula } from '@/types'

// Stored authenticator shape (on-chain representation, snake_case keys).
// Not produced by ts-codegen since the contract query responses return Binary;
// derived from the account contract's state serialization.
type Authenticator =
  | { secp256_k1: { pubkey: string } }
  | { ed25519: { pubkey: string } }
  | { eth_wallet: { address: string } }
  | { jwt: { aud: string; sub: string } }
  | { secp256_r1: { pubkey: string } }
  | { passkey: { passkey: string; url: string } }

const AccountStorageKeys = {
  AUTHENTICATORS: 'authenticators',
}

const TreasuryStorageKeys = {
  PARAMS: 'params',
}

export const authenticators: ContractFormula<Authenticator[]> = {
  docs: {
    description: 'Get authenticator map for account',
  },
  compute: async (env) => {
    const { contractAddress, getMap } = env

    const authenticatorMap =
      (await getMap<number, Authenticator>(
        contractAddress,
        AccountStorageKeys.AUTHENTICATORS
      )) ?? {}

    return Object.values(authenticatorMap)
  },
}

/*
 * This returns the treasury contracts where the passed account is the admin.
 */
export const treasuries: ContractFormula<
  {
    contractAddress: string
    balances?: Record<string, string>
    block: {
      height: string
      timeUnixMs: string
    }
  }[]
> = {
  docs: {
    description:
      'retrieves treasury contracts where the passed account is the admin',
  },
  compute: async (env) => {
    const {
      contractAddress,
      get,
      getBalances,
      getTransformationMatches,
      getCodeIdsForKeys,
    } = env

    // Treasury contracts where the address is the admin.
    const treasuryContracts = await getTransformationMatches(
      undefined,
      'admin',
      contractAddress,
      getCodeIdsForKeys('xion-treasury')
    ).then((matches) => {
      return (matches || []).sort((a, b) =>
        a.block.height < b.block.height ? 1 : -1
      )
    })

    return Promise.all(
      treasuryContracts.map(async ({ contractAddress, block, codeId }) => ({
        contractAddress,
        balances: await getBalances(contractAddress),
        block: {
          height: block.height.toString(),
          timeUnixMs: block.timeUnixMs.toString(),
        },
        codeId,
        params:
          (await get<Params>(contractAddress, TreasuryStorageKeys.PARAMS))
            ?.valueJson ?? {},
      })) ?? []
    )
  },
}
