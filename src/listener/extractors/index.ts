import { ExtractorMaker } from '@/types'

import { contract } from './contract'
import { dao } from './dao'
import { daoRbam } from './daoRbam'

export const extractorMakers: Record<string, ExtractorMaker<any>> = {
  contract,
  dao,
  daoRbam,
}
