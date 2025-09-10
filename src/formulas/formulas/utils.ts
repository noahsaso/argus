import { Op } from 'sequelize'

import {
  Block,
  ContractEnv,
  ContractFormula,
  Env,
  Formula,
  KeyInput,
} from '@/types'

import { Duration, Expiration } from './types'

export const isExpirationExpired = (
  env: Env,
  expiration: Expiration
): boolean => {
  if ('at_height' in expiration) {
    return env.block.height >= expiration.at_height
  } else if ('at_time' in expiration) {
    // Use `env.date` to compare instead of `env.block` since it will be more
    // accurate. `env.block` contains the time the block occurred, so it will be
    // slightly behind the actual time, whereas `env.date` is the current time.
    // If using a block in the past, the `env.date` will be the time the block,
    // so this is ok.

    // at_time is in nanoseconds, so convert to milliseconds.
    return env.date.getTime() >= Number(expiration.at_time) / 1e6
  }
  // Never expires.
  return false
}

export const expirationPlusDuration = (
  expiration: Expiration,
  duration: Duration
): Expiration => {
  if ('at_height' in expiration && 'height' in duration) {
    return { at_height: expiration.at_height + duration.height }
  } else if ('at_time' in expiration && 'time' in duration) {
    // `duration.time` is in seconds, so convert to nanoseconds for `at_time`.
    return {
      at_time: BigInt(
        Number(expiration.at_time) + duration.time * 1e9
      ).toString(),
    }
  }

  // Should never happen.
  throw new Error('expiration duration units mismatch')
}

export type Source =
  | {
      type: 'event'
      key: KeyInput
    }
  | {
      type: 'transformation'
      name: string
    }
  | {
      type: 'extraction'
      name: string
    }

/**
 * Make a simple contract formula with some common error/fallback handling.
 */
export const makeSimpleContractFormula = <
  T = unknown,
  R = T,
  Args extends Record<string, string> = {}
>({
  docs,
  filter,
  fallback,
  transform = (data: T) => data as unknown as R,
  ...source
}: (
  | {
      /**
       * State key to load from WasmStateEvents table.
       */
      key: KeyInput
    }
  | {
      /**
       * Transformation name to load from WasmStateEventTransformations table.
       */
      transformation: string
      /**
       * Fallback state key(s) to load from WasmStateEvents table, fetched in
       * order.
       */
      fallbackKeys?: KeyInput[]
    }
  | {
      /**
       * Sources to load from, using the first source that exists.
       */
      sources: Source[]
    }
) & {
  /**
   * Docs for the formula.
   */
  docs: Formula['docs']
  /**
   * Filter to apply.
   */
  filter?: ContractFormula['filter']
  /**
   * Optional fallback value if no data is found. If undefined, an error is
   * thrown.
   */
  fallback?: R
  /**
   * Optionally transform the data before returning it.
   */
  transform?: (
    data: T,
    options: {
      args: Partial<Args>
      block: Block
    }
  ) => R
}): ContractFormula<R, Args> => ({
  docs,
  filter,
  compute: async ({
    contractAddress,
    args,
    block,
    get,
    getTransformationMatch,
    getExtraction,
  }) => {
    const sources: Source[] =
      'key' in source
        ? [
            {
              type: 'event',
              key: source.key,
            } satisfies Source,
          ]
        : 'transformation' in source
        ? [
            {
              type: 'transformation',
              name: source.transformation,
            } satisfies Source,
            ...(source.fallbackKeys?.map(
              (key): Source => ({
                type: 'event',
                key,
              })
            ) || []),
          ]
        : source.sources

    let value: T | undefined
    for (const source of sources) {
      let found = false
      switch (source.type) {
        case 'event': {
          const event = await get<T>(contractAddress, source.key)
          if (event) {
            found = true
            value = event.valueJson as unknown as T
          }
          break
        }
        case 'transformation': {
          const transformation = await getTransformationMatch<T>(
            contractAddress,
            source.name
          )
          if (transformation) {
            found = true
            value = transformation.value
          }
          break
        }
        case 'extraction': {
          const extraction = await getExtraction<T>(
            contractAddress,
            source.name
          )
          if (extraction) {
            found = true
            value = extraction.data
          }
          break
        }
      }

      if (found) {
        break
      }
    }

    if (value === undefined) {
      if (fallback !== undefined) {
        return fallback
      }

      throw new Error('failed to load')
    }

    return transform(value as T, {
      args,
      block,
    })
  },
})

/**
 * Load a specific range of values from a transformed map or snapshot map.
 */
