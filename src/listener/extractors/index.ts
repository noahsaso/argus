import { ExtractorEnv } from '@/types'

import { ContractExtractor } from './contract'
import { DaoExtractor } from './dao'
import { DaoRbamExtractor } from './daoRbam'
import { NftStakeUpdateExtractor } from './nftStakeUpdate'
import { ProposalExtractor } from './proposal'
import * as xionExtractors from './xion'

export const getExtractors = () => [
  ContractExtractor,
  DaoExtractor,
  DaoRbamExtractor,
  ProposalExtractor,
  NftStakeUpdateExtractor,
  ...Object.values(xionExtractors),
  // Add more extractors here.
]

export const makeExtractors = (env: ExtractorEnv) =>
  getExtractors().map((Extractor) => new Extractor(env))

export const getExtractorMap = () =>
  Object.fromEntries(
    getExtractors().map((Extractor) => [Extractor.type, Extractor])
  )
