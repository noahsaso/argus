import * as Sentry from '@sentry/node'
import { Op, Sequelize } from 'sequelize'

import { WasmCodeKey, WasmStateEvent } from '@/db'
import { WasmCodeService } from '@/services'
import {
  ParsedWasmStateEvent,
  ProcessedWasmCodeTracker,
  WasmCodeTracker,
} from '@/types'
import { dbKeyForKeys } from '@/utils'

import * as trackers from './trackers'

/**
 * Track contracts and save their code IDs to a specified wasm code key in the
 * DB when they are migrated so that other contracts are automatically detected.
 */
export class WasmCodeTrackerManager {
  /**
   * Processed wasm code trackers for the current chain.
   */
  public readonly trackers: ProcessedWasmCodeTracker[]

  /**
   * Process a wasm code tracker.
   * @param tracker The wasm code tracker to process.
   * @returns The processed wasm code tracker.
   */
  private static processWasmCodeTracker(
    tracker: WasmCodeTracker
  ): ProcessedWasmCodeTracker {
    const { contractAddresses, stateKeys } = tracker

    return {
      ...tracker,
      contractAddresses: contractAddresses || new Set(),
      stateKeys:
        stateKeys?.map(({ key, ...rest }) => ({
          dbKey: dbKeyForKeys(...[key].flat()),
          ...rest,
        })) || [],
    }
  }

  constructor(public readonly chainId: string) {
    this.trackers = Object.values(trackers)
      .flat()
      .filter((t) => [t.chainId].flat().includes(chainId))
      .map(WasmCodeTrackerManager.processWasmCodeTracker)
  }

  /**
   * Whether or not the current chain has any wasm code trackers.
   */
  get hasTrackers(): boolean {
    return this.trackers.length > 0
  }

  /**
   * Get all tracked state events for the given contract addresses.
   * @param contractAddresses The contract addresses to get tracked state events
   * for. If not provided, all tracked state events will be returned.
   * @param stateEventUpdates State event updates that may contain state keys to
   * track.
   * @returns All tracked state events for the given contract addresses.
   */
  async getTrackedStateEvents(
    contractAddresses?: string[],
    stateEventUpdates?: Pick<
      ParsedWasmStateEvent,
      'contractAddress' | 'key' | 'value' | 'delete'
    >[]
  ): Promise<
    {
      contractAddress: string
      key: string
      value: string
    }[]
  > {
    if (!this.hasTrackers) {
      return []
    }

    const exactKeys = this.trackers.flatMap(({ stateKeys }) =>
      stateKeys.flatMap((filter) => ('value' in filter ? filter : []))
    )
    const partialKeys = this.trackers.flatMap(({ stateKeys }) =>
      stateKeys.flatMap((filter) => ('partialValue' in filter ? filter : []))
    )

    // Get the latest state events for the given contract addresses.
    const stateEvents = await WasmStateEvent.findAll({
      attributes: [
        // DISTINCT ON is not directly supported by Sequelize, so we need to
        // cast to unknown and back to string to insert this at the beginning of
        // the query. This ensures we use the most recent version of the key.
        Sequelize.literal(
          'DISTINCT ON("contractAddress", "key") \'\''
        ) as unknown as string,
        // Include `id` so that Sequelize doesn't prepend it to the query before
        // the DISTINCT ON, which must come first.
        'id',
        'key',
        'contractAddress',
        'value',
      ],
      where: {
        [Op.and]: [
          ...(contractAddresses
            ? [{ contractAddress: contractAddresses }]
            : []),
          { delete: false },
          {
            [Op.or]: [
              ...exactKeys.map(({ dbKey, value }) => ({
                key: dbKey,
                value,
              })),
              ...partialKeys.map(({ dbKey, partialValue }) => ({
                key: dbKey,
                value: {
                  [Op.like]: `%${partialValue}%`,
                },
              })),
            ],
          },
        ],
      },
      order: [
        // Needs to be first so we can use DISTINCT ON.
        ['contractAddress', 'ASC'],
        ['key', 'ASC'],
        ['blockHeight', 'DESC'],
      ],
    })

    const relevantStateEventUpdates =
      stateEventUpdates?.filter(
        ({ contractAddress, key, value, delete: deleted }) =>
          !deleted &&
          (!contractAddresses || contractAddresses.includes(contractAddress)) &&
          (exactKeys.some(
            ({ dbKey, value: exactValue }) =>
              dbKey === key && exactValue === value
          ) ||
            partialKeys.some(
              ({ dbKey, partialValue }) =>
                dbKey === key && value.includes(partialValue)
            ))
      ) || []

    return [...stateEvents, ...relevantStateEventUpdates]
  }

  /**
   * Attempt to track codes for the given contract update events, optionally
   * using wasm state events to pull state keys.
   * @param contracts The contract update events to attempt to track codes for.
   * @param stateEventUpdates State event updates that may contain state keys to
   * track.
   */
  async trackCodes(
    contracts: {
      address: string
      codeId: number
    }[],
    stateEventUpdates?: Pick<
      ParsedWasmStateEvent,
      'contractAddress' | 'key' | 'value' | 'delete'
    >[]
  ): Promise<void> {
    if (!this.hasTrackers) {
      return
    }

    // Get all tracked state events for the contracts that are being
    // exported.
    const trackedStateEvents = await this.getTrackedStateEvents(
      contracts.map(({ address }) => address),
      stateEventUpdates
    )

    let updatedCodeKey = false
    await Promise.all(
      contracts.flatMap(({ address, codeId }) => {
        const trackers = this.trackers.filter(
          (t) =>
            t.contractAddresses.has(address) ||
            t.stateKeys.some(({ dbKey, ...trackerFilter }) =>
              trackedStateEvents.some(
                (wasmState) =>
                  wasmState.contractAddress === address &&
                  wasmState.key === dbKey &&
                  ('value' in trackerFilter
                    ? wasmState.value === trackerFilter.value
                    : wasmState.value.includes(trackerFilter.partialValue))
              )
            )
        )

        if (!trackers.length) {
          return []
        }

        return trackers.map(async ({ codeKey }) => {
          try {
            await WasmCodeKey.createFromKeyAndIds(codeKey, codeId)
            updatedCodeKey = true
          } catch (err) {
            // Capture failures and move on.
            console.error(
              `Failed to save tracked wasm code for ${address} with code ID ${codeId} and code key ${codeKey}:`,
              err
            )
            Sentry.captureException(err, {
              tags: {
                type: 'failed-save-tracked-wasm-code',
                script: 'export',
                handler: 'wasm',
                chainId: this.chainId,
                codeKey,
                address,
                codeId,
              },
            })
          }
        })
      })
    )

    // Update service if any code keys were updated and the service is
    // initialized.
    if (WasmCodeService.isInitialized && updatedCodeKey) {
      await WasmCodeService.getInstance().reloadWasmCodeIdsFromDB()
    }
  }
}
