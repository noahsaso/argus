import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { AccountDepositWebhookRegistration, Extraction } from '@/db'
import { ExtractorEnv, ExtractorHandleableData } from '@/types'

import {
  IndexedWasmEventDataSource,
  StargateMessageDataSource,
} from '../../sources'
import {
  DEPOSIT_WEBHOOK_EXTRACTION_PREFIX,
  XionDepositWebhookExtractor,
} from './depositWebhook'

describe('XionDepositWebhookExtractor', () => {
  let extractor: XionDepositWebhookExtractor

  const makeRegistration = (
    overrides: Partial<AccountDepositWebhookRegistration> = {}
  ) =>
    ({
      id: 7,
      accountPublicKey: 'account',
      description: 'Sandbox deposit listener',
      endpointUrl: 'https://partner.example/deposits',
      authHeader: 'Authorization',
      authToken: 'secret-token',
      watchedWallets: ['xion1watchedwallet'],
      allowedNativeDenoms: ['uxion'],
      allowedCw20Contracts: ['xion1stablecoincontract'],
      enabled: true,
      matchesNativeDeposit:
        AccountDepositWebhookRegistration.prototype.matchesNativeDeposit,
      matchesCw20Deposit:
        AccountDepositWebhookRegistration.prototype.matchesCw20Deposit,
      ...overrides,
    } as unknown as AccountDepositWebhookRegistration)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(
      AccountDepositWebhookRegistration,
      'getEnabledCached'
    ).mockResolvedValue([makeRegistration()])
    vi.spyOn(Extraction, 'bulkCreate').mockImplementation(
      async (records) => records as any
    )

    const env: ExtractorEnv = {
      config: {
        ...ConfigManager.load(),
        chainId: 'xion-testnet-1',
      },
      sendWebhooks: false,
      autoCosmWasmClient: {} as any,
      txHash: 'test-tx-hash',
      block: {
        height: '12345',
        timeUnixMs: '1700000000000',
        timestamp: '2023-11-14T22:13:20.000Z',
      },
    }

    extractor = new XionDepositWebhookExtractor(env)
  })

  it('extracts native deposits to watched wallets', async () => {
    const data: ExtractorHandleableData[] = [
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        messageIndex: 2,
        value: {
          fromAddress: 'xion1senderwallet',
          toAddress: 'xion1watchedwallet',
          amount: [
            {
              denom: 'uxion',
              amount: '42',
            },
          ],
        },
      }),
    ]

    const result = (await extractor.extract(data)) as Extraction[]

    expect(result).toHaveLength(1)
    expect(result[0].address).toBe('xion1watchedwallet')
    expect(result[0].name).toContain(DEPOSIT_WEBHOOK_EXTRACTION_PREFIX)
    expect(result[0].data).toEqual({
      registrationId: 7,
      idempotencyKey:
        'xion-testnet-1:7:test-tx-hash:xion1watchedwallet:native:uxion:42:2:0',
      wallet: 'xion1watchedwallet',
      recipient: 'xion1watchedwallet',
      sender: 'xion1senderwallet',
      amount: '42',
      assetType: 'native',
      denom: 'uxion',
      contractAddress: null,
      blockHeight: '12345',
      blockTimeUnixMs: '1700000000000',
      txHash: 'test-tx-hash',
    })
  })

  it('extracts cw20 deposits for allowed contracts', async () => {
    const data: ExtractorHandleableData[] = [
      IndexedWasmEventDataSource.handleable('cw20Transfer', {
        address: 'xion1stablecoincontract',
        key: 'action',
        value: 'transfer',
        eventIndex: 4,
        attributes: {
          action: ['transfer'],
          sender: ['xion1senderwallet'],
          recipient: ['xion1watchedwallet'],
          amount: ['1000000'],
        },
        _attributes: [
          { key: '_contract_address', value: 'xion1stablecoincontract' },
          { key: 'action', value: 'transfer' },
          { key: 'sender', value: 'xion1senderwallet' },
          { key: 'recipient', value: 'xion1watchedwallet' },
          { key: 'amount', value: '1000000' },
        ],
      }),
    ]

    const result = (await extractor.extract(data)) as Extraction[]

    expect(result).toHaveLength(1)
    expect(result[0].address).toBe('xion1watchedwallet')
    expect(result[0].data).toEqual({
      registrationId: 7,
      idempotencyKey:
        'xion-testnet-1:7:test-tx-hash:xion1watchedwallet:cw20:xion1stablecoincontract:1000000:4',
      wallet: 'xion1watchedwallet',
      recipient: 'xion1watchedwallet',
      sender: 'xion1senderwallet',
      amount: '1000000',
      assetType: 'cw20',
      denom: null,
      contractAddress: 'xion1stablecoincontract',
      blockHeight: '12345',
      blockTimeUnixMs: '1700000000000',
      txHash: 'test-tx-hash',
    })
  })

  it('falls back to the connected client chain ID when config chainId is empty', async () => {
    extractor = new XionDepositWebhookExtractor({
      ...extractor.env,
      config: {
        ...extractor.env.config,
        chainId: '',
      },
      autoCosmWasmClient: {
        chainId: 'xion-mainnet-1',
      } as any,
    })

    const data: ExtractorHandleableData[] = [
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        messageIndex: 7,
        value: {
          fromAddress: 'xion1senderwallet',
          toAddress: 'xion1watchedwallet',
          amount: [
            {
              denom: 'uxion',
              amount: '42',
            },
          ],
        },
      }),
    ]

    const result = (await extractor.extract(data)) as Extraction[]

    expect(result).toHaveLength(1)
    expect(result[0].data).toMatchObject({
      idempotencyKey:
        'xion-mainnet-1:7:test-tx-hash:xion1watchedwallet:native:uxion:42:7:0',
    })
  })

  it('fails when no chain ID can be determined for idempotency keys', async () => {
    extractor = new XionDepositWebhookExtractor({
      ...extractor.env,
      config: {
        ...extractor.env.config,
        chainId: '',
      },
      autoCosmWasmClient: {} as any,
    })

    const data: ExtractorHandleableData[] = [
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        messageIndex: 9,
        value: {
          fromAddress: 'xion1senderwallet',
          toAddress: 'xion1watchedwallet',
          amount: [{ denom: 'uxion', amount: '42' }],
        },
      }),
    ]

    await expect(extractor.extract(data)).rejects.toThrow(
      'Could not determine chainId required for deposit webhook idempotency keys.'
    )
  })

  it('uses deterministic unique names for same-block deposits', async () => {
    const data: ExtractorHandleableData[] = [
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        messageIndex: 0,
        value: {
          fromAddress: 'xion1senderwallet',
          toAddress: 'xion1watchedwallet',
          amount: [{ denom: 'uxion', amount: '42' }],
        },
      }),
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        messageIndex: 1,
        value: {
          fromAddress: 'xion1senderwallet',
          toAddress: 'xion1watchedwallet',
          amount: [{ denom: 'uxion', amount: '42' }],
        },
      }),
    ]

    const result = (await extractor.extract(data)) as Extraction[]

    expect(result).toHaveLength(2)
    expect(result[0].name).not.toBe(result[1].name)
  })

  it('ignores deposits that do not match watched wallets or allowed assets', async () => {
    const data: ExtractorHandleableData[] = [
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        messageIndex: 0,
        value: {
          fromAddress: 'xion1senderwallet',
          toAddress: 'xion1otherwallet',
          amount: [{ denom: 'uxion', amount: '42' }],
        },
      }),
      IndexedWasmEventDataSource.handleable('cw20Transfer', {
        address: 'xion1othercontract',
        key: 'action',
        value: 'transfer',
        eventIndex: 1,
        attributes: {
          action: ['transfer'],
          recipient: ['xion1watchedwallet'],
          amount: ['1000000'],
        },
        _attributes: [
          { key: '_contract_address', value: 'xion1othercontract' },
          { key: 'action', value: 'transfer' },
          { key: 'recipient', value: 'xion1watchedwallet' },
          { key: 'amount', value: '1000000' },
        ],
      }),
    ]

    await expect(extractor.extract(data)).resolves.toEqual([])
  })

  it('supports snake_case bank message addresses', async () => {
    const data: ExtractorHandleableData[] = [
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        messageIndex: 8,
        value: {
          from_address: 'xion1senderwallet',
          to_address: 'xion1watchedwallet',
          amount: [{ denom: 'uxion', amount: '42' }],
        },
      }),
    ]

    const result = (await extractor.extract(data)) as Extraction[]

    expect(result).toHaveLength(1)
    expect(result[0].data).toMatchObject({
      sender: 'xion1senderwallet',
      recipient: 'xion1watchedwallet',
      idempotencyKey:
        'xion-testnet-1:7:test-tx-hash:xion1watchedwallet:native:uxion:42:8:0',
    })
  })

  it('returns no deposits when no registrations are enabled', async () => {
    vi.mocked(
      AccountDepositWebhookRegistration.getEnabledCached
    ).mockResolvedValue([])

    const data: ExtractorHandleableData[] = [
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        messageIndex: 0,
        value: {
          fromAddress: 'xion1senderwallet',
          toAddress: 'xion1watchedwallet',
          amount: [{ denom: 'uxion', amount: '42' }],
        },
      }),
      IndexedWasmEventDataSource.handleable('cw20Transfer', {
        address: 'xion1stablecoincontract',
        key: 'action',
        value: 'transfer',
        eventIndex: 1,
        attributes: {
          action: ['transfer'],
          sender: ['xion1senderwallet'],
          recipient: ['xion1watchedwallet'],
          amount: ['1000000'],
        },
        _attributes: [
          { key: '_contract_address', value: 'xion1stablecoincontract' },
          { key: 'action', value: 'transfer' },
          { key: 'sender', value: 'xion1senderwallet' },
          { key: 'recipient', value: 'xion1watchedwallet' },
          { key: 'amount', value: '1000000' },
        ],
      }),
    ]

    await expect(extractor.extract(data)).resolves.toEqual([])
  })

  it('ignores malformed bank transfers and unsupported type URLs', async () => {
    const data: ExtractorHandleableData[] = [
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        messageIndex: 10,
        value: {
          fromAddress: 'xion1senderwallet',
          amount: [{ denom: 'uxion', amount: '42' }],
        },
      }),
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        messageIndex: 11,
        value: {
          fromAddress: 'xion1senderwallet',
          toAddress: 'xion1watchedwallet',
          amount: [{ denom: 'uxion' }],
        },
      }),
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        messageIndex: 12,
        value: {
          fromAddress: 'xion1senderwallet',
          toAddress: 'xion1watchedwallet',
          amount: '42',
        },
      }),
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgUnknown',
        messageIndex: 13,
        value: {
          fromAddress: 'xion1senderwallet',
          toAddress: 'xion1watchedwallet',
          amount: [{ denom: 'uxion', amount: '42' }],
        },
      }),
    ]

    await expect(extractor.extract(data)).resolves.toEqual([])
  })

  it('extracts MsgMultiSend deposits and nulls sender for multi-sender inputs', async () => {
    const data: ExtractorHandleableData[] = [
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgMultiSend',
        messageIndex: 3,
        value: {
          inputs: [
            {
              address: 'xion1senderone',
              coins: [{ denom: 'uxion', amount: '30' }],
            },
            {
              address: 'xion1sendertwo',
              coins: [{ denom: 'uxion', amount: '12' }],
            },
          ],
          outputs: [
            {
              address: 'xion1watchedwallet',
              coins: [{ denom: 'uxion', amount: '42' }],
            },
          ],
        },
      }),
    ]

    const result = (await extractor.extract(data)) as Extraction[]

    expect(result).toHaveLength(1)
    expect(result[0].data).toEqual({
      registrationId: 7,
      idempotencyKey:
        'xion-testnet-1:7:test-tx-hash:xion1watchedwallet:native:uxion:42:3:0:0',
      wallet: 'xion1watchedwallet',
      recipient: 'xion1watchedwallet',
      sender: null,
      amount: '42',
      assetType: 'native',
      denom: 'uxion',
      contractAddress: null,
      blockHeight: '12345',
      blockTimeUnixMs: '1700000000000',
      txHash: 'test-tx-hash',
    })
  })

  it('extracts MsgMultiSend deposits and preserves sender for single-sender inputs', async () => {
    const data: ExtractorHandleableData[] = [
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgMultiSend',
        messageIndex: 5,
        value: {
          inputs: [
            {
              address: 'xion1senderone',
              coins: [{ denom: 'uxion', amount: '42' }],
            },
          ],
          outputs: [
            {
              address: 'xion1watchedwallet',
              coins: [{ denom: 'uxion', amount: '42' }],
            },
          ],
        },
      }),
    ]

    const result = (await extractor.extract(data)) as Extraction[]

    expect(result).toHaveLength(1)
    expect(result[0].data).toEqual({
      registrationId: 7,
      idempotencyKey:
        'xion-testnet-1:7:test-tx-hash:xion1watchedwallet:native:uxion:42:5:0:0',
      wallet: 'xion1watchedwallet',
      recipient: 'xion1watchedwallet',
      sender: 'xion1senderone',
      amount: '42',
      assetType: 'native',
      denom: 'uxion',
      contractAddress: null,
      blockHeight: '12345',
      blockTimeUnixMs: '1700000000000',
      txHash: 'test-tx-hash',
    })
  })

  it('extracts unique deposits for multiple watched outputs from one sender', async () => {
    vi.spyOn(
      AccountDepositWebhookRegistration,
      'getEnabledCached'
    ).mockResolvedValue([
      makeRegistration({
        watchedWallets: ['xion1watchedwallet', 'xion1watchedwallettwo'],
      }),
    ])

    const data: ExtractorHandleableData[] = [
      StargateMessageDataSource.handleable('bankTransfer', {
        typeUrl: '/cosmos.bank.v1beta1.MsgMultiSend',
        messageIndex: 6,
        value: {
          inputs: [
            {
              address: 'xion1senderone',
              coins: [{ denom: 'uxion', amount: '100' }],
            },
          ],
          outputs: [
            {
              address: 'xion1watchedwallet',
              coins: [{ denom: 'uxion', amount: '50' }],
            },
            {
              address: 'xion1watchedwallettwo',
              coins: [{ denom: 'uxion', amount: '50' }],
            },
          ],
        },
      }),
    ]

    const result = (await extractor.extract(data)) as Extraction[]

    expect(result).toHaveLength(2)
    expect(result.map((event) => event.data)).toEqual([
      {
        registrationId: 7,
        idempotencyKey:
          'xion-testnet-1:7:test-tx-hash:xion1watchedwallet:native:uxion:50:6:0:0',
        wallet: 'xion1watchedwallet',
        recipient: 'xion1watchedwallet',
        sender: 'xion1senderone',
        amount: '50',
        assetType: 'native',
        denom: 'uxion',
        contractAddress: null,
        blockHeight: '12345',
        blockTimeUnixMs: '1700000000000',
        txHash: 'test-tx-hash',
      },
      {
        registrationId: 7,
        idempotencyKey:
          'xion-testnet-1:7:test-tx-hash:xion1watchedwallettwo:native:uxion:50:6:1:0',
        wallet: 'xion1watchedwallettwo',
        recipient: 'xion1watchedwallettwo',
        sender: 'xion1senderone',
        amount: '50',
        assetType: 'native',
        denom: 'uxion',
        contractAddress: null,
        blockHeight: '12345',
        blockTimeUnixMs: '1700000000000',
        txHash: 'test-tx-hash',
      },
    ])
    expect(result[0].name).not.toBe(result[1].name)
  })

  it('extracts cw20 transfer_from deposits using owner as sender fallback', async () => {
    const data: ExtractorHandleableData[] = [
      IndexedWasmEventDataSource.handleable('cw20Transfer', {
        address: 'xion1stablecoincontract',
        key: 'action',
        value: 'transfer_from',
        eventIndex: 14,
        attributes: {
          action: ['transfer_from'],
          owner: ['xion1ownerwallet'],
          recipient: ['xion1watchedwallet'],
          amount: ['1000000'],
        },
        _attributes: [
          { key: '_contract_address', value: 'xion1stablecoincontract' },
          { key: 'action', value: 'transfer_from' },
          { key: 'owner', value: 'xion1ownerwallet' },
          { key: 'recipient', value: 'xion1watchedwallet' },
          { key: 'amount', value: '1000000' },
        ],
      }),
    ]

    const result = (await extractor.extract(data)) as Extraction[]

    expect(result).toHaveLength(1)
    expect(result[0].data).toMatchObject({
      sender: 'xion1ownerwallet',
      assetType: 'cw20',
      contractAddress: 'xion1stablecoincontract',
      idempotencyKey:
        'xion-testnet-1:7:test-tx-hash:xion1watchedwallet:cw20:xion1stablecoincontract:1000000:14',
    })
  })

  it('extracts cw20 send_from deposits using from as sender fallback', async () => {
    const data: ExtractorHandleableData[] = [
      IndexedWasmEventDataSource.handleable('cw20Transfer', {
        address: 'xion1stablecoincontract',
        key: 'action',
        value: 'send_from',
        eventIndex: 15,
        attributes: {
          action: ['send_from'],
          from: ['xion1fromwallet'],
          recipient: ['xion1watchedwallet'],
          amount: ['1000000'],
        },
        _attributes: [
          { key: '_contract_address', value: 'xion1stablecoincontract' },
          { key: 'action', value: 'send_from' },
          { key: 'from', value: 'xion1fromwallet' },
          { key: 'recipient', value: 'xion1watchedwallet' },
          { key: 'amount', value: '1000000' },
        ],
      }),
    ]

    const result = (await extractor.extract(data)) as Extraction[]

    expect(result).toHaveLength(1)
    expect(result[0].data).toMatchObject({
      sender: 'xion1fromwallet',
      assetType: 'cw20',
      contractAddress: 'xion1stablecoincontract',
      idempotencyKey:
        'xion-testnet-1:7:test-tx-hash:xion1watchedwallet:cw20:xion1stablecoincontract:1000000:15',
    })
  })

  it('ignores malformed cw20 transfers missing recipient or amount', async () => {
    const data: ExtractorHandleableData[] = [
      IndexedWasmEventDataSource.handleable('cw20Transfer', {
        address: 'xion1stablecoincontract',
        key: 'action',
        value: 'transfer',
        eventIndex: 16,
        attributes: {
          action: ['transfer'],
          sender: ['xion1senderwallet'],
          amount: ['1000000'],
        },
        _attributes: [
          { key: '_contract_address', value: 'xion1stablecoincontract' },
          { key: 'action', value: 'transfer' },
          { key: 'sender', value: 'xion1senderwallet' },
          { key: 'amount', value: '1000000' },
        ],
      }),
      IndexedWasmEventDataSource.handleable('cw20Transfer', {
        address: 'xion1stablecoincontract',
        key: 'action',
        value: 'transfer',
        eventIndex: 17,
        attributes: {
          action: ['transfer'],
          sender: ['xion1senderwallet'],
          recipient: ['xion1watchedwallet'],
        },
        _attributes: [
          { key: '_contract_address', value: 'xion1stablecoincontract' },
          { key: 'action', value: 'transfer' },
          { key: 'sender', value: 'xion1senderwallet' },
          { key: 'recipient', value: 'xion1watchedwallet' },
        ],
      }),
    ]

    await expect(extractor.extract(data)).resolves.toEqual([])
  })
})
