import { QueryInterface, fn } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.createTable('WasmCodeKeyIds', {
      id: {
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER,
      },
      codeKey: {
        allowNull: false,
        type: DataType.STRING,
        references: {
          model: 'WasmCodeKeys',
          key: 'codeKey',
        },
      },
      codeKeyId: {
        allowNull: false,
        type: DataType.INTEGER,
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
    await queryInterface.addIndex('WasmCodeKeyIds', {
      unique: true,
      fields: ['codeKey', 'codeKeyId'],
    })
  },
  async down(queryInterface: QueryInterface) {
    await queryInterface.dropTable('WasmCodeKeyIds')
  },
}
