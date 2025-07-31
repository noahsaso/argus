import { ExtractorMaker } from '@/types'

import { contract } from './contract'
import { dao } from './dao'

export const extractorMakers: Record<string, ExtractorMaker<any>> = {
  contract,
  dao,
}
