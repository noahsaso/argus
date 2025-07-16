import { Block } from '@/db'
import {
  compute,
  computeRange,
  getTypedFormula,
  processComputationRange,
} from '@/formulas'
import {
  AggregatorEnv,
  AggregatorEnvOptions,
  AggregatorFormulaComputer,
  AggregatorFormulaRangeComputer,
} from '@/types'

/**
 * Create the base aggregator environment
 */
export const createAggregatorEnv = ({
  chainId,
  block: latestBlock,
  args = {},
}: AggregatorEnvOptions): AggregatorEnv => {
  const date = new Date()
  const currentTime = date.getTime()

  const formulaComputer: AggregatorFormulaComputer = async ({
    type,
    formula,
    address,
    args = {},
    ...options
  }) => {
    const typedFormula = getTypedFormula(type, formula)

    let block = options.block
    if (options.timeMs) {
      let time = BigInt(options.timeMs)
      // If time is negative, subtract from current time.
      if (time < 0) {
        time += BigInt(currentTime)
      }

      block = (await Block.getForTime(time))?.block
    }
    if (!block) {
      block = latestBlock
    }

    const result = await compute({
      ...typedFormula,
      chainId,
      targetAddress: address,
      args,
      block,
    })

    return result.value
  }

  // Create formula range computer function
  const formulaRangeComputer: AggregatorFormulaRangeComputer = async ({
    type,
    formula,
    address,
    args = {},
    ...options
  }) => {
    const typedFormula = getTypedFormula(type, formula)

    // Determine start and end blocks.

    let blockStart = options.blocks?.start
    if (!blockStart && options.times?.start) {
      let time = BigInt(options.times.start)
      // If time is negative, subtract from current time.
      if (time < 0) {
        time += BigInt(currentTime)
      }
      blockStart = (await Block.getForTime(time))?.block
    }
    // Fallback to first block if no start is provided.
    if (!blockStart) {
      blockStart = (await Block.getFirst())?.block || {
        height: 0n,
        timeUnixMs: 0n,
      }
    }

    let blockEnd = options.blocks?.end
    if (!blockEnd && options.times?.end) {
      let time = BigInt(options.times.end)
      // If time is negative, subtract from current time.
      if (time < 0) {
        time += BigInt(currentTime)
      }
      blockEnd = (await Block.getForTime(time))?.block
    }
    // Fallback to latest block if no end is provided.
    if (!blockEnd) {
      blockEnd = latestBlock
    }

    const blockStep =
      (options.blocks?.blockStep && BigInt(options.blocks.blockStep)) ||
      undefined
    if (blockStep && blockStep < 0) {
      throw new Error('Block step cannot be negative')
    }

    const timeStep =
      (options.blocks?.timeStep && BigInt(options.blocks.timeStep)) ||
      (options.times?.step && BigInt(options.times.step)) ||
      undefined
    if (timeStep && timeStep < 0) {
      throw new Error('Time step cannot be negative')
    }

    // Compute the formula over the range
    const results = await computeRange({
      ...typedFormula,
      chainId,
      targetAddress: address,
      args,
      blockStart,
      blockEnd,
      blockStep,
      timeStep,
    })

    // Transform results to the expected format
    return processComputationRange({
      outputs: results,
      blocks: [blockStart, blockEnd],
      blockStep,
      timeStep,
    })
  }

  return {
    chainId,
    block: latestBlock,
    date,
    args,
    compute: formulaComputer,
    computeRange: formulaRangeComputer,
  }
}

/**
 * Create an account aggregator environment
 */
export const createAccountAggregatorEnv = (
  options: AggregatorEnvOptions & { address: string }
) => {
  const baseEnv = createAggregatorEnv(options)
  return {
    ...baseEnv,
    address: options.address,
  }
}

/**
 * Create a contract aggregator environment
 */
export const createContractAggregatorEnv = (
  options: AggregatorEnvOptions & { contractAddress: string }
) => {
  const baseEnv = createAggregatorEnv(options)
  return {
    ...baseEnv,
    contractAddress: options.contractAddress,
  }
}

/**
 * Create a validator aggregator environment
 */
export const createValidatorAggregatorEnv = (
  options: AggregatorEnvOptions & { validatorOperatorAddress: string }
) => {
  const baseEnv = createAggregatorEnv(options)
  return {
    ...baseEnv,
    validatorOperatorAddress: options.validatorOperatorAddress,
  }
}
