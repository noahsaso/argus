import { QueryInterface, fn } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.createTable('FeegrantAllowances', {
      granter: {
        primaryKey: true,
        allowNull: false,
        type: DataType.TEXT,
      },
      grantee: {
        primaryKey: true,
        allowNull: false,
        type: DataType.TEXT,
      },
      blockHeight: {
        primaryKey: true,
        allowNull: false,
        type: DataType.BIGINT,
      },
      blockTimeUnixMs: {
        allowNull: false,
        type: DataType.BIGINT,
      },
      blockTimestamp: {
        allowNull: false,
        type: DataType.DATE,
      },
      allowanceData: {
        allowNull: false,
        type: DataType.TEXT,
      },
      allowanceType: {
        allowNull: true,
        type: DataType.TEXT,
      },
      active: {
        allowNull: false,
        type: DataType.BOOLEAN,
      },
      createdAt: {
        allowNull: false,
        type: DataType.DATE,
        defaultValue: fn('NOW'),
      },
      updatedAt: {
        allowNull: false,
        type: DataType.DATE,
        defaultValue: fn('NOW'),
      },
    })

    // Add indexes for TimescaleDB optimization (matching WasmStateEvent pattern)
    await queryInterface.addIndex('FeegrantAllowances', {
      fields: [
        'granter',
        'grantee',
        { name: 'blockHeight', order: 'DESC' },
      ],
    })

    await queryInterface.addIndex('FeegrantAllowances', {
      fields: [
        { name: 'granter', operator: 'text_pattern_ops' },
        { name: 'blockHeight', order: 'DESC' },
      ],
    })

    await queryInterface.addIndex('FeegrantAllowances', {
      fields: [
        { name: 'grantee', operator: 'text_pattern_ops' },
        { name: 'blockHeight', order: 'DESC' },
      ],
    })

    // Speeds up transform script queries iterating over all events in order of block height
    await queryInterface.addIndex('FeegrantAllowances', ['blockHeight'])
  },
  async down(queryInterface: QueryInterface) {
    await queryInterface.dropTable('FeegrantAllowances')
  },
}
