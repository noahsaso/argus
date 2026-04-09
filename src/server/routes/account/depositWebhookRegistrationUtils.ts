import { AccountDepositWebhookRegistration } from '@/db'

type NormalizedRegistrationInput = {
  description?: string | null
  endpointUrl?: string
  authHeader?: string | null
  authToken?: string | null
  watchedWallets?: string[]
  allowedNativeDenoms?: string[]
  allowedCw20Contracts?: string[]
  enabled?: boolean
}

const normalizeString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined

const normalizeOptionalString = (value: unknown): string | null | undefined =>
  value === undefined
    ? undefined
    : value === null
    ? null
    : normalizeString(value) || null

const normalizeStringArray = (
  value: unknown,
  trim = true
): string[] | undefined =>
  Array.isArray(value)
    ? value
        .map((item) =>
          typeof item === 'string' ? (trim ? item.trim() : item) : ''
        )
        .filter(Boolean)
    : undefined

export const validateAndNormalizeDepositWebhookRegistration = ({
  body,
  requireAll = false,
}: {
  body: Partial<AccountDepositWebhookRegistration>
  requireAll?: boolean
}):
  | {
      error: string
    }
  | {
      normalized: NormalizedRegistrationInput
    } => {
  const description = normalizeOptionalString(body.description)
  if (
    description !== undefined &&
    description !== null &&
    description.length > 255
  ) {
    return {
      error: 'Description too long.',
    }
  }

  const endpointUrl = normalizeString(body.endpointUrl)
  if ((requireAll || 'endpointUrl' in body) && !endpointUrl) {
    return {
      error: 'Invalid endpoint URL.',
    }
  }
  if (endpointUrl) {
    try {
      new URL(endpointUrl)
    } catch {
      return {
        error: 'Invalid endpoint URL.',
      }
    }
  }

  const authHeader = normalizeOptionalString(body.authHeader)
  if ('authHeader' in body && body.authHeader !== null && authHeader === null) {
    return {
      error: 'Invalid auth header.',
    }
  }

  const authToken = normalizeOptionalString(body.authToken)

  const watchedWallets = normalizeStringArray(body.watchedWallets)
  if ((requireAll || 'watchedWallets' in body) && !watchedWallets?.length) {
    return {
      error: 'At least one watched wallet is required.',
    }
  }

  const allowedNativeDenoms = normalizeStringArray(body.allowedNativeDenoms)
  if ('allowedNativeDenoms' in body && allowedNativeDenoms === undefined) {
    return {
      error: 'Invalid native denoms.',
    }
  }

  const allowedCw20Contracts = normalizeStringArray(body.allowedCw20Contracts)
  if ('allowedCw20Contracts' in body && allowedCw20Contracts === undefined) {
    return {
      error: 'Invalid CW20 contracts.',
    }
  }

  const hasNativeDenoms =
    allowedNativeDenoms !== undefined
      ? allowedNativeDenoms.length > 0
      : undefined
  const hasCw20Contracts =
    allowedCw20Contracts !== undefined
      ? allowedCw20Contracts.length > 0
      : undefined

  if (
    (requireAll &&
      !(
        (allowedNativeDenoms?.length || 0) > 0 ||
        (allowedCw20Contracts?.length || 0) > 0
      )) ||
    (('allowedNativeDenoms' in body || 'allowedCw20Contracts' in body) &&
      hasNativeDenoms === false &&
      hasCw20Contracts === false)
  ) {
    return {
      error: 'At least one allowed asset filter is required.',
    }
  }

  if ('enabled' in body && typeof body.enabled !== 'boolean') {
    return {
      error: 'Invalid enabled flag.',
    }
  }

  return {
    normalized: {
      ...(description !== undefined && {
        description,
      }),
      ...(endpointUrl !== undefined && {
        endpointUrl,
      }),
      ...(authHeader !== undefined && {
        authHeader,
      }),
      ...(authToken !== undefined && {
        authToken,
      }),
      ...(watchedWallets !== undefined && {
        watchedWallets,
      }),
      ...(allowedNativeDenoms !== undefined && {
        allowedNativeDenoms,
      }),
      ...(allowedCw20Contracts !== undefined && {
        allowedCw20Contracts,
      }),
      ...('enabled' in body && {
        enabled: body.enabled,
      }),
    },
  }
}
