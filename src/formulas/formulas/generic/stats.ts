import { GenericFormula } from '@/types'
import { dbKeyForKeys } from '@/utils'

export const daos: GenericFormula<
  number,
  {
    // Optionally only return results for the last N days.
    daysAgo?: string
  }
> = {
  docs: {
    description: 'counts the number of DAOs created',
    args: [
      {
        name: 'daysAgo',
        description: 'optionally only return results for the last N days',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  dynamic: true,
  compute: async ({ query, date, args }) => {
    const daysAgo = args.daysAgo ? Number(args.daysAgo) : undefined
    if (typeof daysAgo === 'number' && (isNaN(daysAgo) || daysAgo <= 0)) {
      throw new Error('daysAgo must be a positive number')
    }

    // sg_dao and cw3_dao are beta/legacy DAO DAO (v0.2.5 and v0.3.0)
    const [{ count }] = await query(
      `SELECT COUNT(*) as "count" FROM (
        SELECT DISTINCT ON (address) address FROM (
          SELECT "contractAddress" as address FROM "WasmStateEvents" 
          WHERE "key" = '${dbKeyForKeys(
            'contract_info'
          )}' AND ("value" LIKE '%cw-core%' OR "value" LIKE '%cwd-core%' OR "value" LIKE '%dao-core%' OR "value" LIKE '%sg_dao%' OR "value" LIKE '%cw3_dao%') AND "blockTimeUnixMs" <= $end ${
        daysAgo ? 'AND "blockTimeUnixMs" >= $start' : ''
      }
          UNION ALL
          SELECT "address" FROM "Extractions" 
          WHERE "name" = 'info' AND ("data"->>'contract' LIKE '%cw-core%' OR "data"->>'contract' LIKE '%cwd-core%' OR "data"->>'contract' LIKE '%dao-core%' OR "data"->>'contract' LIKE '%sg_dao%' OR "data"->>'contract' LIKE '%cw3_dao%') AND "blockTimeUnixMs" <= $end ${
            daysAgo ? 'AND "blockTimeUnixMs" >= $start' : ''
          }
        ) combined_daos
        ORDER BY address
      ) tmp`,
      {
        end: date.getTime(),
        ...(daysAgo
          ? {
              start: date.getTime() - daysAgo * 24 * 60 * 60 * 1000,
            }
          : {}),
      }
    )

    return Number(count)
  },
}

export const proposals: GenericFormula<
  number,
  {
    // Optionally only return results for the last N days.
    daysAgo?: string
  }
> = {
  docs: {
    description: 'counts the number of proposals created',
    args: [
      {
        name: 'daysAgo',
        description: 'optionally only return results for the last N days',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  dynamic: true,
  compute: async ({ query, date, args }) => {
    const daysAgo = args.daysAgo ? Number(args.daysAgo) : undefined
    if (typeof daysAgo === 'number' && (isNaN(daysAgo) || daysAgo <= 0)) {
      throw new Error('daysAgo must be a positive number')
    }

    const [{ count }] = await query(
      `SELECT COUNT(*) as "count" FROM (
        SELECT DISTINCT ON (address, name) name FROM (
          SELECT "contractAddress" as address, "name" FROM "WasmStateEventTransformations" 
          WHERE "name" LIKE 'proposal:%' AND "blockTimeUnixMs" <= $end ${
            daysAgo ? 'AND "blockTimeUnixMs" >= $start' : ''
          }
          UNION ALL
          SELECT "address", "name" FROM "Extractions" 
          WHERE "name" LIKE 'proposal:%' AND "blockTimeUnixMs" <= $end ${
            daysAgo ? 'AND "blockTimeUnixMs" >= $start' : ''
          }
        ) combined_proposals
        ORDER BY address, name
      ) tmp`,
      {
        end: date.getTime(),
        ...(daysAgo
          ? {
              start: date.getTime() - daysAgo * 24 * 60 * 60 * 1000,
            }
          : {}),
      }
    )

    return Number(count)
  },
}

export const votes: GenericFormula<
  number,
  {
    // Optionally only return results for the last N days.
    daysAgo?: string
  }
> = {
  docs: {
    description: 'counts the number of votes cast',
    args: [
      {
        name: 'daysAgo',
        description: 'optionally only return results for the last N days',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  dynamic: true,
  compute: async ({ query, date, args }) => {
    const daysAgo = args.daysAgo ? Number(args.daysAgo) : undefined
    if (typeof daysAgo === 'number' && (isNaN(daysAgo) || daysAgo <= 0)) {
      throw new Error('daysAgo must be a positive number')
    }

    const [{ count }] = await query(
      `SELECT COUNT(*) AS "count" FROM (
        SELECT DISTINCT ON (address, name) name FROM (
          SELECT "contractAddress" as address, "name" FROM "WasmStateEventTransformations" 
          WHERE "name" LIKE 'voteCast:%' AND "blockTimeUnixMs" <= $end ${
            daysAgo ? 'AND "blockTimeUnixMs" >= $start' : ''
          }
          UNION ALL
          SELECT "address", "name" FROM "Extractions" 
          WHERE "name" LIKE 'voteCast:%' AND "blockTimeUnixMs" <= $end ${
            daysAgo ? 'AND "blockTimeUnixMs" >= $start' : ''
          }
        ) combined_votes
        ORDER BY address, name
      ) tmp`,
      {
        end: date.getTime(),
        ...(daysAgo
          ? {
              start: date.getTime() - daysAgo * 24 * 60 * 60 * 1000,
            }
          : {}),
      }
    )

    return Number(count)
  },
}

export const uniqueVoters: GenericFormula<
  number,
  {
    // Optionally only return results for the last N days.
    daysAgo?: string
  }
> = {
  docs: {
    description: 'counts the number of unique voters',
    args: [
      {
        name: 'daysAgo',
        description: 'optionally only return results for the last N days',
        required: false,
        schema: {
          type: 'integer',
        },
      },
    ],
  },
  dynamic: true,
  compute: async ({ query, date, args }) => {
    const daysAgo = args.daysAgo ? Number(args.daysAgo) : undefined
    if (typeof daysAgo === 'number' && (isNaN(daysAgo) || daysAgo <= 0)) {
      throw new Error('daysAgo must be a positive number')
    }

    const [{ count }] = await query(
      `SELECT COUNT(*) as "count" FROM (
        SELECT DISTINCT voter FROM (
          SELECT value->>'voter' as voter FROM "WasmStateEventTransformations" 
          WHERE "name" LIKE 'voteCast:%' AND "blockTimeUnixMs" <= $end ${
            daysAgo ? 'AND "blockTimeUnixMs" >= $start' : ''
          }
          UNION
          SELECT data->>'voter' as voter FROM "Extractions" 
          WHERE "name" LIKE 'voteCast:%' AND "blockTimeUnixMs" <= $end ${
            daysAgo ? 'AND "blockTimeUnixMs" >= $start' : ''
          }
        ) combined_voters
        WHERE voter IS NOT NULL
      ) tmp`,
      {
        end: date.getTime(),
        ...(daysAgo
          ? {
              start: date.getTime() - daysAgo * 24 * 60 * 60 * 1000,
            }
          : {}),
      }
    )

    return Number(count)
  },
}
