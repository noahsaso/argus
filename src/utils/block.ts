import { Block, SerializedBlock } from '@/types'

export const validateBlockString = (block: string, subject: string): Block => {
  let parsedBlock
  try {
    parsedBlock = block.split(':').map((s) => BigInt(s))
  } catch (err) {
    throw new Error(`${subject}'s values must be integers`)
  }

  if (parsedBlock.length !== 2) {
    throw new Error(`${subject} must be a height:timeUnixMs pair`)
  }

  const [blockHeight, blockTimeUnixMs] = parsedBlock

  if (blockHeight < 1 || blockTimeUnixMs < 0) {
    throw new Error(
      `${subject}'s height must be at least 1 and ${subject}'s timeUnixMs must be at least 0`
    )
  }

  return {
    height: blockHeight,
    timeUnixMs: blockTimeUnixMs,
  }
}

// Stringifies bigint fields.
export const serializeBlock = ({
  height,
  timeUnixMs,
}: Block): SerializedBlock => ({
  height: height.toString(),
  timeUnixMs: timeUnixMs.toString(),
  timestamp: new Date(Number(timeUnixMs)).toISOString(),
})
