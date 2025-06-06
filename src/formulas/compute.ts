import { ModelStatic, Op } from 'sequelize'

import { Contract, dependentKeyMatches, getDependableEventModels } from '@/db'
import {
  Block,
  Cache,
  CacheMap,
  CacheMapSingle,
  ComputationDependentKey,
  ComputationOutput,
  ComputeOptions,
  ComputeRangeOptions,
  DependableEventModel,
  FormulaType,
} from '@/types'

import { getEnv } from './env'

export const compute = async ({
  chainId,
  targetAddress,
  args,
  block,
  cache,
  ...options
}: ComputeOptions): Promise<ComputationOutput> => {
  // Store the latest block that we've seen for all keys accessed. This is when
  // this computation became valid, i.e. the earliest this computation could
  // have been made to get this output. If the formula is dynamic, then the
  // current block is the earliest/latest block this is valid for (i.e. it's
  // only valid at this block).
  let latestBlock: Block | undefined = options.formula.dynamic
    ? block
    : undefined

  const onFetch = async (events: DependableEventModel[]) => {
    const latestEvent = [...events].sort((a, b) =>
      Number(b.block.height - a.block.height)
    )[0]

    // If latest is unset, or if we found a later block height, update.
    if (
      latestEvent &&
      (latestBlock === undefined ||
        latestEvent.block.height > latestBlock.height)
    ) {
      latestBlock = latestEvent.block
    }
  }

  const dependentKeys: ComputationDependentKey[] = []

  const env = getEnv({
    chainId,
    block,
    args,
    dependentKeys,
    onFetch,
    cache,
  })
  const value =
    options.type === FormulaType.Contract
      ? await options.formula.compute({
          ...env,
          contractAddress: targetAddress,
        })
      : options.type === FormulaType.Validator
      ? await options.formula.compute({
          ...env,
          validatorOperatorAddress: targetAddress,
        })
      : options.type === FormulaType.Account
      ? await options.formula.compute({
          ...env,
          address: targetAddress,
        })
      : await options.formula.compute(env)

  return {
    block: latestBlock,
    value,
    dependentKeys,
  }
}

