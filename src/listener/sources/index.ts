export * from './BankTransferEvent'
export * from './WasmEvent'
export * from './WasmInstantiateOrMigrate'

import { BankTransferEventDataSource } from './BankTransferEvent'
import { WasmEventDataSource } from './WasmEvent'
import { WasmInstantiateOrMigrateDataSource } from './WasmInstantiateOrMigrate'

const _getDataSources = () => [
  BankTransferEventDataSource,
  WasmEventDataSource,
  WasmInstantiateOrMigrateDataSource,
  // Add more data sources here.
]

export const getDataSources = () =>
  Object.fromEntries(
    _getDataSources().map((DataSource) => [DataSource.type, DataSource])
  )
