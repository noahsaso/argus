import { QueryInterface } from 'sequelize'

module.exports = {
  async up(queryInterface: QueryInterface) {
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
