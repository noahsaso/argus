import { ConfigManager } from '@/config'
import { WasmCodeKey } from '@/db/models/WasmCodeKey'
import { WasmCodeKeyId } from '@/db/models/WasmCodeKeyId'
import { Config } from '@/types'

import { WasmCode } from './types'
import { WasmCodeAdapter } from './wasm-code.adapter'

/**
 * A service to manage wasm codes that are loaded from the DB. This is used by
 * various systems throughout the indexer, such as transformers that filter and
 * transform state events from specific contracts and webhooks that listen for
 * on-chain events from specific contracts.
 */
export class WasmCodeService implements WasmCodeAdapter {
  /**
   * Singleton instance.
   */
  private static _instance: WasmCodeService | undefined

  /**
   * Wasm codes that are always added to the list, even when wasm codes are
   * reloaded from the DB.
   */
  private defaultWasmCodes: WasmCode[] = []

  /**
   * List of all active wasm codes, including the defaults and those loaded from
   * the DB.
   */
  private _wasmCodes: WasmCode[] = []

  /**
   * Interval that updates the list of wasm codes from the DB.
   */
  private refreshInterval: NodeJS.Timeout | undefined

  private constructor(
    /**
     * Wasm codes from the config.
     */
    configWasmCodes: Config['codeIds']
  ) {
    this.setDefaultWasmCodes(configWasmCodes)
  }

  /**
   * Return whether or not the service is initialized.
   */
  static get isInitialized(): boolean {
    return !!this._instance
  }

  /**
   * Return the singleton created by the setUpInstance method, throwing an error
   * if not yet setup.
   */
  static get instance(): WasmCodeService {
    if (!this._instance) {
      throw new Error(
        'WasmCodeService not initialized because WasmCodeService.setUpInstance was never called'
      )
    }
    return this._instance
  }

  /**
   * Set up the wasm code service by loading defaults from the config and
   * optionally starting the DB updater.
   *
   * Creates a singleton that is returned if already setup.
   */
  static async setUpInstance({
    withUpdater = false,
  }: {
    /**
     * Whether or not to start the updater automatically. Defaults to false.
     */
    withUpdater?: boolean
  } = {}): Promise<WasmCodeService> {
    if (this._instance) {
      return this._instance
    }

    const config = ConfigManager.load()
    // Update default wasm codes when config changes.
    ConfigManager.instance.onChange((config) => {
      this._instance?.setDefaultWasmCodes(config.codeIds)
    })

    this._instance = new WasmCodeService(config.codeIds)
    if (withUpdater) {
      await this._instance.startUpdater()
    }

    return this._instance
  }

  /**
   * Parse wasm code keys from an arbitrary input.
   *
   * Used in CLI.
   */
  static extractWasmCodeKeys(input: any): string[] {
    if (!input || typeof input !== 'string') {
      return []
    }

    return input.split(',').map((key: string) => key.trim())
  }

  /**
   * Set default wasm codes and merge them into the existing list of wasm codes.
   */
  setDefaultWasmCodes(
    /**
     * Wasm codes from the config.
     */
    configWasmCodes: Config['codeIds']
  ): void {
    this.defaultWasmCodes = Object.entries(configWasmCodes || {}).flatMap(
      ([key, codeIds]) => (codeIds ? new WasmCode(key, codeIds) : [])
    )

    // Merge new default wasm codes into existing list.
    this.mergeWasmCodes(this.defaultWasmCodes, this._wasmCodes)
  }

  /**
   * Merge two lists of wasm codes.
   */
  private mergeWasmCodes(src: WasmCode[], dst: WasmCode[]): void {
    // Merge from src into dst.
    for (const { codeKey, codeIds } of src) {
      let existing = dst.find((code) => code.codeKey === codeKey)
      if (!existing) {
        existing = new WasmCode(codeKey, [])
        dst.push(existing)
      }

      // Add non-existent code ids.
      for (const codeId of codeIds) {
        if (!existing.codeIds.includes(codeId)) {
          existing.codeIds.push(codeId)
        }
      }
    }
  }

