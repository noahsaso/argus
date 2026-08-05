import * as fs from 'fs'

type FifoJsonTracerOptions = {
  file: string
  onData: (data: unknown) => void
  // If provided, this callback will be called when a JSON object cannot be
  // parsed from the line.
  onError?: (line: string, error: unknown) => void
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
// callback throws an error, the FIFO will be closed and the error will be
// thrown. If a line cannot be parsed as a JSON object, the `onError` callback
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
      if (!shuttingDown && !settled) {
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

        try {
          onData(JSON.parse(line))
        } catch (error) {
          if (error instanceof SyntaxError) {
            onError?.(line, error)
          } else {
            shuttingDown = true
            stream.destroy()
            reject(error)
          }
        }
      }
    })

    stream.on('error', (error) => {
      sessionComplete = true
      shuttingDown = true
      if (activeStream === stream) {
        activeStream = undefined
      }
      stream.destroy()
      reject(error)
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
      activeStream?.destroy()
      activeStream = undefined
      resolve()
    },
  }
}
