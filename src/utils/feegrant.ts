import { fromBase64 } from '@cosmjs/encoding'

export interface ParsedAllowanceData {
  amount?: string
  denom?: string
  allowanceType?: string
  expirationUnixMs?: string
}

/**
 * Parse feegrant allowance protobuf data to extract key information
 * This is a basic implementation that can be enhanced as needed
 */
export const parseAllowanceData = (allowanceData: string): ParsedAllowanceData => {
  if (!allowanceData) {
    return {}
  }

  try {
    const data = fromBase64(allowanceData)
    
    // Basic protobuf parsing - this is a simplified approach
    // In a full implementation, you'd use proper protobuf decoders
    
    // Try to detect allowance type from protobuf structure
    let allowanceType: string | undefined
    
    // BasicAllowance typically has a simpler structure
    // PeriodicAllowance has additional period/period_reset fields
    // AllowedMsgAllowance has allowed_messages field
    
    // For now, we'll do basic pattern matching
    // This can be enhanced with proper protobuf parsing later
    const dataStr = Buffer.from(data).toString('hex')
    
    if (dataStr.includes('636f696e')) { // "coin" in hex
      // Likely contains coin data
      allowanceType = 'BasicAllowance'
    } else if (dataStr.includes('706572696f64')) { // "period" in hex
      allowanceType = 'PeriodicAllowance'
    } else if (dataStr.includes('616c6c6f776564')) { // "allowed" in hex
      allowanceType = 'AllowedMsgAllowance'
    }

    // Try to extract amount and denom from coin structures
    // This is a simplified approach - proper protobuf parsing would be more reliable
    let amount: string | undefined
    let denom: string | undefined

    // Look for common patterns in coin protobuf encoding
    // This is a basic implementation that can be improved
    try {
      // Try to find uxion pattern
      if (dataStr.includes('7578696f6e')) { // "uxion" in hex
        denom = 'uxion'
        // Try to extract amount (this is very basic)
        const uxionIndex = dataStr.indexOf('7578696f6e')
        if (uxionIndex > 0) {
          // Look backwards for amount data
          const beforeUxion = dataStr.substring(0, uxionIndex)
          // This is a simplified extraction - would need proper protobuf parsing
          const amountMatch = beforeUxion.match(/([0-9a-f]{2,})$/)
          if (amountMatch) {
            try {
              // Try to decode as varint or similar
              const hexAmount = amountMatch[1]
              // This is a placeholder - proper amount extraction would be more complex
              amount = '0' // Default for now
            } catch {
              // Ignore parsing errors
            }
          }
        }
      }
      // Similar logic for uusdc
      else if (dataStr.includes('7575736463')) { // "uusdc" in hex
        denom = 'uusdc'
        amount = '0' // Placeholder
      }
    } catch {
      // Ignore parsing errors
    }

    return {
      amount,
      denom,
      allowanceType,
    }
  } catch (error) {
    // If parsing fails, return empty object
    return {}
  }
}

/**
 * Enhanced parsing function that can be used when proper protobuf types are available
 * This is a placeholder for future enhancement
 */
export const parseAllowanceDataAdvanced = (allowanceData: string): ParsedAllowanceData => {
  // TODO: Implement proper protobuf parsing using @cosmjs/proto-signing or similar
  // For now, fall back to basic parsing
  return parseAllowanceData(allowanceData)
}

/**
 * Utility to determine if an allowance has expired
 */
export const isAllowanceExpired = (expirationUnixMs?: string): boolean => {
  if (!expirationUnixMs) {
    return false // No expiration means it doesn't expire
  }
  
  const now = Date.now()
  const expiration = parseInt(expirationUnixMs, 10)
  
  return now > expiration
}

/**
 * Format amount for display (convert from micro units)
 */
export const formatAllowanceAmount = (amount: string, denom: string): string => {
  if (!amount || amount === '0') {
    return '0'
  }

  const amountBigInt = BigInt(amount)
  
  // Convert micro units to base units
  if (denom === 'uxion') {
    return (Number(amountBigInt) / 1_000_000).toString()
  } else if (denom === 'uusdc') {
    return (Number(amountBigInt) / 1_000_000).toString()
  }
  
  return amount
}
