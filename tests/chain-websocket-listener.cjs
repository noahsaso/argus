// Isolated lifecycle tests: execute the real TypeScript with only I/O boundaries
// replaced. No global test setup, database, queue, FIFO or real port is loaded.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

function harness(types = 'NewBlock', rpc, socketClass) {
  let now = 0
  let nextId = 0
  const timers = new Map()
  const probes = []
  const sockets = []
  const waits = []
  const events = []
  const setTimeout = (fn, delay) => {
    timers.set(++nextId, { fn, time: now + delay })
    return nextId
  }
  const clearTimeout = (id) => timers.delete(id)
  const tick = async (ms) => {
    const end = now + ms
    await flush()
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].time - b[1].time)[0]
      if (!entry || entry[1].time > end) break
      now = entry[1].time
      timers.delete(entry[0])
      entry[1].fn()
      await flush()
    }
    now = end
    await flush()
  }
  class Probe extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.destroyed = false
      probes.push(this)
    }
    destroy() {
      this.destroyed = true
      if (this.destroyError) {
        this.destroyedEvent = Promise.resolve().then(() => {
          this.emit('error', new Error('queued connection error'))
          this.emit('close')
        })
      } else this.emit('close')
      return this
    }
  }
  class Socket extends EventEmitter {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    constructor(url) {
      super()
      this.url = url
      this.readyState = 0
      this.sent = []
      this.closed = 0
      sockets.push(this)
    }
    addEventListener(event, callback) {
      this.on(event, callback)
    }
    removeEventListener(event, callback) {
      this.removeListener(event, callback)
    }
    send(message) {
      if (this.readyState !== 1)
        throw new Error('WebSocket is not open: readyState 0 (CONNECTING)')
      if (this.sendError) throw this.sendError
      this.sent.push(JSON.parse(message))
    }
    close() {
      if (this.readyState === 3) return
      this.closed++
      this.readyState = 3
      this.onclose?.({ code: 1000, reason: '' })
      this.emit('close')
    }
    terminate() {
      this.close()
    }
    open() {
      this.readyState = 1
      this.onopen?.({})
    }
  }
  const transpile = (file) =>
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText
  const utils = { exports: {} }
  vm.runInNewContext(
    transpile(path.join(__dirname, '../src/utils/objectMatchesStructure.ts')),
    utils
  )
  const dependencies = {
    net: {
      createConnection: (options) => new Probe(options),
      isIP: require('node:net').isIP,
    },
    '@cosmjs/crypto': {
      sha256: (data) => createHash('sha256').update(data).digest(),
    },
    '@cosmjs/encoding': {
      fromBase64: (s) => Buffer.from(s, 'base64'),
      toHex: (b) => b.toString('hex'),
    },
    '@sentry/node': { captureException() {}, captureMessage() {} },
    '@/db': { State: { getSingleton: async () => ({ chainId: 'test' }) } },
    '@/utils': utils.exports,
    ws: { WebSocket: socketClass || Socket },
    // Only used by the pre-fix source to reproduce its uncancellable wait.
    'wait-port': () =>
      new Promise((resolve, reject) => waits.push({ resolve, reject })),
  }
  const context = {
    exports: {},
    URL,
    Buffer,
    setTimeout,
    clearTimeout,
    console: { log() {}, error() {} },
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  }
  if (process.env.LISTENER_BUNDLE) {
    // Evaluate the unchanged class section of the actual built tracer, not the
    // application entrypoint (which opens queues/FIFO/database connections).
    const bundle = fs.readFileSync(process.env.LISTENER_BUNDLE, 'utf8')
    const start = bundle.indexOf('// src/services/ChainWebSocketListener.ts\n')
    assert.ok(start >= 0, 'Built listener marker must exist')
    const end = bundle.indexOf('\n// ', start + 1)
    assert.ok(end > start, 'Built listener boundary must exist')
    const source = bundle.slice(start, end)
    const state = source.match(/\b(State\d*)\.getSingleton/)
    assert.ok(state, 'Built State reference must be identified')
    context[state[1]] = dependencies['@/db'].State
    context.objectMatchesStructure = utils.exports.objectMatchesStructure
    context.__toESM = (module) => ({ ...module, default: module })
    context.__name = (value) => value
    vm.runInNewContext(
      source + '\nexports.ChainWebSocketListener = ChainWebSocketListener;',
      context
    )
  } else {
    vm.runInNewContext(
      transpile(
        process.env.LISTENER_SOURCE ||
          path.join(__dirname, '../src/services/ChainWebSocketListener.ts')
      ),
      context
    )
  }
  const listener = new context.exports.ChainWebSocketListener(types, { rpc })
  listener.onConnectionStateChange((event) => events.push(event))
  const ready = async () => {
    for (const wait of waits.splice(0)) wait.resolve({ open: true })
    for (const probe of probes.filter((p) => !p.destroyed))
      probe.emit('connect')
    await flush()
  }
  const clean = () => {
    listener.disconnect()
    assert.equal(timers.size, 0, 'No pending timers after disconnect')
    assert.ok(
      probes.every((p) => p.destroyed),
      'All port probes destroyed'
    )
    assert.ok(
      probes.every(
        (p) =>
          p.listenerCount('connect') === 0 && p.listenerCount('error') === 0
      ),
      'Probe listeners removed'
    )
    assert.ok(
      sockets.every(
        (s) => s.closed && !s.onopen && !s.onmessage && !s.onclose && !s.onerror
      ),
      'Socket callbacks detached and sockets closed'
    )
  }
  return {
    listener,
    sockets,
    probes,
    waits,
    events,
    timers,
    tick,
    ready,
    clean,
  }
}

