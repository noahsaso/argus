import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate'
import { QueryClient, createProtobufRpcClient } from '@cosmjs/stargate'
import {
  QueryAllContractStateRequest,
  QueryAllContractStateResponse,
} from 'cosmjs-types/cosmwasm/wasm/v1/query'

export type ContractStateEntry = { key: string; value: string }
export type ContractStateDump = { entries: ContractStateEntry[]; count: number }

export type RawModel = { key: Uint8Array; value: Uint8Array }
export type FetchPageArgs = {
  address: string
  pageLimit: number
  nextKey?: Uint8Array
}
export type FetchPageResult = { models: RawModel[]; nextKey?: Uint8Array }

export const fetchContractStatePage =
  (client: CosmWasmClient) =>
  async ({
    address,
    pageLimit,
    nextKey,
  }: FetchPageArgs): Promise<FetchPageResult> => {
    const rpcClient = createProtobufRpcClient(
      new QueryClient(client['forceGetCometClient']())
    )
    const responseBytes = await rpcClient.request(
      'cosmwasm.wasm.v1.Query',
      'AllContractState',
      QueryAllContractStateRequest.encode({
        address,
        pagination: {
          key: nextKey ?? new Uint8Array(),
          offset: 0n,
          limit: BigInt(pageLimit),
          countTotal: false,
          reverse: false,
        },
      }).finish()
    )
    const response = QueryAllContractStateResponse.decode(responseBytes)

    return {
      models: response.models,
      nextKey: response.pagination?.nextKey,
    }
  }

export const dumpContractState = async ({
  address,
  pageLimit,
  fetchPage,
}: {
  address: string
  pageLimit: number
  fetchPage: (args: FetchPageArgs) => Promise<FetchPageResult>
}): Promise<ContractStateDump> => {
  const entries: ContractStateEntry[] = []
  let nextKey: Uint8Array | undefined

  do {
    const page = await fetchPage({ address, pageLimit, nextKey })
    entries.push(
      ...page.models.map(({ key, value }) => ({
        key: Buffer.from(key).toString('base64'),
        value: Buffer.from(value).toString('base64'),
      }))
    )
    nextKey = page.nextKey && page.nextKey.length > 0 ? page.nextKey : undefined
  } while (nextKey)

  return { entries, count: entries.length }
}
