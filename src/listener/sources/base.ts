import { ExtractorMatchInput } from '@/types'

export abstract class DataSource<
  /**
   * The config for the data source that defines its behavior.
   */
  Config extends Record<string, unknown> = Record<string, unknown>,
  /**
   * The data for the data source that is extracted.
   */
  Data extends Record<string, unknown> = Record<string, unknown>
> {
  /**
   * The unique identifier for the data source type.
   */
  static get type(): string {
    throw new Error('Not implemented')
  }

  /**
   * The config for the data source that defines its behavior.
   */
  public readonly config: Config

  constructor(config: Config) {
    this.config = config
  }

  /**
   * The function called with each TX to match and extract relevant data.
   */
  abstract match(input: ExtractorMatchInput): Data[]
}
