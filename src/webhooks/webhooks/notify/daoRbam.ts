import { Extraction } from '@/db'
import { info } from '@/formulas/formulas/contract'
import { listItems } from '@/formulas/formulas/contract/daoCore/base'
import { DumpState } from '@/formulas/formulas/contract/daoCore/dump'
import {
  dao,
  roles,
} from '@/formulas/formulas/contract/external/daoRbam/formulas'
import {
  Assignment,
  Role,
} from '@/formulas/formulas/contract/external/daoRbam/types'
import { WebhookMaker, WebhookType } from '@/types'

// Emits when a DAO with RBAM is created or updated.
export const daoWithRBAM: WebhookMaker<Extraction> = (config) => ({
  filter: {
    EventType: Extraction,
    matches: (event) => event.name === 'dao-dao-core/dump_state',
  },
  endpoint: () => ({
    type: WebhookType.Url,
    url: `${config.rbamWebhooksBaseUrl}/dao`,
    method: 'POST',
  }),
  getValue: async (event, getLastEvent, env) => {
    const daoAddress = event.address
    const data = event.data as DumpState
    const proposalMods = data.proposal_modules?.filter(
      (module) => module.status === 'enabled'
    )

    if (!proposalMods || proposalMods.length === 0) return

    const proposalModsInfo = await Promise.all(
      proposalMods.map(
        async (module) =>
          await info.compute({ ...env, contractAddress: module.address })
      )
    )

    // Check if any proposal module is RBAM
    const rbamMod = proposalModsInfo.filter((info) =>
      info.contract.includes('dao-rbam')
    )

    if (rbamMod.length === 0) return

    // Retrieve items
    const items = await listItems.compute({
      ...env,
      contractAddress: daoAddress,
    })

    return {
      dao: daoAddress,
      name: data.config?.name,
      description: data.config?.description,
      image: data.config?.image_url,
      ...Object.fromEntries(items),
    }
  },
})

// Emits when assignments change.
export const makeRbamAssignmentChanged: WebhookMaker<Extraction> = (
  config
) => ({
  filter: {
    EventType: Extraction,
    matches: (event) => event.name === 'dao-rbam/list_assignments',
  },

  endpoint: async () => {
    return {
      type: WebhookType.Url,
      url: `${config.rbamWebhooksBaseUrl}/rbam`,
      method: 'POST',
    }
  },

  getValue: async (event, getLastEvent, env) => {
    const rbamAddress = event.address

    const daoAddress = await dao.compute({
      ...env,
      contractAddress: rbamAddress,
    })

    const lastEvent = await getLastEvent()
    const lastAssignments: Assignment[] =
      (lastEvent?.data as { assignments?: Assignment[] })?.assignments ?? []

    const curAssignments: Assignment[] =
      (event.data as { assignments?: Assignment[] }).assignments ?? []

    const curRoles: Role[] = await roles.compute({
      ...env,
      contractAddress: rbamAddress,
    })

    //  Diff assignments per role.
    const cur = groupByRole(curAssignments)
    const last = groupByRole(lastAssignments)
    const roleIds = new Set<number>([...cur.keys(), ...last.keys()])
    const roleNameById = new Map(curRoles.map((r) => [r.id, r.name]))

    const changes = [] as Array<{
      role_id: number
      role_name: string
      added: string[]
      removed: string[]
    }>

    for (const roleId of roleIds) {
      const now = cur.get(roleId) ?? new Set<string>()
      const before = last.get(roleId) ?? new Set<string>()
      const added = [...now].filter((a) => !before.has(a)).sort()
      const removed = [...before].filter((a) => !now.has(a)).sort()
      const roleName = roleNameById.get(roleId)
      if (roleName && (added.length || removed.length)) {
        changes.push({
          role_id: roleId,
          role_name: roleName,
          added,
          removed,
        })
      }
    }

    // Skip if no changes
    if (changes.length === 0) return undefined

    return {
      dao: daoAddress,
      changes,
    }
  },
})

function groupByRole(list: Assignment[]) {
  const m = new Map<number, Set<string>>()
  for (const a of list) {
    if (!m.has(a.role_id)) m.set(a.role_id, new Set())
    m.get(a.role_id)!.add(a.addr)
  }
  return m
}
