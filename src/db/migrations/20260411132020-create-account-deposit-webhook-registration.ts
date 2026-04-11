import { QueryInterface, fn } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.createTable('AccountDepositWebhookRegistrations', {
      id: {
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER,
      },
      accountPublicKey: {
        allowNull: false,
        type: DataType.STRING,
        references: {
          model: 'Accounts',
          key: 'publicKey',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      description: {
        allowNull: true,
        type: DataType.STRING,
      },
      endpointUrl: {
        allowNull: false,
        type: DataType.STRING,
      },
      authHeader: {
        allowNull: true,
        type: DataType.STRING,
      },
      authToken: {
        allowNull: true,
        type: DataType.STRING,
      },
      watchedWallets: {
        allowNull: false,
        type: DataType.ARRAY(DataType.STRING),
        defaultValue: [],
      },
      allowedNativeDenoms: {
        allowNull: false,
        type: DataType.ARRAY(DataType.STRING),
        defaultValue: [],
      },
      allowedCw20Contracts: {
        allowNull: false,
        type: DataType.ARRAY(DataType.STRING),
        defaultValue: [],
      },
      enabled: {
        allowNull: false,
        type: DataType.BOOLEAN,
        defaultValue: true,
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
    await queryInterface.addIndex('AccountDepositWebhookRegistrations', {
      fields: ['accountPublicKey'],
    })
    await queryInterface.addIndex('AccountDepositWebhookRegistrations', {
      fields: ['enabled'],
    })
  },
  async down(queryInterface: QueryInterface) {
    await queryInterface.dropTable('AccountDepositWebhookRegistrations')
  },
}
