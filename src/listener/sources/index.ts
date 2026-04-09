export * from './IndexedWasmEvent'
export * from './StargateMessage'
export * from './WasmEvent'
export * from './WasmInstantiateOrMigrate'

import { IndexedWasmEventDataSource } from './IndexedWasmEvent'
import { StargateMessageDataSource } from './StargateMessage'
import { WasmEventDataSource } from './WasmEvent'
import { WasmInstantiateOrMigrateDataSource } from './WasmInstantiateOrMigrate'

const _getDataSources = () => [
  IndexedWasmEventDataSource,
  StargateMessageDataSource,
  WasmEventDataSource,
  WasmInstantiateOrMigrateDataSource,
  // Add more data sources here.
]

export const getDataSources = () =>
  Object.fromEntries(
    _getDataSources().map((DataSource) => [DataSource.type, DataSource])
  )
