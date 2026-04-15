import { QueryInterface } from 'sequelize'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.renameTable('GovStateEvents', 'GovProposals')
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.renameTable('GovProposals', 'GovStateEvents')
  },
}
