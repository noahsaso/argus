import Router from '@koa/router'
import { DefaultContext, DefaultState } from 'koa'

import { State } from '@/db'
import { SerializedBlock } from '@/types'
import { serializeBlock } from '@/utils'
import { version } from '@/version'

type GetStatusResponse =
  | {
      version: string
      chainId: string
      latestBlock: SerializedBlock
      lastStakingBlockHeightExported: string | null
      lastWasmBlockHeightExported: string | null
      lastBankBlockHeightExported: string | null
      lastGovBlockHeightExported: string | null
      lastDistributionBlockHeightExported: string | null
    }
  | {
      error: string
    }

export const getStatus: Router.Middleware<
  DefaultState,
  DefaultContext,
  GetStatusResponse
> = async (ctx) => {
  const state = await State.getSingleton()
  if (!state) {
    ctx.status = 500
    ctx.body = {
      error: 'State not found.',
    }
    return
  }

  ctx.status = 200
  ctx.body = {
    version,
    chainId: state.chainId,
    latestBlock: serializeBlock(state.latestBlock),
    lastStakingBlockHeightExported:
      state.lastStakingBlockHeightExported?.toString() || null,
    lastWasmBlockHeightExported:
      state.lastWasmBlockHeightExported?.toString() || null,
    lastBankBlockHeightExported:
      state.lastBankBlockHeightExported?.toString() || null,
    lastGovBlockHeightExported:
      state.lastBankBlockHeightExported?.toString() || null,
    lastDistributionBlockHeightExported:
      state.lastDistributionBlockHeightExported?.toString() || null,
  }
}
