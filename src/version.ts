import { readFileSync } from 'fs'
import { join } from 'path'

// Read version from package.json at startup. Using readFileSync since this
// runs once at import time, not per-request.
// Use process.cwd() instead of __dirname since bundlers like tsup change
// __dirname resolution, but cwd is reliably /app in Docker.
const pkg = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf-8')
)

export const version: string = pkg.version
