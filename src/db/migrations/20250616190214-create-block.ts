import { QueryInterface, fn } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.createTable('Blocks', {
      height: {
        primaryKey: true,
        allowNull: false,
        type: DataType.BIGINT,
      },
      timeUnixMs: {
        allowNull: false,
        type: DataType.BIGINT,
      },
      timestamp: {
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
    await queryInterface.dropTable('Blocks')
  },
}
