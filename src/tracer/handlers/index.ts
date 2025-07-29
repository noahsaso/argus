import { HandlerMaker } from '@/types'

import { bank } from './bank'
// import { distribution } from './distribution'
import { feegrant } from './feegrant'
import { gov } from './gov'
import { wasm } from './wasm'

export const handlerMakers: Record<string, HandlerMaker<any>> = {
  bank,
  // distribution,
  feegrant,
  gov,
  wasm,
}
