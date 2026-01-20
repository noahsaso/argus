import { Contract } from '@/db'
import { WasmCodeService } from '@/services'
import {
  DataSourceData,
  ExtractorDataSource,
  ExtractorHandler,
  ExtractorHandlerOutput,
  ExtractorSyncEnv,
} from '@/types'
import { getContractInfo } from '@/utils'

import {
  WasmEventData,
  WasmEventDataSource,
  WasmInstantiateOrMigrateData,
  WasmInstantiateOrMigrateDataSource,
} from '../../sources'
import { Extractor } from '../base'

const CODE_IDS_KEYS = ['xion-marketplace']

export class XionMarketplaceExtractor extends Extractor {
  static type = 'xion-marketplace'

  static sources: ExtractorDataSource[] = [
    // Track contract instantiation
    WasmInstantiateOrMigrateDataSource.source('instantiate', {
      type: 'instantiate',
      codeIdsKeys: CODE_IDS_KEYS,
    }),
    // Track all known wasm events with action attribute
    WasmEventDataSource.source('allEvents', {
      key: 'action',
      value: [
        // Marketplace contract actions (from contracts/marketplace/src/execute.rs)
        // Listing events
        'list-item',
        'cancel-listing',
        // Sale events
        'item-sold',
        // Pending sale events (approval queue)
        'pending-sale-created',
        'sale-approved',
        'sale-rejected',
        // Offer events
        'create-offer',
        'cancel-offer',
        // Collection offer events
        'create-collection-offer',
        'cancel-collection-offer',
        // Config events
        'update-config',
      ],
    }),
  ]

  // Handler for contract instantiation
  protected instantiate: ExtractorHandler<WasmInstantiateOrMigrateData> = ({
    address,
  }) => this.saveConfig(address)

  // Handler for ALL wasm events
  protected allEvents: ExtractorHandler<WasmEventData> = ({
    address,
    attributes,
  }) => this.saveEvent(address, attributes)

  /**
   * Save marketplace config
   */
  private async saveConfig(address: string): Promise<ExtractorHandlerOutput[]> {
    const contract = await getContractInfo({
      client: this.env.autoCosmWasmClient,
      address,
    })

    const client = await this.env.autoCosmWasmClient.getValidClient()

    // Only process if it's a marketplace contract
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        contract.codeId,
        ...CODE_IDS_KEYS
      )
    ) {
      return []
    }

    // Query the config from the contract
    let config
    try {
      config = await client.queryContractSmart(address, { config: {} })
    } catch {
      config = null
    }

    // Ensure contract exists in the DB
    await Contract.upsert(
      {
        address: contract.address,
        codeId: contract.codeId,
        admin: contract.admin,
        creator: contract.creator,
        label: contract.label,
        txHash: this.env.txHash,
      },
      {
        fields: ['codeId', 'admin', 'creator', 'label'],
        returning: false,
      }
    )

    return [
      {
        address: contract.address,
        name: 'marketplace/config',
        data: config || {
          codeId: contract.codeId,
          admin: contract.admin,
          creator: contract.creator,
          label: contract.label,
        },
      },
    ]
  }

  /**
   * Save ALL wasm events from marketplace contracts
   */
  private async saveEvent(
    address: string,
    attributes: Partial<Record<string, string[]>>
  ): Promise<ExtractorHandlerOutput[]> {
    const contract = await getContractInfo({
      client: this.env.autoCosmWasmClient,
      address,
    })

    // Only process if it's a marketplace contract
    if (
      !WasmCodeService.instance.matchesWasmCodeKeys(
        contract.codeId,
        ...CODE_IDS_KEYS
      )
    ) {
      return []
    }

    const action = attributes.action?.[0]
    if (!action) {
      return []
    }

    // Convert attributes to a flat object (take first value of each key)
    const flatAttributes: Record<string, string> = {}
    for (const [key, values] of Object.entries(attributes)) {
      if (values && values.length > 0) {
        flatAttributes[key] = values[0]
      }
    }

    // Create extraction name based on action
    const extractionName = `marketplace/${action}`

    return [
      {
        address,
        name: extractionName,
        data: {
          ...flatAttributes,
          blockHeight: this.env.block.height,
          blockTimeUnixMs: this.env.block.timeUnixMs,
          txHash: this.env.txHash,
        },
      },
    ]
  }

  /**
   * Sync historical data from existing contracts
   */
  static async *sync({
    autoCosmWasmClient,
  }: ExtractorSyncEnv): AsyncGenerator<DataSourceData, void, undefined> {
    const client = await autoCosmWasmClient.getValidClient()

    const marketplaceCodeIds = WasmCodeService.instance.findWasmCodeIdsByKeys(
      ...CODE_IDS_KEYS
    )

    if (marketplaceCodeIds.length === 0) {
      return
    }

    for (const codeId of marketplaceCodeIds) {
      let contracts: readonly string[]
      try {
        contracts = await client.getContracts(codeId)
      } catch {
        continue
      }

      if (contracts.length === 0) {
        continue
      }

      // Yield instantiate for each contract to get config
      yield* contracts.map((address) =>
        WasmInstantiateOrMigrateDataSource.data({
          type: 'instantiate',
          address,
          codeId,
          codeIdsKeys: CODE_IDS_KEYS,
        })
      )

      // Note: The marketplace contract has limited query methods.
      // It only has individual query methods (Config, Listing, Offer, etc.)
      // and no list methods to query all listings/offers.
      // Historical backfill for listings/offers would need to come from
      // event history via the RPC or from the asset contracts directly.
    }
  }
}
