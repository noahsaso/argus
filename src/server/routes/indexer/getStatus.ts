import Router from '@koa/router'
import { DefaultContext, DefaultState } from 'koa'

import { ConfigManager } from '@/config'
import { State } from '@/db'
import { SerializedBlock } from '@/types'
import { getStargateClient, serializeBlock } from '@/utils'
import { version } from '@/version'

type LocalRpcStatus = {
  // Whether a local RPC is configured for the indexer to trace.
  configured: boolean
  // Whether the configured local RPC responded. Null when no local RPC is
  // configured, since there is nothing to probe.
  healthy: boolean | null
  // Error message from the failed probe, if any.
  error: string | null
  // Latest block from the local chain node, if reachable.
  block: SerializedBlock | null
}

type PipelineLag = {
  // How many blocks the given pipeline trails the latest block. Null when the
  // pipeline's exported height is unknown.
  //
  // `latestBlock` is advanced by the remote-connected websocket listener
  // (src/scripts/listener.ts) as well as the tracer's and workers' export
  // pipelines, all via GREATEST, so it can sit at the chain tip while the
  // trace pipelines are stalled. These lags make that divergence visible.
  trace: number | null
  wasm: number | null
  bank: number | null
  gov: number | null
  distribution: number | null
  feegrant: number | null
}

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
      lastFeegrantBlockHeightExported: string | null
      // The furthest-behind trace pipeline's exported height: every trace
      // pipeline (wasm, bank, gov, distribution, feegrant) has fully exported
      // at or below this height. Null when no trace pipeline has exported.
      //
      // Staking is excluded because its exported height is legacy and no
      // longer advanced by the indexer.
      lastTraceExportedBlockHeight: string | null
      // Health of the configured local RPC, which the trace pipelines depend
      // on.
      localRpc: LocalRpcStatus
      pipelineLag: PipelineLag
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

  // Probe the configured local RPC. The trace pipelines consume traced events
  // from the local chain node, so an unreachable local node is the primary
  // signal of an indexing outage. Surface its health directly instead of
  // requiring SSH access to diagnose. A failed probe never fails the request.
  let localRpc: LocalRpcStatus = {
    configured: false,
    healthy: null,
    error: null,
    block: null,
  }
  if (ConfigManager.load().localRpc) {
    try {
      const client = await getStargateClient('local')
      const block = await client.getBlock()
      localRpc = {
        configured: true,
        healthy: true,
        error: null,
        block: serializeBlock({
          height: BigInt(block.header.height),
          timeUnixMs: BigInt(new Date(block.header.time).getTime()),
        }),
      }
    } catch (err) {
      localRpc = {
        configured: true,
        healthy: false,
        error: err instanceof Error ? err.message : `${err}`,
        block: null,
      }
    }
  }

  // Per-pipeline exported heads. Each is advanced only by the tracer's
  // corresponding trace-store handler (src/tracer/handlers) as traced events
  // are processed, so they track the trace pipelines' true positions. Staking
  // is legacy and no longer advanced, so it is reported for backwards
  // compatibility but excluded from the trace watermark and lag.
  const pipelineExportedHeights: Record<
    Exclude<keyof PipelineLag, 'trace'>,
    string | null
  > = {
    wasm: state.lastWasmBlockHeightExported,
    bank: state.lastBankBlockHeightExported,
    gov: state.lastGovBlockHeightExported,
    distribution: state.lastDistributionBlockHeightExported,
    feegrant: state.lastFeegrantBlockHeightExported,
  }
  const tracePipelineHeights = Object.values(pipelineExportedHeights).filter(
    (height): height is string => height !== null
  )
  const lastTraceExportedBlockHeight =
    tracePipelineHeights.length > 0
      ? tracePipelineHeights
          .reduce((lowest, height) =>
            BigInt(height) < BigInt(lowest) ? height : lowest
          )
          .toString()
      : null

  // Lag of each pipeline behind the latest block.
  const lag = (height: string | null): number | null =>
    height === null
      ? null
      : Number(BigInt(state.latestBlockHeight) - BigInt(height))
  const pipelineLag: PipelineLag = {
    trace: lag(lastTraceExportedBlockHeight),
    wasm: lag(pipelineExportedHeights.wasm),
    bank: lag(pipelineExportedHeights.bank),
    gov: lag(pipelineExportedHeights.gov),
    distribution: lag(pipelineExportedHeights.distribution),
    feegrant: lag(pipelineExportedHeights.feegrant),
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
      state.lastGovBlockHeightExported?.toString() || null,
    lastDistributionBlockHeightExported:
      state.lastDistributionBlockHeightExported?.toString() || null,
    lastFeegrantBlockHeightExported:
      state.lastFeegrantBlockHeightExported?.toString() || null,
    lastTraceExportedBlockHeight,
    localRpc,
    pipelineLag,
  }
}
