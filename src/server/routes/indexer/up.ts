import Router from '@koa/router'
import { DefaultContext, DefaultState } from 'koa'

import { ConfigManager } from '@/config'
import { State } from '@/db'
import { getStargateClient } from '@/utils'

type UpBlock = {
  height: number
  timeUnixMs: number
  timestamp: string
}

type UpResponse =
  | {
      chainId: string
      remoteBlock: UpBlock
      localBlock: UpBlock | null
      exportedBlock: UpBlock
      caughtUp: boolean
      timing: {
        state: number
        localChainBlock: number | null
        remoteChainBlock: number
      }
    }
  | {
      error: string
    }

export const up: Router.Middleware<
  DefaultState,
  DefaultContext,
  UpResponse
> = async (ctx) => {
  const config = ConfigManager.load()
  const hasLocalRpc = !!config.localRpc

  const start = Date.now()

  let state,
    stateDuration,
    localChainBlock,
    localChainBlockDuration,
    remoteChainBlock,
    remoteChainBlockDuration
  try {
    ;[
      { state, duration: stateDuration },
      { block: localChainBlock, duration: localChainBlockDuration },
      { block: remoteChainBlock, duration: remoteChainBlockDuration },
    ] = await Promise.all([
      State.getSingleton()
        .catch((err) =>
          Promise.reject(
            `Failed to get state singleton: ${
              err instanceof Error ? err.message : `${err}`
            }`
          )
        )
        .then(
          (state) =>
            (state && {
              state,
              duration: Date.now() - start,
            }) ??
            Promise.reject('State not found.')
        ),
      hasLocalRpc
        ? getStargateClient('local')
            .catch((err) =>
              Promise.reject(
                `Failed to connect to local chain via RPC: ${
                  err instanceof Error ? err.message : `${err}`
                }`
              )
            )
            .then((client) =>
              client
                .getBlock()
                .then((block) => ({
                  block,
                  duration: Date.now() - start,
                }))
                .catch((err) =>
                  Promise.reject(
                    `Failed to get local chain block: ${
                      err instanceof Error ? err.message : `${err}`
                    }`
                  )
                )
            )
        : { block: null, duration: null },
      getStargateClient('remote')
        .catch((err) =>
          Promise.reject(
            `Failed to connect to remote chain via RPC: ${
              err instanceof Error ? err.message : `${err}`
            }`
          )
        )
        .then((client) =>
          client
            .getBlock()
            .then((block) => ({
              block,
              duration: Date.now() - start,
            }))
            .catch((err) =>
              Promise.reject(
                `Failed to get remote chain block: ${
                  err instanceof Error ? err.message : `${err}`
                }`
              )
            )
        ),
    ])
  } catch (err) {
    ctx.status = 500
    ctx.body = {
      error: err instanceof Error ? err.message : `${err}`,
    }
    return
  }

  const remoteBlock: UpBlock = {
    height: remoteChainBlock.header.height,
    timeUnixMs: new Date(remoteChainBlock.header.time).getTime(),
    timestamp: new Date(remoteChainBlock.header.time).toISOString(),
  }
  const localBlock: UpBlock | null = localChainBlock && {
    height: Number(localChainBlock.header.height),
    timeUnixMs: new Date(localChainBlock.header.time).getTime(),
    timestamp: new Date(localChainBlock.header.time).toISOString(),
  }
  const exportedBlock: UpBlock = {
    height: Number(state.latestBlock.height),
    timeUnixMs: Number(state.latestBlock.timeUnixMs),
    timestamp: state.latestBlockDate.toISOString(),
  }

  // If local chain is within 5 blocks of actual chain, consider it caught up.
  // If no local RPC, use the exported block instead.
  const caughtUp =
    (localBlock?.height ?? exportedBlock.height) > remoteBlock.height - 5

  ctx.status = caughtUp ? 200 : 412
  ctx.body = {
    chainId: state.chainId,
    remoteBlock,
    localBlock,
    exportedBlock,
    caughtUp,
    timing: {
      state: stateDuration,
      localChainBlock: localChainBlockDuration,
      remoteChainBlock: remoteChainBlockDuration,
    },
  }
}
