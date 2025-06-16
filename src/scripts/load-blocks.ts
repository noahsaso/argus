import { Command } from 'commander'

import { ConfigManager } from '@/config'
import { Block, loadDb } from '@/db'
import { DbType } from '@/types'

// Parse arguments.
const program = new Command()
program.option(
  '-c, --config <path>',
  'path to config file, falling back to config.json'
)
program.option('-b, --batch <size>', 'batch size', '10000')
program.option('-r, --range <size>', 'range size', '50000')
program.option('-i, --initial <height>', 'initial height')
program.parse()
const { config: _config, batch, range, initial } = program.opts()

// Load config with config option.
ConfigManager.load(_config)

/**
 * Simple progress manager to handle stats display with terminal control
 */
class ProgressDisplay {
  private displayed = false
  private lastLineCount = 0

  /**
   * Updates the progress display with current range information
   */
  update(
    currentHeight: bigint,
    rangeEnd: bigint,
    totalRange: bigint,
    startHeight: bigint,
    blocksInRange: number,
    totalProcessed: bigint,
    rangeDuration: number
  ) {
    // Clear previous output if any
    if (this.displayed) {
      this.clearLines(this.lastLineCount)
    }

    const output = this.formatProgress(
      currentHeight,
      rangeEnd,
      totalRange,
      startHeight,
      blocksInRange,
      totalProcessed,
      rangeDuration
    )
    this.lastLineCount = output.split('\n').length

    // Add new line if not yet displayed.
    if (!this.displayed) {
      console.log()
      this.displayed = true
    }

    // Write the formatted output
    process.stdout.write(output)
  }

  /**
   * Clears the specified number of lines from terminal. 1 line is the current
   * line. 2 lines is the current line and the previous line. etc.
   */
  private clearLines(count: number) {
    if (count === 0) {
      return
    }
    process.stdout.write(`\x1b[${count - 1}A\r`) // Move cursor up and to the beginning of the line.
    process.stdout.write('\x1b[J') // Clear to end of screen.
  }

  /**
   * Formats range progress information
   */
  private formatProgress(
    currentHeight: bigint,
    rangeEnd: bigint,
    totalRange: bigint,
    startHeight: bigint,
    blocksInRange: number,
    totalProcessed: bigint,
    rangeDuration: number
  ): string {
    const processed = currentHeight - startHeight
    const progressPercent =
      totalRange > 0
        ? ((Number(processed) / Number(totalRange)) * 100).toFixed(1)
        : '0.0'
    const avgSpeedBlocks = rangeDuration > 0 ? blocksInRange / rangeDuration : 0
    const etaSeconds =
      avgSpeedBlocks > 0 ? Number(totalRange - processed) / avgSpeedBlocks : 0
    const eta =
      etaSeconds > 0
        ? new Date(Date.now() + etaSeconds * 1000).toLocaleString(undefined, {
            timeZoneName: 'short',
          })
        : '-'

    const lines = [
      `Current Range: ${currentHeight.toLocaleString()} - ${rangeEnd.toLocaleString()}`,
      `Blocks in Range: ${blocksInRange.toLocaleString()}`,
      `Total Processed: ${totalProcessed.toLocaleString()}`,
      `Progress: ${progressPercent}% (${processed.toLocaleString()}/${totalRange.toLocaleString()})`,
      `Speed: ${avgSpeedBlocks.toFixed(1)} blocks/sec`,
      `ETA: ${eta}`,
      '',
    ]

    const longestLineLength = Math.max(...lines.map((line) => line.length))

    // Create a progress bar
    const filledWidth = Math.floor(
      (longestLineLength * Number(processed)) / Number(totalRange)
    )
    const emptyWidth = longestLineLength - filledWidth
    lines.push(
      `${'█'.repeat(Math.max(0, filledWidth))}${'░'.repeat(
        Math.max(0, emptyWidth)
      )}`
    )

    // Format the progress box
    return `${'—'.repeat(longestLineLength + 6)}
|${' '.repeat(longestLineLength + 4)}|
${lines
  .map(
    (line) => `|  ${line}${' '.repeat(longestLineLength - line.length + 2)}|`
  )
  .join('\n')}
|${' '.repeat(longestLineLength + 4)}|
${'—'.repeat(longestLineLength + 6)}
`
  }
}

/**
 * Efficiently populate the Block table with unique blocks from all state event tables.
 * Optimized for tens of millions of blocks by processing in height ranges.
 */
