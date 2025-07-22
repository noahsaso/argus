import { WasmCodeService } from '@/services'
import { Extractor, ExtractorMaker } from '@/types'

export type DaoExtractorData = {
  addresses: string[]
}

export const dao: ExtractorMaker<DaoExtractorData> = async ({}) => {
  const match: Extractor<DaoExtractorData>['match'] = ({ events }) => {
    const daoDaoCoreCodeIds =
      WasmCodeService.getInstance().findWasmCodeIdsByKeys('dao-dao-core')

    // Find all DAO addresses by looking for known dao-dao-core code IDs.
    const addresses = events
      .filter(
        (e) =>
          e.type === 'instantiate' &&
          e.attributes.some(
            (a) =>
              a.key === 'code_id' &&
              !isNaN(Number(a.value)) &&
              daoDaoCoreCodeIds.includes(Number(a.value))
          )
      )
      .flatMap((e) =>
        e.attributes
          .filter((a) => a.key === '_contract_address')
          .map((a) => a.value)
      )

    if (addresses.length === 0) {
      return
    }

    return {
      addresses,
    }
  }

  const extract: Extractor<DaoExtractorData>['extract'] = async ({
    addresses,
  }) => {}

  return {
    match,
    extract,
  }
}
