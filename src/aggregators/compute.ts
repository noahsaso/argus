import { AggregatorComputeOptions, AggregatorComputeResult } from '@/types'

import { createAggregatorEnv } from './env'

/**
 * Compute an aggregator with the given options.
 */
export const computeAggregator = async <T>({
  chainId,
  block,
  aggregator,
  args,
}: AggregatorComputeOptions<T>): Promise<AggregatorComputeResult<T>> => {
  const env = createAggregatorEnv({
    chainId,
    block,
    args,
  })

  const value = await aggregator.compute(env)

  return {
    value,
  }
}
