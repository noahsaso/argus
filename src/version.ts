import { readFileSync } from 'fs'
import { join } from 'path'

// Read version from package.json at startup. Using readFileSync since this
// runs once at import time, not per-request.
const pkg = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
)

export const version: string = pkg.version
