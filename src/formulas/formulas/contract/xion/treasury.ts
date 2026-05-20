import type {
  TreasuryAddr as Addr,
  FeeConfig,
  GrantConfig,
  Params,
} from '@burnt-labs/xion-types'
import type { OpenAPIV3_1 } from 'openapi-types'

import { ContractFormula } from '@/types'

import { makeSimpleContractFormula } from '../../utils'

// Load the CosmWasm-generated JSON Schema for the treasury contract.
// The schema files are included in @burnt-labs/xion-types dist via the
// package's copy script and kept in sync with the Rust contract via `cargo schema`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const treasurySchema =
  require('@burnt-labs/xion-types/contracts/treasury/schema/raw/instantiate.json') as {
    definitions: Record<string, OpenAPIV3_1.SchemaObject>
  }

// Resolve JSON Schema $ref references inline for OpenAPI v3.1 compatibility.
function resolveRefs(
  schema: OpenAPIV3_1.SchemaObject,
  defs: Record<string, OpenAPIV3_1.SchemaObject>
): OpenAPIV3_1.SchemaObject {
  if ('$ref' in schema) {
    const name = (schema as { $ref: string }).$ref.replace('#/definitions/', '')
    return resolveRefs(defs[name], defs)
  }
  const resolved = { ...schema }
  if (resolved.properties) {
    resolved.properties = Object.fromEntries(
      Object.entries(resolved.properties).map(([k, v]) => [
        k,
        resolveRefs(v as OpenAPIV3_1.SchemaObject, defs),
      ])
    )
  }
  if (resolved.anyOf) {
    resolved.anyOf = resolved.anyOf.map((s) =>
      resolveRefs(s as OpenAPIV3_1.SchemaObject, defs)
    )
  }
  return resolved
}

const { definitions: defs } = treasurySchema
const AddrSchema = resolveRefs(defs['Addr'], defs)
const FeeConfigSchema = resolveRefs(defs['FeeConfig'], defs)
const GrantConfigSchema = resolveRefs(defs['GrantConfig'], defs)
const ParamsSchema = resolveRefs(defs['Params'], defs)
const GrantConfigMapSchema: OpenAPIV3_1.SchemaObject = {
  type: 'object',
  additionalProperties: GrantConfigSchema,
}

const TreasuryStorageKeys = {
  GRANT_CONFIGS: 'grant_configs',
  FEE_CONFIG: 'fee_config',
  ADMIN: 'admin',
  PENDING_ADMIN: 'pending_admin',
  PARAMS: 'params',
}

// A real treasury must have `admin` set: the contract's instantiate
// (contracts/contracts/treasury/src/contract.rs:18-22) rejects `None` admin.
// If admin is absent, the contract is either not a treasury or was never
// indexed — throw so callers fall back to a direct chain query instead of
// caching an empty placeholder.
//
// So this check is here purely to figure out if the indexer is returning a real
// existing treasury, or just placeholder data for a non-existent one.
const assertTreasuryIndexed = async (
  env: Parameters<ContractFormula['compute']>[0]
): Promise<void> => {
  const adminValue = (
    await env.get<Addr>(env.contractAddress, TreasuryStorageKeys.ADMIN)
  )?.valueJson
  if (adminValue === null || adminValue === undefined) {
    throw new Error('treasury not found')
  }
}

export const grantConfigs: ContractFormula<Record<string, GrantConfig>> = {
  docs: {
    description: "Get the treasury's grant configs by msg type url",
    response: GrantConfigMapSchema,
  },
  compute: async (env) => {
    const { contractAddress, getMap } = env

    await assertTreasuryIndexed(env)

    return (
      (await getMap<string, GrantConfig>(
        contractAddress,
        TreasuryStorageKeys.GRANT_CONFIGS
      )) ?? {}
    )
  },
}

export const feeConfig: ContractFormula<FeeConfig | null> = {
  docs: {
    description: 'Get the fee sponsorship configuration for the treasury',
    response: {
      oneOf: [FeeConfigSchema, { type: 'null' }],
    },
  },
  compute: async (env) => {
    const { contractAddress, get } = env

    await assertTreasuryIndexed(env)

    return (
      (await get<FeeConfig>(contractAddress, TreasuryStorageKeys.FEE_CONFIG))
        ?.valueJson ?? null
    )
  },
}

export const admin: ContractFormula<Addr | null> = {
  docs: {
    description: 'Get the curent admin for the treasury',
    response: { oneOf: [AddrSchema, { type: 'null' }] },
  },
  compute: async (env) => {
    const { contractAddress, get } = env

    const adminValue =
      (await get<Addr>(contractAddress, TreasuryStorageKeys.ADMIN))
        ?.valueJson ?? null

    if (adminValue === null || adminValue === undefined) {
      throw new Error('treasury not found')
    }

    return adminValue
  },
}

export const pendingAdmin = makeSimpleContractFormula<Addr | null>({
  docs: {
    description: 'Get the pending admin for the treasury',
    response: { oneOf: [AddrSchema, { type: 'null' }] },
  },
  transformation: TreasuryStorageKeys.PENDING_ADMIN,
  fallback: null,
})

export const params: ContractFormula<Record<string, Params>> = {
  docs: {
    description: 'Get the params for the treasury',
    response: ParamsSchema,
  },
  compute: async (env) => {
    const { contractAddress, get } = env

    await assertTreasuryIndexed(env)

    return (
      (await get<Params>(contractAddress, TreasuryStorageKeys.PARAMS))
        ?.valueJson ?? {}
    )
  },
}

export const balances: ContractFormula<Record<string, string>> = {
  docs: {
    description: 'Get the balance of the treasury',
    response: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
  },
  compute: async (env) => {
    const { contractAddress, getBalances } = env

    return (await getBalances(contractAddress)) || {}
  },
}

export const all: ContractFormula<{
  grantConfigs: Record<string, GrantConfig>
  feeConfig: FeeConfig | null
  admin: Addr | null
  pendingAdmin: Addr | null
  params: Record<string, Params>
  balances: Record<string, string>
}> = {
  docs: {
    description: 'Get all treasury data in a single endpoint',
    response: {
      type: 'object',
      required: ['grantConfigs', 'params'],
      properties: {
        grantConfigs: GrantConfigMapSchema,
        feeConfig: { oneOf: [FeeConfigSchema, { type: 'null' }] },
        admin: { oneOf: [AddrSchema, { type: 'null' }] },
        pendingAdmin: { oneOf: [AddrSchema, { type: 'null' }] },
        params: ParamsSchema,
        balances: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
    },
  },
  compute: async (env) => {
    // Call all the individual endpoints
    const [
      grantConfigsData,
      feeConfigData,
      adminData,
      pendingAdminData,
      paramsData,
      balanceData,
    ] = await Promise.all([
      grantConfigs.compute(env),
      feeConfig.compute(env),
      admin.compute(env),
      pendingAdmin.compute(env),
      params.compute(env),
      balances.compute(env),
    ])

    // Combine all results into a single object
    return {
      grantConfigs: grantConfigsData,
      feeConfig: feeConfigData,
      admin: adminData,
      pendingAdmin: pendingAdminData,
      params: paramsData,
      balances: balanceData,
    }
  },
}
