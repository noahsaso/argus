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

type UpResponse =
  | {
      version: string
      chainId: string
      remoteBlock: UpBlock
      localBlock: UpBlock | { error: string } | null
      exportedBlock: UpBlock
      caughtUp: boolean
      // Whether a local RPC is configured for the indexer to trace.
      localRpcConfigured: boolean
      // True when a configured component (currently just the local RPC) is
      // unreachable or erroring, in which case `caughtUp` cannot be trusted.
      degraded: boolean
      // Human-readable reasons for the degraded state, empty when healthy.
      degradationReasons: string[]
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

  const localRpcConfigured = hasLocalRpc

  // The configured local RPC is the node the indexer traces, and its trace
  // pipelines cannot progress while it is down. The exported block is not a
  // safe fallback in that case: the remote-connected websocket listener keeps
  // advancing it to the remote chain tip even while the local node is down,
  // which previously made this endpoint report healthy during a local node
  // outage. Flag the indexer as degraded and never caught up instead.
  const degradationReasons: string[] = []
  if (localRpcConfigured && localBlock && 'error' in localBlock) {
    degradationReasons.push(
      `Local RPC (${config.localRpc}) unreachable or erroring: ${localBlock.error}`
    )
  }
  const degraded = degradationReasons.length > 0

  // If local chain is within 5 blocks of actual chain, consider it caught up.
  // If no local RPC is configured, use the exported block instead (legacy
  // behavior for deployments without a local node). If the local RPC is
  // configured but degraded, never consider the indexer caught up.
  const caughtUp =
    !degraded &&
    (localBlock && 'height' in localBlock
      ? localBlock.height
      : exportedBlock.height) >
      remoteBlock.height - 5

  ctx.status = caughtUp ? 200 : 412
  ctx.body = {
    version,
    chainId: state.chainId,
    remoteBlock,
    localBlock,
    exportedBlock,
    caughtUp,
    localRpcConfigured,
    degraded,
    degradationReasons,
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
