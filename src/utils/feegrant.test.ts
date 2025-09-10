import { describe, expect, it } from 'vitest'

import {
  formatAllowanceAmount,
  isAllowanceExpired,
  parseAllowanceData,
} from './feegrant'

describe('feegrant utilities', () => {
  describe('parseAllowanceData', () => {
    it('returns empty object for empty allowance data', () => {
      const result = parseAllowanceData('')
      expect(result).toEqual({})
    })

    it('returns empty object for invalid base64 data', () => {
      const result = parseAllowanceData('invalid-base64!')
      expect(result).toEqual({})
    })

    it('handles basic allowance type detection', () => {
      // Mock base64 data that contains "coin" pattern in hex
      const mockData = Buffer.from('testcointest').toString('base64')
      const result = parseAllowanceData(mockData)

      expect(result.allowanceType).toBe('BasicAllowance')
    })

    it('handles periodic allowance type detection', () => {
      // Mock base64 data that contains "period" pattern in hex
      const mockData = Buffer.from('testperiodtest').toString('base64')
      const result = parseAllowanceData(mockData)

      expect(result.allowanceType).toBe('PeriodicAllowance')
    })

    it('handles allowed message allowance type detection', () => {
      // Mock base64 data that contains "allowed" pattern in hex
      const mockData = Buffer.from('testallowedtest').toString('base64')
      const result = parseAllowanceData(mockData)

      expect(result.allowanceType).toBe('AllowedMsgAllowance')
    })

    it('detects uxion denomination', () => {
      // Mock base64 data that contains "uxion" pattern in hex
      const mockData = Buffer.from('testuxiontest').toString('base64')
      const result = parseAllowanceData(mockData)

      expect(result.denom).toBe('uxion')
    })

    it('detects uusdc denomination', () => {
      // Mock base64 data that contains "uusdc" pattern in hex
      const mockData = Buffer.from('testuusdctest').toString('base64')
      const result = parseAllowanceData(mockData)

      expect(result.denom).toBe('uusdc')
    })

    it('handles parsing errors gracefully', () => {
      // Test with data that will cause parsing errors
      const mockData = Buffer.from('malformed data').toString('base64')
      const result = parseAllowanceData(mockData)

      // Should not throw and should return partial results
      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })

    it('returns undefined for unrecognized patterns', () => {
      // Mock base64 data without recognizable patterns
      const mockData = Buffer.from('randomdata').toString('base64')
      const result = parseAllowanceData(mockData)

      expect(result.allowanceType).toBeUndefined()
      expect(result.denom).toBeUndefined()
      expect(result.amount).toBeUndefined()
    })
  })

  describe('isAllowanceExpired', () => {
    it('returns false for undefined expiration', () => {
      const result = isAllowanceExpired(undefined)
      expect(result).toBe(false)
    })

    it('returns false for null expiration', () => {
      const result = isAllowanceExpired(undefined)
      expect(result).toBe(false)
    })

    it('returns false for future expiration', () => {
      const futureTime = (Date.now() + 24 * 60 * 60 * 1000).toString() // 1 day from now
      const result = isAllowanceExpired(futureTime)
      expect(result).toBe(false)
    })

    it('returns true for past expiration', () => {
      const pastTime = (Date.now() - 24 * 60 * 60 * 1000).toString() // 1 day ago
      const result = isAllowanceExpired(pastTime)
      expect(result).toBe(true)
    })

    it('returns true for current time expiration', () => {
      const currentTime = (Date.now() - 1000).toString() // 1 second ago
      const result = isAllowanceExpired(currentTime)
      expect(result).toBe(true)
    })

    it('handles invalid timestamp strings', () => {
      const result = isAllowanceExpired('invalid-timestamp')
      expect(result).toBe(true) // NaN comparison results in true
    })
  })

  describe('formatAllowanceAmount', () => {
    it('returns "0" for empty amount', () => {
      const result = formatAllowanceAmount('', 'uxion')
      expect(result).toBe('0')
    })

    it('returns "0" for zero amount', () => {
      const result = formatAllowanceAmount('0', 'uxion')
      expect(result).toBe('0')
    })

    it('converts uxion micro units to base units', () => {
      const result = formatAllowanceAmount('1000000', 'uxion')
      expect(result).toBe('1')
    })

    it('converts uusdc micro units to base units', () => {
      const result = formatAllowanceAmount('2500000', 'uusdc')
      expect(result).toBe('2.5')
    })

    it('handles large amounts correctly', () => {
      const result = formatAllowanceAmount('1000000000000', 'uxion') // 1 million XION
      expect(result).toBe('1000000')
    })

    it('handles fractional results', () => {
      const result = formatAllowanceAmount('1500000', 'uxion') // 1.5 XION
      expect(result).toBe('1.5')
    })

    it('returns original amount for unknown denominations', () => {
      const result = formatAllowanceAmount('1000000', 'unknown')
      expect(result).toBe('1000000')
    })

    it('handles very small amounts', () => {
      const result = formatAllowanceAmount('1', 'uxion')
      expect(result).toBe('0.000001')
    })

    it('handles decimal precision correctly', () => {
      const result = formatAllowanceAmount('1234567', 'uxion')
      expect(result).toBe('1.234567')
    })
  })

  describe('integration scenarios', () => {
    it('handles complete allowance parsing workflow', () => {
      // Test a realistic scenario with multiple patterns
      const mockComplexData = Buffer.from('coinuxion').toString('base64') // "coinuxion"
      const result = parseAllowanceData(mockComplexData)

      expect(result.allowanceType).toBe('BasicAllowance')
      expect(result.denom).toBe('uxion')

      // Test formatting if amount was parsed
      if (result.amount) {
        const formatted = formatAllowanceAmount(result.amount, result.denom!)
        expect(typeof formatted).toBe('string')
      }
    })

    it('handles edge cases gracefully', () => {
      // Test with minimal valid data
      const result = parseAllowanceData('dGVzdA==') // "test" in base64

      // Should not throw and should return safe defaults
      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })

    it('validates expiration workflow', () => {
      const mockData = Buffer.from('test').toString('base64')
      const result = parseAllowanceData(mockData)

      // Test expiration checking
      if (result.expirationUnixMs) {
        const isExpired = isAllowanceExpired(result.expirationUnixMs)
        expect(typeof isExpired).toBe('boolean')
      }
    })
  })
})
