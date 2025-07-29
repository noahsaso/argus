import { QueryInterface } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.addColumn('States', 'lastFeegrantBlockHeightExported', {
      allowNull: true,
      type: DataType.BIGINT,
    })
  },
  async down(queryInterface: QueryInterface) {
    await queryInterface.removeColumn('States', 'lastFeegrantBlockHeightExported')
  },
}
