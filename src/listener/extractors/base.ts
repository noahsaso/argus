import { Extraction } from '@/db'
import {
  DependableEventModel,
  ExtractorData,
  ExtractorDataSource,
  ExtractorEnv,
  ExtractorHandler,
} from '@/types'

export abstract class Extractor {
  /**
   * The unique identifier for the data source type.
   */
  static get type(): string {
    throw new Error('Not implemented')
  }

  /**
   * The data sources for the extractor.
   */
  abstract sources: ExtractorDataSource[]

  /**
   * The environment for the extractor.
   */
  public readonly env: ExtractorEnv

  constructor(env: ExtractorEnv) {
    this.env = env
  }

  /**
   * The function that extracts data that's been matched by data sources.
   */
  async extract(data: ExtractorData[]): Promise<DependableEventModel[]> {
    return (
      await Promise.all(
        data.map(async ({ type, data }) => {
          // Find the source for this data.
          const source = this.sources.find((s) => s.type === type)
          if (!source) {
            throw new Error(`Source ${type} not found.`)
          }

          // Find the handler for this data.
          const handler =
            source.handler in this
              ? (this[
                  source.handler as keyof Extractor
                ] as unknown as ExtractorHandler)
              : undefined

          // Ensure the handler is a function.
          if (!handler || typeof handler !== 'function') {
            throw new Error(`Handler function ${source.handler} not found.`)
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

  /**
   * The optional function to sync extractions.
   */
  _sync?(): Promise<ExtractorData[]>
}
