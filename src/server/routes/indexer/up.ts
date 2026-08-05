import Router from '@koa/router'
import { DefaultContext, DefaultState } from 'koa'

import { ConfigManager } from '@/config'
import { State } from '@/db'
import { getStargateClient } from '@/utils'
import { version } from '@/version'

type UpBlock = {
  height: number
  timeUnixMs: number
  timestamp: string
}

type IndexerHeights = {
  remoteHeight: number
  exportedHeight: number
  localHeight?: number
}

export const isIndexerCaughtUp = ({
  remoteHeight,
  exportedHeight,
}: IndexerHeights) => exportedHeight > remoteHeight - 5

type UpResponse =
  | {
      version: string
      chainId: string
      remoteBlock: UpBlock
      localBlock: UpBlock | { error: string } | null
      exportedBlock: UpBlock
      caughtUp: boolean
      timing: {
        state: number
        localChainBlock: number | null
        remoteChainBlock: number
      }
    }
  | {
      version: string
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
    localResponse,
    remoteChainBlock,
    remoteChainBlockDuration
  try {
    ;[
      { state, duration: stateDuration },
      localResponse,
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
            .catch((err) => ({
              error: err instanceof Error ? err.message : `${err}`,
            }))
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
      version,
      error: err instanceof Error ? err.message : `${err}`,
    }
    return
  }

  const remoteBlock: UpBlock = {
    height: remoteChainBlock.header.height,
    timeUnixMs: new Date(remoteChainBlock.header.time).getTime(),
    timestamp: new Date(remoteChainBlock.header.time).toISOString(),
  }
  const localBlock: UpBlock | { error: string } | null =
    'block' in localResponse
      ? localResponse?.block
        ? {
            height: Number(localResponse.block.header.height),
            timeUnixMs: new Date(localResponse.block.header.time).getTime(),
            timestamp: new Date(localResponse.block.header.time).toISOString(),
          }
        : null
      : localResponse
  const exportedBlock: UpBlock = {
    height: Number(state.latestBlock.height),
    timeUnixMs: Number(state.latestBlock.timeUnixMs),
    timestamp: state.latestBlockDate.toISOString(),
  }

  // A healthy local RPC does not prove that the exporter consumed its traces.
  const caughtUp = isIndexerCaughtUp({
    remoteHeight: remoteBlock.height,
    exportedHeight: exportedBlock.height,
  })

  ctx.status = caughtUp ? 200 : 412
  ctx.body = {
    version,
    chainId: state.chainId,
    remoteBlock,
    localBlock,
    exportedBlock,
    caughtUp,
    timing: {
      state: stateDuration,
      localChainBlock:
        localResponse && 'duration' in localResponse
          ? localResponse.duration
          : null,
      remoteChainBlock: remoteChainBlockDuration,
    },
  }
}
