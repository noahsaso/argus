import { QueryInterface, fn } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.createTable('GovProposalVotes', {
      id: {
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER,
      },
      proposalId: {
        allowNull: false,
        type: DataType.BIGINT,
      },
      voterAddress: {
        allowNull: false,
        type: DataType.STRING,
      },
      blockHeight: {
        allowNull: false,
        type: DataType.BIGINT,
      },
      blockTimeUnixMs: {
        allowNull: false,
        type: DataType.BIGINT,
      },
      blockTimestamp: {
        allowNull: false,
        type: DataType.DATE,
      },
      data: {
        allowNull: false,
        type: DataType.TEXT,
      },
      createdAt: {
        allowNull: false,
        type: DataType.DATE,
        defaultValue: fn('NOW'),
      },
      updatedAt: {
        allowNull: false,
        type: DataType.DATE,
        defaultValue: fn('NOW'),
      },
    })
    await queryInterface.addIndex('GovProposalVotes', {
      unique: true,
      fields: ['blockHeight', 'proposalId', 'voterAddress'],
    })
    await queryInterface.addIndex('GovProposalVotes', {
      fields: ['proposalId'],
    })
    await queryInterface.addIndex('GovProposalVotes', {
      fields: ['voterAddress'],
    })
    await queryInterface.addIndex('GovProposalVotes', {
      fields: ['blockHeight'],
    })
    await queryInterface.addIndex('GovProposalVotes', {
      fields: ['blockTimeUnixMs'],
    })
  },
  async down(queryInterface: QueryInterface) {
    await queryInterface.dropTable('GovProposalVotes')
  },
}
