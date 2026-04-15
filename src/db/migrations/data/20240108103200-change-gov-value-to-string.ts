import { QueryInterface } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.bulkDelete('GovStateEvents', {})
    await queryInterface.changeColumn('GovStateEvents', 'value', {
      type: DataType.TEXT,
      allowNull: false,
    })
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.changeColumn('GovStateEvents', 'value', {
      type: DataType.JSONB,
      allowNull: false,
    })
  },
}
