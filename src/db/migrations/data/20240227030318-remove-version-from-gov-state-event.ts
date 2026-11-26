import { QueryInterface } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    // On a fresh database this table does not exist until `npm run db:setup`
    // creates it from the current model, so there is nothing to change yet.
    if (!(await queryInterface.tableExists('GovStateEvents'))) {
      return
    }

    await queryInterface.removeColumn('GovStateEvents', 'version')
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.addColumn('GovStateEvents', 'version', {
      type: DataType.STRING,
      allowNull: false,
      defaultValue: 'v1',
    })
  },
}
