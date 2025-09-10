import { fromBase64, fromUtf8, toBech32 } from '@cosmjs/encoding'
import { Coin } from '@dao-dao/types/protobuf/codegen/cosmos/base/v1beta1/coin'
import { QueryTypes, Sequelize } from 'sequelize'

import { BankDenomBalance, BankStateEvent, Block, Contract, State } from '@/db'
import { WasmCodeService } from '@/services'
import { Handler, HandlerMaker, ParsedBankStateEvent } from '@/types'
import { retry } from '@/utils'

const STORE_NAME = 'bank'
// Keep all bank balance history for contracts matching these code IDs keys.
export const BANK_HISTORY_CODE_IDS_KEYS = [
  'dao-dao-core',
  'xion-treasury',
  'valence-account',
]
// Exclude these addresses from bank balance history, even if they match a code
// ID key.
export const BANK_HISTORY_EXCLUDED_ADDRESSES = new Set(
  [
    // Neutron DAO (constant balance updates)
    {
      chainId: 'neutron-1',
      address:
        'neutron1suhgf5svhu4usrurvxzlgn54ksxmn8gljarjtxqnapv8kjnp4nrstdxvff',
    },
  ].map(({ chainId, address }) => `${chainId}:${address}`)
)

export const bank: HandlerMaker<ParsedBankStateEvent> = async ({
  chainId,
  config: { bech32Prefix },
}) => {
  const match: Handler<ParsedBankStateEvent>['match'] = (trace) => {
    // BalancesPrefix = 0x02
    // bank keys are formatted as:
    // BalancesPrefix || len(addressBytes) || addressBytes || denomBytes

    const keyData = fromBase64(trace.key)
    if (keyData[0] !== 0x02 || keyData.length < 3) {
      return
    }

    const length = keyData[1]

    let address
    let denom
    try {
      address = toBech32(bech32Prefix, keyData.slice(2, 2 + length))
      denom = fromUtf8(keyData.slice(2 + length))
    } catch {
      // Ignore decoding errors.
      return
    }

    // Get code ID and block timestamp from chain.
    const blockHeight = BigInt(trace.metadata.blockHeight).toString()

    const blockTimeUnixMs = BigInt(trace.blockTimeUnixMs).toString()
    const blockTimestamp = new Date(trace.blockTimeUnixMs)

    // Mimics behavior of `UnmarshalBalanceCompat` in `x/bank/keeper/view.go` to
    // decode balance.

    let balance: string | undefined
    // If write operation, balance is updated. Otherwise (delete), balance is 0.
    if (trace.operation === 'write') {
      let valueData
      try {
        valueData = trace.value && fromBase64(trace.value)
      } catch {
        // Ignore decoding errors.
      }

      // If no data, ignore.
      if (!valueData) {
        return
      }

      // Try to decode as JSON-encoded number.
      try {
        const decodedValue = JSON.parse(fromUtf8(valueData))
        if (
          (typeof decodedValue === 'string' && /^[0-9]+$/.test(decodedValue)) ||
          typeof decodedValue === 'number'
        ) {
          balance =
            typeof decodedValue === 'number'
              ? BigInt(decodedValue).toString()
              : decodedValue
        }
      } catch {
        // Ignore decoding errors.
      }

      // Try to decode as legacy Coin protobuf, and ensure amount consists of
      // only numbers. Otherwise, ignore. The protobuf will decode (and not
      // error) if the value is another protobuf, but amount will likely contain
      // other data instead of a number. There's no way to ensure it's actually
      // a coin protobuf, so this is the best we can do.
      try {
        const { amount } = Coin.decode(valueData)
        if (/^[0-9]+$/.test(amount)) {
          balance = amount
        }
      } catch {
        // Ignore decoding errors.
      }
    } else if (trace.operation === 'delete') {
      balance = '0'
    }

    // If could not find balance, ignore.
    if (!balance) {
      return
    }

    return {
      id: [blockHeight, address, denom].join(':'),
      address,
      blockHeight,
      blockTimeUnixMs,
      blockTimestamp,
      denom,
      balance,
    }
  }

  const process: Handler<ParsedBankStateEvent>['process'] = async (events) => {
    const exportEvents = async () => {
      // Save blocks from events.
      await Block.createMany(
        [...new Set(events.map((e) => e.blockHeight))].map((height) => ({
          height,
          timeUnixMs: events.find((e) => e.blockHeight === height)!
            .blockTimeUnixMs,
        }))
      )

      // Get unique addresses with balance updates.
      const uniqueAddresses = [...new Set(events.map((event) => event.address))]

      // Find contracts for all addresses matching code IDs so we know which
      // addresses to save history for.
      const codeIds = WasmCodeService.instance.findWasmCodeIdsByKeys(
        ...BANK_HISTORY_CODE_IDS_KEYS
      )
      const addressesToKeepHistoryFor = codeIds.length
        ? (
            await Contract.findAll({
              where: {
                address: uniqueAddresses.filter(
                  (address) =>
                    !BANK_HISTORY_EXCLUDED_ADDRESSES.has(
                      `${chainId}:${address}`
                    )
                ),
                codeId: codeIds,
              },
            })
          ).map((contract) => contract.address)
        : []

      const keepHistoryEvents = events.filter((event) =>
        addressesToKeepHistoryFor.includes(event.address)
      )

      const [bankStateEvents, bankDenomBalances] = await Promise.all([
        keepHistoryEvents.length
          ? BankStateEvent.bulkCreate(keepHistoryEvents, {
              updateOnDuplicate: ['balance'],
              conflictAttributes: ['address', 'denom', 'blockHeight'],
            })
          : [],
        // Custom upsert logic to only update when blockHeight is newer
        (async () => {
          // Get latest event for each address/denom. The bulk insert cannot
          // affect the same row twice, and there may be duplicates in the same
          // block.
          const deduplicatedEvents = Object.values(
            events.reduce((acc, event) => {
              const key = `${event.address}:${event.denom}`
              if (
                !acc[key] ||
                BigInt(event.blockHeight) > BigInt(acc[key].blockHeight)
              ) {
                acc[key] = event
              }
              return acc
            }, {} as Record<string, ParsedBankStateEvent>)
          )

          // Build values for bulk insert with timestamps
          const valueStrings = deduplicatedEvents
            .map(
              (_, index) =>
                `($${index * 6 + 1}, $${index * 6 + 2}, $${index * 6 + 3}, $${
                  index * 6 + 4
                }, $${index * 6 + 5}, $${index * 6 + 6}, NOW(), NOW())`
            )
            .join(', ')

          // Flatten all event values for parameterized query
          const values = deduplicatedEvents.flatMap((event) => [
            event.address,
            event.denom,
            event.balance,
            event.blockHeight,
            event.blockTimeUnixMs,
            event.blockTimestamp,
          ])

          // Use INSERT ... ON CONFLICT with conditional update based on
          // blockHeight comparison.
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
            RETURNING *;
          `

          const results = await BankDenomBalance.sequelize!.query(query, {
            bind: values,
            type: QueryTypes.SELECT,
          })

          return results.map((result) => BankDenomBalance.build(result as any))
        })(),
      ])

      return [...bankStateEvents, ...bankDenomBalances]
    }

    const exportedEvents = await retry(3, exportEvents, 100)

    // Store last block height exported, and update latest block height/time if
    // the last export is newer. Don't use exportedEvents because it may include
    // events with block heights in the future that were pulled from existing
    // records if we are behind/reindexing past data.
    const lastEvent = events.sort(
      (a, b) => Number(a.blockHeight) - Number(b.blockHeight)
    )[events.length - 1]
    const lastBlockHeightExported = lastEvent.blockHeight
    const lastBlockTimeUnixMsExported = lastEvent.blockTimeUnixMs
    await State.updateSingleton({
      lastBankBlockHeightExported: Sequelize.fn(
        'GREATEST',
        Sequelize.col('lastBankBlockHeightExported'),
        lastBlockHeightExported
      ),

      latestBlockHeight: Sequelize.fn(
        'GREATEST',
        Sequelize.col('latestBlockHeight'),
        lastBlockHeightExported
      ),
      latestBlockTimeUnixMs: Sequelize.fn(
        'GREATEST',
        Sequelize.col('latestBlockTimeUnixMs'),
        lastBlockTimeUnixMsExported
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
