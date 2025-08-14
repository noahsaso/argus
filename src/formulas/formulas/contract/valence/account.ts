import { ContractFormula } from '@/types'
import { dbKeyToKeys } from '@/utils'

import { makeSimpleContractFormula } from '../../utils'
import { AUCTIONS_MANAGER_ADDR, REBALANCER_ADDR } from './constants'
import {
  AccountResponse,
  AuctionIds,
  FundsInAuctionsResponse,
  Pair,
  ParsedTarget,
  RebalancerConfig,
  RebalancerConfigResponse,
} from './types'

export const admin = makeSimpleContractFormula<string>({
  docs: {
    description: 'retrieves the admin address of the contract',
  },
  key: 'admin',
})

export const data: ContractFormula<AccountResponse> = {
  docs: {
    description: 'retrieves account data (admin and rebalancer config)',
  },
  compute: async (env) => ({
    admin: await admin.compute(env),
    rebalancerConfig: await rebalancerConfig.compute(env),
  }),
}

export const rebalancerConfig: ContractFormula<
  RebalancerConfigResponse | undefined
> = {
  docs: {
    description: 'retrieves the rebalancer configuration for the account',
  },
  compute: async ({ contractAddress: accountAddr, get }) => {
    // TODO: modify to transformer
    const config = (
      await get<RebalancerConfig>(REBALANCER_ADDR, 'configs', accountAddr)
    )?.valueJson

    if (config) {
      return {
        ...config,
        is_paused: false,
      }
    } else {
      const config = (
        await get<RebalancerConfig>(
          REBALANCER_ADDR,
          'paused_configs',
          accountAddr
        )
      )?.valueJson
      if (config) {
        return {
          ...config,
          is_paused: true,
        }
      } else {
        return undefined
      }
    }
  },
}

export const rebalancerTargets: ContractFormula<ParsedTarget[] | undefined> = {
  docs: {
    description: 'retrieves the rebalancer targets',
  },
  compute: async ({ contractAddress: accountAddr, get }) => {
    // TODO: modify to transformer
    const config = (
      await get<RebalancerConfig>(REBALANCER_ADDR, 'configs', accountAddr)
    )?.valueJson

    return config?.targets
  },
}

export const fundsInAuction: ContractFormula<
  FundsInAuctionsResponse[] | undefined
> = {
  docs: {
    description:
      'retrieves information about funds currently in auction for the account',
  },
  compute: async ({ contractAddress: accountAddr, get, getMap }) => {
    const pairMap =
      (await getMap(AUCTIONS_MANAGER_ADDR, 'pairs', {
        keyType: 'raw',
      })) || {}

    return Promise.all(
      Object.entries(pairMap).map(async ([key, auctionAddr]) => {
        const pair = dbKeyToKeys(key, [false, false]) as Pair

        // get the current id of the auction
        const auctionCurrId = (
          await get<AuctionIds>(auctionAddr, 'auction_ids')
        )?.valueJson?.curr

        if (auctionCurrId === undefined) {
          return undefined
        }

        // get the funds amount
        const funds = (
          await get<string>(auctionAddr, 'funds', auctionCurrId, accountAddr)
        )?.valueJson

        if (funds) {
          return {
            pair,
            amount: funds,
          } as FundsInAuctionsResponse
        }

        return undefined
      })
    ).then(
      (res) => res.filter((r) => r !== undefined) as FundsInAuctionsResponse[]
    )
  },
}