const populateBlocks = async (
  sequelize: any,
  batchSize: number = 10_000,
  rangeSize: bigint = 50_000n,
  initialHeight?: bigint
) => {
  const populateStart = Date.now()
  console.log(`\n[${new Date().toISOString()}] populating blocks table...`)

  // Find the overall height range across all tables
  const heightRangeQueries = [
    'SELECT MIN("blockHeight"::bigint) as min_height, MAX("blockHeight"::bigint) as max_height FROM "WasmStateEvents"',
    // 'SELECT MIN("blockHeight"::bigint) as min_height, MAX("blockHeight"::bigint) as max_height FROM "BankStateEvents"',
    // 'SELECT MIN("blockHeight"::bigint) as min_height, MAX("blockHeight"::bigint) as max_height FROM "GovProposals"',
    // 'SELECT MIN("blockHeight"::bigint) as min_height, MAX("blockHeight"::bigint) as max_height FROM "GovProposalVotes"',
  ]

  const heightRanges = await Promise.all(
    heightRangeQueries.map(async (query) => {
      try {
        const result = (await sequelize.query(query, {
          type: 'SELECT',
        })) as unknown as [
          { min_height: string | null; max_height: string | null }
        ]
        return result[0]
      } catch (error) {
        // Table might not exist or be empty
        return { min_height: null, max_height: null }
      }
    })
  )

  // Find global min/max heights
  const validRanges = heightRanges.filter(
    (r) => r.min_height !== null && r.max_height !== null
  )
  if (validRanges.length === 0) {
    console.log('no blocks found in any state event tables, skipping')
    return
  }

  const globalMinHeight = validRanges.reduce(
    (min, r) =>
      min === null
        ? BigInt(r.min_height!)
        : BigInt(r.min_height!) < min
        ? BigInt(r.min_height!)
        : min,
    null as bigint | null
  )!
  const globalMaxHeight = validRanges.reduce(
    (max, r) =>
      max === null
        ? BigInt(r.max_height!)
        : BigInt(r.max_height!) > max
        ? BigInt(r.max_height!)
        : max,
    null as bigint | null
  )!

  const effectiveStartHeight = initialHeight ?? globalMinHeight
  const totalRange = globalMaxHeight - effectiveStartHeight + 1n

  console.log(
    `processing blocks from height ${effectiveStartHeight.toLocaleString()} to ${globalMaxHeight.toLocaleString()} (${totalRange.toLocaleString()} blocks)`
  )

  if (effectiveStartHeight > globalMaxHeight) {
    console.log('no new blocks to process')
    return
  }

  // Initialize progress display
  const progressDisplay = new ProgressDisplay()

  // Process in height ranges for efficiency
  let currentHeight = effectiveStartHeight
  let totalProcessed = 0n

  while (currentHeight <= globalMaxHeight) {
    const rangeEnd =
      currentHeight + rangeSize - 1n > globalMaxHeight
        ? globalMaxHeight
        : currentHeight + rangeSize - 1n
    const rangeStart = Date.now()

    // Get unique blocks in this height range using a more efficient approach
    // Process each table separately to avoid complex UNIONs
    const uniqueBlocksInRange = new Map<
      string,
      { height: string; timeUnixMs: string }
    >()

    const tableQueries = [
      { table: 'WasmStateEvents', name: 'WASM State' },
      // { table: 'BankStateEvents', name: 'Bank State' },
      // { table: 'GovProposals', name: 'Gov Proposals' },
      // { table: 'GovProposalVotes', name: 'Gov Votes' },
    ]

    for (const { table, name } of tableQueries) {
      try {
        const blocks = (await sequelize.query(
          `
          SELECT DISTINCT 
            "blockHeight" as height,
            "blockTimeUnixMs" as "timeUnixMs"
          FROM "${table}"
          WHERE "blockHeight"::bigint >= ${currentHeight} 
            AND "blockHeight"::bigint <= ${rangeEnd}
          ORDER BY "blockHeight"
          `,
          { type: 'SELECT' }
        )) as unknown as {
          height: string
          timeUnixMs: string
        }[]

        for (const block of blocks) {
          uniqueBlocksInRange.set(block.height, block)
        }
      } catch (error) {
        console.log(
          `  skipping ${name} table (${
            error instanceof Error ? error.message : 'unknown error'
          })`
        )
      }
    }

    const uniqueBlocks = Array.from(uniqueBlocksInRange.values()).sort((a, b) =>
      BigInt(a.height) - BigInt(b.height) < 0n ? -1 : 1
    )

    if (uniqueBlocks.length > 0) {
      // Insert in smaller batches
      for (let i = 0; i < uniqueBlocks.length; i += batchSize) {
        const batch = uniqueBlocks.slice(i, i + batchSize)

        await Block.createMany(
          batch.map(({ height, timeUnixMs }) => ({
            height,
            timeUnixMs,
          }))
        )
      }

      totalProcessed += BigInt(uniqueBlocks.length)
    }

    const rangeDuration = (Date.now() - rangeStart) / 1000

    // Update progress display
    progressDisplay.update(
      currentHeight,
      rangeEnd,
      totalRange,
      effectiveStartHeight,
      uniqueBlocks.length,
      totalProcessed,
      rangeDuration
    )

    currentHeight = rangeEnd + 1n
  }

  const populateDuration = (Date.now() - populateStart) / 1000
  console.log(
    `\n[${new Date().toISOString()}] populated ${totalProcessed.toLocaleString()} blocks in ${populateDuration.toLocaleString()} seconds`
  )
}

const main = async () => {
  // Load DB on start.
  const sequelize = await loadDb({
    type: DbType.Data,
  })

  // Populate blocks table from all state event tables
  await populateBlocks(
    sequelize,
    Number(batch),
    BigInt(range),
    initial && BigInt(initial)
  )

  // Close DB connections.
  await sequelize.close()

  // Exit.
  process.exit(0)
}

main().catch((err) => {
  console.error('Block population script errored', err)
  process.exit(1)
})
