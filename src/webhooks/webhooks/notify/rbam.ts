import { State, WasmStateEvent } from '@/db'
import {
  activeProposalModules,
  config as daoCoreConfig,
  item as daoCoreItem,
} from '@/formulas/formulas/contract/daoCore/base'
import { Env, WebhookMaker, WebhookType } from '@/types'
import { dbKeyForKeys, dbKeyToKeys } from '@/utils'
import { getDaoAddressForProposalModule } from '@/webhooks/utils'

const DAO_CORE_CODE_IDS_KEY = 'dao-dao-core'
const DAO_RBAM_CODE_IDS_KEY = 'dao-rbam'

const KEY_PREFIX_CONFIG_V2 = dbKeyForKeys('config_v2', '')
const KEY_PREFIX_ASSIGNMENTS = dbKeyForKeys('assignments', '')

export const makeDaoCreatedWithRBAM: WebhookMaker<WasmStateEvent> = (
  config,
  state
) => ({
  filter: {
    EventType: WasmStateEvent,
    codeIdsKeys: [DAO_CORE_CODE_IDS_KEY],
    matches: (event) =>
      event.key.startsWith(KEY_PREFIX_CONFIG_V2) &&
      !event.delete &&
      !!event.valueJson,
  },

  endpoint: () => ({
    type: WebhookType.Url,
    url: config.rbamWebhookBaseUrl + '/dao-created',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
  }),

  getValue: async (event, getLastEvent, env) => {
    // Only fire the first time we see config_v2
    const last = await getLastEvent()
    if (last !== null) return

    const daoAddress = event.contractAddress

    const [daoCfg, proposalMods] = await Promise.all([
      daoCoreConfig.compute({ ...env, contractAddress: daoAddress }),
      activeProposalModules.compute({ ...env, contractAddress: daoAddress }),
    ])
    if (!daoCfg || !proposalMods?.length) return

    // Check if any proposal module is RBAM
    const rbamModules = proposalMods.filter((m) => {
      return (
        typeof m.info?.contract === 'string' &&
        m.info.contract.toLowerCase().includes(DAO_RBAM_CODE_IDS_KEY)
      )
    })
    if (rbamModules.length === 0) return

    // Retrieve additional items
    const daoType = await daoCoreItem.compute({
      ...env,
      contractAddress: daoAddress,
      args: { key: 'type' },
    })
    const bgImage = await daoCoreItem.compute({
      ...env,
      contractAddress: daoAddress,
      args: { key: 'bgImage' },
    })
    const websiteLink = await daoCoreItem.compute({
      ...env,
      contractAddress: daoAddress,
      args: { key: 'websiteLink' },
    })
    const twitterLink = await daoCoreItem.compute({
      ...env,
      contractAddress: daoAddress,
      args: { key: 'twitterLink' },
    })

    return {
      type: 'dao_created_with_rbam' as const,
      chainId: state.chainId,
      dao: daoAddress,
      name: daoCfg.name,
      description: daoCfg.description ?? undefined,
      image: daoCfg.image_url ?? undefined,
      daoType, // organization or project
      bgImage,
      twitterLink,
      websiteLink,
    }
  },
})

/**
 * Emits:
 * - rbam_assignment_added    when ("assignments", addr, roleId) is created
 * - rbam_assignment_removed  when that exact key is deleted
 *
 */
export const makeRbamAssignmentChanged: WebhookMaker<WasmStateEvent> = (
  config,
  state
) => ({
  filter: {
    EventType: WasmStateEvent,
    codeIdsKeys: [DAO_RBAM_CODE_IDS_KEY],
    matches: (event) => event.key.startsWith(KEY_PREFIX_ASSIGNMENTS),
  },

  endpoint: async (event, env) => {
    const daoAddress = await getDaoAddressForProposalModule({
      ...env,
      contractAddress: event.contractAddress,
    })
    if (!daoAddress) return
    return {
      type: WebhookType.Url,
      url: `${config.rbamWebhookBaseUrl}/${daoAddress}`,
      method: 'POST',
    }
  },

  getValue: async (event, getLastEvent, env) => {
    // ("assignments", addr, roleId)
    const [, addr, roleIdStr] = dbKeyToKeys(event.key, [false, true, true])
    const roleId = Number(roleIdStr)

    // IMPORTANT: we need the last event for THIS EXACT KEY, not just the prefix.
    // If your helper doesn't accept a key, use an env-scoped getter instead.
    const last = (await getLastEvent(event.key)) ?? null // adjust if your signature differs

    if (event.delete) {
      return basePayload('rbam_assignment_removed', {
        state,
        event,
        env,
        addr: addr as string,
        roleId,
      })
    } else {
      // add: only fire if this is the first time (or it was previously deleted)
      if (last && !last.delete) return null
      return basePayload('rbam_assignment_added', {
        state,
        event,
        env,
        addr: addr as string,
        roleId,
      })
    }
  },
})

// helper to build a consistent payload (and fetch parent dao once)
async function basePayload(
  type: 'rbam_assignment_added' | 'rbam_assignment_removed',
  {
    state,
    event,
    env,
    addr,
    roleId,
  }: {
    state: State
    event: WasmStateEvent
    env: Env
    addr: string
    roleId: number
  }
) {
  const dao = await getDaoAddressForProposalModule({
    ...env,
    contractAddress: event.contractAddress,
  })
  return {
    type,
    chainId: state.chainId,
    dao,
    rbam: event.contractAddress,
    addr,
    roleId,
  }
}
