import { ConfigManager } from '@/config'
import { State } from '@/db'

import { loadMeilisearch } from './client'
import { meilisearchIndexers } from './indexers'
import { getMeilisearchIndexName } from './utils'

export const setupMeilisearch = async () => {
  const { meilisearch } = ConfigManager.load()

  // If no meilisearch in config, nothing to setup.
  if (!meilisearch) {
    return
  }

  const state = await State.getSingleton()
  if (!state) {
    throw new Error('State not found.')
  }

  const client = await loadMeilisearch()

  // Ensure indexes exist and are up to date with their config.
  for (const {
    index,
    filterableAttributes,
    sortableAttributes,
  } of meilisearchIndexers) {
    const indexName = getMeilisearchIndexName(state, index)

    // Find or create index, and make sure its primary key is `id`.
    try {
      const clientIndex = await client.getIndex(indexName)
      if (clientIndex.primaryKey !== 'id') {
        await clientIndex.update({
          primaryKey: 'id',
        })
      }
    } catch {
      await client.createIndex(indexName, {
        primaryKey: 'id',
      })
    }

    // Update index filterable and sortable attributes.
    const clientIndex = client.index(indexName)
    await clientIndex.updateFilterableAttributes([
      'id',
      'value',
      ...(filterableAttributes || []),
    ])
    await clientIndex.updateSortableAttributes([
      'block.height',
      'block.timeUnixMs',
      ...(sortableAttributes || []),
    ])
  }
}
