import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_IMPORT_BYTES } from './modules/translations/limits'

/**
 * The backend accepts MAX_IMPORT_BYTES of JSON on the two import routes. Every
 * nginx config in the repo that proxies `/api/` must let such a body through,
 * with headroom for the JSON envelope, or nginx answers 413 before the request
 * reaches the backend. The effective limit for a path is resolved the way
 * nginx does for top-level locations: exact match, then the longest prefix
 * (`^~` stops the search), then the first matching regex, else the longest
 * prefix; without a `client_max_body_size` in the chosen location the server
 * value applies, else nginx's default of 1 MB.
 */
const NGINX_CONFIGS = ['nginx.conf', 'frontend/nginx.conf']
const HEADROOM_BYTES = 512 * 1024
const NGINX_DEFAULT_BYTES = 1024 * 1024
const IMPORT_PATHS = [
  '/api/projects/0123456789abcdef01234567/translations/import',
  '/api/projects/0123456789abcdef01234567/translations/import/preview',
]

interface Location {
  modifier: string
  pattern: string
  body: string
}

function toBytes(value: string): number {
  const match = /^(\d+)([kKmMgG]?)$/.exec(value.trim())
  if (!match) throw new Error(`unparsable size: ${value}`)
  const unit = match[2].toLowerCase()
  const factor =
    unit === 'k' ? 1024 : unit === 'm' ? 1024 ** 2 : unit === 'g' ? 1024 ** 3 : 1
  // 0 disables the check in nginx.
  return Number(match[1]) === 0 ? Number.POSITIVE_INFINITY : Number(match[1]) * factor
}

function stripComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n')
}

/** Content between the brace at `open` and its matching closing brace. */
function blockAt(text: string, open: number): string {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    if (text[i] === '}') {
      depth--
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  throw new Error('unbalanced braces')
}

/** Removes nested `{…}` blocks so only directives of this level remain. */
function topLevel(body: string): string {
  let out = ''
  let depth = 0
  for (const ch of body) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (depth === 0) out += ch
  }
  return out
}

function bodySize(directives: string): number | undefined {
  const match = /(?:^|[;\s])client_max_body_size\s+([^;\s]+)\s*;/.exec(directives)
  return match ? toBytes(match[1]) : undefined
}

function parseServer(file: string): { server: string; locations: Location[] } {
  const text = stripComments(
    readFileSync(join(__dirname, '..', '..', file), 'utf8')
  )
  const serverStart = text.search(/\bserver\s*\{/)
  if (serverStart === -1) throw new Error(`${file}: no server block`)
  const server = blockAt(text, text.indexOf('{', serverStart))
  const locations: Location[] = []
  const re = /\blocation\s+(=|\^~|~\*|~)?\s*([^\s{]+)\s*\{/g
  let depth = 0
  let scanned = 0
  for (let m = re.exec(server); m; m = re.exec(server)) {
    for (; scanned < m.index; scanned++) {
      if (server[scanned] === '{') depth++
      if (server[scanned] === '}') depth--
    }
    if (depth !== 0) continue // nested location: not modelled
    const open = m.index + m[0].length - 1
    locations.push({
      modifier: m[1] ?? '',
      pattern: m[2],
      body: blockAt(server, open),
    })
  }
  return { server, locations }
}

function chooseLocation(locations: Location[], path: string): Location | undefined {
  const exact = locations.find((l) => l.modifier === '=' && l.pattern === path)
  if (exact) return exact
  const prefixes = locations
    .filter((l) => (l.modifier === '' || l.modifier === '^~') && path.startsWith(l.pattern))
    .sort((a, b) => b.pattern.length - a.pattern.length)
  const longest = prefixes[0]
  if (longest?.modifier === '^~') return longest
  const regex = locations.find(
    (l) =>
      (l.modifier === '~' || l.modifier === '~*') &&
      new RegExp(l.pattern, l.modifier === '~*' ? 'i' : '').test(path)
  )
  return regex ?? longest
}

function effectiveLimit(file: string, path: string): number {
  const { server, locations } = parseServer(file)
  const location = chooseLocation(locations, path)
  if (!location) throw new Error(`${file}: no location handles ${path}`)
  if (!/\bproxy_pass\b/.test(location.body)) {
    throw new Error(`${file}: ${path} is not proxied to the backend`)
  }
  return (
    bodySize(topLevel(location.body)) ??
    bodySize(topLevel(server)) ??
    NGINX_DEFAULT_BYTES
  )
}

describe('nginx request body limit on the import routes', () => {
  const cases = NGINX_CONFIGS.flatMap((file) =>
    IMPORT_PATHS.map((path) => [file, path] as const)
  )

  it.each(cases)('%s lets a full-size import through on %s', (file, path) => {
    expect(effectiveLimit(file, path)).toBeGreaterThanOrEqual(
      MAX_IMPORT_BYTES + HEADROOM_BYTES
    )
  })
})

describe('nginx read timeout on the AI translation routes', () => {
  const AI_PATHS = [
    '/api/projects/0123456789abcdef01234567/translations/ai/suggest',
    '/api/projects/0123456789abcdef01234567/translations/ai/preview-missing',
    '/api/projects/0123456789abcdef01234567/translations/ai/apply',
  ]
  const readTimeout = (file: string, path: string) => {
    const location = chooseLocation(parseServer(file).locations, path)
    if (!location || !/\bproxy_pass\b/.test(location.body)) {
      throw new Error(`${file}: ${path} is not proxied to the backend`)
    }
    return /proxy_read_timeout\s+([^;\s]+)\s*;/.exec(topLevel(location.body))?.[1]
  }

  it.each(
    NGINX_CONFIGS.flatMap((file) => AI_PATHS.map((path) => [file, path] as const))
  )('%s waits 150s for %s', (file, path) => {
    expect(readTimeout(file, path)).toBe('150s')
  })

  it.each(NGINX_CONFIGS)('%s keeps other API routes on the /api/ location', (file) => {
    const location = chooseLocation(
      parseServer(file).locations,
      '/api/projects/0123456789abcdef01234567/translations'
    )
    expect(location?.pattern).toBe('/api/')
  })
})

describe('nginx location for the MCP endpoint', () => {
  const mcpLocation = (file: string) =>
    parseServer(file).locations.find(
      (l) => l.modifier === '=' && l.pattern === '/api/mcp'
    )

  it.each(NGINX_CONFIGS)('%s waits 150s on the exact /api/mcp location', (file) => {
    const location = mcpLocation(file)
    expect(location).toBeDefined()
    expect(/\bproxy_pass\b/.test(location?.body ?? '')).toBe(true)
    expect(
      /proxy_read_timeout\s+([^;\s]+)\s*;/.exec(
        topLevel(location?.body ?? '')
      )?.[1]
    ).toBe('150s')
  })

  it.each(NGINX_CONFIGS)('%s lets a 1 MB MCP body through', (file) => {
    expect(effectiveLimit(file, '/api/mcp')).toBeGreaterThanOrEqual(
      1024 * 1024 + 64 * 1024
    )
  })

  it.each(NGINX_CONFIGS)('%s keeps the /api/mcp/ prefix on the /api/ location', (file) => {
    const location = chooseLocation(parseServer(file).locations, '/api/mcp/x')
    expect(location?.pattern).toBe('/api/')
  })
})
