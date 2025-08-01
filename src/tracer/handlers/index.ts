import { HandlerMaker, HandlerMakerOptions, NamedHandler } from '@/types'

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

export const makeHandlers = async (options: HandlerMakerOptions) =>
  (
    await Promise.allSettled(
      Object.entries(handlerMakers).map(
        async ([name, handlerMaker]): Promise<NamedHandler> => ({
          name,
          handler: await handlerMaker(options),
        })
      )
    )
  )
    // Handlers throw errors if they cannot be initialized on the current chain.
    // On error, just ignore them.
    .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
