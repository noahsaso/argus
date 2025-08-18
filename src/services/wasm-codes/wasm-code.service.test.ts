import { beforeAll, describe, expect, test } from 'vitest'

import { WasmCodeKeyId } from '@/db'
import { WasmCodeKey } from '@/db/models/WasmCodeKey'

import { WasmCode } from './types'
import { WasmCodeService } from './wasm-code.service'

describe('WasmCodeService tests', () => {
  beforeAll(async () => {
    await WasmCodeService.setUpInstance()
  })

  test('WasmCodeService', async () => {
    const wasmCodeService = WasmCodeService.instance

    await WasmCodeKey.createFromKeyAndIds('codeKey1', [1, 2, 3])
    await WasmCodeKey.createFromKeyAndIds('codeKey2', [4, 5, 6, 5, 5, 5])
    await WasmCodeKey.createFromKeyAndIds('codeKey3', [1, 3, 5])

    await wasmCodeService.reloadWasmCodeIdsFromDB()

    expect(wasmCodeService.getWasmCodes()).toEqual([
      new WasmCode('codeKey1', [1, 2, 3]),
      new WasmCode('codeKey2', [4, 5, 6]),
      new WasmCode('codeKey3', [1, 3, 5]),
      // From config-test.json
      new WasmCode('dao-dao-core', [1]),
    ])

    expect(wasmCodeService.exportWasmCodes()).toEqual({
      codeKey1: [1, 2, 3],
      codeKey2: [4, 5, 6],
      codeKey3: [1, 3, 5],
      'dao-dao-core': [1],
    })

    expect(wasmCodeService.findWasmCodeIdsByKeys('codeKey1')).toEqual([1, 2, 3])
    expect(wasmCodeService.findWasmCodeIdsByKeys('codeKey2')).toEqual([4, 5, 6])
    expect(
      wasmCodeService.findWasmCodeIdsByKeys('codeKey1', 'codeKey2')
    ).toEqual([1, 2, 3, 4, 5, 6])

    expect(wasmCodeService.findWasmCodeKeysById(1)).toEqual([
      'dao-dao-core',
      'codeKey1',
      'codeKey3',
    ])
    expect(wasmCodeService.findWasmCodeKeysById(4)).toEqual(['codeKey2'])
    expect(wasmCodeService.findWasmCodeKeysById(7)).toEqual([])

    expect(WasmCodeService.extractWasmCodeKeys(undefined)).toEqual([])
    expect(WasmCodeService.extractWasmCodeKeys('')).toEqual([])
    expect(WasmCodeService.extractWasmCodeKeys('codeKey1')).toEqual([
      'codeKey1',
    ])
    expect(WasmCodeService.extractWasmCodeKeys('codeKey1,codeKey2')).toEqual([
      'codeKey1',
      'codeKey2',
    ])

    await WasmCodeKeyId.truncate()
    await WasmCodeKey.truncate({
      cascade: true,
    })

    await WasmCodeKey.createFromKeyAndIds('codeKey1', 1)
    await WasmCodeKey.createFromKeyAndIds('codeKey2', [2, 3])
    await WasmCodeKey.createFromKeyAndIds('codeKey3', [])

    await wasmCodeService.reloadWasmCodeIdsFromDB()

    expect(wasmCodeService.getWasmCodes()).toEqual([
      new WasmCode('codeKey1', [1]),
      new WasmCode('codeKey2', [2, 3]),
      new WasmCode('codeKey3', []),

      // From config-test.json
      new WasmCode('dao-dao-core', [1]),
    ])

    await WasmCodeKey.createFromKeyAndIds('codeKey4', [])
    await wasmCodeService.reloadWasmCodeIdsFromDB()

    expect(wasmCodeService.getWasmCodes()).toEqual([
      new WasmCode('codeKey1', [1]),
      new WasmCode('codeKey2', [2, 3]),
      new WasmCode('codeKey3', []),
      new WasmCode('codeKey4', []),

      // From config-test.json
      new WasmCode('dao-dao-core', [1]),
    ])
  })
})
