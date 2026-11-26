import path from 'path'

import { QueryTypes, Sequelize } from 'sequelize'
import { beforeEach, describe, expect, it } from 'vitest'

import { DbType } from '@/types'

import { loadDb } from './connection'
import { getMigrationNames, markMigrationsAsRun, setup } from './setup'

const MIGRATIONS_PATH = path.join(
  process.cwd(),
  'src',
  'db',
  'migrations',
  'data'
)

/**
 * Drop every table and type in the public schema, leaving an empty database
 * (extensions stay installed).
 */
const emptyDatabase = async (sequelize: Sequelize) => {
  await sequelize.query(`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
      FOR r IN
        SELECT t.typname FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype = 'e'
      LOOP
        EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
      END LOOP;
    END $$;
  `)
}

const tableExists = (sequelize: Sequelize, table: string) =>
  sequelize.getQueryInterface().tableExists(table)

const getExecutedMigrations = async (sequelize: Sequelize) => {
  if (!(await tableExists(sequelize, 'SequelizeMeta'))) {
    return []
  }

  return (
    await sequelize.query<{ name: string }>(
      'SELECT "name" FROM "SequelizeMeta" ORDER BY "name";',
      {
        type: QueryTypes.SELECT,
      }
    )
  ).map(({ name }) => name)
}

const getPrimaryKeyColumns = async (sequelize: Sequelize, table: string) =>
  (
    await sequelize.query<{ column: string }>(
      `SELECT a.attname AS "column"
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = quote_ident(?)::regclass AND i.indisprimary
      ORDER BY a.attname;`,
      {
        replacements: [table],
        type: QueryTypes.SELECT,
      }
    )
  ).map(({ column }) => column)

const loadMigration = async (name: string) => {
  const migration = await import(path.join(MIGRATIONS_PATH, name))
  return (migration.default ?? migration) as {
    up: (...args: unknown[]) => Promise<void>
  }
}

/**
 * Run pending migrations the way `sequelize-cli db:migrate` does: create
 * `SequelizeMeta` if needed, run each migration not recorded there in name
 * order, and record it. Returns the names of the migrations that ran.
 */
const runPendingMigrations = async (sequelize: Sequelize) => {
  await sequelize.query(
    'CREATE TABLE IF NOT EXISTS "SequelizeMeta" ("name" VARCHAR(255) NOT NULL UNIQUE, PRIMARY KEY ("name"));'
  )

  const executed = await getExecutedMigrations(sequelize)
  const pending = getMigrationNames(MIGRATIONS_PATH).filter(
    (name) => !executed.includes(name)
  )

  for (const name of pending) {
    const { up } = await loadMigration(name)
    await up(sequelize.getQueryInterface(), Sequelize)
    await sequelize.query('INSERT INTO "SequelizeMeta" ("name") VALUES (?);', {
      replacements: [name],
    })
  }

  return pending
}