export const mapRange = async <V>({
  env: { contractAddress, getTransformationMatches },
  name,
  startAfter,
  limit,
}: {
  /**
   * The environment.
   */
  env: ContractEnv
  /**
   * The name of the transformed snapshot map to load from.
   */
  name: string
  /**
   * The key to start after.
   */
  startAfter?: string
  /**
   * The maximum number of values to load.
   */
  limit?: number
}): Promise<
  {
    /**
     * Key in the map with the name prefix removed.
     */
    key: string
    /**
     * Value in the map.
     */
    value: V
  }[]
> =>
  (
    await getTransformationMatches<V>(
      contractAddress,
      name + ':*',
      undefined,
      undefined,
      startAfter
        ? {
            [Op.gt]: `${name}:${startAfter}`,
          }
        : undefined,
      limit
    )
  )
    // Remove deleted values.
    ?.filter(({ value }) => value !== null)
    .map(({ name: nameAndKey, value }) => ({
      key: nameAndKey.slice(name.length + 1),
      value,
    })) ?? []

/**
 * Potentially load a value at a height from a transformed snapshot. Returns
 * undefined if no value is found at the height, null if a change was found but
 * the old value did not exist, and the old value otherwise.
 *
 * https://github.com/CosmWasm/cw-storage-plus/blob/cac9687e29579c61eeacffafc131614c9f43baaa/src/snapshot/mod.rs#L151-L180
 */
export const snapshotMayLoadAtHeight = async <
  K extends string | number | null,
  V
>({
  env: { contractAddress, getTransformationMap },
  name,
  key,
  height,
}: {
  /**
   * The environment.
   */
  env: ContractEnv
  /**
   * The name of the transformed snapshot to load from.
   */
  name: string
  /**
   * The key to load. If undefined, key is omitted. This is used for
   * SnapshotItems that have no key.
   */
  key: K | undefined
  /**
   * The height to load.
   */
  height: number
}): Promise<V | null | undefined> => {
  // Map of height to ChangeSet.
  const changelogMap =
    (await getTransformationMap<{ old: V | undefined | null }>(
      contractAddress,
      [
        `${name}/changelog`,
        ...(key !== undefined
          ? [typeof key === 'number' ? BigInt(key).toString() : key]
          : []),
      ].join(':')
    )) || {}

  const start = BigInt(height)
  const changelog = Object.entries(changelogMap)
    // Sort ascending.
    .sort(([a], [b]) => Number(BigInt(a) - BigInt(b)))
    // Find first entry whose height is the start height or greater.
    .find(([height]) => BigInt(height) >= start)

  return changelog && (changelog[1]?.old ?? null)
}

/**
 * Potentially load a value from a transformed snapshot item. Returns undefined
 * if no value is found.
 *
 * https://github.com/CosmWasm/cw-storage-plus/blob/cac9687e29579c61eeacffafc131614c9f43baaa/src/snapshot/item.rs#L130-L134
 */
export const snapshotItemMayLoad = async <V>({
  env: { contractAddress, getTransformationMatch },
  name,
}: {
  /**
   * The environment.
   */
  env: ContractEnv
  /**
   * The name of the transformed snapshot item to load from.
   */
  name: string
}): Promise<V | undefined> =>
  (await getTransformationMatch<V>(contractAddress, name))?.value

/**
 * Potentially load a value at a height from a transformed snapshot item.
 * Returns undefined if no old value is found at the height and no current value
 * exists, null if a change was found but the old value did not exist, and the
 * old value otherwise.
 *
 * https://github.com/CosmWasm/cw-storage-plus/blob/cac9687e29579c61eeacffafc131614c9f43baaa/src/snapshot/item.rs#L136-L145
 */
export const snapshotItemMayLoadAtHeight = async <V>({
  env,
  name,
  height,
}: {
  /**
   * The environment.
   */
  env: ContractEnv
  /**
   * The name of the transformed snapshot item to load from.
   */
  name: string
  /**
   * The height to load.
   */
  height: number
}): Promise<V | null | undefined> => {
  const snapshot = await snapshotMayLoadAtHeight<null, V>({
    env,
    name,
    key: undefined,
    height,
  })

  return snapshot === undefined
    ? // If no snapshot at height, return current value.
      await snapshotItemMayLoad({
        env,
        name,
      })
    : // Otherwise, return snapshot.
      snapshot
}

/**
 * Potentially load a value from a transformed snapshot map. Returns undefined
 * if no value is found.
 *
 * https://github.com/CosmWasm/cw-storage-plus/blob/cac9687e29579c61eeacffafc131614c9f43baaa/src/snapshot/map.rs#L148-L152
 */
