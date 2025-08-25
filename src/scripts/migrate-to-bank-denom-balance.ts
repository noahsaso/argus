import { Op, QueryTypes } from 'sequelize'

import { BankBalance, BankDenomBalance, Block, loadDb } from '@/db'
import { DbType } from '@/types'

async function main() {
  console.log('Starting bank denom balance migration...')

  await loadDb({
    type: DbType.Data,
  })

  try {
    const initialBankBalanceCount = await BankBalance.count()
    console.log(
      `Found ${initialBankBalanceCount.toLocaleString()} bank balances to migrate`
    )

    // Migrate in batches of 3000.
    let processed = 0
    let updated = 0
    const batchSize = 3000
    let lastAddress: string | undefined = undefined

    while (processed < initialBankBalanceCount) {
      console.log('Processing batch...')

      const bankBalanceBatch: BankBalance[] = await BankBalance.findAll({
        where: {
          ...(lastAddress ? { address: { [Op.gt]: lastAddress } } : {}),
        },
        order: [['address', 'ASC']],
        limit: batchSize,
      })

      // Build values for bulk insert with timestamps
      let updates = await Promise.all(
        bankBalanceBatch.map(async (bankBalance) => ({
          bankBalance,
          updates: await Promise.all(
            Object.entries(bankBalance.balances).map(
              async ([denom, balance]) => {
                // Fallback to 0 block height if no denom update block height
                // is found (should never happen).
                const blockHeight =
                  bankBalance.denomUpdateBlockHeights[denom] || '0'
                // Default to 0 block time if not found in DB.
                let blockTimeUnixMs = '0'
                let blockTimestamp = new Date(0)
                if (blockHeight !== '0') {
                  const block =
                    (await Block.findByPk(blockHeight)) ||
                    (await Block.getForHeight(blockHeight))
                  if (block) {
                    blockTimeUnixMs = block.timeUnixMs
                    blockTimestamp = block.timestamp
                  }
                }

                return [
                  bankBalance.address,
                  denom,
                  balance,
                  blockHeight,
                  blockTimeUnixMs,
                  blockTimestamp,
                ] as const
              }
            )
          ),
        }))
      )

      // Cap total updates to 7,000, stopping before the first update that
      // would exceed the limit, unless there is only one update.
      let totalUpdates = 0
      for (let i = 0; i < updates.length; i++) {
        const update = updates[i]
        totalUpdates += update.updates.length
        if (totalUpdates > 7000 && i > 0) {
          // Skip the current and remaining updates.
          updates = updates.slice(0, i)
          break
        }
      }

      processed += updates.length
      lastAddress =
        updates.length > 0
          ? updates[updates.length - 1].bankBalance.address
          : undefined

      if (updates.length > 0) {
        const values = updates.flatMap((update) => update.updates).flat()
        const valueStrings = updates
          .flatMap((update) => update.updates)
          .map(
            (_, index) =>
              `($${index * 6 + 1}, $${index * 6 + 2}, $${index * 6 + 3}, $${
                index * 6 + 4
              }, $${index * 6 + 5}, $${index * 6 + 6}, NOW(), NOW())`
          )
          .join(', ')

        const query = `
        INSERT INTO "${BankDenomBalance.tableName}" (
          "address", "denom", "balance", "blockHeight",
          "blockTimeUnixMs", "blockTimestamp", "createdAt", "updatedAt"
        )
        VALUES ${valueStrings}
        ON CONFLICT ("address", "denom")
        DO UPDATE SET
          "balance" = CASE
            WHEN EXCLUDED."blockHeight"::bigint > "BankDenomBalances"."blockHeight"::bigint 
            THEN EXCLUDED."balance"
            ELSE "BankDenomBalances"."balance"
          END,
          "blockHeight" = CASE
            WHEN EXCLUDED."blockHeight"::bigint > "BankDenomBalances"."blockHeight"::bigint 
            THEN EXCLUDED."blockHeight"
            ELSE "BankDenomBalances"."blockHeight"
          END,
          "blockTimeUnixMs" = CASE
            WHEN EXCLUDED."blockHeight"::bigint > "BankDenomBalances"."blockHeight"::bigint 
            THEN EXCLUDED."blockTimeUnixMs"
            ELSE "BankDenomBalances"."blockTimeUnixMs"
          END,
          "blockTimestamp" = CASE
            WHEN EXCLUDED."blockHeight"::bigint > "BankDenomBalances"."blockHeight"::bigint 
            THEN EXCLUDED."blockTimestamp"
            ELSE "BankDenomBalances"."blockTimestamp"
          END,
          "updatedAt" = NOW()
        RETURNING id;
      `

        const results = await BankDenomBalance.sequelize!.query(query, {
          bind: values,
          type: QueryTypes.SELECT,
        })

        // Delete BankBalances that were updated.
        await BankBalance.destroy({
          where: {
            address: {
              [Op.in]: updates.map((update) => update.bankBalance.address),
            },
          },
        })

        console.log(
          `Updated ${results.length.toLocaleString()} bank denom balances`
        )

        updated += updates.length
      }

      console.log(
        `Processed ${processed.toLocaleString()}/${initialBankBalanceCount.toLocaleString()} bank balances (${updated.toLocaleString()} updated)`
      )

      // Small delay between batches to avoid overwhelming the database
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const remainingBankBalanceCount = await BankBalance.count()

    console.log(`Migration completed!`)
    console.log(`- Total processed: ${processed.toLocaleString()}`)
    console.log(`- Total updated: ${updated.toLocaleString()}`)
    console.log(`- Skipped (no block found): ${processed - updated}`)
    console.log(
      `- Deleted bank balances: ${(
        initialBankBalanceCount - remainingBankBalanceCount
      ).toLocaleString()}`
    )
    console.log(
      `- Remaining bank balances: ${remainingBankBalanceCount.toLocaleString()}`
    )
    process.exit(0)
  } catch (error) {
    console.error('Error during migration:', error)
    process.exit(1)
  }
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('Migration script failed:', error)
    process.exit(1)
  })
