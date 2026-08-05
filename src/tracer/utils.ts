import * as fs from 'fs'

type FifoJsonTracerOptions = {
  file: string
  onData: (data: unknown) => unknown | Promise<unknown>
  // If provided, this callback will be called when a JSON object cannot be
  // parsed from the line.
  onError?: (line: string, error: unknown) => unknown | Promise<unknown>
}

type FifoJsonTracer = {
  // Promise that resolves when explicitly closed or rejects if the FIFO errors.
  promise: Promise<void>
  // Close the FIFO and resolve the promise.
  close: () => void
}

// Trace a FIFO (see `mkfifo`) that transmits JSON objects on each line, and
// execute an asynchronous callback synchronously (i.e. don't read from the FIFO
// while executing the async callback) with the parsed JSON object. If the
// callback throws or rejects, the FIFO will be closed and the lifetime
// promise will reject. If a line cannot be parsed as a JSON object, the `onError` callback
// will be called if provided. If the `onError` callback is not provided, the
// line will be ignored.
//
// Example:
//
//   ```sh
//   # Create FIFO.
//   mkfifo /tmp/my-fifo
//   ```
//
//   ```ts
//   import { setUpFifoJsonTracer } from './utils'
//
//   setUpFifoJsonTracer({
//     file: '/tmp/my-fifo',
//     onData: async (data) => {
//       console.log('Parsed JSON object:', data)
//     },
//     onError: (buffer, error) => {
//       console.error(`Unexpected non-JSON line: "${buffer}"`, err)
//     },
//   })
//   ```
//
//   ```sh
//   # Write JSON objects to FIFO.

//   echo '{"foo": "bar"}' > /tmp/my-fifo
//   # Output:
//   # Parsed JSON object: { foo: 'bar' }

//   echo '{"baz": "qux"}' > /tmp/my-fifo
//   # Output:
//   # Parsed JSON object: { foo: 'bar' }
//   ```
export const setUpFifoJsonTracer = ({
  file,
  onData,
  onError,
}: FifoJsonTracerOptions): FifoJsonTracer => {
  let activeStream: fs.ReadStream | undefined
  let shuttingDown = false
  let settled = false
  let resolvePromise: () => void = () => {}
  let rejectPromise: (error: unknown) => void = () => {}

  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  const resolve = () => {
    if (!settled) {
      settled = true
      resolvePromise()
    }
  }

  const reject = (error: unknown) => {
    if (!settled) {
      settled = true
      rejectPromise(error)
    }
  }

  const openReaderSession = () => {
    if (shuttingDown || settled) {
      return
    }

    // A partial line belongs to the writer session that produced it and must
    // not be combined with data from a replacement writer.
    let buffer = ''
    let sessionComplete = false
    const stream = fs.createReadStream(file, { encoding: 'utf-8' })
    activeStream = stream

    const reconnect = () => {
      if (sessionComplete) {
        return
      }
      sessionComplete = true
      if (activeStream === stream) {
        activeStream = undefined
      }
      if (shuttingDown) {
        resolve()
      } else if (!settled) {
        setImmediate(openReaderSession)
      }
    }

    stream.on('open', () => {
      console.log(`[${new Date().toISOString()}] FIFO opened.`)
    })

    stream.on('data', (chunk: string | Buffer) => {
      if (!chunk || typeof chunk !== 'string') {
        return
      }

      // Pause before awaiting callbacks so later chunks cannot be read or
      // processed until every complete line in this chunk finishes.
      stream.pause()

      void (async () => {
        const lines = chunk.split('\n')
        if (buffer) {
          lines[0] = buffer + lines[0]
          buffer = ''
        }
        if (lines[lines.length - 1]) {
          buffer = lines.pop()!
        }

        for (const line of lines) {
          if (!line) {
            continue
          }

          let data: unknown
          try {
            data = JSON.parse(line)
          } catch (error) {
            await onError?.(line, error)
            continue
          }

          await onData(data)
        }
      })()
        .then(() => {
          if (!shuttingDown && !settled && !stream.destroyed) {
            stream.resume()
          }
        })
        .catch((error) => {
          shuttingDown = true
          stream.destroy()
          reject(error)
        })
    })

    stream.on('error', (error) => {
      sessionComplete = true
      if (activeStream === stream) {
        activeStream = undefined
      }
      stream.destroy()
      if (shuttingDown) {
        resolve()
      } else {
        shuttingDown = true
        reject(error)
      }
    })
    stream.on('end', reconnect)
    stream.on('close', reconnect)
  }

  openReaderSession()

  return {
    promise,
    close: () => {
      if (shuttingDown) {
        return
      }
      shuttingDown = true
      const stream = activeStream
      if (!stream) {
        resolve()
      } else if (stream.pending) {
        // A read-only FIFO open blocks until a writer connects. Open a
        // temporary writer to release that pending open before destroying
        // the stream, so shutdown does not leave a libuv worker blocked
        // indefinitely. The matching pending reader makes this open complete.
        fs.open(file, fs.constants.O_WRONLY, (error, fd) => {
          if (fd !== undefined) {
            fs.close(fd, () => {})
          }
          stream.destroy(error ?? undefined)
        })
      } else {
        stream.destroy()
      }
    },
  }
}
