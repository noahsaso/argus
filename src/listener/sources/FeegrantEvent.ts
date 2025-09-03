import type {
  DataSourceData,
  ExtractableTxInput,
  ExtractorDataSource,
  ExtractorHandleableData,
} from '@/types'

import { DataSource } from './base'

export type FeegrantEventDataSourceConfig = {
  /**
   * The feegrant action to match.
   */
  action: 'set_feegrant' | 'revoke_feegrant' | 'use_feegrant' | 'prune_feegrant'
  /**
   * Optional granter address to filter by.
   */
  granter?: string
  /**
   * Optional grantee address to filter by.
   */
  grantee?: string
}

export type FeegrantEventData = {
  /**
   * The feegrant action that was matched.
   */
  action: string
  /**
   * The address of the granter (when applicable).
   */
  granter?: string
  /**
   * The address of the grantee (when applicable).
   */
  grantee?: string
  /**
   * The address of the pruner (for prune events).
   */
  pruner?: string
  /**
   * A map of attribute key to all values (since there can be multiple values
   * for the same key).
   */
  attributes: Partial<Record<string, string[]>>
  /**
   * The attributes of the event.
   */
  _attributes: {
    /**
     * The key of the attribute.
     */
    key: string
    /**
     * The value of the attribute.
     */
    value: string
  }[]
}

export class FeegrantEventDataSource extends DataSource<
  FeegrantEventDataSourceConfig,
  FeegrantEventData
> {
  static get type(): string {
    return 'feegrant/event'
  }

  static source(
    handler: string,
    config: FeegrantEventDataSourceConfig
  ): ExtractorDataSource<FeegrantEventDataSourceConfig> {
    return {
      type: this.type,
      handler,
      config,
    }
  }

  static handleable(
    handler: string,
    data: FeegrantEventData
  ): ExtractorHandleableData<FeegrantEventData> {
    return {
      source: this.type,
      handler,
      data,
    }
  }

  static data(
    data: Omit<FeegrantEventData, 'attributes'>
  ): DataSourceData<FeegrantEventData> {
    return {
      source: this.type,
      data: {
        ...data,
        attributes: data._attributes.reduce(
          (acc, { key, value }) => ({
            ...acc,
            [key]: [...(acc[key] || []), value],
          }),
          {} as Record<string, string[]>
        ),
      },
    }
  }

  match({ events }: ExtractableTxInput): FeegrantEventData[] {
    return events.flatMap(({ type, attributes }) => {
      // Feegrant events are message type events
      if (type !== 'message') {
        return []
      }

      // Find the action attribute
      const actionAttr = attributes.find(({ key }) => key === 'action')
      if (!actionAttr || actionAttr.value !== this.config.action) {
        return []
      }

      // Extract relevant addresses based on action type
      const granterAttr = attributes.find(({ key }) => key === 'granter')
      const granteeAttr = attributes.find(({ key }) => key === 'grantee')
      const prunerAttr = attributes.find(({ key }) => key === 'pruner')

      // Apply optional filters
      if (this.config.granter && granterAttr?.value !== this.config.granter) {
        return []
      }
      if (this.config.grantee && granteeAttr?.value !== this.config.grantee) {
        return []
      }

      // Build the event data
      const eventData: FeegrantEventData = {
        action: actionAttr.value,
        granter: granterAttr?.value,
        grantee: granteeAttr?.value,
        pruner: prunerAttr?.value,
        attributes: attributes.reduce(
          (acc, { key, value }) => ({
            ...acc,
            [key]: [...(acc[key] || []), value],
          }),
          {} as Record<string, string[]>
        ),
        _attributes: [...attributes],
      }

      return [eventData]
    })
  }

  isOurData(data: FeegrantEventData): boolean {
    // Check if the action matches
    if (data.action !== this.config.action) {
      return false
    }

    // Check optional filters
    if (this.config.granter && data.granter !== this.config.granter) {
      return false
    }
    if (this.config.grantee && data.grantee !== this.config.grantee) {
      return false
    }

    return true
  }
}