test('multiple timeout windows cannot revive settled port waits or create multiple sockets', async () => {
  const h = harness()
  const connection = h.listener.connect()
  await h.tick(10000)
  await h.tick(1000)
  await h.tick(10000)
  await h.tick(2000)
  await h.ready()
  assert.equal(
    h.sockets.length,
    1,
    'Only the current attempt may create a socket'
  )
  h.sockets[0].open()
  await connection
  assert.equal(h.sockets[0].sent.length, 1)
  h.clean()
})

test('disconnect during port wait settles connect and late readiness is inert', async () => {
  const h = harness()
  let settled = false
  const connection = h.listener.connect().then(() => {
    settled = true
  })
  await flush()
  h.listener.disconnect()
  await flush()
  await h.ready()
  assert.equal(h.listener.connecting, false)
  assert.equal(settled, true)
  assert.equal(h.sockets.length, 0)
  await connection
  h.clean()
})

test('saved stale open/close/error/message callbacks cannot touch a newer CONNECTING socket', async () => {
  const h = harness()
  const first = h.listener.connect({ skipWait: true })
  await flush()
  const old = h.sockets[0]
  const stale = {
    open: old.onopen,
    close: old.onclose,
    error: old.onerror,
    message: old.onmessage,
  }
  old.open()
  await first
  h.listener.disconnect()
  const second = h.listener.connect({ skipWait: true })
  await flush()
  const current = h.sockets[1]
  assert.doesNotThrow(() => stale.open({}))
  await stale.error({ error: new Error('stale') })
  stale.close({ code: 1006, reason: 'stale' })
  await stale.message({ data: '{}' })
  assert.equal(current.readyState, 0)
  assert.equal(current.closed, 0)
  assert.equal(h.listener.connected, false)
  current.open()
  await Promise.all([first, second])
  assert.equal(current.sent.length, 1)
  assert.equal(old.sent.length, 1)
  h.clean()
})

test('handshake timeout releases the socket and ignores a saved late open', async () => {
  const h = harness()
  const connection = h.listener
    .connect({ skipWait: true, continuousReconnect: false })
    .catch((error) => error)
  await flush()
  const old = h.sockets[0]
  const open = old.onopen
  await h.tick(10000)
  assert.match((await connection).message, /timeout/)
  assert.equal(old.closed, 1)
  open({})
  assert.equal(old.sent.length, 0)
  assert.equal(h.listener.connected, false)
  h.clean()
})

test('subscription send exceptions are contained and fail the attempt with cleanup', async () => {
  const h = harness(['NewBlock', 'Tx'])
  const connection = h.listener
    .connect({ skipWait: true, continuousReconnect: false })
    .catch((error) => error)
  await flush()
  h.sockets[0].sendError = new Error('send failed')
  assert.doesNotThrow(() => h.sockets[0].open())
  assert.match((await connection).message, /send failed/)
  assert.equal(h.listener.connected, false)
  h.clean()
})

test('onopen must not subscribe while the owned socket is still CONNECTING', async () => {
  const h = harness()
  const connection = h.listener.connect({ skipWait: true })
  await flush()
  assert.doesNotThrow(() => h.sockets[0].onopen({}))
  assert.equal(h.sockets[0].sent.length, 0)
  assert.equal(h.listener.connected, false)
  h.listener.disconnect()
  await connection
  h.clean()
})

test('disconnect cancels backoff and an immediate new connect is not corrupted by the old loop', async () => {
  const h = harness()
  const old = h.listener.connect({ skipWait: true })
  await h.tick(10000)
  h.listener.disconnect()
  const current = h.listener.connect({ skipWait: true })
  await flush()
  assert.equal(h.sockets.length, 2)
  h.sockets[1].open()
  await Promise.all([old, current])
  await h.tick(60000)
  assert.equal(h.sockets.length, 2)
  assert.equal(h.listener.connected, true)
  h.clean()
})

