import { ContractFormula } from '@/types'
import { dbKeyToKeys } from '@/utils'

import { Pair, Price, PriceResponse } from './types'

export const allPrices: ContractFormula<PriceResponse[] | undefined> = {
  docs: {
    description: 'retrieves all price pairs from the oracle',
  },
  compute: async ({ contractAddress, getMap }) => {
    const pairMap = (await getMap(contractAddress, 'prices', {
      keyType: 'raw',
    }))!

    return Object.entries(pairMap).map(([key, value]) => {
      const pair = dbKeyToKeys(key, [false, false]) as Pair

      return {
        pair,
        ...value,
      }
    })
  },
}

export const price: ContractFormula<
  PriceResponse | undefined,
  { pair: string }
> = {
  docs: {
    description: 'retrieves the price for a specific pair from the oracle',
    args: [
      {
        name: 'pair',
        description:
          'comma-separated pair of token denominations to get the price for',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({ contractAddress, get, args }) => {
    if (!args.pair) {
      throw new Error('Must include the pair argument')
    }

    const pair = args.pair.split(',') as Pair
    const priceAndTime =
      (await get<Price>(contractAddress, 'prices', pair[0], pair[1]))
        ?.valueJson ?? undefined

    return (
      priceAndTime && {
        pair,
        price: priceAndTime.price,
        time: priceAndTime.time,
      }
    )
  },
}

export const pricesOfDenom: ContractFormula<
  PriceResponse[] | undefined,
  {
    base_denom: string
  }
> = {
  docs: {
    description: 'retrieves all prices for a specific base token',
    args: [
      {
        name: 'base_denom',
        description: 'base token denomination to get prices for',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({ contractAddress, getMap, args }) => {
    if (!args.base_denom) {
      throw new Error('Must include the pair argument')
    }

    const pairs: PriceResponse[] = []
    const pairMap =
      (await getMap(contractAddress, 'prices', {
        keyType: 'raw',
      })) || {}

    Object.entries(pairMap).forEach(([key, value]) => {
      const pair = dbKeyToKeys(key, [false, false]) as Pair

      if (pair[1] === args.base_denom) {
        pairs.push({
          pair,
          ...value,
        })
      }
    })

    return pairs
  },
}
