import {
  AccountFormula,
  Block,
  ComputationOutput,
  ContractFormula,
  FormulaType,
  FormulaTypeValues,
  GenericFormula,
  NestedFormulaMap,
  TypedFormula,
  ValidatorFormula,
} from '@/types'

import {
  accountFormulas,
  contractFormulas,
  genericFormulas,
  validatorFormulas,
} from './formulas'

const makeGetFormula =
  <T extends unknown>(formulas: NestedFormulaMap<T> | T | undefined) =>
  (formulaName: string): T | undefined => {
    const formulaPath = formulaName.split('/')
    const formulaBase = formulaPath
      .slice(0, -1)
      .reduce(
        (acc, key) =>
          acc && typeof acc === 'object' && key in acc
            ? (acc as NestedFormulaMap<T>)[key]
            : undefined,
        formulas
      )

    const formula =
      typeof formulaBase === 'object'
        ? (formulaBase as NestedFormulaMap<ContractFormula<any, any>>)[
            formulaPath[formulaPath.length - 1]
          ]
        : undefined

    return formula &&
      'compute' in formula &&
      typeof formula.compute === 'function'
      ? (formula as T)
      : undefined
  }

const getAccountFormula = makeGetFormula<AccountFormula>(accountFormulas)
const getContractFormula = makeGetFormula<ContractFormula>(contractFormulas)
const getGenericFormula = makeGetFormula<GenericFormula>(genericFormulas)
const getValidatorFormula = makeGetFormula<ValidatorFormula>(validatorFormulas)

export const getTypedFormula = (
  type: FormulaType,
  formulaName: string
): TypedFormula => {
  const typeAndFormula =
    type === FormulaType.Account
      ? {
          type,
          formula: getAccountFormula(formulaName),
        }
      : type === FormulaType.Contract
      ? {
          type,
          formula: getContractFormula(formulaName),
        }
      : type === FormulaType.Generic
      ? {
          type,
          formula: getGenericFormula(formulaName),
        }
      : type === FormulaType.Validator
      ? {
          type,
          formula: getValidatorFormula(formulaName),
        }
      : undefined

  if (!typeAndFormula?.formula) {
    throw new Error(`Formula not found: ${formulaName}`)
  }

  return {
    name: formulaName,
    ...typeAndFormula,
  } as TypedFormula
}

export const typeIsFormulaTypeOrWallet = (
  type: string
): type is FormulaType | 'wallet' =>
  FormulaTypeValues.includes(type as FormulaType) ||
  // Backwards compatibility for deprecated wallet type.
  type === 'wallet'

// Process computation range output with step.
export const processComputationRange = ({
  outputs,
  blockStep,
  timeStep,
  blocks,
  times,
}: {
  outputs: Pick<ComputationOutput, 'value' | 'block'>[]
  blockStep?: bigint
  timeStep?: bigint
  blocks: [Block, Block]
  times?: [bigint, bigint | undefined]
}): {
  at?: string
  value: any
  blockHeight: number
  blockTimeUnixMs: number
}[] => {
  let processed: {
    at?: string
    value: any
    blockHeight: number
    blockTimeUnixMs: number
  }[] = []
  // Skip to match step.
  if (
    (blockStep === undefined || blockStep === 1n) &&
    (timeStep === undefined || timeStep === 1n)
  ) {
    processed = outputs.map(({ value, block }) => ({
      value,
      // If no block, the computation must not have accessed any keys. It may be
      // a constant formula, in which case it doesn't have any block context.
      blockHeight: Number(block?.height ?? -1),
      blockTimeUnixMs: Number(block?.timeUnixMs ?? -1),
    }))
  } else if (blockStep) {
    for (
      let blockHeight = blocks[0].height;
      blockHeight <= blocks[1].height;
      blockHeight =
        // Prevent infinite loop.
        blockHeight === blocks[1].height
          ? blockHeight + 1n
          : // Make sure to include the last block.
          blockHeight + blockStep > blocks[1].height
          ? blocks[1].height
          : // Increment normally.
            blockHeight + blockStep
    ) {
      // Sorted ascending by block, so find first computation with block
      // height greater than desired block height and use the previous to
      // get the latest value at the target block height. If not found,
      // use the last one.
      let index = outputs.findIndex(
        (c) => (c.block?.height ?? -1) > blockHeight
      )
      if (index === -1) {
        index = outputs.length
      }
      if (index > 0) {
        const output = outputs[index - 1]
        processed.push({
          at: blockHeight.toString(),
          value: output.value,
          // If no block, the computation must not have accessed any keys. It
          // may be a constant formula, in which case it doesn't have any block
          // context.
          blockHeight: Number(output.block?.height ?? -1),
          blockTimeUnixMs: Number(output.block?.timeUnixMs ?? -1),
        })
        // Remove all computations before the one we just added, keeping
        // the current one in case nothing has changed in the next step.
        outputs.splice(0, index - 1)
      }
    }
  } else if (times && timeStep) {
    const endTimeUnixMs = times[1] ?? blocks[1].timeUnixMs
    for (
      let blockTime = times[0];
      blockTime <= endTimeUnixMs;
      blockTime =
        // Prevent infinite loop.
        blockTime === endTimeUnixMs
          ? blockTime + 1n
          : // Make sure to include the last block.
          blockTime + timeStep > endTimeUnixMs
          ? endTimeUnixMs
          : // Increment normally.
            blockTime + timeStep
    ) {
      // Sorted ascending by block, so find first computation with block
      // time greater than desired block time and use the previous to get
      // the latest value at the target block time. If not found, use the
      // last one.
      let index = outputs.findIndex(
        (c) => (c.block?.timeUnixMs ?? -1) > blockTime
      )
      if (index === -1) {
        index = outputs.length
      }
      if (index > 0) {
        const output = outputs[index - 1]
        processed.push({
          at: blockTime.toString(),
          value: output.value,
          // If no block, the computation must not have accessed any keys. It
          // may be a constant formula, in which case it doesn't have any block
          // context.
          blockHeight: Number(output.block?.height ?? -1),
          blockTimeUnixMs: Number(output.block?.timeUnixMs ?? -1),
        })
        // Remove all computations before the one we just added, keeping
        // the current one in case nothing has changed in the next step.
        outputs.splice(0, index - 1)
      }
    }
  }

  return processed
}
