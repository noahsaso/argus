import { QueryInterface } from 'sequelize'
import { DataType } from 'sequelize-typescript'

module.exports = {
  async up(queryInterface: QueryInterface) {
    const migrateBankStateEvents = async () => {
      // Remove primary key constraint and add auto-incrementing id column.
      await queryInterface.removeConstraint(
        'BankStateEvents',
        'BankStateEvents_pkey'
      )
      await queryInterface.addColumn('BankStateEvents', 'id', {
        type: DataType.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      })

      // Remove index and re-add as unique index.
      await queryInterface.removeIndex(
        'BankStateEvents',
        'bank_state_events_address_denom_block_height'
      )
      await queryInterface.addIndex('BankStateEvents', {
        unique: true,
        fields: [
          'address',
          'denom',
          {
            name: 'blockHeight',
            order: 'DESC',
          },
        ],
      })

      console.log('BankStateEvents migrated')
    }

    const migrateExtractions = async () => {
      // Remove primary key constraint and add auto-incrementing id column.
      await queryInterface.removeConstraint('Extractions', 'Extractions_pkey')
      await queryInterface.addColumn('Extractions', 'id', {
        type: DataType.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      })

      // Remove index and re-add as unique index.
      await queryInterface.removeIndex(
        'Extractions',
        'extractions_address_name_block_height'
      )
      await queryInterface.addIndex('Extractions', {
        unique: true,
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

      console.log('Extractions migrated')
    }

    const migrateFeegrantAllowances = async () => {
      // Remove primary key constraint and add auto-incrementing id column.
      await queryInterface.removeConstraint(
        'FeegrantAllowances',
        'FeegrantAllowances_pkey'
      )
      await queryInterface.addColumn('FeegrantAllowances', 'id', {
        type: DataType.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      })

      // Remove index and re-add as unique index.
      await queryInterface.removeIndex(
        'FeegrantAllowances',
        'feegrant_allowances_granter_grantee_block_height'
      )
      await queryInterface.addIndex('FeegrantAllowances', {
        unique: true,
        fields: [
          'granter',
          'grantee',
          {
            name: 'blockHeight',
            order: 'DESC',
          },
        ],
      })

      console.log('FeegrantAllowances migrated')
    }

    const migrateGovProposals = async () => {
      // Remove primary key constraint and add auto-incrementing id column.
      await queryInterface.removeConstraint('GovProposals', 'GovProposals_pkey')
      await queryInterface.addColumn('GovProposals', 'id', {
        type: DataType.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      })

      // Remove index and re-add as unique index.
      await queryInterface.removeIndex(
        'GovProposals',
        'gov_proposals_proposal_id_block_height'
      )
      await queryInterface.addIndex('GovProposals', {
        unique: true,
        fields: [
          'proposalId',
          {
            name: 'blockHeight',
            order: 'DESC',
          },
        ],
      })

      console.log('GovProposals migrated')
    }

    const migrateGovProposalVotes = async () => {
      // Remove primary key constraint and add auto-incrementing id column.
      await queryInterface.removeConstraint(
        'GovProposalVotes',
        'GovProposalVotes_pkey'
      )
      await queryInterface.addColumn('GovProposalVotes', 'id', {
        type: DataType.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      })

      // Remove index and re-add as unique index.
      await queryInterface.removeIndex(
        'GovProposalVotes',
        'gov_proposal_votes_proposal_id_voter_address_block_height'
      )
      await queryInterface.addIndex('GovProposalVotes', {
        unique: true,
        fields: [
          'proposalId',
          'voterAddress',
          {
            name: 'blockHeight',
            order: 'DESC',
          },
        ],
      })

      console.log('GovProposalVotes migrated')
    }

    const migrateWasmStateEvents = async () => {
      // Remove primary key constraint and add auto-incrementing id column.
      await queryInterface.removeConstraint(
        'WasmStateEvents',
        'WasmStateEvents_pkey'
      )
      await queryInterface.addColumn('WasmStateEvents', 'id', {
        type: DataType.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      })

      // Remove index and re-add as unique index.
      await queryInterface.removeIndex(
        'WasmStateEvents',
        'wasm_state_events_contract_address_key_block_height'
      )
      await queryInterface.addIndex('WasmStateEvents', {
        unique: true,
        fields: [
          'contractAddress',
          {
            name: 'key',
            operator: 'text_pattern_ops',
          },
          {
            name: 'blockHeight',
            order: 'DESC',
          },
        ],
      })

      console.log('WasmStateEvents migrated')
    }

    const migrateWasmStateEventTransformations = async () => {
      // Remove primary key constraint and add auto-incrementing id column.
      await queryInterface.removeConstraint(
        'WasmStateEventTransformations',
        'WasmStateEventTransformations_pkey'
      )
      await queryInterface.addColumn('WasmStateEventTransformations', 'id', {
        type: DataType.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      })

      // Remove index and re-add as unique index.
      await queryInterface.removeIndex(
        'WasmStateEventTransformations',
        'wasm_state_event_transformations_contract_address_name_block_he'
      )
      await queryInterface.addIndex('WasmStateEventTransformations', {
        unique: true,
        fields: [
          'contractAddress',
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

      console.log('WasmStateEventTransformations migrated')
    }

    // Execute lighter table migrations in parallel.
    await Promise.all([
      migrateExtractions(),
      migrateFeegrantAllowances(),
      migrateGovProposals(),
      migrateGovProposalVotes(),
      migrateWasmStateEventTransformations(),
    ])

    // Execute heavier table migrations one by one.
    await migrateBankStateEvents()
    await migrateWasmStateEvents()
  },

  async down(_queryInterface: QueryInterface) {
    throw new Error('Not implemented')
  },
}
