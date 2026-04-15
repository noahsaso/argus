import { QueryInterface, fn } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.createTable('WasmCodeKeys', {
      codeKey: {
        primaryKey: true,
        allowNull: false,
        type: DataType.STRING,
      },
      description: {
        allowNull: true,
        type: DataType.TEXT,
      },
      createdAt: {
        allowNull: false,
        type: DataType.DATE,
        defaultValue: fn('NOW'),
      },
      updatedAt: {
        allowNull: false,
        type: DataType.DATE,
        defaultValue: fn('NOW'),
      },
    })
    await queryInterface.addIndex('WasmCodeKeys', {
      unique: true,
      fields: ['codeKey'],
    })
  },
  async down(queryInterface: QueryInterface) {
    await queryInterface.dropTable('WasmCodeKeys')
  },
}
