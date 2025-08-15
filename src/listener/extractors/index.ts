import { ExtractorMaker, ExtractorMakerOptions, NamedExtractor } from '@/types'

import { contract } from './contract'
import { dao } from './dao'
import { nftStakeUpdate } from './nftStakeUpdate'

export const extractorMakers: Record<string, ExtractorMaker<any>> = {
  contract,
  dao,
  nftStakeUpdate,
}

export const makeExtractors = async (
  options: ExtractorMakerOptions
): Promise<NamedExtractor[]> =>
  Promise.all(
    Object.entries(extractorMakers).map(async ([name, extractorMaker]) => ({
      name,
      extractor: await extractorMaker(options),
    }))
  )
