import { QueryInterface } from 'sequelize'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.addIndex('WasmStateEvents', ['blockHeight'])
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.removeIndex('WasmStateEvents', ['blockHeight'])
  },
}
