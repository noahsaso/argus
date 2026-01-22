# Formulas

A formula processes the "current" state and returns an output. It is
block-agnostic, meaning it does not request state from any specific block—it
purely defines the relationship between the current state and an output. The
indexer API is responsible for giving the formula access to only the state at
the point in time requested by the user.

This formula abstraction allows the indexer to intelligently cache formula
computations and invalidate those caches when any of the inputs change. This
means that the indexer doesn't have to recompute the formula for every block,
but only when necessary. And if it has already computed it for a particular
block, it can simply return the cached result.

Formulas are defined in the `src/formulas/formulas` directory.

## Formula Types

There are four types of formulas:

- `account`
- `contract`
- `generic`
- `validator`

`generic` takes no address, whereas the others take an address. They are
differentiated because they are expected to work slightly differently, though
under the hood they are processed the same way. When using `generic` formulas,
any address can be passed in, and it is ignored.

## Formula Structure

A formula is an object that contains some metadata and a function. The function
computes the output of the formula given the current state and is called with
one argument that gives it access to the state.

```ts
type Formula = {
  compute: (env: Env) => Promise<any>
  // If true, the formula is non-deterministic within the same block, so it
  // cannot be cached. This likely means that some expiration is being checked
  // based on the latest time, which affects the output of the formula without
  // any state changing.
  dynamic?: boolean
  // Contract formulas support filtering by code ID key. The config defines
  // code ID keys, which map a unique identifier to a list of code IDs that are
  // related. This is likely different versions of a common smart contract.
  filter?: {
    codeIdsKeys: string[]
  }
}
```

The environment passed to the formula function has the following structure, plus
an additional address property if the formula is not `generic`:

```ts
type Env = {
  chainId: string
  block: Block
  // If latest block is being used, this will be the current date. If fetching
  // at a specific block, this will be the date of that block.
  date: Date
  // Arguments may or may not be present.
  args: Record<string, string>

  getBlock: FormulaBlockGetter
  get: FormulaGetter
  getMap: FormulaMapGetter
  getDateKeyModified: FormulaDateGetter
  getDateKeyFirstSet: FormulaDateGetter
  getDateKeyFirstSetWithValueMatch: FormulaDateWithValueMatchGetter
  getTransformationMatch: FormulaTransformationMatchGetter
  getTransformationMatches: FormulaTransformationMatchesGetter
  getTransformationMap: FormulaTransformationMapGetter
  getDateFirstTransformed: FormulaTransformationDateGetter
  prefetch: FormulaPrefetch
  prefetchTransformations: FormulaPrefetchTransformations
  getContract: FormulaContractGetter
  getCodeIdsForKeys: FormulaCodeIdsForKeysGetter
  contractMatchesCodeIdKeys: FormulaContractMatchesCodeIdKeysGetter
  getCodeIdKeyForContract: FormulaCodeIdKeyForContractGetter
  getSlashEvents: FormulaSlashEventsGetter
  getTxEvents: FormulaTxEventsGetter
  getBalance: FormulaBalanceGetter
  getBalances: FormulaBalancesGetter
  getProposal: FormulaProposalGetter
  getProposals: FormulaProposalsGetter
  getProposalCount: FormulaProposalCountGetter
  getProposalVote: FormulaProposalVoteGetter
  getProposalVotes: FormulaProposalVotesGetter
  getProposalVoteCount: FormulaProposalVoteCountGetter
  getCommunityPoolBalances: FormulaCommunityPoolBalancesGetter
  getExtraction: FormulaExtractionGetter
  getExtractions: FormulaExtractionsGetter
  getExtractionMap: FormulaExtractionMapGetter
  getDateFirstExtracted: FormulaDateFirstExtractedGetter
  getFeegrantAllowance: FormulaFeegrantAllowanceGetter
  getFeegrantAllowances: FormulaFeegrantAllowancesGetter
  hasFeegrantAllowance: FormulaFeegrantHasAllowanceGetter
}
```

For `contract` formulas, the address is passed in via the environment under the
`contractAddress` key. For `validator` formulas, the address is passed in via
the environment under the `validatorOperatorAddress` key. And for `account`
formulas, the address is passed in via the environment under the `address` key.

## How to write a formula

