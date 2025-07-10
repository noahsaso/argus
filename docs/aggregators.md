# Aggregators

An aggregator processes data over multiple points in time or ranges and returns aggregated results. Unlike formulas which operate on the "current" state at a single block, aggregators are designed to work across time periods, allowing for time-series analysis, trend detection, and more.

Aggregators are built on top of the formula system and can call any formula multiple times across different blocks or time ranges to generate their results.

Aggregators are defined in the `src/aggregators/aggregators` directory.

## Aggregator Structure

An aggregator is an object that contains metadata and a compute function. The function processes data across time periods and is called with an environment that provides access to formula computation capabilities.

```ts
type Aggregator<R = any, Args extends Record<string, string> = {}> = {
  compute: (env: AggregatorEnv<Args>) => Promise<R>
  docs: {
    description: string
    args?: Omit<OpenAPIV3_1.ParameterObject, 'in'>[]
  }
}
```

The environment passed to the aggregator function has the following structure:

```ts
type AggregatorEnv<Args extends Record<string, string> = {}> = {
  chainId: string
  block: Block
  date: Date
  args: Partial<Args>

  // Compute a formula at a specific block/time
  compute: AggregatorFormulaComputer

  // Compute a formula over a range of blocks/times
  computeRange: AggregatorFormulaRangeComputer
}
```

## How to write an aggregator

To add a new aggregator, create a file in the `src/aggregators/aggregators` directory and export it from the `index.ts` file in that directory. The aggregator name is determined by the export path. For example, an aggregator exported as `balance.overTime` would be accessible via the name `balance/overTime`.

### Environment Functions

The aggregator environment provides two main functions for interacting with formulas:

#### `compute`

Computes a formula at a specific block or time:

```ts
const result = await env.compute({
  type: FormulaType.Account,
  formula: 'balance',
  address: 'cosmos1...',
  args: { denom: 'uatom' },
  // Optional: specify a specific block
  block: { height: 1000n, timeUnixMs: 1234567890n },
  // OR specify a time in milliseconds
  timeMs: 1234567890,
})
```

#### `computeRange`

Computes a formula over a range of blocks or times:

```ts
const results = await env.computeRange({
  type: FormulaType.Contract,
  formula: 'totalSupply',
  address: 'cosmos1...',
  args: {},
  // Option 1: Block range
  blocks: {
    start: { height: 1000n, timeUnixMs: 1234567890n },
    end: { height: 2000n, timeUnixMs: 1234567999n },
    blockStep: 100n, // Optional: step by blocks
    timeStep: 3600000n, // Optional: step by time (mutually exclusive with blockStep)
  },
  // Option 2: Time range
  times: {
    start: 1234567890,
    end: 1234567999,
    step: 3600000, // Step in milliseconds
  },
})
```

The `computeRange` function returns an array of results with metadata:

```ts
{
  at?: string // The block height or time requested (if using steps)
  value: T // The formula result
  blockHeight: number
  blockTimeUnixMs: number
}[]
```

### Arguments

Aggregators can take arguments just like formulas. All arguments are passed as strings from URL queries, so you must validate them inside the aggregator. The `Aggregator` generic type lets you define the argument types.

## Examples

### Basic Balance Aggregation

This aggregator tracks an account's balance over time and returns statistical summaries:

```ts
export const balanceOverTime: Aggregator<
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
      formula: 'balance',
      address,
      args: { denom },
      times: {
        start: startTimeBigInt,
        end: endTimeBigInt,
        step: timeStepBigInt,
      },
    })

    // Extract balance values and compute aggregations
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
        description: 'Account address to track',
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
```

### Multi-Contract Comparison

Here's an example aggregator that compares values across multiple contracts:

```ts
export const contractComparison: Aggregator<
  {
    contracts: {
      address: string
      value: any
      error?: string
    }[]
    summary: {
      total: number
      successful: number
      failed: number
    }
  },
  {
    addresses: string
    formula: string
  }
> = {
  compute: async (env) => {
    const { addresses, formula } = env.args

    if (!addresses || !formula) {
      throw new Error('addresses and formula arguments are required')
    }

    const addressList = addresses.split(',').map((a) => a.trim())
    const contracts = []
    let successful = 0
    let failed = 0

    for (const address of addressList) {
      try {
        const value = await env.compute({
          type: FormulaType.Contract,
          formula,
          address,
          args: {},
        })

        contracts.push({ address, value })
        successful++
      } catch (error) {
        contracts.push({
          address,
          value: null,
          error: error instanceof Error ? error.message : String(error),
        })
        failed++
      }
    }

    return {
      contracts,
      summary: {
        total: addressList.length,
        successful,
        failed,
      },
    }
  },
  docs: {
    description: 'Compare a formula result across multiple contracts',
    args: [
      {
        name: 'addresses',
        description: 'Comma-separated list of contract addresses',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'formula',
        description: 'Formula to execute for all contracts',
        required: true,
        schema: { type: 'string' },
      },
    ],
  },
}
```

