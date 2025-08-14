import { ContractFormula } from '@/types'

type VestingContract = {
  contract: string
  instantiator: string
  recipient: string
}

export const listVestingContracts: ContractFormula<
  VestingContract[],
  { limit?: string; startAfter?: string }
> = {
  docs: {
    description: 'lists vesting contracts',
    args: [
      {
        name: 'limit',
        description: 'maximum number of contracts to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startAfter',
        description: 'contract address to start listing after',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({ contractAddress, getMap, args: { limit, startAfter } }) => {
    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    const vestingContractsMap =
      (await getMap<string, VestingContract>(contractAddress, [
        'vesting_contracts',
      ])) ?? {}
    const vestingContracts = Object.entries(vestingContractsMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([key]) => !startAfter || key.localeCompare(startAfter) > 0)
      .slice(0, limitNum)

    return vestingContracts.map(([, value]) => value)
  },
}

export const listVestingContractsReverse: ContractFormula<
  VestingContract[],
  { limit?: string; startBefore?: string }
> = {
  docs: {
    description: 'lists vesting contracts in reverse order',
    args: [
      {
        name: 'limit',
        description: 'maximum number of contracts to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startBefore',
        description: 'contract address to start listing before',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({
    contractAddress,
    getMap,
    args: { limit, startBefore },
  }) => {
    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    const vestingContractsMap =
      (await getMap<string, VestingContract>(contractAddress, [
        'vesting_contracts',
      ])) ?? {}
    const vestingContracts = Object.entries(vestingContractsMap)
      .sort(([a], [b]) => b.localeCompare(a))
      .filter(([key]) => !startBefore || key.localeCompare(startBefore) < 0)
      .slice(0, limitNum)

    return vestingContracts.map(([, value]) => value)
  },
}

export const listVestingContractsByInstantiator: ContractFormula<
  VestingContract[],
  { instantiator: string; limit?: string; startAfter?: string }
> = {
  docs: {
    description: 'lists vesting contracts by instantiator',
    args: [
      {
        name: 'instantiator',
        description: 'address of the instantiator',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'limit',
        description: 'maximum number of contracts to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startAfter',
        description: 'contract address to start listing after',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({
    contractAddress,
    getMap,
    args: { instantiator, limit, startAfter },
  }) => {
    if (!instantiator) {
      throw new Error('missing `instantiator`')
    }

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    const vestingContractsMap =
      (await getMap<string, VestingContract>(contractAddress, [
        'vesting_contracts',
      ])) ?? {}
    const vestingContracts = Object.entries(vestingContractsMap)
      .filter(([, value]) => value.instantiator === instantiator)
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([key]) => !startAfter || key.localeCompare(startAfter) > 0)
      .slice(0, limitNum)

    return vestingContracts.map(([, value]) => value)
  },
}

export const listVestingContractsByInstantiatorReverse: ContractFormula<
  VestingContract[],
  { instantiator: string; limit?: string; startBefore?: string }
> = {
  docs: {
    description: 'lists vesting contracts by instantiator in reverse order',
    args: [
      {
        name: 'instantiator',
        description: 'address of the instantiator',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'limit',
        description: 'maximum number of contracts to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startBefore',
        description: 'contract address to start listing before',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({
    contractAddress,
    getMap,
    args: { instantiator, limit, startBefore },
  }) => {
    if (!instantiator) {
      throw new Error('missing `instantiator`')
    }

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    const vestingContractsMap =
      (await getMap<string, VestingContract>(contractAddress, [
        'vesting_contracts',
      ])) ?? {}
    const vestingContracts = Object.entries(vestingContractsMap)
      .filter(([, value]) => value.instantiator === instantiator)
      .sort(([a], [b]) => b.localeCompare(a))
      .filter(([key]) => !startBefore || key.localeCompare(startBefore) < 0)
      .slice(0, limitNum)

    return vestingContracts.map(([, value]) => value)
  },
}

export const listVestingContractsByRecipient: ContractFormula<
  VestingContract[],
  { recipient: string; limit?: string; startAfter?: string }
> = {
  docs: {
    description: 'lists vesting contracts by recipient',
    args: [
      {
        name: 'recipient',
        description: 'address of the recipient',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'limit',
        description: 'maximum number of contracts to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startAfter',
        description: 'contract address to start listing after',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({
    contractAddress,
    getMap,
    args: { recipient, limit, startAfter },
  }) => {
    if (!recipient) {
      throw new Error('missing `recipient`')
    }

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    const vestingContractsMap =
      (await getMap<string, VestingContract>(contractAddress, [
        'vesting_contracts',
      ])) ?? {}
    const vestingContracts = Object.entries(vestingContractsMap)
      .filter(([, value]) => value.recipient === recipient)
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([key]) => !startAfter || key.localeCompare(startAfter) > 0)
      .slice(0, limitNum)

    return vestingContracts.map(([, value]) => value)
  },
}

export const listVestingContractsByRecipientReverse: ContractFormula<
  VestingContract[],
  { recipient: string; limit?: string; startBefore?: string }
> = {
  docs: {
    description: 'lists vesting contracts by recipient in reverse order',
    args: [
      {
        name: 'recipient',
        description: 'address of the recipient',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        name: 'limit',
        description: 'maximum number of contracts to return',
        required: false,
        schema: {
          type: 'integer',
        },
      },
      {
        name: 'startBefore',
        description: 'contract address to start listing before',
        required: false,
        schema: {
          type: 'string',
        },
      },
    ],
  },
  compute: async ({
    contractAddress,
    getMap,
    args: { recipient, limit, startBefore },
  }) => {
    if (!recipient) {
      throw new Error('missing `recipient`')
    }

    const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

    const vestingContractsMap =
      (await getMap<string, VestingContract>(contractAddress, [
        'vesting_contracts',
      ])) ?? {}
    const vestingContracts = Object.entries(vestingContractsMap)
      .filter(([, value]) => value.recipient === recipient)
      .sort(([a], [b]) => b.localeCompare(a))
      .filter(([key]) => !startBefore || key.localeCompare(startBefore) < 0)
      .slice(0, limitNum)

    return vestingContracts.map(([, value]) => value)
  },
}

export const ownership: ContractFormula = {
  docs: {
    description: 'retrieves the ownership information of the contract',
  },
  compute: async ({ contractAddress, get }) =>
    (await get(contractAddress, 'ownership'))?.valueJson,
}

export const codeId: ContractFormula = {
  docs: {
    description:
      'retrieves the code ID of the cw-vesting contract that gets created by this factory',
  },
  compute: async ({ contractAddress, get }) =>
    (await get(contractAddress, 'pci'))?.valueJson,
}
