import { ExtractorEnv } from '@/types'

import { ContractExtractor } from './contract'
import { DaoExtractor } from './dao'
import { DaoRbamExtractor } from './daoRbam'
import { NftStakeUpdateExtractor } from './nftStakeUpdate'
import { ProposalExtractor } from './proposal'

export const getExtractors = () => [
  ContractExtractor,
  DaoExtractor,
  ProposalExtractor,
  NftStakeUpdateExtractor,
  DaoRbamExtractor,
  // Add more extractors here.
]

export const makeExtractors = (env: ExtractorEnv) =>
  getExtractors().map((Extractor) => new Extractor(env))

export const getExtractorMap = () =>
  Object.fromEntries(
    getExtractors().map((Extractor) => [Extractor.type, Extractor])
  )
