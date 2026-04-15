import { QueryInterface } from 'sequelize'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.dropTable('PendingWebhooks')
  },

  async down() {
    throw new Error('Not implemented.')
  },
}
