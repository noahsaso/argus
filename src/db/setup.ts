import fs from 'fs'

import { QueryTypes, Sequelize } from 'sequelize'

export const setup = async (
  sequelize: Sequelize,
  force = true,
  type: 'data' | 'accounts'
) => {
  if (type === 'data') {
    // Add trigram index extension.
    await sequelize.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;')
    await sequelize.query('CREATE EXTENSION IF NOT EXISTS btree_gin;')

    // Add timescaledb extension.
    await sequelize.query('CREATE EXTENSION IF NOT EXISTS timescaledb;')
  }

  // Drop all tables and recreate them.
  await sequelize.sync({ force })
}

/**
 * The same file pattern sequelize-cli uses to find migrations in a folder.
 */
const MIGRATION_FILE_PATTERN = /^(?!.*\.d\.ts$).*\.(cjs|js|cts|ts)$/

/**
 * List the migration names in a migrations folder, as sequelize-cli records
 * them in `SequelizeMeta` (the file name, including its extension). Returns an
 * empty list if the folder does not exist.
 */
export const getMigrationNames = (migrationsPath: string): string[] =>
  fs.existsSync(migrationsPath)
    ? fs
        .readdirSync(migrationsPath)
        .filter((file) => MIGRATION_FILE_PATTERN.test(file))
        .sort()
    : []

/**
 * Create the `SequelizeMeta` table if it does not exist, matching the table
 * sequelize-cli creates.
 */
const ensureSequelizeMeta = async (sequelize: Sequelize) => {
  await sequelize.query(
    'CREATE TABLE IF NOT EXISTS "SequelizeMeta" ("name" VARCHAR(255) NOT NULL UNIQUE, PRIMARY KEY ("name"));'
  )
}

export type MarkMigrationsAsRunResult = {
  /**
   * Whether the migrations were recorded as run.
   */
  marked: boolean
  /**
   * The migration names inserted into `SequelizeMeta` (excluding ones already
   * there).
   */
  inserted: string[]
}

/**
 * Record every migration in a migrations folder as run in `SequelizeMeta`, so
 * that sequelize-cli does not try to rerun them on a database whose tables were
 * just created from the current models by `setup`.
 *
 * This only happens when the tables match the current models: when they were
 * just recreated (`force`), or when the database has no record of any of these
 * migrations yet (a fresh database). On a database that already has migration
 * history, tables that already existed were not altered by the model sync, so
 * any migrations that have not run yet are left pending for
 * `npm run db:migrate:<type>`.
 *
 * Safe to run more than once.
 */
export const markMigrationsAsRun = async (
  sequelize: Sequelize,
  migrationsPath: string,
  { force = false }: { force?: boolean } = {}
): Promise<MarkMigrationsAsRunResult> => {
  const names = getMigrationNames(migrationsPath)
  if (!names.length) {
    return {
      marked: false,
      inserted: [],
    }
  }

  await ensureSequelizeMeta(sequelize)

  const executed = new Set(
    (
      await sequelize.query<{ name: string }>(
        'SELECT "name" FROM "SequelizeMeta";',
        {
          type: QueryTypes.SELECT,
        }
      )
    ).map(({ name }) => name)
  )

  const hasHistory = names.some((name) => executed.has(name))
  if (hasHistory && !force) {
    return {
      marked: false,
      inserted: [],
    }
  }

  const inserted = names.filter((name) => !executed.has(name))
  for (const name of inserted) {
    await sequelize.query(
      'INSERT INTO "SequelizeMeta" ("name") VALUES (?) ON CONFLICT ("name") DO NOTHING;',
      {
        replacements: [name],
      }
    )
  }

  return {
    marked: true,
    inserted,
  }
}