test('normal subscriptions, NewBlock/Tx delivery and reconnect retain the public contract', async () => {
  const h = harness(['NewBlock', 'Tx'])
  const blocks = [],
    txs = []
  h.listener.onNewBlock((block) => blocks.push(block))
  h.listener.onTx((...args) => txs.push(args))
  const connection = h.listener.connect()
  await flush()
  await h.ready()
  const socket = h.sockets[0]
  assert.equal(socket.url, 'ws://127.0.0.1:26657/websocket')
  socket.open()
  await connection
  assert.deepEqual(
    JSON.parse(JSON.stringify(socket.sent)),
    ['NewBlock', 'Tx'].map((type) => ({
      jsonrpc: '2.0',
      method: 'subscribe',
      id: 1,
      params: { query: `tm.event = '${type}'` },
    }))
  )
  const header = {
    chain_id: 'xion-testnet-2',
    height: '123',
    time: '2026-10-30T00:00:00Z',
  }
  const tx = {
    height: '123',
    tx: Buffer.from('tx').toString('base64'),
    result: {},
  }
  await socket.onmessage({
    data: JSON.stringify({
      result: {
        data: {
          type: 'tendermint/event/NewBlock',
          value: { block: { header } },
        },
      },
    }),
  })
  await socket.onmessage({
    data: JSON.stringify({
      result: {
        data: { type: 'tendermint/event/Tx', value: { TxResult: tx } },
      },
    }),
  })
  await socket.onmessage({ data: '{}' })
  await socket.onmessage({ data: 'invalid JSON' })
  assert.equal(JSON.stringify(blocks), JSON.stringify([header]))
  assert.equal(
    txs[0][0],
    createHash('sha256').update('tx').digest('hex').toUpperCase()
  )
  const staleError = socket.onerror
  socket.close()
  await h.tick(1000)
  await h.ready()
  const newer = h.sockets[1]
  assert.ok(newer)
  await staleError({ error: new Error('late') })
  newer.open()
  await flush()
  assert.equal(h.listener.connected, true)
  assert.equal(newer.sent.length, 2)
  assert.equal(
    h.events.map((e) => e.state).join(','),
    'connecting,connected,disconnected,connecting,connected'
  )
  h.clean()
})

test('initial socket error is cleaned up and non-reconnecting connect rejects once', async () => {
  const h = harness()
  const connection = h.listener
    .connect({ skipWait: true, continuousReconnect: false })
    .catch((error) => error)
  await flush()
  const socket = h.sockets[0]
  await socket.onerror({ error: new Error('handshake failed') })
  assert.match((await connection).message, /handshake failed/)
  assert.equal(h.listener.connecting, false)
  h.clean()
})

test('already CLOSED sockets do not retain transport cleanup listeners', async () => {
  const h = harness()
  const connection = h.listener.connect({ skipWait: true })
  await flush()
  const socket = h.sockets[0]
  socket.open()
  await connection
  socket.readyState = 3
  socket.closed++
  socket.emit('close')
  socket.onclose({ code: 1000, reason: '' })
  assert.equal(socket.listenerCount('error'), 0)
  assert.equal(socket.listenerCount('close'), 0)
  h.clean()
})

test('saved port-readiness callback from a timed-out probe cannot revive it', async () => {
  const h = harness()
  const connection = h.listener.connect()
  await flush()
  const late = h.probes[0].listeners('connect')[0]
  await h.tick(10000)
  await h.tick(1000)
  late()
  await flush()
  assert.equal(h.sockets.length, 0)
  await h.ready()
  h.sockets[0].open()
  await connection
  h.clean()
})

test('disconnect cancels the delayed reconnect after a connected error', async () => {
  const h = harness()
  const connection = h.listener.connect({ skipWait: true })
  await flush()
  const socket = h.sockets[0]
  socket.open()
  await connection
  await socket.onerror({ error: new Error('connection lost') })
  h.listener.disconnect()
  await h.tick(60000)
  assert.equal(h.sockets.length, 1)
  h.clean()
})

test('a reentrant connected callback can disconnect without restarting a stale loop', async () => {
  const h = harness()
  h.listener.onConnectionStateChange(({ state }) => {
    if (state === 'connected') h.listener.disconnect()
  })
  const connection = h.listener.connect({ skipWait: true })
  await flush()
  h.sockets[0].open()
  await connection
  await h.tick(60000)
  assert.equal(h.listener.connected, false)
  assert.equal(h.listener.connecting, false)
  h.clean()
})

