import { QueryInterface } from 'sequelize'

module.exports = {
  async up(queryInterface: QueryInterface) {
    // On a fresh database this table does not exist until `npm run db:setup`
    // creates it from the current model, so there is nothing to change yet.
    if (!(await queryInterface.tableExists('GovStateEvents'))) {
      return
    }

    await queryInterface.renameTable('GovStateEvents', 'GovProposals')
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.renameTable('GovProposals', 'GovStateEvents')
  },
}