  /**
   * Manually add new wasm codes, storing them in the default list so they stick
   * around during DB updates.
   *
   * Used in tests.
   */
  addDefaultWasmCodes(...wasmCodes: WasmCode[]): void {
    // First store new wasm codes in default list so they stick around when the
    // DB updates.
    this.mergeWasmCodes(wasmCodes, this.defaultWasmCodes)
    // Then merge into existing list.
    this.mergeWasmCodes(wasmCodes, this._wasmCodes)
  }

  /**
   * Return a list of all wasm codes currently loaded.
   */
  get wasmCodes(): readonly WasmCode[] {
    return this._wasmCodes
  }

  /**
   * Return a sorted list of wasm codes with sorted IDs.
   */
  getWasmCodes(): WasmCode[] {
    return this._wasmCodes
      .map(
        (wasmCode: WasmCode) =>
          new WasmCode(wasmCode.codeKey, wasmCode.codeIds.sort())
      )
      .sort((a, b) => a.codeKey.localeCompare(b.codeKey))
  }

  /**
   * Return a map of code key to code IDs.
   */
  exportWasmCodes(): Record<string, number[]> {
    return Object.fromEntries(
      this._wasmCodes.map((wasmCode: WasmCode) => [
        wasmCode.codeKey,
        wasmCode.codeIds,
      ])
    )
  }

  /**
   * Find all code IDs for the list of keys.
   */
  findWasmCodeIdsByKeys(...keys: string[]): number[] {
    return keys.length === 0
      ? []
      : keys.flatMap(
          (key: string) =>
            this._wasmCodes.find(
              (wasmCode: WasmCode) => wasmCode.codeKey === key
            )?.codeIds ?? []
        )
  }

  /**
   * Find all keys that contain the given code ID.
   */
  findWasmCodeKeysById(codeId: number): string[] {
    return this._wasmCodes
      .filter((wasmCode: WasmCode) => wasmCode.codeIds.includes(codeId))
      .map((wasmCode: WasmCode) => wasmCode.codeKey)
  }

  /**
   * Whether or not the given code ID matches any of the given keys.
   */
  matchesWasmCodeKeys(codeId: number, ...keys: string[]): boolean {
    return this.findWasmCodeIdsByKeys(...keys).includes(codeId)
  }

  /**
   * Reload wasm codes from DB, preserving the default list and removing any
   * previously loaded from the DB that no longer exist.
   */
  async reloadWasmCodeIdsFromDB(): Promise<void> {
    const wasmCodesFromDB = await WasmCodeKey.findAllWithIds()

    const dbWasmCodes = wasmCodesFromDB.map(
      (wasmCodeKey: WasmCodeKey) =>
        new WasmCode(
          wasmCodeKey.codeKey,
          wasmCodeKey.codeKeyIds.map(
            (wasmCodeKeyId: WasmCodeKeyId) => wasmCodeKeyId.codeKeyId
          )
        )
    )

    // Reset to defaults.
    this._wasmCodes = [...this.defaultWasmCodes]

    // Merge DB codes into list with defaults.
    this.mergeWasmCodes(dbWasmCodes, this._wasmCodes)
  }

  /**
   * Start updating wasm codes from DB on a timer, if not already started.
   */
  async startUpdater(): Promise<void> {
    if (this.refreshInterval) {
      return
    }

    // Initial reload.
    await this.reloadWasmCodeIdsFromDB()

    // Start updater.
    this.refreshInterval = setInterval(async () => {
      try {
        await this.reloadWasmCodeIdsFromDB()
      } catch (error) {
        console.error('Failed to reload wasm code IDs from DB:', error)
      }
    }, 60 * 1000)
  }

  /**
   * Stop updating wasm codes from DB on a timer, if started.
   */
  stopUpdater(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = undefined
    }
  }
}
