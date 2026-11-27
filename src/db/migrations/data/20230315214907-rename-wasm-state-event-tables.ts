import { QueryInterface } from 'sequelize'

module.exports = {
  async up(queryInterface: QueryInterface) {
    // Rename existing WasmEvents table to WasmStateEvents. A fresh database has
    // neither old table (`npm run db:setup` creates the new names from the
    // current models), so only rename the tables that exist.
    if (await queryInterface.tableExists('WasmEvents')) {
      await queryInterface.renameTable('WasmEvents', 'WasmStateEvents')
    }
    if (await queryInterface.tableExists('WasmEventTransformations')) {
      await queryInterface.renameTable(
        'WasmEventTransformations',
        'WasmStateEventTransformations'
      )
    }
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.renameTable('WasmStateEvents', 'WasmEvents')
    await queryInterface.renameTable(
      'WasmStateEventTransformations',
      'WasmEventTransformations'
    )
  },
}
