import { QueryInterface } from 'sequelize'

module.exports = {
  async up(queryInterface: QueryInterface) {
    // On a fresh database this table does not exist until `npm run db:setup`
    // creates it from the current model, so there is nothing to change yet.
    if (!(await queryInterface.tableExists('WasmStateEvents'))) {
      return
    }

    await queryInterface.removeIndex('WasmStateEvents', ['key', 'blockHeight'])
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.addIndex('WasmStateEvents', {
      fields: [
        {
          name: 'key',
          operator: 'text_pattern_ops',
        },
        {
          name: 'blockHeight',
          order: 'DESC',
        },
      ],
    })
  },
}
