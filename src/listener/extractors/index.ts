import { ExtractorEnv } from '@/types'

import { ContractExtractor } from './contract'
import { DaoExtractor } from './dao'

export const getExtractors = (env: ExtractorEnv) =>
  [DaoExtractor, ContractExtractor].map((Extractor) => new Extractor(env))

// export const extractorMakers: Record<string, ExtractorMaker<any>> = {
//   nftStakeUpdate,
// }

// export const makeExtractors = async (
//   env: ExtractorEnv
// ): Promise<NamedExtractor[]> =>
//   Promise.all(
//     Object.entries(extractorMakers).map(async ([name, extractorMaker]) => ({
//       name,
//       extractor: await extractorMaker(env),
//     }))
//   )
