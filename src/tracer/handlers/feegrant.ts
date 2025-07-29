import { fromBase64, toBech32 } from '@cosmjs/encoding'
import retry from 'async-await-retry'
import { Sequelize } from 'sequelize'

import { Block, FeegrantAllowance, State } from '@/db'
import { Handler, HandlerMaker, ParsedFeegrantStateEvent } from '@/types'

const STORE_NAME = 'feegrant'

export const feegrant: HandlerMaker<ParsedFeegrantStateEvent> = async ({
  config: { bech32Prefix },
}) => {
  const match: Handler<ParsedFeegrantStateEvent>['match'] = (trace) => {
    // FeeAllowanceKeyPrefix = 0x00
    // Key format: 0x00 || len(granter) || granter || len(grantee) || grantee
    
    const keyData = fromBase64(trace.key)
    if (keyData[0] !== 0x00 || keyData.length < 3) {
      return
    }

    try {
      const granterLength = keyData[1]
      if (keyData.length < 2 + granterLength + 1) {
        return
      }

      const granter = toBech32(bech32Prefix, keyData.slice(2, 2 + granterLength))
      
      const granteeLength = keyData[2 + granterLength]
      if (keyData.length !== 2 + granterLength + 1 + granteeLength) {
        return
      }

      const grantee = toBech32(
        bech32Prefix, 
        keyData.slice(2 + granterLength + 1)
      )

      const blockHeight = BigInt(trace.metadata.blockHeight).toString()
      const blockTimeUnixMs = BigInt(trace.blockTimeUnixMs).toString()
      const blockTimestamp = new Date(trace.blockTimeUnixMs)

      // Determine if this is a grant (write) or revocation (delete)
      const active = trace.operation === 'write'
      const allowanceData = trace.value || ''

      // Try to determine allowance type from protobuf data
      let allowanceType: string | null = null
      if (active && allowanceData) {
        // For MVP, we can leave this as null or add basic type detection later
        // This would require protobuf parsing to determine the exact allowance type
        allowanceType = null
      }

      return {
        id: [blockHeight, granter, grantee].join(':'),
        granter,
        grantee,
        blockHeight,
        blockTimeUnixMs,
        blockTimestamp,
        allowanceData,
        allowanceType,
        active,
      }
    } catch (error) {
      // Ignore decoding errors
      return
    }
  }

  const process: Handler<ParsedFeegrantStateEvent>['process'] = async (events) => {
    // Save blocks from events
    await Block.createMany(
      [...new Set(events.map((e) => e.blockHeight))].map((height) => ({
        height,
        timeUnixMs: events.find((e) => e.blockHeight === height)!.blockTimeUnixMs,
      }))
    )

    const exportEvents = async () => {
      // Create new records for historical tracking (no upsert)
      const allowances = await Promise.all(
        events.map(async (event) => {
          const allowance = await FeegrantAllowance.create({
            granter: event.granter,
            grantee: event.grantee,
            blockHeight: event.blockHeight,
            blockTimeUnixMs: event.blockTimeUnixMs,
            blockTimestamp: event.blockTimestamp,
            allowanceData: event.allowanceData,
            allowanceType: event.allowanceType,
            active: event.active,
          })
          return allowance
        })
      )

      return allowances
    }

    // Retry with exponential backoff
    const exportedEvents = await retry(exportEvents, [], {
      retriesMax: 3,
      exponential: true,
      interval: 100,
    })

    // Update state tracking
    const lastEvent = events.sort(
      (a, b) => Number(a.blockHeight) - Number(b.blockHeight)
    )[events.length - 1]
    
    await State.updateSingleton({
      lastFeegrantBlockHeightExported: Sequelize.fn(
        'GREATEST',
        Sequelize.col('lastFeegrantBlockHeightExported'),
        lastEvent.blockHeight
      ),
      latestBlockHeight: Sequelize.fn(
        'GREATEST',
        Sequelize.col('latestBlockHeight'),
        lastEvent.blockHeight
      ),
      latestBlockTimeUnixMs: Sequelize.fn(
        'GREATEST',
        Sequelize.col('latestBlockTimeUnixMs'),
        lastEvent.blockTimeUnixMs
      ),
    })

    return exportedEvents
  }

  return {
    storeName: STORE_NAME,
    match,
    process,
  }
}
