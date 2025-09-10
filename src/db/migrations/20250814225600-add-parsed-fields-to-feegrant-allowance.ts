import { QueryInterface } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    // Add parsed fields to FeegrantAllowances table
    await queryInterface.addColumn('FeegrantAllowances', 'parsedAmount', {
      type: DataType.TEXT,
      allowNull: true,
    })

    await queryInterface.addColumn('FeegrantAllowances', 'parsedDenom', {
      type: DataType.TEXT,
      allowNull: true,
    })

    await queryInterface.addColumn(
      'FeegrantAllowances',
      'parsedAllowanceType',
      {
        type: DataType.TEXT,
        allowNull: true,
      }
    )

    await queryInterface.addColumn(
      'FeegrantAllowances',
      'parsedExpirationUnixMs',
      {
        type: DataType.BIGINT,
        allowNull: true,
      }
    )

    // Add indexes for efficient aggregation queries
    await queryInterface.addIndex('FeegrantAllowances', {
      fields: ['active', 'parsedDenom'],
      where: {
        active: true,
      },
      name: 'feegrant_allowances_active_parsed_denom',
    })

    await queryInterface.addIndex('FeegrantAllowances', {
      fields: ['active', 'parsedAllowanceType'],
      where: {
        active: true,
      },
      name: 'feegrant_allowances_active_parsed_allowance_type',
    })

    await queryInterface.addIndex('FeegrantAllowances', {
      fields: ['parsedDenom'],
      name: 'feegrant_allowances_parsed_denom',
    })

    await queryInterface.addIndex('FeegrantAllowances', {
      fields: ['parsedAllowanceType'],
      name: 'feegrant_allowances_parsed_allowance_type',
    })
  },
  async down(queryInterface: QueryInterface) {
    // Remove indexes
    await queryInterface.removeIndex(
      'FeegrantAllowances',
      'feegrant_allowances_active_parsed_denom'
    )
    await queryInterface.removeIndex(
      'FeegrantAllowances',
      'feegrant_allowances_active_parsed_allowance_type'
    )
    await queryInterface.removeIndex(
      'FeegrantAllowances',
      'feegrant_allowances_parsed_denom'
    )
    await queryInterface.removeIndex(
      'FeegrantAllowances',
      'feegrant_allowances_parsed_allowance_type'
    )

    // Remove columns
    await queryInterface.removeColumn('FeegrantAllowances', 'parsedAmount')
    await queryInterface.removeColumn('FeegrantAllowances', 'parsedDenom')
    await queryInterface.removeColumn(
      'FeegrantAllowances',
      'parsedAllowanceType'
    )
    await queryInterface.removeColumn(
      'FeegrantAllowances',
      'parsedExpirationUnixMs'
    )
  },
}
