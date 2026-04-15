import { QueryInterface, fn } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.createTable('BankDenomBalances', {
      id: {
        primaryKey: true,
        autoIncrement: true,
        type: DataType.BIGINT,
      },
      address: {
        allowNull: false,
        type: DataType.TEXT,
      },
      denom: {
        allowNull: false,
        type: DataType.TEXT,
      },
      balance: {
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
    await queryInterface.addIndex('BankDenomBalances', {
      unique: true,
      fields: ['address', 'denom'],
    })
    await queryInterface.addIndex('BankDenomBalances', {
      fields: [
        'address',
        {
          name: 'blockHeight',
          order: 'DESC',
        },
      ],
    })
  },
  async down(queryInterface: QueryInterface) {
    await queryInterface.dropTable('BankDenomBalances')
  },
}
