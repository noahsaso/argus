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

/**
 * Tables that setting up a brand-new database fills by itself, so rows in them
 * do not mean the database holds indexed data: `db:migrate:data` seeds the WASM
 * code keys and IDs from config, and the model sync creates the `States`
 * singleton row. Leaving them out keeps `npm run db:init` (migrations, then
 * setup) and a repeated `db:setup` working on an otherwise empty database.
 */
export const POPULATED_CHECK_IGNORED_TABLES = [
  'States',
  'WasmCodeKeyIds',
  'WasmCodeKeys',
]

/**
 * The environment variable that lets the model sync scripts (`db:setup`,
 * `db:init` and `db:alter`) run on a database that already holds data, the same
 * as passing `--allow-populated`.
 */
export const ALLOW_SYNC_ON_POPULATED_DB_ENV = 'ALLOW_SYNC_ON_POPULATED_DB'

/**
 * Whether the environment allows syncing a populated database.
 */
export const isSyncOnPopulatedDbAllowedByEnv = (
  env: NodeJS.ProcessEnv = process.env
): boolean => {
  const value = env[ALLOW_SYNC_ON_POPULATED_DB_ENV]?.trim().toLowerCase()
  return value === 'true' || value === '1'
}

// PostgreSQL escapes a double quote inside an identifier by doubling it.
const quoteIdentifier = (identifier: string) =>
  `"${identifier.replace(/"/g, '""')}"`

/**
 * List the tables of this connection's models that exist and hold at least one
 * row, ignoring `POPULATED_CHECK_IGNORED_TABLES`.
 *
 * Discover matching relations in one catalog query, then probe each with
 * `LIMIT 1` rather than counting its rows.
 */
export const getPopulatedTables = async (
  sequelize: Sequelize
): Promise<string[]> => {
  const queryInterface = sequelize.getQueryInterface()
  const tables = Object.values(sequelize.models)
    .map((model) => {
      const name = model.getTableName()
      // Sequelize folds the connection's schema into each model at init.
      // A bare name is emitted unqualified in PostgreSQL DDL, so resolve it
      // through the search path instead of assuming its first schema has it.
      const { schema = null, tableName: table } =
        typeof name === 'string' ? { tableName: name } : name
      // Sequelize can strip embedded double quotes when generating DDL.
      // Refuse rather than inspect a different relation than sync would use.
      if (
        queryInterface.quoteIdentifier(table) !== quoteIdentifier(table) ||
        (schema &&
          queryInterface.quoteIdentifier(schema) !== quoteIdentifier(schema))
      ) {
        throw new Error(
          `Cannot verify the sync target for ${quoteIdentifier(
            table
          )}: Sequelize changes the spelling or quoting of its PostgreSQL identifiers.`
        )
      }
      return { schema, table }
    })
    .filter(({ table }) => !POPULATED_CHECK_IGNORED_TABLES.includes(table))

  if (!tables.length) {
    return []
  }

  const existing = await sequelize.query<{ schema: string; table: string }>(
    `SELECT DISTINCT n.nspname AS "schema", c.relname AS "table"
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.jsonb_to_recordset(CAST(:tables AS jsonb))
      AS target("schema" name, "table" name)
      ON c.relname = target."table"
      AND (n.nspname = target."schema" OR
        (target."schema" IS NULL AND pg_catalog.pg_table_is_visible(c.oid)))
    WHERE c.relkind IN ('r', 'p')
    ORDER BY "table", "schema";`,
    {
      // Sequelize can prepend SET search_path, which cannot be sent as
      // part of a PostgreSQL prepared statement. Use an escaped replacement.
      replacements: { tables: JSON.stringify(tables) },
      type: QueryTypes.SELECT,
    }
  )

  const populated: string[] = []
  for (const { schema, table } of existing) {
    const relation = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
    const rows = await sequelize.query(`SELECT 1 FROM ${relation} LIMIT 1;`, {
      type: QueryTypes.SELECT,
    })
    if (rows.length) {
      populated.push(schema === 'public' ? table : relation)
    }
  }

  return populated
}

export class PopulatedDatabaseError extends Error {
  constructor(
    public readonly populated: {
      name: string
      tables: string[]
    }[],
    action: string
  ) {
    super(
      [
        `Refusing to ${action}: ${populated
          .map(
            ({ name, tables }) =>
              `the ${name} database already holds data (in ${tables.join(
                ', '
              )})`
          )
          .join('; ')}.`,
        'Syncing the models on an existing database can rebuild dropped indexes, drop columns or rewrite foreign keys on very large tables.',
        'Use `npm run db:migrate:data` and `npm run db:migrate:accounts` to upgrade an existing database.',
        `If you really mean to sync this database, pass --allow-populated or set ${ALLOW_SYNC_ON_POPULATED_DB_ENV}=true.`,
      ].join('\n')
    )
    this.name = 'PopulatedDatabaseError'
  }
}

/**
 * Throw a `PopulatedDatabaseError` if any of these databases already holds
 * data, unless `allowPopulated` is set. An empty database (including one where
 * only migrations have run) passes.
 */
export const assertSyncAllowed = async (
  databases: {
    name: string
    sequelize: Sequelize | null | undefined
  }[],
  {
    action,
    allowPopulated = false,
  }: {
    action: string
    allowPopulated?: boolean
  }
): Promise<void> => {
  if (allowPopulated) {
    return
  }

  const populated: { name: string; tables: string[] }[] = []
  for (const { name, sequelize } of databases) {
    if (!sequelize) {
      continue
    }

    const tables = await getPopulatedTables(sequelize)
    if (tables.length) {
      populated.push({
        name,
        tables,
      })
    }
  }

  if (populated.length) {
    throw new PopulatedDatabaseError(populated, action)
  }
}
