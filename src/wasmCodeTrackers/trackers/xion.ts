import { WasmCodeTracker } from '@/types'

export const xionTreasury: WasmCodeTracker = {
  chainId: ['xion-mainnet-1', 'xion-testnet-2'],
  codeKey: 'xion-treasury',
  stateKeys: [
    {
      key: 'contract_info',
      partialValue: '"contract":"treasury"',
    },
  ],
}
