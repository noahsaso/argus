import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigManager } from '@/config'
import { AccountDepositWebhookRegistration, Extraction } from '@/db'
import { DEPOSIT_WEBHOOK_EXTRACTION_PREFIX } from '@/listener/extractors/xion/depositWebhook'

import { makeDepositDetectedWebhook } from './depositWebhook'

describe('Deposit webhook', () => {
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
      allowedCw20Contracts: [],
      enabled: true,
      ...overrides,
    } as unknown as AccountDepositWebhookRegistration)

  const makeEvent = (data: Record<string, unknown>) =>
    ({
      id: 1,
      address: 'xion1watchedwallet',
      name: `${DEPOSIT_WEBHOOK_EXTRACTION_PREFIX}idempotency-key`,
      blockHeight: '12345',
      blockTimeUnixMs: '1700000000000',
      txHash: 'test-tx-hash',
      data,
    } as unknown as Extraction)

  const makeWebhook = () => {
    const webhook = makeDepositDetectedWebhook(ConfigManager.load(), {} as any)
    if (!webhook) {
      throw new Error('Expected deposit webhook to be defined.')
    }

    return webhook
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(
      AccountDepositWebhookRegistration,
      'findEnabledByPk'
    ).mockResolvedValue(makeRegistration())
  })

  it('builds a bearer-authenticated endpoint and forwards extraction payload', async () => {
    const webhook = makeWebhook()

    const event = makeEvent({
      registrationId: 7,
      idempotencyKey: 'idempotency-key',
      wallet: 'xion1watchedwallet',
      recipient: 'xion1watchedwallet',
      sender: 'xion1senderwallet',
      amount: '1000000',
      assetType: 'native',
      denom: 'uxion',
      contractAddress: null,
      blockHeight: '12345',
      blockTimeUnixMs: '1700000000000',
      txHash: 'test-tx-hash',
    })

    const endpoint = await (webhook.endpoint as any)(event, {})
    const value = await webhook.getValue(event, async () => null, {} as any)

    expect(
      AccountDepositWebhookRegistration.findEnabledByPk
    ).toHaveBeenCalledWith(7)
    expect(endpoint).toEqual({
      type: 'url',
      url: 'https://partner.example/deposits',
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Idempotency-Key': 'idempotency-key',
      },
    })
    expect(value).toEqual({
      idempotencyKey: 'idempotency-key',
      wallet: 'xion1watchedwallet',
      recipient: 'xion1watchedwallet',
      sender: 'xion1senderwallet',
      amount: '1000000',
      assetType: 'native',
      denom: 'uxion',
      contractAddress: null,
      blockHeight: '12345',
      blockTimeUnixMs: '1700000000000',
      txHash: 'test-tx-hash',
    })
  })

  it('uses custom auth headers without bearer prefixing', async () => {
    vi.mocked(
      AccountDepositWebhookRegistration.findEnabledByPk
    ).mockResolvedValue(
      makeRegistration({
        authHeader: 'X-API-Key',
        authToken: 'raw-secret',
      })
    )

    const webhook = makeWebhook()

    const event = makeEvent({
      registrationId: 7,
      idempotencyKey: 'idempotency-key',
      wallet: 'xion1watchedwallet',
      recipient: 'xion1watchedwallet',
      sender: null,
      amount: '1000000',
      assetType: 'native',
      denom: 'uxion',
      contractAddress: null,
      blockHeight: '12345',
      blockTimeUnixMs: '1700000000000',
      txHash: 'test-tx-hash',
    })

    const endpoint = await (webhook.endpoint as any)(event, {})

    expect(endpoint).toEqual({
      type: 'url',
      url: 'https://partner.example/deposits',
      method: 'POST',
      headers: {
        'X-API-Key': 'raw-secret',
        'Idempotency-Key': 'idempotency-key',
      },
    })
  })

  it('preserves explicit bearer tokens without double prefixing', async () => {
    vi.mocked(
      AccountDepositWebhookRegistration.findEnabledByPk
    ).mockResolvedValue(
      makeRegistration({
        authToken: 'Bearer secret-token',
      })
    )

    const webhook = makeWebhook()

    const event = makeEvent({
      registrationId: 7,
      idempotencyKey: 'idempotency-key',
      wallet: 'xion1watchedwallet',
      recipient: 'xion1watchedwallet',
      sender: null,
      amount: '1000000',
      assetType: 'native',
      denom: 'uxion',
      contractAddress: null,
      blockHeight: '12345',
      blockTimeUnixMs: '1700000000000',
      txHash: 'test-tx-hash',
    })

    const endpoint = await (webhook.endpoint as any)(event, {})

    expect(endpoint).toEqual({
      type: 'url',
      url: 'https://partner.example/deposits',
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Idempotency-Key': 'idempotency-key',
      },
    })
  })

  it('sends only the idempotency key when no auth token is configured', async () => {
    vi.mocked(
      AccountDepositWebhookRegistration.findEnabledByPk
    ).mockResolvedValue(
      makeRegistration({
        authHeader: null,
        authToken: null,
      })
    )

    const webhook = makeWebhook()

    const event = makeEvent({
      registrationId: 7,
      idempotencyKey: 'idempotency-key',
      wallet: 'xion1watchedwallet',
      recipient: 'xion1watchedwallet',
      sender: null,
      amount: '1000000',
      assetType: 'native',
      denom: 'uxion',
      contractAddress: null,
      blockHeight: '12345',
      blockTimeUnixMs: '1700000000000',
      txHash: 'test-tx-hash',
    })

    const endpoint = await (webhook.endpoint as any)(event, {})

    expect(endpoint).toEqual({
      type: 'url',
      url: 'https://partner.example/deposits',
      method: 'POST',
      headers: {
        'Idempotency-Key': 'idempotency-key',
      },
    })
  })

  it('skips delivery when the registration no longer exists or is disabled', async () => {
    vi.mocked(
      AccountDepositWebhookRegistration.findEnabledByPk
    ).mockResolvedValue(null)

    const webhook = makeWebhook()

    const event = makeEvent({
      registrationId: 7,
      idempotencyKey: 'idempotency-key',
      wallet: 'xion1watchedwallet',
      recipient: 'xion1watchedwallet',
      sender: null,
      amount: '1000000',
      assetType: 'native',
      denom: 'uxion',
      contractAddress: null,
      blockHeight: '12345',
      blockTimeUnixMs: '1700000000000',
      txHash: 'test-tx-hash',
    })

    await expect((webhook.endpoint as any)(event, {})).resolves.toBeUndefined()
  })

  it('validates payloads before returning webhook body', async () => {
    const webhook = makeWebhook()

    const event = {
      ...makeEvent({
        idempotencyKey: 'idempotency-key',
        wallet: 'xion1watchedwallet',
      }),
      name: `${DEPOSIT_WEBHOOK_EXTRACTION_PREFIX}bad-payload`,
    } as Extraction

    await expect(
      webhook.getValue(event, async () => null, {} as any)
    ).rejects.toThrow('Invalid deposit webhook extraction payload')
  })

  it('validates payloads before building the webhook endpoint', async () => {
    const webhook = makeWebhook()

    const event = {
      ...makeEvent({
        registrationId: 7,
        idempotencyKey: 'idempotency-key',
        wallet: 'xion1watchedwallet',
        recipient: 'xion1watchedwallet',
        sender: null,
        amount: '1000000',
        assetType: 'cw20',
        denom: null,
        contractAddress: null,
        blockHeight: '12345',
        blockTimeUnixMs: '1700000000000',
        txHash: 'test-tx-hash',
      }),
      name: `${DEPOSIT_WEBHOOK_EXTRACTION_PREFIX}bad-payload`,
    } as Extraction

    await expect((webhook.endpoint as any)(event, {})).rejects.toThrow(
      'Invalid deposit webhook extraction payload'
    )
  })
})
