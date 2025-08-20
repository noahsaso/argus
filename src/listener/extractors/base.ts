import { Extraction } from '@/db'
import {
  DataSourceData,
  DependableEventModel,
  ExtractableTxInput,
  ExtractorDataSource,
  ExtractorEnv,
  ExtractorHandleableData,
  ExtractorHandler,
  ExtractorSyncEnv,
} from '@/types'

import { getDataSources } from '../sources'

export abstract class Extractor {
  /**
   * The unique identifier for the extractor.
   */
  static type: string

  /**
   * The data sources for the extractor.
   */
  static sources: ExtractorDataSource[]

  /**
   * An optional function to sync extractions in order to backfill data.
   */
  static sync?(
    env: ExtractorSyncEnv
  ): AsyncGenerator<DataSourceData, void, undefined>

  /**
   * The environment for the extractor.
   */
  public readonly env: ExtractorEnv

  constructor(env: ExtractorEnv) {
    this.env = env
  }

  /**
   * The unique identifier for the extractor type (accessible on instances).
   */
  get type(): string {
    return (this.constructor as typeof Extractor).type
  }

  /**
   * The data sources for the extractor (accessible on instances).
   */
  get sources(): ExtractorDataSource[] {
    return (this.constructor as typeof Extractor).sources
  }

  /**
   * A function that uses data sources to filter an input and produce data
   * that's ready to be passed to a handler.
   */
  static match(input: ExtractableTxInput): ExtractorHandleableData[] {
    const availableDataSources = getDataSources()
    return this.sources.flatMap(({ type, handler, config }) => {
      const Source = availableDataSources[type]
      if (!Source) {
        throw new Error(`Source ${type} not found.`)
      }

      const source = new Source(config as any)
      return source.match(input).map((data) => ({
        source: type,
        handler,
        data,
      }))
    })
  }

  /**
   * A function that checks if data source data can be handled by this extractor
   * and returns data that's ready to be passed to a handler.
   */
  static sourceMatch(data: DataSourceData): ExtractorHandleableData[] {
    const availableDataSources = getDataSources()
    return this.sources.flatMap(({ type, handler, config }) => {
      if (type !== data.source) {
        return []
      }

      const Source = availableDataSources[type]
      if (!Source) {
        throw new Error(`Source ${type} not found.`)
      }

      const source = new Source(config as any)
      return source.isOurData(data.data as any)
        ? {
            source: type,
            handler,
            data: data.data,
          }
        : []
    })
  }

  /**
   * A function that extracts data that's been matched by data sources by
   * calling the handler functions for each matched data.
   */
  async extract(
    data: ExtractorHandleableData[]
  ): Promise<DependableEventModel[]> {
    return (
      await Promise.all(
        data.map(async ({ handler: _handler, data }) => {
          // Find the handler for this data.
          const handler =
            _handler in this
              ? (this[
                  _handler as keyof Extractor
                ] as unknown as ExtractorHandler)
              : undefined

          // Ensure the handler is a function.
          if (!handler || typeof handler !== 'function') {
            throw new Error(`Handler function ${_handler} not found.`)
          }

          // Call the handler and save the output extractions.
          const extractions = await handler(data)

          return Extraction.bulkCreate(
            extractions.map((extraction) => ({
              ...extraction,
              blockHeight: this.env.block.height,
              blockTimeUnixMs: this.env.block.timeUnixMs,
              txHash: this.env.txHash,
            })),
            {
              updateOnDuplicate: ['blockTimeUnixMs', 'txHash', 'data'],
              conflictAttributes: ['address', 'name', 'blockHeight'],
              returning: true,
            }
          )
        })
      )
    ).flat()
  }
}
