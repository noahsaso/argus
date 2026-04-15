import { QueryInterface } from 'sequelize'

import { WasmCodeService } from '@/services/wasm-codes'

module.exports = {
  async up(queryInterface: QueryInterface) {
    // loads from config automatically
    const codes = (await WasmCodeService.setUpInstance()).getWasmCodes()

    const codeKeysInserts = codes.map(({ codeKey }) => ({ codeKey }))
    if (codeKeysInserts.length) {
      await queryInterface.bulkInsert('WasmCodeKeys', codeKeysInserts)
    }

    const codeKeyIdInserts = codes.flatMap(({ codeKey, codeIds }) =>
      codeIds.map((codeKeyId) => ({
        codeKey,
        codeKeyId,
      }))
    )
    if (codeKeyIdInserts.length) {
      await queryInterface.bulkInsert('WasmCodeKeyIds', codeKeyIdInserts)
    }
  },
  async down(queryInterface: QueryInterface) {
    await queryInterface.bulkDelete('WasmCodeKeyIds', {})
    await queryInterface.bulkDelete('WasmCodeKeys', {})
  },
}
