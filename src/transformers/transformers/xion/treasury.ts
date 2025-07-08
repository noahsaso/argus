import { makeTransformer, makeTransformerForMap } from '../../utils'

const CODE_IDS_KEYS = ['xion-treasury']

const admin = makeTransformer(CODE_IDS_KEYS, 'admin')
const params = makeTransformer(CODE_IDS_KEYS, 'params')
const pendingAdmin = makeTransformer(
  CODE_IDS_KEYS,
  'pendingAdmin',
  'pending_admin'
)
const feeConfig = makeTransformer(CODE_IDS_KEYS, 'feeConfig', 'fee_config')
const grantConfigs = makeTransformerForMap(
  CODE_IDS_KEYS,
  'grantConfig',
  'grant_configs'
)

// Export the transformers
export default [admin, params, pendingAdmin, feeConfig, grantConfigs]
