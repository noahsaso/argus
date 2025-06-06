import { QueryInterface } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.addColumn('Contracts', 'admin', {
      type: DataType.TEXT,
      allowNull: true,
    })
    await queryInterface.addColumn('Contracts', 'creator', {
      type: DataType.TEXT,
      allowNull: true,
    })
    await queryInterface.addColumn('Contracts', 'label', {
      type: DataType.TEXT,
      allowNull: true,
    })
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.removeColumn('Contracts', 'admin')
    await queryInterface.removeColumn('Contracts', 'creator')
    await queryInterface.removeColumn('Contracts', 'label')
  },
}