### Time-Series Analysis

An aggregator that performs trend analysis:

```ts
export const trendAnalysis: Aggregator<
  {
    trend: 'increasing' | 'decreasing' | 'stable'
    changePercent: string
    dataPoints: number
    firstValue: string
    lastValue: string
  },
  {
    type: string
    address: string
    formula: string
    startTime: string
    endTime: string
    minDataPoints?: string
  }
> = {
  compute: async (env) => {
    const { type, address, formula, startTime, endTime, minDataPoints } =
      env.args

    if (!type || !address || !formula || !startTime || !endTime) {
      throw new Error(
        'type, address, formula, startTime, and endTime are required'
      )
    }

    const minPoints = minDataPoints ? parseInt(minDataPoints) : 5

    const results = await env.computeRange({
      type: type as FormulaType,
      formula,
      address,
      args: {},
      times: {
        start: BigInt(startTime),
        end: BigInt(endTime),
        step: BigInt(
          Math.floor((Number(endTime) - Number(startTime)) / minPoints)
        ),
      },
    })

    if (results.length < 2) {
      throw new Error('Not enough data points for trend analysis')
    }

    const values = results
      .map((r) => r.value)
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .map((v) => BigInt(String(v)))

    if (values.length < 2) {
      throw new Error('Not enough numeric values for trend analysis')
    }

    const firstValue = values[0]
    const lastValue = values[values.length - 1]
    const change = lastValue - firstValue
    const changePercent =
      firstValue !== 0n ? ((change * 100n) / firstValue).toString() : '0'

    let trend: 'increasing' | 'decreasing' | 'stable'
    if (change > 0n) {
      trend = 'increasing'
    } else if (change < 0n) {
      trend = 'decreasing'
    } else {
      trend = 'stable'
    }

    return {
      trend,
      changePercent,
      dataPoints: values.length,
      firstValue: firstValue.toString(),
      lastValue: lastValue.toString(),
    }
  },
  docs: {
    description: 'Analyze trends in formula values over time',
    args: [
      {
        name: 'type',
        description: 'Formula type (account, contract, generic, validator)',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'address',
        description: 'Target address',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'formula',
        description: 'Formula to analyze',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'startTime',
        description: 'Start time in Unix milliseconds',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'endTime',
        description: 'End time in Unix milliseconds',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'minDataPoints',
        description: 'Minimum number of data points to collect',
        required: false,
        schema: { type: 'string' },
      },
    ],
  },
}
```

## Aggregator Organization

Aggregators are organized in the `src/aggregators/aggregators` directory. Each file can export multiple aggregators, and they are all exported from the main `index.ts` file. The aggregator name is the path to the export.

For example:

- `balance.ts` exports `overTime` → accessible as `balance/overTime`

## Query

Once you've written an aggregator, you can query it using the API server:

```bash
# Basic usage with API key in header
GET /a/balance/balanceOverTime?address=cosmos1...&denom=uatom&startTime=1234567890&endTime=1234567999
Headers: x-api-key: your-api-key

# Alternative with API key in URL
GET /a/your-api-key/balance/balanceOverTime?address=cosmos1...&denom=uatom&startTime=1234567890&endTime=1234567999

# Contract comparison
GET /a/contract/comparison?addresses=cosmos1contract1,cosmos1contract2&formula=totalSupply

# Trend analysis
GET /a/trend/analysis?type=contract&address=cosmos1...&formula=totalSupply&startTime=1234567890&endTime=1234567999
```

## Key Differences from Formulas

1. **Time-aware**: Aggregators are designed to work across time periods, while formulas work at a single point in time.

2. **Higher-level**: Aggregators build on top of formulas and can call multiple formulas to generate results.

3. **Statistical focus**: Aggregators are designed for analysis, trends, and comparisons rather than raw state access.

4. **Different API**: Aggregators use the `/a/` endpoint and don't require type/address in the URL path since they can work with multiple addresses and types.

## Best Practices

1. **Validate arguments**: Always validate required arguments and provide clear error messages.

2. **Handle errors gracefully**: When working with multiple addresses or formulas, collect errors rather than failing entirely.

3. **Use BigInt for math**: When performing mathematical operations on blockchain values, use BigInt to maintain precision.

4. **Limit data points**: For time-series analysis, be mindful of the number of data points to avoid expensive computations.

5. **Document thoroughly**: Provide clear descriptions and document all arguments in the `docs` section.
