import { Options as PusherOptions } from 'pusher'
import { SequelizeOptions } from 'sequelize-typescript'

export type DB = { uri?: string } & Pick<
  SequelizeOptions,
  | 'dialect'
  | 'dialectModulePath'
  | 'dialectOptions'
  | 'storage'
  | 'database'
  | 'username'
  | 'password'
  | 'host'
  | 'port'
  | 'ssl'
  | 'protocol'
  | 'pool'
  | 'schema'
  | 'logging'
  | 'retry'
>

export type Config = {
  home: string
  rpc: string
  bech32Prefix: string
  db: {
    data: DB
    accounts: DB
  }
  redis?: {
    host?: string
    port?: number | string
    password: string
  }
  meilisearch?: {
    host: string
    apiKey?: string
  }
  ignoreApiKey?: boolean

  /**
   * Map some arbitary string to a list of code IDs.
   * @deprecated Use WasmCodeService to access code IDs.
   */
  codeIds?: Partial<Record<string, number[]>>

  // If present, sets up Sentry error reporting.
  sentryDsn?: string
  // Payment info.
  payment?: {
    // cw-receipt contract address where payments are tracked
    cwReceiptAddress: string
    // cw-receipt webhook secret
    cwReceiptWebhookSecret: string
    // native denom accepted for payments
    nativeDenomAccepted: string
    // Value to scale the payment amount by to get the credit amount. If 1 $USDC
    // is sent, since $USDC has 6 decimals, the payment amount will be 1e6. To
    // give 1e4 credits, the scale factor would be 0.01 (1e-2), since 1e6 * 1e-2
    // = 1e4.
    creditScaleFactor: number
  }
  // WebSockets Soketi server.
  soketi?: PusherOptions
  // Accounts server JWT secret.
  accountsJwtSecret?: string
  // Indexer exporter dashboard password.
  exporterDashboardPassword?: string

  // Other config options.
  [key: string]: any
}
