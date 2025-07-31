/**
 * Example usage of the Feegrant tracer
 *
 * This file demonstrates how to query feegrant allowances after the tracer
 * has been running and collecting data.
 */

import { FeegrantAllowance } from '@/db'

// Example queries for feegrant allowances

/**
 * Get all active allowances granted by a specific address
 */
export async function getAllowancesGrantedBy(granterAddress: string) {
  return await FeegrantAllowance.findAll({
    where: {
      granter: granterAddress,
      active: true,
    },
    order: [['blockHeight', 'DESC']],
  })
}

/**
 * Get all active allowances received by a specific address
 */
export async function getAllowancesReceivedBy(granteeAddress: string) {
  return await FeegrantAllowance.findAll({
    where: {
      grantee: granteeAddress,
      active: true,
    },
    order: [['blockHeight', 'DESC']],
  })
}

/**
 * Check if a specific granter->grantee allowance exists and is active
 */
export async function hasActiveAllowance(
  granterAddress: string,
  granteeAddress: string
) {
  const allowance = await FeegrantAllowance.findOne({
    where: {
      granter: granterAddress,
      grantee: granteeAddress,
      active: true,
    },
  })
  return allowance !== null
}

/**
 * Get all active allowances in the system
 */
export async function getAllActiveAllowances() {
  return await FeegrantAllowance.findAll({
    where: {
      active: true,
    },
    order: [['blockHeight', 'DESC']],
  })
}

/**
 * Get allowance history for a specific granter->grantee pair
 * (including revoked/expired allowances)
 */
export async function getAllowanceHistory(
  granterAddress: string,
  granteeAddress: string
) {
  return await FeegrantAllowance.findAll({
    where: {
      granter: granterAddress,
      grantee: granteeAddress,
    },
    order: [['blockHeight', 'DESC']],
  })
}

/**
 * Count active allowances by granter
 */
export async function countAllowancesByGranter() {
  return await FeegrantAllowance.findAll({
    attributes: [
      'granter',
      [FeegrantAllowance.sequelize!.fn('COUNT', '*'), 'allowanceCount'],
    ],
    where: {
      active: true,
    },
    group: ['granter'],
    order: [[FeegrantAllowance.sequelize!.literal('allowanceCount'), 'DESC']],
  })
}

/**
 * Example usage:
 *
 * // Get all allowances granted by a specific address
 * const grantedAllowances = await getAllowancesGrantedBy('cosmos1abc...')
 * console.log(`Found ${grantedAllowances.length} active allowances granted`)
 *
 * // Check if a specific allowance exists
 * const hasAllowance = await hasActiveAllowance('cosmos1granter...', 'cosmos1grantee...')
 * console.log(`Allowance exists: ${hasAllowance}`)
 *
 * // Get allowance statistics
 * const stats = await countAllowancesByGranter()
 * console.log('Top granters:', stats.slice(0, 10))
 */
