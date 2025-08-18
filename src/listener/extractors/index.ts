import { ExtractorEnv } from '@/types'

import { ContractExtractor } from './contract'
import { DaoExtractor } from './dao'
import { NftStakeUpdateExtractor } from './nftStakeUpdate'

export const getExtractors = (env: ExtractorEnv) =>
  [DaoExtractor, ContractExtractor, NftStakeUpdateExtractor].map(
    (Extractor) => new Extractor(env)
  )
