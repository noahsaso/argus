import { describe, expect, it } from 'vitest'

import { parseWasmStoreKey } from './wasm'

describe('parseWasmStoreKey', () => {
  it('parses a Juno v30 contract state key', () => {
    const proposal42TraceKey =
      'A5dHR/1jIwQddN2fdxZpDoG7YKst2MT51H4nrxvh3RhjAAxwcm9wb3NhbHNfdjIAAAAAAAAAKg=='

    expect(parseWasmStoreKey(proposal42TraceKey, 'juno')).toEqual({
      prefix: 0x03,
      contractAddress:
        'juno1jar50ltryvzp6axanam3v6gwsxakp2edmrz0n4r7y7h3hcwarp3sm6ccsp',
      stateKey:
        '0,12,112,114,111,112,111,115,97,108,115,95,118,50,0,0,0,0,0,0,0,42',
    })
  })

  it('parses a Juno v30 contract info key', () => {
    expect(
      parseWasmStoreKey('ApdHR/1jIwQddN2fdxZpDoG7YKst2MT51H4nrxvh3Rhj', 'juno')
    ).toEqual({
      prefix: 0x02,
      contractAddress:
        'juno1jar50ltryvzp6axanam3v6gwsxakp2edmrz0n4r7y7h3hcwarp3sm6ccsp',
      stateKey: '',
    })
  })

  it('ignores a key too short to contain a contract address', () => {
    expect(parseWasmStoreKey('Aw==', 'juno')).toBeUndefined()
  })
})
