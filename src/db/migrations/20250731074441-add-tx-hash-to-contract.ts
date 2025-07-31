import { QueryInterface } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.addColumn('Contracts', 'txHash', {
      type: DataType.TEXT,
      allowNull: true,
    })
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.removeColumn('Contracts', 'txHash')
  },
}
