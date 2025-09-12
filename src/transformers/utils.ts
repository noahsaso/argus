import {
  KeyInput,
  KeyInputType,
  ParsedWasmStateEvent,
  Transformer,
} from '@/types'
import { dbKeyForKeys, dbKeyToKeys, dbKeyToKeysAdvanced } from '@/utils'

export const defaultGetValue = (event: ParsedWasmStateEvent) =>
  // If value is null but this is not a delete event, store an empty string
  // instead so this transformation doesn't look like a delete.
  event.valueJson === null && !event.delete ? '' : event.valueJson

export const makeTransformer = (
  codeIdsKeys: string[] | 'any',
  name: string,
  keyOrKeys?: string | string[]
): Transformer => {
  const dbKeys = [keyOrKeys || name].flat().map((key) => dbKeyForKeys(key))

  return {
    filter: {
      codeIdsKeys,
      matches: (event) => dbKeys.includes(event.key),
    },
    name,
    getValue: defaultGetValue,
  }
}

interface TransformerForMapOptions<V = any> {
  /**
   * Override the default name generation. The map prefix is automatically
   * prepended to the name.
   */
  namer?: {
    /**
     * The key types to decode from the event, ignoring the map prefix. This is
     * passed to `dbKeyToKeysAdvanced`.
     *
     * Defaults to `string`, which is just one key.
     */
    input?: KeyInputType | KeyInputType[]
    /**
     * Transform the decoded keys and event into a string to use as the name.
     *
     * Defaults to concatenating the keys with a colon.
     */
    transform?: (keys: KeyInput[], event: ParsedWasmStateEvent) => string
  }
  /**
   * Override the default value generation.
   */
  getValue?: Transformer<V>['getValue']
}

export const makeTransformerForMap = <V = any>(
  codeIdsKeys: string[] | 'any',
  mapPrefix: string,
  keyPrefixOrPrefixes: string | string[],
  { namer: _namer, getValue }: TransformerForMapOptions<V> = {}
): Transformer<V> => {
  const namer = {
    input: [_namer?.input || 'string'].flat(),
    transform:
      _namer?.transform ||
      ((keys) =>
        keys
          .map((key) =>
            typeof key === 'number' ? BigInt(key).toString() : key
          )
          .join(':')),
  }

  const dbKeyPrefixes = [keyPrefixOrPrefixes]
    .flat()
    .map((key) => dbKeyForKeys(key, ''))

  return {
    filter: {
      codeIdsKeys,
      matches: (event) =>
        dbKeyPrefixes.some((prefix) => event.key.startsWith(prefix)),
    },
    name: (event) => {
      const key = namer.transform(
        dbKeyToKeysAdvanced(event.key, [
          // The map prefix is a string.
          'string',
          ...namer.input,
        ])
          // Ignore the decoded map namespace.
          .slice(1),
        event
      )
      return `${mapPrefix}:${key}`
    },
    getValue: getValue || defaultGetValue,
  }
}

/**
 * Transform Map<K, ()>, which is just efficient list storage with empty values,
 * to an actual list.
 */
export const makeTransformerForMapList = (
  codeIdsKeys: string[],
  name: string,
  mapKey: string
): Transformer<any[]> => {
  const prefix = dbKeyForKeys(mapKey, '')

  return {
    filter: {
      codeIdsKeys,
      matches: (event) => event.key.startsWith(prefix),
    },
    name,
    getValue: async (event, getLastValue) => {
      const value = (await getLastValue()) || []
      if (!Array.isArray(value)) {
        throw new Error(`Expected array, got ${typeof value}`)
      }

      const [, key] = dbKeyToKeys(event.key, [false, false])

      const curr = [...value]
      if (event.delete) {
        const index = curr.indexOf(key)
        if (index !== -1) {
          curr.splice(index, 1)
        }
      } else {
        curr.push(key)
      }

      return curr
    },
  }
}

/**
 * Transform a cw-storage-plus Snapshot.
 */
export const makeTransformerForSnapshot = ({
  codeIdsKeys,
  name,
  changelogKey,
  namer,
}: {
  /**
   * The code IDs to filter by.
   */
  codeIdsKeys: string[] | 'any'
  /**
   * The name of the transformation.
   */
  name: string
  /**
   * The key of the changelog.
   */
  changelogKey: string
} & Pick<TransformerForMapOptions, 'namer'>): Transformer =>
  makeTransformerForMap(codeIdsKeys, `${name}/changelog`, changelogKey, {
    namer: {
      // Detect additional numeric key at the end, which is the height.
      input: [...[namer?.input || 'string'].flat(), 'number'],
      transform:
        namer?.transform &&
        ((keys, event) =>
          // Transform just the keys provided by the custom namer.
          namer.transform!(keys.slice(0, -1), event) +
          // Add the height.
          ':' +
          BigInt(keys[keys.length - 1] as number).toString()),
    },
  })

