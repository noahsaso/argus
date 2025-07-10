import { Aggregator, FormulaType } from '@/types'

/**
 * Example: Aggregate account balance over time
 */
export const overTime: Aggregator<
  {
    sum: string
    average: string
    min: string
    max: string
    count: number
    values: { value: string; blockHeight: string; blockTimeUnixMs: string }[]
  },
  {
    address: string
    denom: string
    startTime?: string
    endTime?: string
    timeStep?: string
  }
> = {
  compute: async (env) => {
    const { address, denom, startTime, endTime, timeStep } = env.args

    if (!address) {
      throw new Error('address argument is required')
    }

    if (!denom) {
      throw new Error('denom argument is required')
    }

    // Parse time parameters
    const timeStepBigInt = timeStep ? BigInt(timeStep) : undefined
    const startTimeBigInt = startTime ? BigInt(startTime) : undefined
    const endTimeBigInt = endTime ? BigInt(endTime) : undefined

    // Get balance over time range
    const results = await env.computeRange({
      type: FormulaType.Account,
      formula: 'bank/balance',
      address,
      args: { denom },
      times: {
        start: startTimeBigInt,
        end: endTimeBigInt,
        step: timeStepBigInt,
      },
    })

    // Extract balance values
    const values = results.map((r) => ({
      value: r.value || '0',
      blockHeight: r.blockHeight.toString(),
      blockTimeUnixMs: r.blockTimeUnixMs.toString(),
    }))

    const balanceValues = values.map((v) => v.value)

    return {
      sum: balanceValues
        .reduce((acc, v) => acc + BigInt(v), BigInt(0))
        .toString(),
      average: (
        balanceValues.reduce((acc, v) => acc + BigInt(v), BigInt(0)) /
        BigInt(balanceValues.length || 1)
      ).toString(),
      min: balanceValues
        .reduce((acc, v) => (acc < BigInt(v) ? acc : BigInt(v)), BigInt(0))
        .toString(),
      max: balanceValues
        .reduce((acc, v) => (acc > BigInt(v) ? acc : BigInt(v)), BigInt(0))
        .toString(),
      count: balanceValues.length,
      values,
    }
  },
  docs: {
    description: 'Aggregate account balance over a time range',
    args: [
      {
        name: 'address',
        description: 'Account address to aggregate',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'denom',
        description: 'Token denomination to aggregate',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'startTime',
        description: 'Start time in Unix milliseconds',
        required: false,
        schema: { type: 'string' },
      },
      {
        name: 'endTime',
        description: 'End time in Unix milliseconds',
        required: false,
        schema: { type: 'string' },
      },
      {
        name: 'timeStep',
        description: 'Time step in milliseconds between data points',
        required: false,
        schema: { type: 'string' },
      },
    ],
  },
}
