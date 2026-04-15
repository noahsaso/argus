'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.dropTable('BankBalances')
  },

  async down() {
    throw new Error('Cannot revert this migration')
  },
}
