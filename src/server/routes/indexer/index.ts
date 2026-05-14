import Router from '@koa/router'

import { loadAggregator } from './aggregator'
import { loadComputer } from './computer'
import { getContractState } from './contractState'
import { getStatus } from './getStatus'
import { up } from './up'

export const setUpIndexerRouter = async (root: Router) => {
  const indexerRouter = new Router()

  // Status.
  indexerRouter.get('/status', getStatus)

  // Check if indexer is caught up.
  indexerRouter.get('/up', up)

  // Aggregator routes (with "a" prefix to distinguish from formulas).
  const aggregator = await loadAggregator()
  indexerRouter.get('/a/(.+)', aggregator)

  // Recover live CosmWasm contract storage through the events pipeline.
  indexerRouter.post('/contract/:address/state/recover', getContractState)

  // Formula computer. This must be the last route since it's a catch-all.
  const computer = await loadComputer()
  indexerRouter.get('/(.+)', computer)

  root.use(indexerRouter.routes(), indexerRouter.allowedMethods())
}
