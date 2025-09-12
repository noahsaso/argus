import { makeTransformer, makeTransformerForMap } from '../../utils'

const CODE_IDS_KEYS = ['dao-rbam']

const dao = makeTransformer(CODE_IDS_KEYS, 'dao')
const filter = makeTransformer(CODE_IDS_KEYS, 'filter')
const protobufRegistry = makeTransformer(CODE_IDS_KEYS, 'protobuf_registry')
const enabled = makeTransformer(CODE_IDS_KEYS, 'enabled')
const roles = makeTransformerForMap(CODE_IDS_KEYS, 'role', 'roles')
const authorizations = makeTransformerForMap(
  CODE_IDS_KEYS,
  'authorization',
  'authorizations',
  {
    namer: {
      input: 'number',
    },
  }
)
const authorizationsForRole = makeTransformerForMap(
  CODE_IDS_KEYS,
  'authorizationForRole',
  'authorizations',
  {
    namer: {
      input: 'number',
      transform: ([id], event) => `${event.valueJson.role_id}:${id}`,
    },
  }
)
const assignments = makeTransformerForMap(
  CODE_IDS_KEYS,
  'assignment',
  'assignments',
  {
    namer: {
      input: ['string', 'number'],
    },
  }
)
const assignmentsForRole = makeTransformerForMap(
  CODE_IDS_KEYS,
  'assignmentForRole',
  'assignments',
  {
    namer: {
      input: ['string', 'number'],
      transform: ([address, roleId]) => `${roleId}:${address}`,
    },
  }
)
const log = makeTransformerForMap(CODE_IDS_KEYS, 'log', 'log', {
  namer: {
    input: ['number'],
  },
})
const logsForAddress = makeTransformerForMap(
  CODE_IDS_KEYS,
  'logForAddress',
  'log',
  {
    namer: {
      input: ['number'],
      transform: ([id], event) => `${event.valueJson.addr}:${id}`,
    },
  }
)
const logsForRole = makeTransformerForMap(CODE_IDS_KEYS, 'logForRole', 'log', {
  namer: {
    input: ['number'],
    transform: ([id], event) => `${event.valueJson.role_id}:${id}`,
  },
})
const logsForAuthorization = makeTransformerForMap(
  CODE_IDS_KEYS,
  'logForAuthorization',
  'log',
  {
    namer: {
      input: ['number'],
      transform: ([id], event) => `${event.valueJson.authorization_id}:${id}`,
    },
  }
)

export default [
  dao,
  filter,
  protobufRegistry,
  enabled,
  roles,
  authorizations,
  authorizationsForRole,
  assignments,
  assignmentsForRole,
  log,
  logsForAddress,
  logsForRole,
  logsForAuthorization,
]