describe('database setup and migrations', () => {
  let sequelize: Sequelize
  let migrationNames: string[]

  beforeEach(async () => {
    sequelize = await loadDb({
      type: DbType.Data,
    })
    migrationNames = getMigrationNames(MIGRATIONS_PATH)

    // Start every test from an empty database.
    await emptyDatabase(sequelize)
  })

  it('lists migration files the way sequelize-cli names them', () => {
    expect(migrationNames.length).toBeGreaterThan(0)
    expect(migrationNames).toContain(
      '20230315214907-rename-wasm-state-event-tables.ts'
    )
    expect(migrationNames).toEqual([...migrationNames].sort())
    expect(getMigrationNames(path.join(MIGRATIONS_PATH, 'missing'))).toEqual([])
  })

  it('records every migration on a fresh database set up from models, so none run afterwards', async () => {
    await setup(sequelize, false, 'data')

    const result = await markMigrationsAsRun(sequelize, MIGRATIONS_PATH)
    expect(result).toEqual({
      marked: true,
      inserted: migrationNames,
    })

    // The real migration names, not the folder names.
    expect(await getExecutedMigrations(sequelize)).toEqual(migrationNames)

    expect(await runPendingMigrations(sequelize)).toEqual([])
  })

  it('is idempotent when setup runs again', async () => {
    await setup(sequelize, false, 'data')
    await markMigrationsAsRun(sequelize, MIGRATIONS_PATH)

    await setup(sequelize, false, 'data')
    expect(await markMigrationsAsRun(sequelize, MIGRATIONS_PATH)).toEqual({
      marked: false,
      inserted: [],
    })
    expect(
      await markMigrationsAsRun(sequelize, MIGRATIONS_PATH, { force: true })
    ).toEqual({
      marked: true,
      inserted: [],
    })

    expect(await getExecutedMigrations(sequelize)).toEqual(migrationNames)
    expect(await runPendingMigrations(sequelize)).toEqual([])
  })

  it('runs every migration on a fresh empty database, and setup afterwards completes the schema', async () => {
    expect(await runPendingMigrations(sequelize)).toEqual(migrationNames)

    // Same order as `npm run db:init`: migrations, then setup.
    await setup(sequelize, false, 'data')
    expect(await markMigrationsAsRun(sequelize, MIGRATIONS_PATH)).toEqual({
      marked: false,
      inserted: [],
    })

    expect(await getExecutedMigrations(sequelize)).toEqual(migrationNames)
    expect(await runPendingMigrations(sequelize)).toEqual([])

    for (const table of [
      'BankStateEvents',
      'Blocks',
      'Contracts',
      'Extractions',
      'GovProposals',
      'GovProposalVotes',
      'States',
      'WasmStateEvents',
      'WasmStateEventTransformations',
    ]) {
      expect(await tableExists(sequelize, table)).toBe(true)
    }

    // The create-gov-proposal-vote migration makes an integer id, which the
    // pkey migration widens to match the model.
    const govProposalVotes = await sequelize
      .getQueryInterface()
      .describeTable('GovProposalVotes')
    expect(govProposalVotes.id.type).toBe('BIGINT')
    expect(await getPrimaryKeyColumns(sequelize, 'GovProposalVotes')).toEqual([
      'id',
    ])
  })

  it('leaves pending migrations to run on a database that already has migration history', async () => {
    await runPendingMigrations(sequelize)
    await setup(sequelize, false, 'data')

    // Pretend the latest migration was added after this database was migrated.
    const latest = migrationNames[migrationNames.length - 1]
    await sequelize.query('DELETE FROM "SequelizeMeta" WHERE "name" = ?;', {
      replacements: [latest],
    })

    await setup(sequelize, false, 'data')
    expect(await markMigrationsAsRun(sequelize, MIGRATIONS_PATH)).toEqual({
      marked: false,
      inserted: [],
    })
    expect(await getExecutedMigrations(sequelize)).not.toContain(latest)

    expect(await runPendingMigrations(sequelize)).toEqual([latest])
  })

  it('records missing migrations when the tables were just recreated', async () => {
    await runPendingMigrations(sequelize)
    const latest = migrationNames[migrationNames.length - 1]
    await sequelize.query('DELETE FROM "SequelizeMeta" WHERE "name" = ?;', {
      replacements: [latest],
    })

    await setup(sequelize, true, 'data')
    expect(
      await markMigrationsAsRun(sequelize, MIGRATIONS_PATH, { force: true })
    ).toEqual({
      marked: true,
      inserted: [latest],
    })
    expect(await runPendingMigrations(sequelize)).toEqual([])
  })

  it('repairs a database that an older setup marked with folder names', async () => {
    await setup(sequelize, false, 'data')
    await sequelize.query(
      'CREATE TABLE "SequelizeMeta" ("name" VARCHAR(255) NOT NULL UNIQUE, PRIMARY KEY ("name"));'
    )
    await sequelize.query(
      `INSERT INTO "SequelizeMeta" ("name") VALUES ('data'), ('accounts');`
    )

    expect(await markMigrationsAsRun(sequelize, MIGRATIONS_PATH)).toEqual({
      marked: true,
      inserted: migrationNames,
    })
    expect(await runPendingMigrations(sequelize)).toEqual([])
  })

  it('does nothing for a migrations folder that does not exist', async () => {
    expect(
      await markMigrationsAsRun(
        sequelize,
        path.join(MIGRATIONS_PATH, '..', 'missing')
      )
    ).toEqual({
      marked: false,
      inserted: [],
    })
    expect(await tableExists(sequelize, 'SequelizeMeta')).toBe(false)
  })

  describe('migrations that skip missing tables still apply when the tables exist', () => {
    it('renames the old wasm event tables', async () => {
      await sequelize.query('CREATE TABLE "WasmEvents" ("id" INTEGER);')
      await sequelize.query(
        'CREATE TABLE "WasmEventTransformations" ("id" INTEGER);'
      )

      const { up } = await loadMigration(
        '20230315214907-rename-wasm-state-event-tables.ts'
      )
      await up(sequelize.getQueryInterface(), Sequelize)

      expect(await tableExists(sequelize, 'WasmEvents')).toBe(false)
      expect(await tableExists(sequelize, 'WasmEventTransformations')).toBe(
        false
      )
      expect(await tableExists(sequelize, 'WasmStateEvents')).toBe(true)
      expect(
        await tableExists(sequelize, 'WasmStateEventTransformations')
      ).toBe(true)
    })

    it('does not create the renamed tables when the old ones are missing', async () => {
      const { up } = await loadMigration(
        '20230315214907-rename-wasm-state-event-tables.ts'
      )
      await up(sequelize.getQueryInterface(), Sequelize)

      expect(await tableExists(sequelize, 'WasmStateEvents')).toBe(false)
      expect(
        await tableExists(sequelize, 'WasmStateEventTransformations')
      ).toBe(false)
    })

    it('adds a column to an existing table', async () => {
      await setup(sequelize, false, 'data')
      await sequelize
        .getQueryInterface()
        .removeColumn('States', 'listenerLatestBlockHeight')

      const { up } = await loadMigration(
        '20261120160000-add-listener-latest-block-height-to-state.ts'
      )
      await up(sequelize.getQueryInterface(), Sequelize)

      const columns = await sequelize
        .getQueryInterface()
        .describeTable('States')
      expect(columns.listenerLatestBlockHeight).toBeDefined()
    })

    it('adds the id column to an existing table without one', async () => {
      await sequelize.query(
        'CREATE TABLE "GovProposalVotes" ("proposalId" BIGINT NOT NULL, "voterAddress" VARCHAR(255) NOT NULL, "blockHeight" BIGINT NOT NULL, PRIMARY KEY ("proposalId", "voterAddress", "blockHeight"));'
      )

      const { up } = await loadMigration(
        '20250813001028-migrate-pkey-unique-indexes.ts'
      )
      await up(sequelize.getQueryInterface(), Sequelize)

      // The original behaviour: the composite primary key is dropped and an
      // auto-incrementing bigint id column is added (addColumn does not make it
      // the primary key).
      const columns = await sequelize
        .getQueryInterface()
        .describeTable('GovProposalVotes')
      expect(columns.id.type).toBe('BIGINT')
      expect(columns.id.defaultValue).toContain('nextval')
      expect(await getPrimaryKeyColumns(sequelize, 'GovProposalVotes')).toEqual(
        []
      )
    })
  })
})
