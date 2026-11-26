import { QueryInterface } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    // On a fresh database this table does not exist until `npm run db:setup`
    // creates it from the current model, so there is nothing to change yet.
    if (!(await queryInterface.tableExists('GovStateEvents'))) {
      return
    }

    await queryInterface.bulkDelete('GovStateEvents', {})
    await queryInterface.changeColumn('GovStateEvents', 'value', {
      type: DataType.TEXT,
      allowNull: false,
    })
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.changeColumn('GovStateEvents', 'value', {
      type: DataType.JSONB,
      allowNull: false,
    })
  },
}
