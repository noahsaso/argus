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
  const formulaComputer: AggregatorFormulaComputer = async ({
    type,
    formula,
    address,
    args = {},
    ...options
  }) => {
    const typedFormula = getTypedFormula(type, formula)

    const block =
      options.block ||
      (options.timeMs && (await Block.getForTime(options.timeMs))?.block) ||
      latestBlock

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

    // Determine start and end blocks
    const blockStart = (options.blocks
      ? options.blocks.start
      : options.times.start &&
        (await Block.getForTime(options.times.start))?.block) ||
      // Fallback to first block if no start is provided.
      (await Block.getFirst())?.block || { height: 0n, timeUnixMs: 0n }
    const blockEnd =
      (options.blocks
        ? options.blocks.end
        : options.times.end &&
          (await Block.getForTime(options.times.end))?.block) ||
      // Fallback to latest block if no end is provided.
      latestBlock

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
    date: new Date(),
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