To add a new formula, it must be exported from the `index.ts` file of the
respective formula type folder, such as `data/formulas/contract/index.ts`. The
full formula name is the path of the export. For example,
`data/formula/contract/daoCore/index.ts` exports one object with the name
`daoCore` containing all of the formulas for the DAO's core contract, and
`data/formulas/contract/index.ts` exports the `daoCore` object, so all formulas
nested in the `daoCore` export are accessible via `daoCore/<FUNCTION NAME>`. Any
level of nesting is supported.

Most of the environment functions (i.e. the state getters) are self-explanatory,
and their type definitions can be found in `src/core/types.ts`. Explore
everything that is available to you in the environment to see what you can do.

Whenever a function takes keys, it is referring to the key given to an `Item` or
a `Map` in a CosmWasm smart contract. Getter functions take variable number of
keys to allow for nested access—for an `Item`, simply use the key of the `Item`,
but for a `Map`, you must use the key of the `Map` followed by the key of the
value inside the `Map`. If the `Map` uses a multi-key, you can simply pass in
each key as a separate argument.

There are a set of functions that share behavior but operate only on transformed
state (`get` and `getTransformationMatch` do the same thing, but
`getTransformationMatch` only operates on transformed state, whereas `get` works
on the raw state). You cannot use `getTransformationMatch` without setting up a
transformer, but `get` will work right away for all contracts, for example. See
the [transformers docs](./transformers.md) to learn more about transforming
state and when it would be useful.

Also be sure to check out the [keys docs](./keys.md) for a very important
explanation of how keys are formatted. It describes some utility functions that
may come in handy when writing formulas. One is used below in a complex
multi-key Map scenario (`dbKeyToKeys`).

### `get` and `getMap`

The `get` function is the most common function and is used to fetch the value of
a given state key for a given contract. It can be used on both `Item`s and
`Map`s. `getMap` is another function which provides the whole map and loads
every key from state. See them used below:

```ts
export const formula: ContractFormula = {
  // Get the contract address and state getter functions from the environment.
  compute: async ({ contractAddress, get, getMap }) => {
    // Get the value from an Item, for example:
    // `pub const LABEL: Item<String> = Item::new("label");`
    const labelValue = await get(contractAddress, 'label')

    // Get the value from an item in a Map, for example:
    // `pub const BALANCES: Map<&Addr, Uint128> = Map::new("balance");`
    const addr1Balance = await get(contractAddress, 'balance', 'addr1')
    // To get the entire map as an object, use `getMap`:
    const balanceMap = await getMap(contractAddress, 'balance')
    // Now addr1Balance === balanceMap["addr1"]

    // And if a Map uses numeric keys instead of strings, you can use:
    const balanceMap = await getMap(contractAddress, 'numeric_map', {
      keyType: 'number',
    })

    // Get the value from a multi-key Map, for example:
    // `pub const ALLOWANCES: Map<(&Addr, &Addr), AllowanceResponse> = Map::new("allowance");`
    const allowance = await get(contractAddress, 'allowance', 'addr1', 'addr2')
    // `getMap` also works for multi-key maps, but the syntax is different:
    const allowanceMap = await getMap(contractAddress, ['allowance', 'addr1'])
    // Now allowance === allowanceMap["addr2"]

    // Get a map of all values in a multi-key Map, for example:
    const allAllowances = await getMap(contractAddress, 'allowance', {
      // The keys of the `allowance` `Map` are tuples of two addresses, so they
      // cannot be decoded as one string or number here. We need to use the
      // raw key type and the `dbKeyToKeys` utility function to decode them.
      keyType: 'raw',
    })
    // The keys will be strings in their database-key format and must be further
    // decoded with the `dbKeyToKeys` utility function.
    const addr1Allowances = Object.entries(allAllowances)
      .map(([key, value]) => {
        const [addr1, addr2] = dbKeyToKeys(key, [false, false])
        return [addr1, addr2, value]
      })
      .filter(([addr1]) => addr1 === 'addr1')
  },
}
```

### Arguments

Formulas can also take arguments. All arguments are passed as strings since they
come from URL queries, so you must validate them inside the formula. The
`ContractFormula` generic type lets you define the arguments so you can access
them inside the `compute` function.

This formula accesses a wallet's balance from a contract.

```ts
export const walletBalance: ContractFormula<number, { wallet: string }> = {
  compute: async ({ get, contractAddress, args: { wallet } }) => {
    if (!wallet) {
      throw new Error('Missing wallet')
    }

    return await get(contractAddress, 'balance', wallet)
  },
}
```

