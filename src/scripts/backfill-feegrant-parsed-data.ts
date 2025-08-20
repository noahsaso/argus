#!/usr/bin/env node

import { Op } from 'sequelize'

import { FeegrantAllowance, loadDb } from '@/db'
import { DbType } from '@/types'
import { parseAllowanceData } from '@/utils'

/**
 * Backfill script to parse existing feegrant allowance data
 * This script will update existing records with parsed fields
 */
async function backfillFeegrantParsedData() {
  console.log('Starting feegrant parsed data backfill...')

  await loadDb({
    type: DbType.Data,
  })

  try {
    // Get all allowances that don't have parsed data yet
    const allowanceCount = await FeegrantAllowance.count({
      where: {
        parsedAmount: null,
        allowanceData: {
          [Op.ne]: '',
        },
      },
    })

    console.log(
      `Found ${allowanceCount.toLocaleString()} allowances to backfill`
    )

    let processed = 0
    let updated = 0

    // Process in batches to avoid memory issues
    const batchSize = 500
    const batchCount = Math.ceil(allowanceCount / batchSize)
    let lastId = '0'

    for (let i = 0; i < batchCount; i++) {
      const allowanceBatch = await FeegrantAllowance.findAll({
        where: {
          id: {
            [Op.gt]: lastId,
          },
          parsedAmount: null,
          allowanceData: {
            [Op.ne]: '',
          },
        },
        order: [['id', 'ASC']],
        limit: batchSize,
      })

      lastId = allowanceBatch[allowanceBatch.length - 1].id

      console.log(`Processing batch ${i + 1}/${batchCount}`)

      const updates = allowanceBatch.flatMap((allowance) => {
        try {
          // Parse the allowance data
          const parsed = parseAllowanceData(allowance.allowanceData)
          processed++

          // Update the record if we got any parsed data
          if (
            parsed.amount ||
            parsed.denom ||
            parsed.allowanceType ||
            parsed.expirationUnixMs
          ) {
            updated++
            return {
              id: allowance.id,
              granter: allowance.granter,
              grantee: allowance.grantee,
              blockHeight: allowance.blockHeight,
              blockTimeUnixMs: allowance.blockTimeUnixMs,
              blockTimestamp: allowance.blockTimestamp,
              allowanceData: allowance.allowanceData,
              allowanceType: allowance.allowanceType,
              active: allowance.active,
              parsedAmount: parsed.amount || null,
              parsedDenom: parsed.denom || null,
              parsedAllowanceType: parsed.allowanceType || null,
              parsedExpirationUnixMs: parsed.expirationUnixMs || null,
            }
          }
        } catch (error) {
          console.error(`Error processing allowance ${allowance.id}:`, error)
        }

        return []
      })

      await FeegrantAllowance.bulkCreate(updates, {
        updateOnDuplicate: [
          'parsedAmount',
          'parsedDenom',
          'parsedAllowanceType',
          'parsedExpirationUnixMs',
        ],
        conflictAttributes: ['id'],
      })

      console.log(
        `Processed ${processed.toLocaleString()}/${allowanceCount.toLocaleString()} allowances (${updated.toLocaleString()} updated)`
      )

      // Small delay between batches to avoid overwhelming the database
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    console.log(`Backfill completed!`)
    console.log(`- Total processed: ${processed.toLocaleString()}`)
    console.log(`- Total updated: ${updated.toLocaleString()}`)
    console.log(
      `- Skipped (no parseable data): ${processed - updated}`.toLocaleString()
    )
    process.exit(0)
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
