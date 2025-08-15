import { ExtractorMaker } from '@/types'

import { contract } from './contract'
import { dao } from './dao'
import { nftStakeUpdate } from './nftStakeUpdate'

export const extractorMakers: Record<string, ExtractorMaker<any>> = {
  contract,
  dao,
  nftStakeUpdate,
}
