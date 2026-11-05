import { Config } from '@/types'

/**
 * Build the set of contract addresses excluded from indexing by the
 * `excludedContractAddresses` config option. Matching is by exact address
 * only; other contracts with the same code ID are unaffected.
 *
 * An absent or empty option returns an empty set, leaving behavior unchanged.
 * A malformed option throws so that a typo cannot silently disable the
 * exclusion.
 */
export const getExcludedContractAddresses = (
  config: Pick<Config, 'excludedContractAddresses'>
): ReadonlySet<string> => {
  const addresses: unknown = config.excludedContractAddresses
  if (addresses === undefined || addresses === null) {
    return new Set()
  }

  if (
    !Array.isArray(addresses) ||
    addresses.some((address) => typeof address !== 'string' || !address)
  ) {
    throw new Error(
      'Invalid config: excludedContractAddresses must be an array of non-empty contract address strings.'
    )
  }

  return new Set(addresses)
}

/**
 * Whether the contract address is excluded from indexing by config.
 */
export const isContractAddressExcluded = (
  config: Pick<Config, 'excludedContractAddresses'>,
  address: string
): boolean => getExcludedContractAddresses(config).has(address)
