import { WasmCodeTracker } from '@/types'

export const osmosisLevanaMarket: WasmCodeTracker = {
  chainId: 'osmosis-1',
  codeKey: 'levana-finance',
  stateKeys: [
    {
      key: 'contract_info',
      partialValue: '"contract":"levana.finance',
    },
  ],
}

export const osmosisClVault: WasmCodeTracker = {
  chainId: 'osmosis-1',
  codeKey: 'cl-vault',
  stateKeys: [
    {
      key: 'contract_info',
      partialValue: '"crates.io:cl-vault"',
    },
  ],
}

export const osmosisIcnsResolver: WasmCodeTracker = {
  chainId: 'osmosis-1',
  codeKey: 'icns-resolver',
  stateKeys: [
    {
      key: 'contract_info',
      partialValue: '"crates.io:icns-resolver"',
    },
  ],
}

export const osmosisSkipApiIbcAdapterIbcHooks: WasmCodeTracker = {
  chainId: 'osmosis-1',
  codeKey: 'skip-api',
  stateKeys: [
    {
      key: 'contract_info',
      partialValue: '"contract":"skip-api-',
    },
  ],
}

export const osmosisCalcDca: WasmCodeTracker = {
  chainId: 'osmosis-1',
  codeKey: 'calc-dca',
  stateKeys: [
    {
      key: 'contract_info',
      partialValue: '"crates.io:calc-dca"',
    },
  ],
}

export const osmosisRateLimiter: WasmCodeTracker = {
  chainId: 'osmosis-1',
  codeKey: 'rate-limiter',
  stateKeys: [
    {
      key: 'contract_info',
      partialValue: '"crates.io:rate-limiter"',
    },
  ],
}
