import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountDepositWebhookRegistration } from './AccountDepositWebhookRegistration'

describe('AccountDepositWebhookRegistration', () => {
  const makeRegistration = (
    overrides: Partial<AccountDepositWebhookRegistration> = {}
  ) =>
    ({
      id: 7,
      accountPublicKey: 'account',
      description: null,
      endpointUrl: 'https://partner.example/deposits',
      authHeader: null,
      authToken: null,
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
    AccountDepositWebhookRegistration.invalidateActiveRegistrationsCache()
    vi.restoreAllMocks()
  })

  it('matches native and cw20 deposits only when enabled and filtered', () => {
    const registration = makeRegistration()

    expect(
      registration.matchesNativeDeposit('xion1watchedwallet', 'uxion')
    ).toBe(true)
    expect(registration.matchesNativeDeposit('xion1otherwallet', 'uxion')).toBe(
      false
    )
    expect(
      registration.matchesCw20Deposit(
        'xion1watchedwallet',
        'xion1stablecoincontract'
      )
    ).toBe(true)
    expect(
      registration.matchesCw20Deposit(
        'xion1watchedwallet',
        'xion1othercontract'
      )
    ).toBe(false)

    registration.enabled = false

    expect(
      registration.matchesNativeDeposit('xion1watchedwallet', 'uxion')
    ).toBe(false)
    expect(
      registration.matchesCw20Deposit(
        'xion1watchedwallet',
        'xion1stablecoincontract'
      )
    ).toBe(false)
  })

  it('reuses cached enabled registrations until invalidated', async () => {
    const findAllSpy = vi.spyOn(AccountDepositWebhookRegistration, 'findAll')
    findAllSpy.mockResolvedValue([makeRegistration()])

    const first = await AccountDepositWebhookRegistration.getEnabledCached()
    const second = await AccountDepositWebhookRegistration.getEnabledCached()

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(findAllSpy).toHaveBeenCalledTimes(1)
  })

  it('invalidates the enabled-registration cache after save and destroy', async () => {
    const publishSpy = vi
      .spyOn(
        AccountDepositWebhookRegistration,
        'publishActiveRegistrationsCacheInvalidation'
      )
      .mockResolvedValue()
    const findAllSpy = vi.spyOn(AccountDepositWebhookRegistration, 'findAll')
    const firstRegistration = makeRegistration({
      id: 7,
      watchedWallets: ['xion1watchedwallet'],
    })
    const secondRegistration = makeRegistration({
      id: 8,
      watchedWallets: ['xion1secondwallet'],
      endpointUrl: 'https://partner.example/deposits-two',
    })
    findAllSpy
      .mockResolvedValueOnce([firstRegistration])
      .mockResolvedValueOnce([firstRegistration, secondRegistration])
      .mockResolvedValueOnce([firstRegistration])

    await AccountDepositWebhookRegistration.getEnabledCached()
    expect(findAllSpy).toHaveBeenCalledTimes(1)

    await AccountDepositWebhookRegistration.afterSaveHook()

    const afterCreate =
      await AccountDepositWebhookRegistration.getEnabledCached()
    expect(findAllSpy).toHaveBeenCalledTimes(2)
    expect(afterCreate.map(({ id }) => id)).toEqual([
      firstRegistration.id,
      secondRegistration.id,
    ])

    await AccountDepositWebhookRegistration.afterDestroyHook()

    const afterDestroy =
      await AccountDepositWebhookRegistration.getEnabledCached()
    expect(findAllSpy).toHaveBeenCalledTimes(3)
    expect(afterDestroy.map(({ id }) => id)).toEqual([firstRegistration.id])
    expect(publishSpy).toHaveBeenCalledTimes(2)
  })
})
