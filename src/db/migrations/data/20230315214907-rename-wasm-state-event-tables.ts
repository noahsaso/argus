import { QueryInterface } from 'sequelize'

module.exports = {
  async up(queryInterface: QueryInterface) {
    // Rename existing WasmEvents table to WasmStateEvents
    await queryInterface.renameTable('WasmEvents', 'WasmStateEvents')
    await queryInterface.renameTable(
      'WasmEventTransformations',
      'WasmStateEventTransformations'
    )
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.renameTable('WasmStateEvents', 'WasmEvents')
    await queryInterface.renameTable(
      'WasmStateEventTransformations',
      'WasmEventTransformations'
    )
  },
}
