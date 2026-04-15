import { QueryInterface } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.addColumn(
      'States',
      'lastDistributionBlockHeightExported',
      {
        type: DataType.BIGINT,
        allowNull: true,
      }
    )
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.removeColumn(
      'States',
      'lastDistributionBlockHeightExported'
    )
  },
}
