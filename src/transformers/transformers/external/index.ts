import cw1Whitelist from './cw1Whitelist'
import cw20 from './cw20'
import cw4Group from './cw4Group'
import cw721 from './cw721'
import cwVesting from './cwVesting'
import daoRbam from './daoRbam'

export default [
  ...cw1Whitelist,
  ...cw20,
  ...cw4Group,
  ...cw721,
  ...cwVesting,
  ...daoRbam,
]
