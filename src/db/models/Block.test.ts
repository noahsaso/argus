import { QueryInterface, QueryTypes } from 'sequelize'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { Block } from '@/db'

type Migration = {
  up(queryInterface: QueryInterface): Promise<void>
  down(queryInterface: QueryInterface): Promise<void>
}

// Data migrations assign `module.exports` for sequelize-cli, so TypeScript
// sees no exports. Load it through a dynamic import, which vitest resolves to
// the `module.exports` object as the default export.
const MIGRATION_PATH =
  '../migrations/data/20261126200000-add-blocks-time-unix-ms-index'
let migration: Migration
beforeAll(async () => {
  migration = (await import(MIGRATION_PATH)).default
})

type IndexRow = {
  name: string
  valid: boolean
  definition: string
}

const getSequelize = () => {
  if (!Block.sequelize) {
    throw new Error('Block model is not initialized')
  }
  return Block.sequelize
}

const getBlockIndexes = async (): Promise<IndexRow[]> =>
  await getSequelize().query<IndexRow>(
    `
      SELECT c.relname AS "name",
             i.indisvalid AS "valid",
             pg_get_indexdef(i.indexrelid) AS "definition"
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = '"Blocks"'::regclass
      ORDER BY c.relname
    `,
    { type: QueryTypes.SELECT }
  )

const getTimeIndexes = async () =>
  (await getBlockIndexes()).filter(({ definition }) =>
    definition.includes('"timeUnixMs"')
  )

const runUp = () => migration.up(getSequelize().getQueryInterface())

describe('Block', () => {
  describe('model indexes', () => {
    it('only declares the primary key and the timeUnixMs index', async () => {
      const indexes = await getBlockIndexes()

      expect(indexes.map(({ name }) => name)).toEqual([
        'Blocks_pkey',
        'blocks_time_unix_ms',
      ])
    })
  })

  describe('add blocks timeUnixMs index migration', () => {
    it('creates the index when it is missing', async () => {
      await getSequelize().query('DROP INDEX "blocks_time_unix_ms"')
      expect(await getTimeIndexes()).toEqual([])

      await runUp()

      const indexes = await getTimeIndexes()
      expect(indexes).toHaveLength(1)
      expect(indexes[0]).toMatchObject({
        name: 'blocks_time_unix_ms',
        valid: true,
      })
      expect(indexes[0].definition).toMatch(
        /ON public\."Blocks" USING btree \("timeUnixMs"\)$/
      )
    })

    it('builds the index concurrently', async () => {
      await getSequelize().query('DROP INDEX "blocks_time_unix_ms"')

      const querySpy = vi.spyOn(getSequelize(), 'query')
      try {
        await runUp()
        expect(querySpy).toHaveBeenCalledWith(
          'CREATE INDEX CONCURRENTLY IF NOT EXISTS "blocks_time_unix_ms" ON "Blocks" ("timeUnixMs")'
        )
      } finally {
        querySpy.mockRestore()
      }
    })

    it('leaves an existing index alone', async () => {
      // `sync` already created it, like on databases that were set up with
      // db:setup, or where it was created by hand before migrating.
      const before = await getTimeIndexes()
      expect(before).toHaveLength(1)

      await runUp()

      expect(await getTimeIndexes()).toEqual(before)
    })

    it('is idempotent', async () => {
      await getSequelize().query('DROP INDEX "blocks_time_unix_ms"')

      await runUp()
      await runUp()

      const indexes = await getTimeIndexes()
      expect(indexes).toHaveLength(1)
      expect(indexes[0]).toMatchObject({
        name: 'blocks_time_unix_ms',
        valid: true,
      })
    })

    it('rebuilds an invalid index left by a failed concurrent build', async () => {
      // Simulate an interrupted CREATE INDEX CONCURRENTLY.
      await getSequelize().query(`
        UPDATE pg_index SET indisvalid = false
        WHERE indexrelid = '"blocks_time_unix_ms"'::regclass
      `)
      expect(await getTimeIndexes()).toMatchObject([{ valid: false }])

      await runUp()

      expect(await getTimeIndexes()).toMatchObject([
        { name: 'blocks_time_unix_ms', valid: true },
      ])
    })

    it('keeps the index on down', async () => {
      await migration.down(getSequelize().getQueryInterface())

      expect(await getTimeIndexes()).toMatchObject([
        { name: 'blocks_time_unix_ms', valid: true },
      ])
    })
  })
})