/**
 * Transform a cw-storage-plus SnapshotItem.
 */
export const makeTransformersForSnapshotItem = ({
  codeIdsKeys,
  name,
  primaryKey,
  changelogKey,
}: {
  /**
   * The code IDs to filter by.
   */
  codeIdsKeys: string[]
  /**
   * The name of the transformation.
   */
  name: string
  /**
   * The primary key of the item.
   */
  primaryKey: string
  /**
   * The key of the changelog.
   */
  changelogKey: string
}): Transformer[] => {
  const primaryTransformer = makeTransformer(codeIdsKeys, name, primaryKey)

  const snapshotTransformer = makeTransformerForSnapshot({
    codeIdsKeys,
    name,
    changelogKey,
    namer: {
      // No additional map keys for snapshot item.
      input: [],
    },
  })

  return [primaryTransformer, snapshotTransformer]
}

/**
 * Transform a cw-storage-plus SnapshotMap.
 */
export const makeTransformersForSnapshotMap = ({
  codeIdsKeys,
  name,
  primaryKey,
  changelogKey,
  namer,
}: {
  /**
   * The code IDs to filter by.
   */
  codeIdsKeys: string[] | 'any'
  /**
   * The name of the transformation.
   */
  name: string
  /**
   * The primary key of the map.
   */
  primaryKey: string
  /**
   * The key of the changelog.
   */
  changelogKey: string
} & Pick<TransformerForMapOptions, 'namer'>): Transformer[] => {
  const primaryTransformer = makeTransformerForMap(
    codeIdsKeys,
    name,
    primaryKey,
    { namer }
  )

  const snapshotTransformer = makeTransformerForSnapshot({
    codeIdsKeys,
    name,
    changelogKey,
    namer,
  })

  return [primaryTransformer, snapshotTransformer]
}

/**
 * Transform a SnapshotVectorMap.
 */
export const makeTransformersForSnapshotVectorMap = ({
  codeIdsKeys,
  name,
  itemsKey,
  nextIdsKey,
  activePrimaryKey,
  activeChangelogKey,
  keyType = 'string',
}: {
  /**
   * The code IDs to filter by.
   */
  codeIdsKeys: string[] | 'any'
  /**
   * The name of the transformation.
   */
  name: string
  /**
   * The key of the items map.
   */
  itemsKey: string
  /**
   * The key of the next IDs map.
   */
  nextIdsKey: string
  /**
   * The key of the active SnapshotMap primary key.
   */
  activePrimaryKey: string
  /**
   * The key of the active SnapshotMap changelog.
   */
  activeChangelogKey: string
  /**
   * The type of the key. Defaults to `string`.
   */
  keyType?: KeyInputType
}): Transformer[] => {
  const itemsTransformer = makeTransformerForMap(
    codeIdsKeys,
    `${name}/items`,
    itemsKey,
    {
      namer: {
        input: [keyType, 'number'],
      },
    }
  )

  const nextIdsTransformer = makeTransformerForMap(
    codeIdsKeys,
    `${name}/nextIds`,
    nextIdsKey,
    {
      namer: {
        input: keyType,
      },
    }
  )

  const activeSnapshotMapTransformers = makeTransformersForSnapshotMap({
    codeIdsKeys,
    name: `${name}/active`,
    primaryKey: activePrimaryKey,
    changelogKey: activeChangelogKey,
    namer: {
      input: keyType,
    },
  })

  return [
    itemsTransformer,
    nextIdsTransformer,
    ...activeSnapshotMapTransformers,
  ]
}

/**
 * Transform a cw-wormhole Wormhole.
 */
export const makeTransformerForWormhole = ({
  codeIdsKeys,
  name,
  key,
  keyType = 'string',
}: {
  /**
   * The code IDs to filter by.
   */
  codeIdsKeys: string[] | 'any'
  /**
   * The name of the transformation.
   */
  name: string
  /**
   * The key of the wormhole map.
   */
  key: string
  /**
   * The type of the key. Defaults to `string`.
   */
  keyType?: KeyInputType
}): Transformer =>
  makeTransformerForMap(codeIdsKeys, name, key, {
    namer: {
      // Detect additional numeric key at the end, which is the timestamp.
      input: [keyType, 'number'],
    },
  })