test('TCP refusal retries with bounded resources; hostname IPv6 fallback and HTTPS port remain supported', async () => {
  const h = harness('NewBlock', 'https://localhost')
  const connection = h.listener.connect()
  await flush()
  assert.equal(h.probes[0].options.port, 443)
  assert.equal(h.probes[0].options.family, 4)
  h.probes[0].emit(
    'error',
    Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
  )
  assert.equal(h.probes[1].options.family, 6)
  h.probes[1].emit(
    'error',
    Object.assign(new Error('IPv6 disabled'), { code: 'EADDRNOTAVAIL' })
  )
  await h.tick(1000)
  assert.equal(h.probes.length, 3)
  assert.equal(h.probes.filter((p) => !p.destroyed).length, 1)
  await h.ready()
  h.sockets[0].open()
  await connection
  h.clean()
})

test('invalid RPC and DNS errors reject without leaving resources', async () => {
  for (const rpc of ['invalid URL', 'http://missing.invalid']) {
    const h = harness('NewBlock', rpc)
    const connection = h.listener
      .connect({ continuousReconnect: false })
      .catch((error) => error)
    await flush()
    h.probes[0]?.emit(
      'error',
      Object.assign(new Error('missing host'), { code: 'ENOTFOUND' })
    )
    assert.match((await connection).message, /Invalid URL|missing host/)
    h.clean()
  }
})

test('cancelling a probe consumes a queued transport error until close', async () => {
  const h = harness()
  const connection = h.listener.connect()
  await flush()
  const probe = h.probes[0]
  probe.destroyError = true
  h.listener.disconnect()
  await assert.doesNotReject(probe.destroyedEvent)
  await connection
  h.clean()
})

test('real locked ws contains the asynchronous CONNECTING termination error without any network I/O', async () => {
  const { Duplex } = require('node:stream')
  const NativeWebSocket = require(process.env.WS_PACKAGE || 'ws').WebSocket
  const transport = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback()
    },
  })
  const sockets = []
  class IsolatedWebSocket extends NativeWebSocket {
    constructor(url) {
      // HTTP/WebSocket handshake runs against an inert stream, never TCP.
      super(url, { createConnection: () => transport })
      sockets.push(this)
    }
  }
  const h = harness('NewBlock', undefined, IsolatedWebSocket)
  const connection = h.listener.connect({ skipWait: true })
  await flush()
  assert.equal(sockets[0].readyState, NativeWebSocket.CONNECTING)
  h.listener.disconnect()
  await connection
  await new Promise(setImmediate)
  assert.equal(sockets[0].readyState, NativeWebSocket.CLOSED)
  assert.equal(sockets[0].onerror, null)
  assert.equal(sockets[0].onclose, null)
  assert.equal(h.timers.size, 0)
  assert.equal(h.listener.connecting, false)
  assert.equal(transport.destroyed, true)
})

test('a duplicate readiness callback cannot publish a second socket within one attempt', async () => {
  const h = harness()
  const connection = h.listener.connect()
  await flush()
  const ready = h.probes[0].listeners('connect')[0]
  await h.ready()
  ready()
  assert.equal(h.sockets.length, 1)
  h.sockets[0].open()
  await connection
  h.clean()
})

test('manual disconnect during CONNECTING emits once, settles the attempt and permits a fresh connection', async () => {
  const h = harness()
  const pending = h.listener.connect({ skipWait: true })
  await flush()
  const old = h.sockets[0]
  const staleClose = old.onclose
  const staleError = old.onerror
  h.listener.disconnect()
  h.listener.disconnect()
  await pending
  await h.tick(60000)
  assert.equal(
    h.events.map(({ state }) => state).join(','),
    'connecting,disconnected'
  )
  assert.equal(h.events[1].isReconnection, false)
  assert.equal(h.listener.connected, false)
  assert.equal(h.listener.connecting, false)
  assert.equal(h.timers.size, 0)
  assert.equal(old.closed, 1)
  assert.equal(h.sockets.length, 1)

  const fresh = h.listener.connect({ skipWait: true })
  await flush()
  staleClose({ code: 1006, reason: 'late cancellation close' })
  await staleError({ error: new Error('late cancellation error') })
  h.sockets[1].open()
  await fresh
  assert.equal(
    h.events.map(({ state }) => state).join(','),
    'connecting,disconnected,connecting,connected'
  )
  assert.equal(h.listener.connected, true)
  assert.equal(h.sockets[1].sent.length, 1)
  h.listener.disconnect()
  h.listener.disconnect()
  assert.equal(
    h.events.map(({ state }) => state).join(','),
    'connecting,disconnected,connecting,connected,disconnected'
  )
  assert.equal(h.events[4].isReconnection, false)
  h.clean()
})
