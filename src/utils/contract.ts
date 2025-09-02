import { QueryContractInfoResponse as XionQueryContractInfoResponse } from '@burnt-labs/xion-types/cosmwasm/wasm/v1/query'
import { Contract, CosmWasmClient } from '@cosmjs/cosmwasm-stargate'
import { QueryClient, createProtobufRpcClient } from '@cosmjs/stargate'
import {
  QueryContractInfoRequest,
  QueryContractInfoResponse,
} from '@dao-dao/types/protobuf/codegen/cosmwasm/wasm/v1/query'

import { AutoCosmWasmClient } from './AutoCosmWasmClient'

/**
 * Get contract info.
 */
export const getContractInfo = async ({
  address,
  ...connection
}: {
  address: string
} & (
  | {
      client: CosmWasmClient | AutoCosmWasmClient
    }
  | {
      rpc: string
    }
)): Promise<Contract> => {
  let client: CosmWasmClient
  let chainId: string
  if ('rpc' in connection) {
    client = await CosmWasmClient.connect(connection.rpc)
    chainId = await client.getChainId()
  } else if (connection.client instanceof AutoCosmWasmClient) {
    client = await connection.client.getValidClient()
    chainId = await connection.client.getValidChainId()
  } else {
    client = connection.client
    chainId = await client.getChainId()
  }

  const rpcClient = createProtobufRpcClient(
    new QueryClient(client['forceGetCometClient']())
  )
  const responseDecoder = chainId.startsWith('xion-testnet-')
    ? (XionQueryContractInfoResponse as typeof QueryContractInfoResponse)
    : QueryContractInfoResponse

  const { address: retrievedAddress, contractInfo } = responseDecoder.decode(
    await rpcClient.request(
      'cosmwasm.wasm.v1.Query',
      'ContractInfo',
      QueryContractInfoRequest.encode({
        address,
      }).finish()
    )
  )

  if (!contractInfo) {
    throw new Error(`No contract found at address "${address}"`)
  }

  if (
    !retrievedAddress ||
    !contractInfo.codeId ||
    !contractInfo.creator ||
    !contractInfo.label
  ) {
    throw new Error(`Contract info incomplete for address "${address}"`)
  }

  return {
    address: retrievedAddress,
    codeId: Number(contractInfo.codeId),
    creator: contractInfo.creator,
    admin: contractInfo.admin || undefined,
    label: contractInfo.label,
    ibcPortId: contractInfo.ibcPortId || undefined,
  }
}
