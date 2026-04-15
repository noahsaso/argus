import { QueryInterface, fn } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.createTable('BankBalances', {
      address: {
        primaryKey: true,
        allowNull: false,
        type: DataType.TEXT,
      },
      balances: {
        allowNull: false,
        type: DataType.JSONB,
      },
      denomUpdateBlockHeights: {
        allowNull: false,
        type: DataType.JSONB,
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
  },
  async down(queryInterface: QueryInterface) {
    await queryInterface.dropTable('BankBalances')
  },
}
