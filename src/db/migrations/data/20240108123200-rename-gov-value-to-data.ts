import { QueryInterface } from 'sequelize'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.renameColumn('GovStateEvents', 'value', 'data')
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.renameColumn('GovStateEvents', 'data', 'value')
  },
}
