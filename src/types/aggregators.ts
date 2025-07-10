import { OpenAPIV3_1 } from 'openapi-types'

import { FormulaType } from './formulas'
import { Block, NestedMap } from './misc'

/**
 * Function that computes a formula at a specific block/time
 */
export type AggregatorFormulaComputer = <T = any>(
  options: {
    type: FormulaType
    formula: string
    address: string
    args?: Record<string, any>
  } & (
    | {
        block?: Block
        timeMs?: never
      }
    | {
        block?: never
        timeMs: string | number | bigint
      }
  )
) => Promise<T>

/**
 * Function that computes a formula over a range of blocks/times
 */
export type AggregatorFormulaRangeComputer = <T = any>(
  options: {
    type: FormulaType
    formula: string
    address: string
    args?: Record<string, any>
  } & (
    | {
        blocks: {
          start?: Block
          end?: Block
        } & (
          | {
              blockStep?: string | number | bigint
              timeStep?: never
            }
          | {
              blockStep?: never
              timeStep?: string | number | bigint
            }
        )
        times?: never
      }
    | {
        blocks?: never
        times: {
          start?: string | number | bigint
          end?: string | number | bigint
          step?: string | number | bigint
        }
      }
  )
) => Promise<
  {
    at?: string
    value: T
    blockHeight: number
    blockTimeUnixMs: number
  }[]
>

/**
 * Base aggregator environment available to all aggregator types
 */
export type AggregatorEnv<Args extends Record<string, string> = {}> = {
  chainId: string
  block: Block
  /**
   * Current date
   */
  date: Date
  /**
   * Arguments may or may not be present, so force aggregator to handle undefined.
   */
  args: Partial<Args>

  /**
   * Compute a formula at a specific block/time
   */
  compute: AggregatorFormulaComputer

  /**
   * Compute a formula over a range of blocks/times
   */
  computeRange: AggregatorFormulaRangeComputer
}

export type AggregatorEnvOptions = {
  chainId: string
  block: Block
  args?: Record<string, any>
}

/**
 * Aggregators compute aggregated values over multiple points in time or ranges.
 */
export type Aggregator<R = any, Args extends Record<string, string> = {}> = {
  compute: (env: AggregatorEnv<Args>) => Promise<R>
  /**
   * Docs for the aggregator.
   */
  docs: {
    /**
     * Aggregator description.
     */
    description: string
    /**
     * Argument definitions.
     */
    args?: Omit<OpenAPIV3_1.ParameterObject, 'in'>[]
  }
}

export type AggregatorComputeOptions<T> = {
  chainId: string
  block: Block
  aggregator: Aggregator<T>
  args: Record<string, any>
}

export type AggregatorComputeResult<R = any> = {
  value: R
}

export type NestedAggregatorMap = NestedMap<Aggregator>
