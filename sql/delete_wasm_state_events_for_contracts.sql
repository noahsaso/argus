\timing

SET client_min_messages TO NOTICE;

-- Create temp table with only the contracts we want to delete

CREATE TEMPORARY TABLE contracts_to_delete AS
SELECT "address" FROM "Contracts" WHERE "codeId" NOT IN (...CODE IDS...);

-- Create procedure to delete the data

CREATE OR REPLACE PROCEDURE delete_contracts_iteratively()
LANGUAGE plpgsql
AS $$
DECLARE
    affected_rows INTEGER;
    total_deleted INTEGER := 0;
    contract_count INTEGER := (SELECT COUNT(*) FROM contracts_to_delete);
    batch_size INTEGER := 50000;
    contract_batch_size INTEGER := 250;
    iteration INTEGER := 0;
    contract_addresses TEXT[];
BEGIN
    RAISE NOTICE 'Starting deletion process for % contracts', contract_count;

    LOOP
        iteration := iteration + 1;

        -- Get a batch of contract addresses to process together
        SELECT ARRAY(
            SELECT "address" 
            FROM contracts_to_delete 
            LIMIT contract_batch_size
        ) INTO contract_addresses;

        -- Exit if no more contracts to process
        IF array_length(contract_addresses, 1) IS NULL THEN
            EXIT;
        END IF;
        
        -- Delete rows for this batch of contracts
        DELETE FROM "WasmStateEvents" 
        WHERE "contractAddress" = ANY(contract_addresses)
        AND ("contractAddress", "key", "blockHeight") IN (
            SELECT "contractAddress", "key", "blockHeight"
            FROM "WasmStateEvents"
            WHERE "contractAddress" = ANY(contract_addresses)
            LIMIT batch_size
        );

        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        total_deleted := total_deleted + affected_rows;

        IF affected_rows > 0 THEN
            RAISE NOTICE 'Iteration %: Deleted % rows for % contracts (total deleted: %)', 
                         iteration, affected_rows, array_length(contract_addresses, 1), total_deleted;
            
            -- Small pause to prevent overwhelming the database
            PERFORM pg_sleep(0.1);
        ELSE
            -- No more rows found for these contracts, remove them from the temp table
            DELETE FROM contracts_to_delete 
            WHERE "address" = ANY(contract_addresses);
            
            RAISE NOTICE 'Completed deletion for % contracts. Remaining contracts: %', 
                         array_length(contract_addresses, 1), 
                         (SELECT COUNT(*) FROM contracts_to_delete);
        END IF;

        -- Longer pause every 10 iterations
        IF iteration % 10 = 0 THEN
            RAISE NOTICE 'Completed % iterations. Total rows deleted: %', iteration, total_deleted;
            PERFORM pg_sleep(0.5);
        END IF;

        COMMIT;
    END LOOP;

    RAISE NOTICE 'Deletion complete. Total iterations: %, Total rows deleted: %', iteration, total_deleted;
END $$;

CALL delete_contracts_iteratively();

VACUUM ANALYZE "WasmStateEvents";