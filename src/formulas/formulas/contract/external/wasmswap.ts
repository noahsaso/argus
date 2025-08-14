import { ContractFormula } from '@/types'

import { Denom } from '../../types'
import { tokenInfo } from './cw20'

interface Token {
  reserve: string
  denom: Denom
}

export const summary: ContractFormula = {
  docs: {
    description: 'retrieves summary information about the pool',
  },
  compute: async (env) => {
    const { contractAddress, get } = env

    const [{ token1, token1Cw20 }, { token2, token2Cw20 }] = await Promise.all([
      get<Token>(contractAddress, 'token1')
        .then((event) => event?.valueJson)
        .then(async (token1) => ({
          token1,
          // Get CW20 token info if available.
          token1Cw20:
            token1 && 'cw20' in token1.denom
              ? await tokenInfo.compute({
                  ...env,
                  contractAddress: token1.denom.cw20,
                })
              : undefined,
        })),
      get<Token>(contractAddress, 'token2')
        .then((event) => event?.valueJson)
        .then(async (token2) => ({
          token2,
          // Get CW20 token info if available.
          token2Cw20:
            token2 && 'cw20' in token2.denom
              ? await tokenInfo.compute({
                  ...env,
                  contractAddress: token2.denom.cw20,
                })
              : undefined,
        })),
    ])

    if (!token1 || !token2) {
      return undefined
    }

    const token1Amount = parseFloat(token1.reserve)
    const token2Amount = parseFloat(token2.reserve)

    if (token1Amount === 0 || token2Amount === 0) {
      return undefined
    }

    return {
      token1: {
        denom: token1.denom,
        cw20Info: token1Cw20,
        reserve: token1Amount,
        price: token2Amount / token1Amount,
      },
      token2: {
        denom: token2.denom,
        cw20Info: token2Cw20,
        reserve: token2Amount,
        price: token1Amount / token2Amount,
      },
    }
  },
}

export const price: ContractFormula = {
  docs: {
    description:
      'calculates the price ratio between the two tokens in the pool',
  },
  compute: async (env) => {
    const { contractAddress, get } = env

    const [token1, token2] = await Promise.all([
      get<Token>(contractAddress, 'token1').then((event) => event?.valueJson),
      get<Token>(contractAddress, 'token2').then((event) => event?.valueJson),
    ])

    if (!token1 || !token2) {
      return undefined
    }

    const token1Amount = parseFloat(token1.reserve)
    const token2Amount = parseFloat(token2.reserve)

    if (token1Amount === 0 || token2Amount === 0) {
      return undefined
    }

    return {
      token1: token2Amount / token1Amount,
      token2: token1Amount / token2Amount,
    }
  },
}
