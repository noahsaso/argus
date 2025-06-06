import { ContractFormula } from '@/types'

import { ContractInfo } from '../types'
import { makeSimpleContractFormula } from '../utils'

export const info: ContractFormula<ContractInfo> = {
  docs: {
    description: 'retrieves the contract info (name and version)',
  },
  compute: async ({ contractAddress, getTransformationMatch, get }) => {
    const info =
      (await getTransformationMatch<ContractInfo>(contractAddress, 'info'))
        ?.value || (await get(contractAddress, 'contract_info'))

    if (!info) {
      throw new Error(`no contract info found for ${contractAddress}`)
    }

    return info
  },
}

/**
 * Retrieves the wasm-level contract admin. If data not yet indexed, returns
 * undefined. A no-admin setting is serialized as an empty string.
 */
export const contractAdmin: ContractFormula<string | undefined> = {
  docs: {
    description: 'retrieves the wasm-level contract admin',
  },
  compute: async ({ contractAddress, getContract }) => {
    const contract = await getContract(contractAddress)
    if (!contract) {
      throw new Error('contract not yet indexed')
    }
    return contract.admin ?? undefined
  },
}

// cw-ownable
export const ownership = makeSimpleContractFormula({
  docs: {
    description:
      'retrieves the contract ownership defined by the cw-ownable crate',
  },
  transformation: 'ownership',
  fallbackKeys: ['ownership'],
})

export const instantiatedAt: ContractFormula<string> = {
  docs: {
    description: 'retrieves the contract instantiation timestamp',
  },
  compute: async ({ contractAddress, getContract }) => {
    const timestamp = (
      await getContract(contractAddress)
    )?.instantiatedAt.timestamp.toISOString()

    if (!timestamp) {
      throw new Error('contract not yet indexed')
    }

    return timestamp
  },
}

// Access any state item. This is either a top-level item or an item
// found as a value in a map. To access an item in a map, use
// keys="map_namespace":"key_in_map" or keys="map_namespace":1 depending on the
// type of the key.
export const item: ContractFormula<any, { key: string; keys: string }> = {
  docs: {
    description:
      'retrieves a value stored in the contract state at the given key',
    args: [
      {
        name: 'key',
        description: '`Item` key to retrieve',
        required: false,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'keys',
        description:
          '`Map` key to retrieve (by joining JSON-stringified keys with a colon)',
        required: false,
        schema: {
          type: 'string',
        },
        examples: {
          simple: {
            summary: 'access a string-keyed map',
            value: '"map_namespace":"key_in_map"',
          },
          numeric: {
            summary: 'access a numeric-keyed map',
            value: '"map_namespace":1',
          },
          tuple: {
            summary: 'access a map with a tuple key',
            value: '"map_namespace":"address":1:"another_key"',
          },
        },
      },
    ],
  },
  compute: async ({ contractAddress, get, args: { key, keys } }) => {
    if (key) {
      return await get(contractAddress, key)
    }

    if (keys) {
      const parsedKeys = keys.split(':').map((value) => JSON.parse(value))
      if (
        parsedKeys.some(
          (value) => typeof value !== 'string' && typeof value !== 'number'
        )
      ) {
        throw new Error(
          'keys must be a string of colon-separated values of type string (wrapped in quotes) or number. example: keys="a_string":1'
        )
      }

      return await get(contractAddress, ...parsedKeys)
    }

    throw new Error('missing key or keys')
  },
}

// Access any state map.
export const map: ContractFormula<
  any,
  { key: string; keys: string; numeric: string }
> = {
  docs: {
    description:
      'retrieves a map stored in the contract state at the given key. if the map has a tuple key, you can access the map at any degree by omitting a suffix of the tuple key',
    args: [
      {
        name: 'key',
        description: '`Map` namespace to retrieve',
        required: false,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'keys',
        description:
          '`Map` namespace to retrieve (by joining JSON-stringified keys with a colon)',
        required: false,
        schema: {
          type: 'string',
        },
        examples: {
          simple: {
            summary: 'access a normal map',
            value: '"map_namespace"',
          },
          tuple: {
            summary: 'access a map with a tuple namespace',
            value: '"map_namespace":"address":1',
          },
        },
      },
      {
        name: 'numeric',
        description:
          "whether or not the map's keys are numbers (otherwise treated as strings)",
        required: false,
        schema: {
          type: 'boolean',
        },
      },
    ],
  },
  compute: async ({
    contractAddress,
    getMap,
    args: { key, keys, numeric },
  }) => {
    if (key) {
      return await getMap(contractAddress, key, {
        keyType: numeric ? 'number' : 'string',
      })
    }

    if (keys) {
      const splitKeys = keys.split(':')
      // Process escaped colons (two in a row), which end up as empty strings
      // sandwiched between two non-empty strings once split.
      const processedKeys: string[] = []
      for (let i = 0; i < splitKeys.length; i++) {
        if (splitKeys[i]) {
          processedKeys.push(splitKeys[i])
        } else if (
          i > 0 &&
          i < splitKeys.length - 1 &&
          splitKeys[i - 1] &&
          splitKeys[i + 1]
        ) {
          processedKeys[processedKeys.length - 1] += ':' + splitKeys[i + 1]
          // Skip an extra item since we just added the next one to the
          // previous.
          i++
        }
      }
      const parsedKeys = processedKeys.map((value) => JSON.parse(value))

      if (
        parsedKeys.some(
          (value) => typeof value !== 'string' && typeof value !== 'number'
        )
      ) {
        throw new Error(
          'keys must contain colon-separated values of type string (wrapped in quotes) or number, with colons escaped as double colons. example: keys="a_string":1 becomes ["a_string", 1], and keys="some::key":"another" becomes ["some:key", "another"]'
        )
      }

      return await getMap(contractAddress, parsedKeys, {
        keyType: numeric ? 'number' : 'string',
      })
    }

    throw new Error('missing key or keys')
  },
}
