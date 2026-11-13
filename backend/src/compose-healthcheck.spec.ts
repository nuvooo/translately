import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The backend runs `prisma db push` on start and exits if it fails, so
 * MongoDB may only report healthy once the replica set has a writable
 * primary. `rs.status()` alone succeeds while the node is still SECONDARY.
 * Every deploy file in the repo root that defines the mongodb service is
 * checked. No YAML parser is a direct dependency, so the healthcheck command
 * is extracted by indentation (tolerant of quoting and list/string forms).
 */
const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.coolify.yml',
  'coolify.yaml',
]

const indentOf = (line: string): number => line.length - line.trimStart().length
const isContent = (line: string): boolean =>
  line.trim() !== '' && !line.trim().startsWith('#')

/** Lines nested below `lines[index]` (more indented; blanks and comments kept). */
function blockBelow(lines: string[], index: number): string[] {
  const indent = indentOf(lines[index])
  const block: string[] = []
  for (let i = index + 1; i < lines.length; i++) {
    if (isContent(lines[i]) && indentOf(lines[i]) <= indent) break
    block.push(lines[i])
  }
  return block
}

function findKey(lines: string[], key: string, indent?: number): number {
  const pattern = new RegExp(`^\\s*["']?${key}["']?\\s*:`)
  return lines.findIndex(
    (line) =>
      pattern.test(line) && (indent === undefined || indentOf(line) === indent)
  )
}

/** The mongodb service's healthcheck `test` value, as one string. */
function mongoHealthcheck(file: string): string {
  const lines = readFileSync(join(__dirname, '..', '..', file), 'utf8').split(
    /\r?\n/
  )
  const services = findKey(lines, 'services')
  if (services === -1) throw new Error(`${file}: no services`)
  const serviceLines = blockBelow(lines, services)
  const serviceIndent = Math.min(
    ...serviceLines.filter(isContent).map(indentOf)
  )
  const mongodb = findKey(serviceLines, 'mongodb', serviceIndent)
  if (mongodb === -1) throw new Error(`${file}: no mongodb service`)
  const mongoLines = blockBelow(serviceLines, mongodb)
  const healthcheck = findKey(mongoLines, 'healthcheck')
  if (healthcheck === -1) throw new Error(`${file}: mongodb has no healthcheck`)
  const healthLines = blockBelow(mongoLines, healthcheck)
  const test = findKey(healthLines, 'test')
  if (test === -1) throw new Error(`${file}: mongodb healthcheck has no test`)
  return [
    healthLines[test].replace(/^\s*["']?test["']?\s*:/, ''),
    ...blockBelow(healthLines, test).filter(isContent),
  ]
    .map((line) => line.trim())
    .join(' ')
}

describe('compose MongoDB healthcheck', () => {
  it.each(COMPOSE_FILES)('%s waits for a writable primary', (file) => {
    const test = mongoHealthcheck(file)
    // The healthcheck initiates the replica set itself; without that the
    // stricter check below could never pass.
    expect(test).toContain('rs.initiate(')
    expect(test).toContain('isWritablePrimary')
    // Not primary yet -> non-zero exit (unhealthy, retried).
    expect(test).toMatch(
      /if\s*\(\s*!\s*db\.hello\(\s*\)\.isWritablePrimary\s*\)\s*\{?\s*quit\(\s*[1-9]\d*\s*\)/
    )
  })
})
