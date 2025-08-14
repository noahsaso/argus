import { ContractFormula } from '@/types'

import { AuctionConfig, AuctionConfigResponse, AuctionStrategy } from './types'

export const config: ContractFormula<AuctionConfigResponse | undefined> = {
  docs: {
    description:
      'retrieves the auction configuration and price strategy from the contract',
  },
  compute: async ({ contractAddress, get }) => {
    const config = (await get<AuctionConfig>(contractAddress, 'auction_config'))
      ?.valueJson
    const priceStrategy = (
      await get<AuctionStrategy>(contractAddress, 'auction_strategy')
    )?.valueJson

    if (config && priceStrategy) {
      return {
        ...config,
        price_strategy: priceStrategy,
      }
    } else {
      return undefined
    }
  },
}
