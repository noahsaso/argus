import * as fs from 'fs'

type FifoJsonTracerOptions = {
  file: string
  onData: (data: unknown) => void
  // If provided, this callback will be called when a JSON object cannot be
  // parsed from the line.
  onError?: (line: string, error: unknown) => void
}

type FifoJsonTracer = {
  // Promise that resolves when the FIFO is closed or rejects if the FIFO
  // errors.
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
  const fifoRs = fs.createReadStream(file, {
    // Parse chunks as UTF-8 strings.
    encoding: 'utf-8',
  })

  // In the case a chunk ends in the middle of a JSON object and not after a
  // newline, buffer the chunk and continue reading until we have a valid JSON
  // object.
  let buffer = ''

  const dataListener = (chunk: string | Buffer) => {
    // Type-check chunk. It should be a string due to `encoding` set above.
    if (!chunk || typeof chunk !== 'string') {
      return
    }

    // All complete lines that should be JSON objects end with a newline, so
    // the last item in this array will be an empty string if the last line
    // is complete. The last line may not be complete if the data being sent
    // exceeds the chunk buffer size. If this is the case, use the buffer
    // across chunks to build the incomplete line.
    const lines = chunk.split('\n')

    if (lines.length === 0) {
      return
    }

    // If the previous chunk left an incomplete line in the buffer, prepend
    // it to the first line of this chunk.
    if (buffer) {
      lines[0] = buffer + lines[0]
      buffer = ''
    }

    // If the last line is not empty, it is incomplete, so buffer it for the
    // next chunk.
    if (lines[lines.length - 1]) {
      buffer = lines.pop()!
    }

    for (const line of lines) {
      // Ignore empty line.
      if (!line) {
        continue
      }

      let data: unknown | undefined
      try {
        data = JSON.parse(line)
      } catch (error) {
        // If we cannot parse the buffer as a JSON object, call the error
        // callback if provided.
        onError?.(line, error)
        continue
      }

      // Execute callback with parsed JSON.
      onData(data)
    }
  }

  let opened = false

  // Wait for FIFO to error or end.
  let resolveDelayed: () => void = () => {}
  const promise = new Promise<void>((_resolve, reject) => {
    let done = false
    const resolve = () => {
      if (!done) {
        done = true
        _resolve()
      }
    }
    resolveDelayed = () => setTimeout(resolve, 5_000)

    fifoRs.on('error', (error) => {
      fifoRs.off('end', resolve)
      fifoRs.off('close', resolveDelayed)
      // Reject once the FIFO ends.
      fifoRs.on('end', () => {
        if (!done) {
          done = true
          reject(error)
        }
      })
      // If closed and promise not done after 2 seconds, reject.
      fifoRs.on('close', () => {
        setTimeout(() => {
          if (!done) {
            done = true
            reject(error)
          }
        }, 2000)
      })
      // Close the FIFO if it is not already closed, so it ends.
      if (!fifoRs.closed) {
        fifoRs.destroy()
      }
    })

    fifoRs.on('open', () => {
      console.log(`[${new Date().toISOString()}] FIFO opened.`)
      opened = true
    })

    // Once data ends, resolve.
    fifoRs.on('end', resolve)

    // If closed and promise not done after 5 seconds, resolve.
    fifoRs.on('close', resolveDelayed)
  })

  // Start reading from the FIFO.
  fifoRs.on('data', dataListener)

  return {
    promise,
    close: () => {
      fifoRs.destroy()
      // If the FIFO was not opened, resolve the promise in 5 seconds.
      if (!opened) {
        resolveDelayed()
      }
    },
  }
}
