import { QueryInterface } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.changeColumn('BankStateEvents', 'balance', {
      type: DataType.TEXT,
      allowNull: false,
    })
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.changeColumn('BankStateEvents', 'balance', {
      type: DataType.BIGINT,
      allowNull: false,
    })
  },
}
