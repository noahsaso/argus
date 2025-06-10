import { ConfigManager } from '@/config'
import { State } from '@/db'
import { compute, getTypedFormula } from '@/formulas'

import { loadMeilisearch } from './client'
import { meilisearchIndexers } from './indexers'
import { getMeilisearchIndexName } from './utils'

type UpdateIndexesOptions = {
  /**
   * Filter by index ID.
   */
  index?: string
  /**
   * Batch size for updating indexes. Defaults to 100.
   */
  batchSize?: number
}

export const updateIndexes = async ({
  index: filterIndex,
  batchSize = 100,
}: UpdateIndexesOptions = {}): Promise<number> => {
  const config = ConfigManager.load()

  // If no meilisearch in config, nothing to update.
  if (!config.meilisearch) {
    return 0
  }

  const client = loadMeilisearch()

  // Update indexes with data from the latest block height.
  const state = await State.getSingleton()
  if (!state) {
    throw new Error('State not found while updating indexes')
  }

  let exported = 0

  for (const {
    id: indexId,
    index: indexName,
    getBulkUpdates,
  } of meilisearchIndexers) {
    // If no bulk updater, skip.
    if (!getBulkUpdates) {
      continue
    }

    // If filter index is provided and does not match, skip.
    if (filterIndex && filterIndex !== indexId) {
      continue
    }

    const index = client.index(getMeilisearchIndexName(state, indexName))

    // Get bulk updates.
    const updates = await getBulkUpdates()
    console.log(
      `[${indexId}] Found ${updates.length.toLocaleString()} updates. Computing...`
    )

    try {
      // Compute updates in batches.
      for (let i = 0; i < updates.length; i += batchSize) {
        const documents = await Promise.all(
          updates
            .slice(i, i + batchSize)
            .map(
              async ({
                id,
                formula: { type, name, targetAddress, args = {} },
              }) => {
                const typedFormula = getTypedFormula(type, name)
                const { block, value } = await compute({
                  chainId: state.chainId,
                  targetAddress,
                  args,
                  block: state.latestBlock,
                  ...typedFormula,
                })

                return {
                  id,
                  block: block && {
                    height: Number(block.height),
                    timeUnixMs: Number(block.timeUnixMs),
                  },
                  value,
                }
              }
            )
        )

        console.log(
          `[${indexId}] Finished computing ${Math.min(
            i + batchSize,
            updates.length
          ).toLocaleString()}/${updates.length.toLocaleString()} updates...`
        )

        await index.addDocuments(documents)
        exported += documents.length
      }
    } catch (err) {
      console.error(`Error updating index ${indexId}:`, err)
    }
  }

  return exported
}
