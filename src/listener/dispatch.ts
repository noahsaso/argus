import { BlockHeader } from '@cosmjs/stargate'
import { decodeRawProtobufMsg } from '@dao-dao/types/protobuf/utils'

import { ExtractQueue } from '@/queues/queues'
import { TxData } from '@/services'
import { ExtractableTxInput, ExtractorEnv } from '@/types'

import { getExtractors } from './extractors'
import { Extractor } from './extractors/base'

/**
 * Match a transaction against the extractors and queue extraction jobs for
 * every match. Unsuccessful transactions are ignored.
 *
 * Re-dispatching the same transaction queues the same jobs again. Extractions
 * are upserted on (address, name, blockHeight), so the stored data is the
 * same, but side effects of an extraction (webhooks, search index updates) run
 * again.
 */
export const dispatchTxToExtractors = async (
  { hash, code, messages: rawMessages, height, events }: TxData,
  { time }: Pick<BlockHeader, 'time'>,
  extractors: Pick<typeof Extractor, 'type' | 'match'>[] = getExtractors()
): Promise<void> => {
  // Ignore unsuccessful TXs.
  if (code !== 0) {
    return
  }

  // Attempt to decode each message, ignoring errors and returning the
  // original message if it fails.
  const messages = rawMessages.flatMap((message) => {
    try {
      return decodeRawProtobufMsg(message)
    } catch {
      return message
    }
  })

  // Create input for extractors.
  const input: ExtractableTxInput = {
    hash,
    messages,
    events,
  }

  // Create extractor environment for queue.
  const env: Pick<ExtractorEnv, 'txHash' | 'block'> = {
    txHash: hash,
    block: {
      height: BigInt(height).toString(),
      timeUnixMs: BigInt(Date.parse(time)).toString(),
      timestamp: new Date(time).toISOString(),
    },
  }

  // Match messages with extractors and add to queue.
  for (const Extractor of extractors) {
    const data = Extractor.match(input)

    if (data.length > 0) {
      await ExtractQueue.addBulk(
        data.map((data) => ({
          name: `${Extractor.type} (${data.source})`,
          data: {
            extractor: Extractor.type,
            data,
            env,
          },
        }))
      )

      console.log(
        `[${new Date().toISOString()}] TX ${hash} at block ${height} sent to "${
          Extractor.type
        }" extractor.`
      )
    }
  }
}
