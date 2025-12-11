import { ExtractorEnv } from '@/types'

import { AssetExtractor } from './asset'
import { ContractExtractor } from './contract'
import { DaoExtractor } from './dao'
import { DaoRbamExtractor } from './daoRbam'
import { MarketplaceExtractor } from './marketplace'
import { NftStakeUpdateExtractor } from './nftStakeUpdate'
import { ProposalExtractor } from './proposal'

export const getExtractors = () => [
  ContractExtractor,
  DaoExtractor,
  DaoRbamExtractor,
  ProposalExtractor,
  NftStakeUpdateExtractor,
  AssetExtractor,
  MarketplaceExtractor,
  // Add more extractors here.
]

export const makeExtractors = (env: ExtractorEnv) =>
  getExtractors().map((Extractor) => new Extractor(env))

export const getExtractorMap = () =>
  Object.fromEntries(
    getExtractors().map((Extractor) => [Extractor.type, Extractor])
  )
