import Router from '@koa/router'
import { DefaultContext, DefaultState } from 'koa'

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
      chainBlock: UpBlock
      nodeBlock: UpBlock
      exportedBlock: UpBlock
      caughtUp: boolean
      timing: {
        state: number
        localChainBlock: number
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
      getStargateClient('local')
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
        ),
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

  const chainBlock: UpBlock = {
    height: remoteChainBlock.header.height,
    timeUnixMs: new Date(remoteChainBlock.header.time).getTime(),
    timestamp: new Date(remoteChainBlock.header.time).toISOString(),
  }
  const nodeBlock: UpBlock = {
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
  const caughtUp = nodeBlock.height > chainBlock.height - 5

  ctx.status = caughtUp ? 200 : 412
  ctx.body = {
    chainId: state.chainId,
    chainBlock,
    nodeBlock,
    exportedBlock,
    caughtUp,
    timing: {
      state: stateDuration,
      localChainBlock: localChainBlockDuration,
      remoteChainBlock: remoteChainBlockDuration,
    },
  }
}
