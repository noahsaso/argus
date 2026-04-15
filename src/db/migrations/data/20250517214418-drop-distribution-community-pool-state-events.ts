import { QueryInterface } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.dropTable('DistributionCommunityPoolStateEvents')
  },
  async down(queryInterface: QueryInterface) {
    await queryInterface.createTable('DistributionCommunityPoolStateEvents', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataType.INTEGER,
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
      balances: {
        allowNull: false,
        type: DataType.JSONB,
      },
      createdAt: {
        allowNull: false,
        type: DataType.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: DataType.DATE,
      },
    })
    await queryInterface.addIndex('DistributionCommunityPoolStateEvents', {
      unique: true,
      fields: ['blockHeight'],
    })
    await queryInterface.addIndex('DistributionCommunityPoolStateEvents', {
      fields: ['blockTimeUnixMs'],
    })
  },
}
