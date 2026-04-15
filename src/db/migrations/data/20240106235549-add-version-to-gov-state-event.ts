import { QueryInterface } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.addColumn('GovStateEvents', 'version', {
      type: DataType.STRING,
      allowNull: false,
      defaultValue: 'v1',
    })
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.removeColumn('GovStateEvents', 'version')
  },
}
