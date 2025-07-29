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

    // Add indexes for efficient querying
    await queryInterface.addIndex('FeegrantAllowances', ['granter'])
    await queryInterface.addIndex('FeegrantAllowances', ['grantee'])
    await queryInterface.addIndex('FeegrantAllowances', ['active'])
  },
  async down(queryInterface: QueryInterface) {
    await queryInterface.dropTable('FeegrantAllowances')
  },
}