### Dynamic formulas

Mark a formula as `dynamic` (by setting `dynamic` to true) when its results
change based on the block height and/or timestamp, even when a state key does
not change. One example of this is when a formula checks an expiration.

```ts
export const paused: ContractFormula<PausedResponse> = {
  // This formula depends on the block height/time to check expiration.
  dynamic: true,
  compute: async (env) => {
    const { contractAddress, get, date } = env

    const expiration = (
      await get<Expiration | undefined>(contractAddress, 'paused')
    )?.valueJson

    // at_time is in nanoseconds, so convert to milliseconds.
    return !expiration || date.getTime() >= Number(expiration.at_time) / 1e6
      ? { Unpaused: {} }
      : { Paused: { expiration } }
  },
}
```

This affects historical range queries and caching behavior, since dynamic
formulas rely on more than just state.

## Examples

This formula returns the config for a
[DAO](https://github.com/DA0-DA0/dao-contracts/tree/main/contracts/dao-dao-core).
You can see it supports both V1 and V2 of the contract, which happen to be
stored under different state keys in the different versions of the contract. The
indexer unifies the API and allows you to query the same formula for both
versions of the contract.

```ts
export const config: ContractFormula<Config | undefined> = {
  compute: async ({ contractAddress, get }) =>
    // V2.
    (await get<Config>(contractAddress, 'config_v2'))?.valueJson ??
    // V1.
    (await get<Config>(contractAddress, 'config'))?.valueJson,
}
```

Here's another example where a formula uses the result of another formula by
passing the `env` object through. It filters a DAO's proposal modules by the
ones that are enabled.

```ts
export const activeProposalModules: ContractFormula<
  ProposalModuleWithInfo[] | undefined
> = {
  compute: async (env) => {
    const modules = await proposalModules.compute(env)
    return modules?.filter(
      (module) => module.status === 'enabled' || module.status === 'Enabled'
    )
  },
}
```

And here is a formula that sets `dynamic` to `true` since it depends on the
current time to verify expiration. This cannot be cached. No state key will
change when the expiration is reached, so the indexer cannot invalidate the
cache. Thus the formula should always be computed when requested. This formula
checks if a DAO is paused or not.

```ts
export const paused: ContractFormula<PausedResponse> = {
  // This formula depends on the block height/time to check expiration.
  dynamic: true,
  compute: async (env) => {
    const { contractAddress, get, date } = env

    const expiration = (await get<Expiration | undefined>(
      contractAddress,
      'paused'
    ))?.valueJson

    // at_time is in nanoseconds, so convert to milliseconds.
    return !expiration || date.getTime() >= Number(expiration.at_time) / 1e6
      ? { Unpaused: {} }
      : { Paused: { expiration } }
  },
}
```

Here's a complicated account formula that calls contract formulas and returns
the list of all cw20 tokens that the account has a balance of. It uses
transformed state to efficiently perform the query. Read the [transformers
docs](./transformers.md) for more information on how this works.

```ts
export const list: AccountFormula<ContractWithBalance[]> = {
  compute: async (env) => {
    const { address, getTransformationMatches } = env

    // Potential cw20 contracts where the address has tokens.
    const matchingContracts =
      (await getTransformationMatches(
        undefined,
        `hasBalance:${address}`,
        true
      )) ?? []

    const contractInfos = await Promise.all(
      matchingContracts.map(({ contractAddress }) =>
        info.compute({
          ...env,
          contractAddress,
        })
      )
    )

    const balances = await Promise.all(
      matchingContracts.map(({ contractAddress }) =>
        balance.compute({
          ...env,
          contractAddress,
          args: {
            address: env.address,
          },
        })
      )
    )

    const contractsWithBalance = matchingContracts
      // Filter by those with cw20 in the contract name and with a >0 balance.
      .map(({ contractAddress }, index): ContractWithBalance | undefined =>
        contractInfos[index]?.contract?.includes('cw20') &&
        balances[index] !== '0'
          ? {
              contractAddress,
              balance: balances[index],
            }
          : undefined
      )
      .filter(
        (contractWithBalance): contractWithBalance is ContractWithBalance =>
          !!contractWithBalance
      )

    return contractsWithBalance
  },
}
```

## Query

Once you've written a formula, you can query it using the API server. Head over
to the [query docs](./query.md) for more information.
