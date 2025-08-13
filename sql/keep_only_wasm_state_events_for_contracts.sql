\timing

SET client_min_messages TO NOTICE;

-- Rename indexes to avoid conflicts

ALTER INDEX wasm_state_events_block_height RENAME TO wasm_state_events_block_height_old;

ALTER INDEX wasm_state_events_contract_address_key_block_height RENAME TO wasm_state_events_contract_address_key_block_height_old;

ALTER INDEX wasm_state_events_key_trgm_idx RENAME TO wasm_state_events_key_trgm_idx_old;

-- Create new table to migrate to

CREATE TABLE "WasmStateEvents_new" (
  "id" BIGSERIAL,
  "contractAddress" VARCHAR(255) NOT NULL REFERENCES "Contracts" ("address") ON DELETE NO ACTION ON UPDATE CASCADE,
  "key" TEXT NOT NULL,
  "blockHeight" BIGINT NOT NULL,
  "blockTimeUnixMs" BIGINT NOT NULL,
  "blockTimestamp" TIMESTAMP WITH TIME ZONE NOT NULL,
  "value" TEXT NOT NULL,
  "valueJson" JSONB,
  "delete" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wasm_state_events_contract_address_key_block_height" ON "WasmStateEvents_new" (
  "contractAddress",
  "key" text_pattern_ops,
  "blockHeight" DESC
);

CREATE INDEX "wasm_state_events_block_height" ON "WasmStateEvents_new" ("blockHeight");

CREATE INDEX CONCURRENTLY "wasm_state_events_key_trgm_idx" ON "WasmStateEvents_new" USING gin ("key" gin_trgm_ops);

-- Create temp table with only the contracts we want to keep

CREATE TEMPORARY TABLE contracts_to_keep AS
SELECT
  "address"
FROM
  "Contracts"
WHERE
  "codeId" IN (...CODE IDS...);

-- Create procedure to migrate the data

CREATE OR REPLACE PROCEDURE migrate_contracts()
LANGUAGE plpgsql
AS $$
DECLARE
  affected_rows INTEGER;
  total_migrated INTEGER := 0;
  contract_count INTEGER := (
    SELECT
      COUNT(*)
    FROM
      contracts_to_keep
  );
  contract_batch_size INTEGER := 100;
  iteration INTEGER := 0;
  contract_addresses TEXT [];
BEGIN
  RAISE NOTICE 'Starting migration process for % contracts', contract_count;

  LOOP
    iteration := iteration + 1;

    -- Get a batch of contract addresses to process together
    SELECT ARRAY(
      SELECT "address"
      FROM contracts_to_keep
      LIMIT contract_batch_size
    ) INTO contract_addresses;

    -- Exit if no more contracts to process
    IF array_length(contract_addresses, 1) IS NULL THEN
      EXIT;
    END IF;

    -- Copy rows for this batch of contracts
    INSERT INTO
      "WasmStateEvents_new" (
        "contractAddress",
        "key",
        "blockHeight",
        "blockTimeUnixMs",
        "blockTimestamp",
        "value",
        "valueJson",
        "delete",
        "createdAt",
        "updatedAt"
      )
    SELECT
      "contractAddress",
      "key",
      "blockHeight",
      "blockTimeUnixMs",
      "blockTimestamp",
      "value",
      "valueJson",
      "delete",
      "createdAt",
      "updatedAt"
    FROM
      "WasmStateEvents"
    WHERE
      "contractAddress" = ANY(contract_addresses)
    ON CONFLICT ("contractAddress", "key", "blockHeight") DO UPDATE SET
      "value" = EXCLUDED."value",
      "valueJson" = EXCLUDED."valueJson",
      "delete" = EXCLUDED."delete",
      "createdAt" = EXCLUDED."createdAt",
      "updatedAt" = EXCLUDED."updatedAt";

    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    total_migrated := total_migrated + affected_rows;

    RAISE NOTICE 'Iteration %: Migrated % rows for % contracts (total migrated: %)', iteration, affected_rows, array_length(contract_addresses, 1), total_migrated;

    DELETE FROM contracts_to_keep
    WHERE "address" = ANY(contract_addresses);

    -- Small pause to prevent overwhelming the database
    PERFORM pg_sleep(0.1);

    -- Longer pause every 10 iterations
    IF iteration % 10 = 0 THEN
      RAISE NOTICE 'Completed % iterations. Total rows migrated: %', iteration, total_migrated;
      PERFORM pg_sleep(0.5);
    END IF;
  END LOOP;

  RAISE NOTICE 'Migration complete. Total iterations: %, Total rows migrated: %', iteration, total_migrated;
END $$;

CALL migrate_contracts();

-- Drop old table and rename new table

DROP TABLE "WasmStateEvents";

ALTER TABLE "WasmStateEvents_new" RENAME TO "WasmStateEvents";

ALTER INDEX "WasmStateEvents_new_pkey" RENAME TO "WasmStateEvents_pkey";

ALTER SEQUENCE "WasmStateEvents_new_id_seq" RENAME TO "WasmStateEvents_id_seq";

ALTER TABLE "WasmStateEvents" RENAME CONSTRAINT "WasmStateEvents_new_contractAddress_fkey" TO "WasmStateEvents_contractAddress_fkey";

VACUUM ANALYZE "WasmStateEvents";
