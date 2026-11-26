import { QueryInterface } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    // On a fresh database this table does not exist until `npm run db:setup`
    // creates it from the current model, so there is nothing to change yet.
    if (!(await queryInterface.tableExists('Contracts'))) {
      return
    }

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
