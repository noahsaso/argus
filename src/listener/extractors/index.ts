import { ExtractorMaker } from '@/types'

import { dao } from './dao'

export const extractorMakers: Record<string, ExtractorMaker<any>> = {
  dao,
}
