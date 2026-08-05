import { execFile } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { afterEach, describe, expect, it } from 'vitest'

import { setUpFifoJsonTracer } from './utils'

const execFileAsync = promisify(execFile)

const waitFor = async (assertion: () => void, timeout = 2_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  assertion()
}

const settlesWithin = async (promise: Promise<void>, timeout: number) =>
  Promise.race([
    promise.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), timeout)),
  ])

describe('setUpFifoJsonTracer', () => {
  let directory: string | undefined
  let close: (() => void) | undefined

  afterEach(async () => {
    close?.()
    if (directory) {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps reading after the FIFO writer disconnects', async () => {
    directory = await mkdtemp(join(tmpdir(), 'argus-fifo-'))
    const fifo = join(directory, 'trace.fifo')
    await execFileAsync('mkfifo', [fifo])
    const seen: unknown[] = []
    const tracer = setUpFifoJsonTracer({
      file: fifo,
      onData: (data) => seen.push(data),
    })
    close = tracer.close

    await writeFile(fifo, `${JSON.stringify({ block: 40420068 })}\n`)
    await waitFor(() => expect(seen).toEqual([{ block: 40420068 }]))
    expect(await settlesWithin(tracer.promise, 100)).toBe(false)

    await writeFile(fifo, `${JSON.stringify({ block: 40420069 })}\n`)
    await waitFor(() =>
      expect(seen).toEqual([{ block: 40420068 }, { block: 40420069 }])
    )

    tracer.close()
    await expect(tracer.promise).resolves.toBeUndefined()
  })

  it('stops processing a chunk after an onData callback fails', async () => {
    directory = await mkdtemp(join(tmpdir(), 'argus-fifo-'))
    const fifo = join(directory, 'trace.fifo')
    await execFileAsync('mkfifo', [fifo])
    const seen: unknown[] = []
    const error = new Error('callback failed')
    const tracer = setUpFifoJsonTracer({
      file: fifo,
      onData: (data) => {
        seen.push(data)
        throw error
      },
    })
    close = tracer.close

    const rejection = expect(tracer.promise).rejects.toBe(error)
    await writeFile(fifo, '{"line":1}\n{"line":2}\n')

    await rejection
    expect(seen).toEqual([{ line: 1 }])
  })

  it('stops processing a chunk after an onError callback fails', async () => {
    directory = await mkdtemp(join(tmpdir(), 'argus-fifo-'))
    const fifo = join(directory, 'trace.fifo')
    await execFileAsync('mkfifo', [fifo])
    const seen: unknown[] = []
    const error = new Error('error callback failed')
    const tracer = setUpFifoJsonTracer({
      file: fifo,
      onData: (data) => seen.push(data),
      onError: () => {
        throw error
      },
    })
    close = tracer.close

    const rejection = expect(tracer.promise).rejects.toBe(error)
    await writeFile(fifo, 'invalid\n{"line":2}\n')

    await rejection
    expect(seen).toEqual([])
  })

  it('resolves when explicitly closed while waiting for a writer', async () => {
    directory = await mkdtemp(join(tmpdir(), 'argus-fifo-'))
    const fifo = join(directory, 'trace.fifo')
    await execFileAsync('mkfifo', [fifo])
    const tracer = setUpFifoJsonTracer({ file: fifo, onData: () => {} })
    close = tracer.close

    tracer.close()

    await expect(tracer.promise).resolves.toBeUndefined()
  })
})
