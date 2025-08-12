#!/usr/bin/env node

import { FeegrantAllowance } from '@/db'
import { parseAllowanceData } from '@/utils'

/**
 * Backfill script to parse existing feegrant allowance data
 * This script will update existing records with parsed fields
 */
async function backfillFeegrantParsedData() {
  console.log('Starting feegrant parsed data backfill...')

  try {
    // Get all allowances that don't have parsed data yet
    const allowances = await FeegrantAllowance.findAll({
      where: {
        parsedAmount: null,
        allowanceData: {
          $ne: '',
        },
      },
      order: [['blockHeight', 'ASC']],
    })

    console.log(`Found ${allowances.length} allowances to backfill`)

    let processed = 0
    let updated = 0

    // Process in batches to avoid memory issues
    const batchSize = 100
    for (let i = 0; i < allowances.length; i += batchSize) {
      const batch = allowances.slice(i, i + batchSize)

      console.log(
        `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
          allowances.length / batchSize
        )}`
      )

      for (const allowance of batch) {
        try {
          // Parse the allowance data
          const parsed = parseAllowanceData(allowance.allowanceData)

          // Update the record if we got any parsed data
          if (
            parsed.amount ||
            parsed.denom ||
            parsed.allowanceType ||
            parsed.expirationUnixMs
          ) {
            await allowance.update({
              parsedAmount: parsed.amount || null,
              parsedDenom: parsed.denom || null,
              parsedAllowanceType: parsed.allowanceType || null,
              parsedExpirationUnixMs: parsed.expirationUnixMs || null,
            })
            updated++
          }

          processed++

          if (processed % 50 === 0) {
            console.log(
              `Processed ${processed}/${allowances.length} allowances (${updated} updated)`
            )
          }
        } catch (error) {
          console.error(`Error processing allowance ${allowance.id}:`, error)
        }
      }

      // Small delay between batches to avoid overwhelming the database
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    console.log(`Backfill completed!`)
    console.log(`- Total processed: ${processed}`)
    console.log(`- Total updated: ${updated}`)
    console.log(`- Skipped (no parseable data): ${processed - updated}`)
  } catch (error) {
    console.error('Error during backfill:', error)
    process.exit(1)
  }
}

// Run the backfill if this script is executed directly
if (require.main === module) {
  backfillFeegrantParsedData()
    .then(() => {
      console.log('Backfill script completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Backfill script failed:', error)
      process.exit(1)
    })
}

export { backfillFeegrantParsedData }
