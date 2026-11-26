import { QueryInterface } from 'sequelize'

// Same name Sequelize generates for the model's `{ fields: ['timeUnixMs'] }`
// index, so a later `sync` sees it as existing and does not build a second one.
const INDEX_NAME = 'blocks_time_unix_ms'

/**
 * Add the `timeUnixMs` index declared by the Block model.
 *
 * The create-block migration only created the primary key, and model indexes
 * are only created by `sequelize.sync`, so databases that were only ever
 * migrated have no index on `timeUnixMs`, and every `Block.getForTime` lookup
 * is a full table scan. Some databases already have the index (from `sync`, or
 * created by hand before this migration ran), so this must be idempotent.
 *
 * The index is built with `CREATE INDEX CONCURRENTLY` so it does not block the
 * tracer's inserts and upserts on `Blocks` while it builds. That cannot run
 * inside a transaction; sequelize-cli does not wrap migrations in one (the
 * create-extraction migration already builds an index concurrently).
 */
module.exports = {
  async up(queryInterface: QueryInterface) {
    // A failed or interrupted concurrent build leaves an INVALID index behind.
    // `IF NOT EXISTS` would skip it and leave the table without a usable
    // index, so drop an invalid one first and build it again.
    const [existing] = (await queryInterface.sequelize.query(
      `SELECT i.indisvalid AS "valid" FROM pg_index i WHERE i.indexrelid = to_regclass(:name)`,
      {
        replacements: { name: `"${INDEX_NAME}"` },
      }
    )) as [{ valid: boolean }[], unknown]

    if (existing.length > 0 && !existing[0].valid) {
      await queryInterface.sequelize.query(
        `DROP INDEX CONCURRENTLY IF EXISTS "${INDEX_NAME}"`
      )
    }

    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${INDEX_NAME}" ON "Blocks" ("timeUnixMs")`
    )
  },
  // Intentionally a no-op. The migration cannot tell whether it created the
  // index or found one that `sync` or an operator created earlier, and the
  // Block model still declares it, so dropping it here could remove an index
  // that predates this migration.
  async down() {},
}
