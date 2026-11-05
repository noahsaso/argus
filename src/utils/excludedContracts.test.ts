import { describe, expect, it } from 'vitest'

import {
  getExcludedContractAddresses,
  isContractAddressExcluded,
} from './excludedContracts'

describe('getExcludedContractAddresses', () => {
  it('returns an empty set when the option is absent or empty', () => {
    expect(getExcludedContractAddresses({}).size).toBe(0)
    expect(
      getExcludedContractAddresses({ excludedContractAddresses: [] }).size
    ).toBe(0)
  })

  it('returns the configured addresses', () => {
    expect([
      ...getExcludedContractAddresses({
        excludedContractAddresses: ['juno1a', 'juno1b'],
      }),
    ]).toEqual(['juno1a', 'juno1b'])
  })

  it('throws on a malformed option instead of silently ignoring it', () => {
    expect(() =>
      getExcludedContractAddresses({
        excludedContractAddresses: 'juno1a' as any,
      })
    ).toThrow(/excludedContractAddresses/)
    expect(() =>
      getExcludedContractAddresses({
        excludedContractAddresses: ['juno1a', ''],
      })
    ).toThrow(/excludedContractAddresses/)
  })
})

describe('isContractAddressExcluded', () => {
  it('matches exact addresses only', () => {
    const config = { excludedContractAddresses: ['juno1a'] }
    expect(isContractAddressExcluded(config, 'juno1a')).toBe(true)
    expect(isContractAddressExcluded(config, 'juno1b')).toBe(false)
    expect(isContractAddressExcluded(config, 'JUNO1A')).toBe(false)
    expect(isContractAddressExcluded({}, 'juno1a')).toBe(false)
  })
})