export const computeRange = async ({
  chainId,
  targetAddress,
  args,
  blockStart,
  blockEnd,
  ...options
}: ComputeRangeOptions): Promise<ComputationOutput[]> => {
  // Dependent keys seen so far.
  const allDependentKeys: ComputationDependentKey[] = []
  // All events sorted ascending by block height. These keys are different from
  // dependent keys because dependent keys can include prefixes. We need to
  // store all events for each key so we can find the first event for a given
  // key based on dynamic block height constraints. Prefix groupings may change
  // based on many different keys, so a map that uses a prefix needs to be
  // reconstructed by individual key comparisons, meaning we need to store keys
  // separately here and not combined into their maps.
  const allEvents: Record<string, DependableEventModel[] | undefined> = {}

  // Cache contracts across all computations since they stay constant.
  const contractCache: CacheMapSingle<Contract> = {}

  const computeForBlockInRange = async (
    block: Block
  ): Promise<{
    latestBlock: Block | undefined
    value: any
    dependentKeys: ComputationDependentKey[]
    eventsUsed: DependableEventModel[]
  }> => {
    // Store the latest block that we've seen for all keys accessed. This is the
    // earliest this computation could have been made. If the formula is
    // dynamic, then the current block is the earliest/latest block this is
    // valid for (i.e. it's only valid at this block).
    let latestBlock: Block | undefined = options.formula.dynamic
      ? block
      : undefined

    // Store the dependable events used for this computation.
    let eventsUsed: DependableEventModel[] = []

    const onFetch = async (events: DependableEventModel[]) => {
      if (events.length) {
        eventsUsed = [...eventsUsed, ...events]
      }

      const latestEvent = [...events].sort((a, b) =>
        Number(b.block.height - a.block.height)
      )[0]

      // If latest is unset, or if we found a later block height, update.
      if (
        latestEvent &&
        (latestBlock === undefined ||
          latestEvent.block.height > latestBlock.height)
      ) {
        latestBlock = latestEvent.block
      }
    }

    // Build cache from all dependent events already loaded.
    const initialCache: Cache = {
      events: {},
      contracts: contractCache,
    }

    if (allDependentKeys.length > 0) {
      addToCache(allDependentKeys, allEvents, initialCache.events, block)
    }

    const dependentKeys: ComputationDependentKey[] = []

    const env = getEnv({
      chainId,
      block,
      args,
      dependentKeys,
      onFetch,
      cache: initialCache,
    })
    const value =
      options.type === FormulaType.Account
        ? await options.formula.compute({
            ...env,
            address: targetAddress,
          })
        : options.type === FormulaType.Contract
        ? await options.formula.compute({
            ...env,
            contractAddress: targetAddress,
          })
        : options.type === FormulaType.Validator
        ? await options.formula.compute({
            ...env,
            validatorOperatorAddress: targetAddress,
          })
        : await options.formula.compute(env)

    return {
      latestBlock,
      value,
      dependentKeys,
      eventsUsed,
    }
  }

  const results: ComputationOutput[] = []

  let nextPotentialBlock: Block | undefined = blockStart
  while (nextPotentialBlock && nextPotentialBlock.height <= blockEnd.height) {
    const currentBlock: Block = nextPotentialBlock
    const result = await computeForBlockInRange(currentBlock)

    const previousResult = results[results.length - 1]
    // Only store result if it's the first result or newer than the most
    // recently stored result.
    if (
      !previousResult ||
      (!previousResult.block && result.latestBlock) ||
      (previousResult.block &&
        result.latestBlock &&
        result.latestBlock.height > previousResult.block.height)
    ) {
      // If there is a previous result and the formula is not dynamic, update
      // its latest valid block height to just before this one, since there's
      // now a new value. If the formula is dynamic, then the previous result's
      // latest valid block height is already correct.
      if (previousResult && result.latestBlock && !options.formula.dynamic) {
        previousResult.latestBlockHeightValid = result.latestBlock.height - 1n
      }

      results.push({
        block: result.latestBlock,
        value: result.value === undefined ? null : result.value,
        dependentKeys: result.dependentKeys,
        // At least valid until the requested block, which may be equal to or
        // after the latestBlock returned in the result.
        latestBlockHeightValid: currentBlock.height,
      })
    }

    // Load events used into cache if they don't already exist. They may have
    // been added in a previous future events fetch, so don't double-add.
    result.eventsUsed
      // Sort ascending.
      .sort((a, b) => Number(a.block.height - b.block.height))
      .forEach((event) => {
        if (event.dependentKey in allEvents) {
          if (!allEvents[event.dependentKey]!.includes(event)) {
            allEvents[event.dependentKey]!.push(event)
          }
        } else {
          allEvents[event.dependentKey] = [event]
        }
      })

    // Preload all events for new dependent keys seen until the end.
    const newDependentKeys = result.dependentKeys.filter(
      (a) => !allDependentKeys.some((b) => dependentKeyMatches(a, b))
    )
    if (newDependentKeys.length > 0) {
      const futureEvents = (
        await Promise.all(
          getDependableEventModels().map(async (DependableEventModel) => {
            const namespacedDependentKeys = newDependentKeys.filter(({ key }) =>
              key.startsWith(DependableEventModel.dependentKeyNamespace + ':')
            )
            if (namespacedDependentKeys.length === 0) {
              return []
            }

            return await (
              DependableEventModel as unknown as ModelStatic<DependableEventModel>
            ).findAll({
              where: {
                // After the current block up to the end block.
                [DependableEventModel.blockHeightKey]: {
                  [Op.gt]: currentBlock.height,
                  [Op.lte]: blockEnd.height,
                },
                ...DependableEventModel.getWhereClauseForDependentKeys(
                  namespacedDependentKeys
                ),
              },
              order: [[DependableEventModel.blockHeightKey, 'ASC']],
            })
          })
        )
      ).flat()

      // Save for future computations.
      futureEvents
        // Sort ascending.
        .sort((a, b) => Number(a.block.height - b.block.height))
        .forEach((event) => {
          if (event.dependentKey in allEvents) {
            allEvents[event.dependentKey]!.push(event)
          } else {
            allEvents[event.dependentKey] = [event]
          }
        })

      newDependentKeys.forEach((key) => allDependentKeys.push(key))
    }

    // Find the next event that has the potential to change the result for the
    // given dependencies. If it remains undefined, then we know that the result
    // will not change because no inputs changed.
    nextPotentialBlock = getNextPotentialBlock(
      result.dependentKeys,
      allEvents,
      currentBlock
    )
  }

  return results
}

