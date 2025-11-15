export * from './FeegrantEvent'
export * from './WasmEvent'
export * from './WasmInstantiateOrMigrate'

import { FeegrantEventDataSource } from './FeegrantEvent'
import { WasmEventDataSource } from './WasmEvent'
import { WasmInstantiateOrMigrateDataSource } from './WasmInstantiateOrMigrate'

const _getDataSources = () => [
  WasmEventDataSource,
  WasmInstantiateOrMigrateDataSource,
  FeegrantEventDataSource,
  // Add more data sources here.
]

export const getDataSources = () =>
  Object.fromEntries(
    _getDataSources().map((DataSource) => [DataSource.type, DataSource])
  )
