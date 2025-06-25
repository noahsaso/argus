import { WasmCodeTracker } from '@/types'

/**
 * Track the `kujira-fin` contract.
 */
export const kujiraFin: WasmCodeTracker = {
  chainId: 'kaiyo-1',
  codeKey: 'kujira-fin',
  stateKeys: [
    {
      key: 'contract_info',
      partialValue: '"crates.io:kujira-fin"',
    },
  ],
}