// This function takes the given dependent keys and all events that have been
// loaded from those dependent keys, and then adds to the cache the latest event
// for each dependent key that is before or at the given block. For dependent
// key prefixes, it finds all unique keys that match the prefix and adds the
// latest event for each of those keys to the cache. This populates the cache
// with the events that will be relevant at the given block based on the loaded
// events. It is used when computing ranges so that we can prefetch the
// appropriate events for future computations that we already know will be
// needed.
const addToCache = (
  dependentKeys: ComputationDependentKey[],
  allEvents: Record<string, DependableEventModel[] | undefined>,
  cache: CacheMap<DependableEventModel>,
  block: Block
) => {
  const nonPrefixes = dependentKeys.filter(({ prefix }) => !prefix)
  const prefixes = dependentKeys.filter(({ prefix }) => prefix)

  for (const { key } of nonPrefixes) {
    const allEventsForThisKey = allEvents[key]
    // No events found for this key, cache null to indicate it doesn't exist and
    // prevent querying for it.
    if (!allEventsForThisKey) {
      cache[key] = null
      continue
    }

    // Sorted ascending by block height, so we can find the latest event for a
    // given key that is before or at the current block height by finding the
    // index of the first event that is after the current block height and
    // subtracting 1.
    const nextIndex = allEventsForThisKey.findIndex(
      (event) => event.block.height > block.height
    )

    const currentIndex =
      // If the next event index is undefined or is the first event, there is no
      // current event.
      nextIndex === undefined || nextIndex === 0
        ? undefined
        : // If the next event index is greater than 0, the current event is the
        // most recent event before this one, so subtract one.
        nextIndex > 0
        ? nextIndex - 1
        : // If the next event index is -1, meaning no events matched the predicate, and events exist, the current event is the last event.
        allEventsForThisKey.length > 0
        ? allEventsForThisKey.length - 1
        : // Otherwise there are no events before the current block height.
          undefined

    if (currentIndex !== undefined) {
      cache[key] = [allEventsForThisKey[currentIndex]]

      // Remove all events that are before the current event we found, since
      // future computations will only go up. Keep the one we found in case it's
      // used in the future.
      allEvents[key] = allEventsForThisKey.slice(currentIndex)
    } else {
      cache[key] = null
    }
  }

  for (const { key: prefixKey } of prefixes) {
    const prefixedKeyEventEntries = Object.entries(allEvents).filter(([key]) =>
      key.startsWith(prefixKey)
    )

    // Sorted ascending by block height, so we can find the latest event for
    // each unique key before or at the current block height by finding the
    // index of the first event for each that is after the current block height
    // and subtracting 1.
    const currentIndexes = prefixedKeyEventEntries.map(([, events]) => {
      if (!events) {
        return undefined
      }

      const nextIndex = events.findIndex(
        (event) => event.block.height > block.height
      )

      // If the next event index is the first event, there is no current event.
      return nextIndex === 0
        ? undefined
        : // If the next event index is greater than 0, the current event is the most recent event before this one, so subtract one.
        nextIndex > 0
        ? nextIndex - 1
        : // If the next event index is -1, meaning no events matched the predicate, and events exist, the current event is the last event.
        events.length > 0
        ? events.length - 1
        : // Otherwise there are no events before the current block height.
          undefined
    })

    cache[prefixKey] = currentIndexes
      .map((currentEventIndex, entryIndex) =>
        currentEventIndex !== undefined
          ? prefixedKeyEventEntries[entryIndex][1]![currentEventIndex]
          : null
      )
      .filter((event): event is DependableEventModel => event !== null)

    // Remove all events that are before the current event we found for each
    // key, since future computations will only go up. Keep the one we found in
    // case it's used in the future.
    currentIndexes.forEach((currentEventIndex, index) => {
      if (currentEventIndex !== undefined) {
        allEvents[prefixedKeyEventEntries[index][0]] =
          allEvents[prefixedKeyEventEntries[index][0]]?.slice(currentEventIndex)
      }
    })
  }
}

// Find the next event that has the potential to change the result for the given
// keys. If it remains undefined, then we know that the result will not change
// because no inputs changed.
export const getNextPotentialBlock = (
  dependentKeys: ComputationDependentKey[],
  allEvents: Record<string, DependableEventModel[] | undefined>,
  currentBlock: Block
): Block | undefined => {
  let nextPotentialBlock: Block | undefined

  const nonPrefixes = dependentKeys.filter(({ prefix }) => !prefix)
  const prefixes = dependentKeys.filter(({ prefix }) => prefix)

  for (const { key } of nonPrefixes) {
    // Sorted ascending by block height, so we can find the next event for a
    // given key that is after the current block height by selecting the first
    // one.
    const matchingEvent = allEvents[key]?.find(
      (event) => event.block.height > currentBlock.height
    )

    if (
      matchingEvent &&
      (nextPotentialBlock === undefined ||
        matchingEvent.block.height < nextPotentialBlock.height)
    ) {
      nextPotentialBlock = matchingEvent.block
    }
  }

  for (const { key: prefixKey } of prefixes) {
    // Sorted ascending by block height so we can find the next event for each
    // unique key after the current block height by finding the first one.
    const matchingEvents = Object.entries(allEvents)
      .filter(([key]) => key.startsWith(prefixKey))
      .map(([, events]) =>
        events?.find((event) => event.block.height > currentBlock.height)
      )
      .filter((event): event is DependableEventModel => event !== undefined)

    const nextEvent = matchingEvents.sort((a, b) =>
      Number(a.block.height - b.block.height)
    )[0]
    if (
      nextEvent &&
      (nextPotentialBlock === undefined ||
        nextEvent.block.height < nextPotentialBlock.height)
    ) {
      nextPotentialBlock = nextEvent.block
    }
  }

  return nextPotentialBlock
}
