import { QueryInterface, fn } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    // The trigram index below needs pg_trgm. `npm run db:setup` creates it, but
    // a fresh database that runs migrations first does not have it yet.
    await queryInterface.sequelize.query(
      'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
    )

    await queryInterface.createTable('Extractions', {
      address: {
        primaryKey: true,
        allowNull: false,
        type: DataType.TEXT,
      },
      name: {
        primaryKey: true,
        allowNull: false,
        type: DataType.TEXT,
      },
      blockHeight: {
        primaryKey: true,
        allowNull: false,
        type: DataType.BIGINT,
      },
      blockTimeUnixMs: {
        allowNull: false,
        type: DataType.BIGINT,
      },
      txHash: {
        allowNull: false,
        type: DataType.TEXT,
      },
      data: {
        allowNull: false,
        type: DataType.JSONB,
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
    await queryInterface.addIndex('Extractions', {
      fields: [
        'address',
        {
          name: 'name',
          operator: 'text_pattern_ops',
        },
        {
          name: 'blockHeight',
          order: 'DESC',
        },
      ],
    })
    await queryInterface.addIndex('Extractions', {
      fields: [
        {
          name: 'name',
          operator: 'text_pattern_ops',
        },
        {
          name: 'blockHeight',
          order: 'DESC',
        },
      ],
    })
    await queryInterface.addIndex('Extractions', {
      name: 'extractions_name_trgm_idx',
      fields: [
        {
          name: 'name',
          operator: 'gin_trgm_ops',
        },
      ],
      concurrently: true,
      using: 'gin',
    })
  },
  async down(queryInterface: QueryInterface) {
    await queryInterface.dropTable('Extractions')
  },
}
