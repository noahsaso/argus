import { fromBase64, toBech32 } from '@cosmjs/encoding'
import { Sequelize } from 'sequelize'

import { Block, FeegrantAllowance, State } from '@/db'
import { Handler, HandlerMaker, ParsedFeegrantStateEvent } from '@/types'
import { parseAllowanceData, retry } from '@/utils'

const STORE_NAME = 'feegrant'

export const feegrant: HandlerMaker<ParsedFeegrantStateEvent> = async ({
  chainId,
  config: { bech32Prefix },
}) => {
  if (!chainId.startsWith('xion-')) {
    throw new Error(`Feegrant handler not supported on chain ${chainId}`)
  }

  const match: Handler<ParsedFeegrantStateEvent>['match'] = (trace) => {
    // FeeAllowanceKeyPrefix = 0x00
    // Key format: 0x00 || len(grantee) || grantee || len(granter) || granter

    const keyData = fromBase64(trace.key)
    if (keyData[0] !== 0x00 || keyData.length < 3) {
      return
    }

    try {
      const granteeLength = keyData[1]
      if (keyData.length < 2 + granteeLength + 1) {
        return
      }

      const grantee = toBech32(
        bech32Prefix,
        keyData.slice(2, 2 + granteeLength)
      )

      const granterLength = keyData[2 + granteeLength]
      if (keyData.length !== 2 + granteeLength + 1 + granterLength) {
        return
      }

      const granter = toBech32(
        bech32Prefix,
        keyData.slice(2 + granteeLength + 1)
      )

      const blockHeight = BigInt(trace.metadata.blockHeight).toString()
      const blockTimeUnixMs = BigInt(trace.blockTimeUnixMs).toString()
      const blockTimestamp = new Date(trace.blockTimeUnixMs)

      // Determine if this is a grant (write) or revocation (delete)
      const active = trace.operation === 'write'
      const allowanceData = trace.value || ''

      // Parse allowance data to extract structured information
      let parsedData: {
        amount: string | null
        denom: string | null
        allowanceType: string | null
        expirationUnixMs: string | null
      } = {
        amount: null,
        denom: null,
        allowanceType: null,
        expirationUnixMs: null,
      }

      if (active && allowanceData) {
        const parsed = parseAllowanceData(allowanceData)
        parsedData = {
          amount: parsed.amount || null,
          denom: parsed.denom || null,
          allowanceType: parsed.allowanceType || null,
          expirationUnixMs: parsed.expirationUnixMs || null,
        }
      }

      // Keep the original allowanceType field for backward compatibility
      const allowanceType = parsedData.allowanceType

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
        parsedAmount: parsedData.amount,
        parsedDenom: parsedData.denom,
        parsedAllowanceType: parsedData.allowanceType,
        parsedExpirationUnixMs: parsedData.expirationUnixMs,
      }
    } catch (error) {
      // Ignore decoding errors
      return
    }
  }

  const process: Handler<ParsedFeegrantStateEvent>['process'] = async (
    events
  ) => {
    const exportEvents = async () => {
      // Save blocks from events
      await Block.createMany(
        [...new Set(events.map((e) => e.blockHeight))].map((height) => ({
          height,
          timeUnixMs: events.find((e) => e.blockHeight === height)!
            .blockTimeUnixMs,
        }))
      )

      // Bulk create allowances.
      return FeegrantAllowance.bulkCreate(events, {
        updateOnDuplicate: [
          'allowanceData',
          'allowanceType',
          'active',
          'parsedAmount',
          'parsedDenom',
          'parsedAllowanceType',
          'parsedExpirationUnixMs',
        ],
        conflictAttributes: ['granter', 'grantee', 'blockHeight'],
      })
    }

    const exportedEvents = await retry(3, exportEvents, 100)

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