export const snapshotMapMayLoad = async <K extends string | number, V>({
  env: { contractAddress, getTransformationMatch },
  name,
  key,
}: {
  /**
   * The environment.
   */
  env: ContractEnv
  /**
   * The name of the transformed snapshot map to load from.
   */
  name: string
  /**
   * The key to load.
   */
  key: K
}): Promise<V | undefined> =>
  (
    await getTransformationMatch<V>(
      contractAddress,
      `${name}:${typeof key === 'number' ? BigInt(key).toString() : key}`
    )
  )?.value

/**
 * Potentially load a value at a height from a transformed snapshot map. Returns
 * undefined if no old value is found at the height and no current value exists,
 * null if a change was found but the old value did not exist, and the old value
 * otherwise.
 *
 * https://github.com/CosmWasm/cw-storage-plus/blob/cac9687e29579c61eeacffafc131614c9f43baaa/src/snapshot/map.rs#L154-L170
 */
export const snapshotMapMayLoadAtHeight = async <K extends string | number, V>({
  env,
  name,
  key,
  height,
}: {
  /**
   * The environment.
   */
  env: ContractEnv
  /**
   * The name of the transformed snapshot map to load from.
   */
  name: string
  /**
   * The key to load.
   */
  key: K
  /**
   * The height to load.
   */
  height: number
}): Promise<V | null | undefined> => {
  const snapshot = await snapshotMayLoadAtHeight<K, V>({
    env,
    name,
    key,
    height,
  })

  return snapshot === undefined
    ? // If no snapshot at height, return current value.
      await snapshotMapMayLoad({
        env,
        name,
        key,
      })
    : // Otherwise, return snapshot.
      snapshot
}

/**
 * Potentially load an item by key and ID from a transformed SnapshotVectorMap.
 * Returns undefined if no item is found.
 */
export const snapshotVectorMapMayLoadItem = async <
  K extends string | number,
  V
>({
  env: { contractAddress, getTransformationMatch },
  name,
  key,
  id,
}: {
  /**
   * The environment.
   */
  env: ContractEnv
  /**
   * The name of the transformed snapshot map to load from.
   */
  name: string
  /**
   * The key to load.
   */
  key: K
  /**
   * The ID to load.
   */
  id: number
}): Promise<V | undefined> =>
  (
    await getTransformationMatch<V>(
      contractAddress,
      `${name}/items:${
        typeof key === 'number' ? BigInt(key).toString() : key
      }:${BigInt(id).toString()}`
    )
  )?.value

/**
 * Loads paged items at the given block height that are not expired from a
 * transformed SnapshotVectorMap.
 */
export const snapshotVectorMapLoad = async <K extends string | number, V>({
  env,
  name,
  key,
  height,
  limit,
  offset = 0,
}: {
  /**
   * The environment.
   */
  env: ContractEnv
  /**
   * The name of the transformed snapshot map to load from.
   */
  name: string
  /**
   * The key to load.
   */
  key: K
  /**
   * The height to load.
   */
  height: number
  /**
   * Limit the number of items to load.
   */
  limit?: number
  /**
   * The offset to start loading from.
   */
  offset?: number
}): Promise<
  {
    id: number
    item: V | undefined
    expiration: number | null
  }[]
> => {
  const activeIds =
    (await snapshotMapMayLoadAtHeight<K, [number, number | null][]>({
      env,
      name: `${name}/active`,
      key,
      height,
    })) || []

  const items = await Promise.all(
    activeIds
      .filter(([, exp]) => exp === null || exp > height)
      .slice(offset, limit === undefined ? undefined : offset + limit)
      .map(async ([id, expiration]) => ({
        id,
        item: await snapshotVectorMapMayLoadItem<K, V>({
          env,
          name,
          key,
          id,
        }),
        expiration,
      }))
  )

  return items
}

/**
 * Loads the value at a key at the specified time of a transformed Wormhole.
 * Returns undefined if no value is found at the time.
 */
export const wormholeLoad = async <K extends string | number, V>({
  env: { contractAddress, getTransformationMap },
  name,
  key,
  timestamp,
}: {
  /**
   * The environment.
   */
  env: ContractEnv
  /**
   * The name of the transformed wormhole to load from.
   */
  name: string
  /**
   * The key to load.
   */
  key: K
  /**
   * The timestamp to load.
   */
  timestamp: number
}): Promise<V | undefined> => {
  // Map of timestamp to value.
  const wormholeMap =
    (await getTransformationMap<V>(
      contractAddress,
      `${name}:${typeof key === 'number' ? BigInt(key).toString() : key}`
    )) || {}

  const end = BigInt(timestamp)
  const entry = Object.entries(wormholeMap)
    // Sort descending.
    .sort(([a], [b]) => Number(BigInt(b) - BigInt(a)))
    // Find first entry whose timestamp is the end timestamp or less.
    .find(([timestamp]) => BigInt(timestamp) <= end)

  return entry?.[1]
}
