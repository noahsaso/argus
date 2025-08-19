import { Uint128 } from '@dao-dao/types/contracts/common'

import { ContractFormula } from '@/types'
import { dbKeyToKeys } from '@/utils'

import { makeSimpleContractFormula } from '../../utils'
import { NullableUint64, Vest } from './cwVesting.types'

type ValidatorStake = {
  validator: string
  timeMs: number
  // Staked + unstaking
  amount: string
}

export { ownership } from '../common'

export const info: ContractFormula<Vest> = makeSimpleContractFormula({
  docs: {
    description: 'retrieves vesting information',
  },
  transformation: 'vesting',
  fallbackKeys: ['vesting'],
})

export const vested: ContractFormula = makeSimpleContractFormula<
  Vest,
  Uint128,
  {
    /**
     * Nanosecond timestamp.
     */
    t: string
  }
>({
  docs: {
    description: 'calculates the vested amount at a given timestamp',
    args: [
      {
        name: 't',
        description:
          'nanosecond timestamp to calculate vested amount at, defaulting to the current block',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  transformation: 'vesting',
  fallbackKeys: ['vesting'],
  transform: ({ vested, start_time }, { args: { t }, block }) => {
    if (t && isNaN(Number(t))) {
      throw new Error('Invalid timestamp (NaN).')
    }

    // Convert to seconds.
    const tSeconds = t ? BigInt(t) / 1_000_000_000n : block.timeUnixMs / 1_000n
    const x = tSeconds - BigInt(start_time) / 1_000_000_000n

    if ('constant' in vested) {
      return vested.constant.y
    } else if ('saturating_linear' in vested) {
      // https://github.com/wynddao/wynddao/blob/909ee2f2b382eff06cf9f7af4102f0920da8c8a3/packages/utils/src/curve.rs#L202-L209

      const minX = BigInt(vested.saturating_linear.min_x)
      const maxX = BigInt(vested.saturating_linear.max_x)
      const minY = BigInt(vested.saturating_linear.min_y)
      const maxY = BigInt(vested.saturating_linear.max_y)

      if (x < minX || minX === maxX) {
        return minY.toString()
      } else if (x > maxX) {
        return maxY.toString()
      } else {
        return interpolate([minX, minY], [maxX, maxY], x).toString()
      }
    } else if ('piecewise_linear' in vested) {
      // https://github.com/wynddao/wynddao/blob/909ee2f2b382eff06cf9f7af4102f0920da8c8a3/packages/utils/src/curve.rs#L270-L302

      // figure out the pair of points it lies between
      const steps = vested.piecewise_linear.steps
      let [prev, next]: [[bigint, bigint] | undefined, [bigint, bigint]] = [
        undefined,
        [BigInt(steps[0][0]), BigInt(steps[0][1])],
      ]
      for (const [stepX, stepY] of steps) {
        // only break if x is not above prev
        if (x > next[0]) {
          prev = next
          next = [BigInt(stepX), BigInt(stepY)]
        } else {
          break
        }
      }
      // at this time:
      // prev may be None (this was lower than first point)
      // x may equal prev.0 (use this value)
      // x may be greater than next (if higher than last item)
      // OR x may be between prev and next (interpolate)
      if (prev) {
        if (x === prev[0]) {
          // this handles exact match with low end
          return prev[1].toString()
        } else if (x >= next[0]) {
          // this handles both higher than all and exact match
          return next[1].toString()
        } else {
          // here we do linear interpolation
          return interpolate(prev, next, x).toString()
        }
      } else {
        // lower than all, use first
        return next[1].toString()
      }
    } else {
      throw new Error('Invalid curve')
    }
  },
})

// https://github.com/wynddao/wynddao/blob/909ee2f2b382eff06cf9f7af4102f0920da8c8a3/packages/utils/src/curve.rs#L248-L255
const interpolate = (
  [minX, minY]: [bigint, bigint],
  [maxX, maxY]: [bigint, bigint],
  x: bigint
): bigint => {
  if (maxY > minY) {
    return minY + ((maxY - minY) * (x - minX)) / (maxX - minX)
  } else {
    // maxY <= minY
    return minY - ((minY - maxY) * (x - minX)) / (maxX - minX)
  }
}

export const totalToVest: ContractFormula<Uint128> = makeSimpleContractFormula<
  Vest,
  Uint128
>({
  docs: {
    description: 'calculates the total amount to be vested',
  },
  transformation: 'vesting',
  fallbackKeys: ['vesting'],
  transform: ({ vested }) => {
    if ('constant' in vested) {
      return vested.constant.y
    } else if ('saturating_linear' in vested) {
      const minY = BigInt(vested.saturating_linear.min_y)
      const maxY = BigInt(vested.saturating_linear.max_y)
      return (maxY > minY ? maxY : minY).toString()
    } else if ('piecewise_linear' in vested) {
      const maxY = vested.piecewise_linear.steps
        .map(([_, y]) => BigInt(y))
        .reduce((acc, y) => (y > acc ? y : acc), 0n)
      return maxY.toString()
    } else {
      throw new Error('Invalid curve')
    }
  },
})

export const vestDuration = makeSimpleContractFormula<Vest, NullableUint64>({
  docs: {
    description: 'calculates the duration of the vesting period',
  },
  transformation: 'vesting',
  fallbackKeys: ['vesting'],
  transform: ({ vested }) => {
    if ('constant' in vested) {
      return null
    } else if ('saturating_linear' in vested) {
      const start = BigInt(vested.saturating_linear.min_x)
      const end = BigInt(vested.saturating_linear.max_x)
      return (end - start).toString()
    } else if ('piecewise_linear' in vested) {
      const steps = vested.piecewise_linear.steps
      const start = steps[0][0]
      const end = steps[steps.length - 1][0]
      return (end - start).toString()
    } else {
      throw new Error('Invalid curve')
    }
  },
})

export const unbondingDurationSeconds: ContractFormula =
  makeSimpleContractFormula({
    docs: {
      description: 'calculates the unbonding duration in seconds',
    },
    transformation: 'ubs',
    fallbackKeys: ['ubs'],
  })

// The amount staked and unstaking for each validator over time.
export const validatorStakes: ContractFormula<ValidatorStake[]> = {
  docs: {
    description:
      'retrieves the amount staked and unstaking for each validator over time',
  },
  compute: async ({ contractAddress, getMap }) => {
    const validatorsMap =
      (await getMap(contractAddress, 'validator', {
        keyType: 'raw',
      })) ?? {}

    const validators = Object.entries(validatorsMap)
      .map(([key, amount]): ValidatorStake => {
        const [validator, epoch] = dbKeyToKeys(key, [false, true]) as [
          string,
          number
        ]

        return {
          validator,
          timeMs: epoch * 1000,
          amount,
        }
      })
      // Sort descending by time.
      .sort((a, b) => b.timeMs - a.timeMs)

    return validators
  },
}
