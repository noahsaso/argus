import Router from '@koa/router'

import { loadAggregator } from './aggregator'
import { loadComputer } from './computer'
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

  // Formula computer. This must be the last route since it's a catch-all.
  const computer = await loadComputer()
  indexerRouter.get('/(.+)', computer)

  root.use(indexerRouter.routes(), indexerRouter.allowedMethods())
}
