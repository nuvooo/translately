import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The `*.example` env files in the repo root are meant to be copied to `.env`.
 * docker compose rejects lines it cannot parse (e.g. a quoted value followed
 * by more text), so every line must follow a simple dotenv-compatible rule:
 * blank, a `#` comment, or `KEY=value` where a value that starts with a quote
 * is closed by the same quote at its end.
 */
const ROOT = join(__dirname, '..', '..')

const KEY_VALUE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/

/** Why the line is not dotenv-compatible, or null when it is fine. */
function envLineProblem(line: string): string | null {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return null
  const match = KEY_VALUE.exec(trimmed)
  if (!match) return 'not KEY=value'
  const value = match[2]
  const quote = value[0]
  if (quote !== '"' && quote !== "'") {
    return /["']/.test(value) ? 'quote inside an unquoted value' : null
  }
  const closed = value.length > 1 && value.endsWith(quote)
  if (!closed) return 'quote not closed at the end of the value'
  if (value.slice(1, -1).includes(quote)) return 'quote inside a quoted value'
  return null
}

const exampleFiles = readdirSync(ROOT).filter((name) =>
  /^\.env.*\.example$/.test(name)
)

describe('env example files', () => {
  it('finds the example files', () => {
    expect(exampleFiles).toEqual(
      expect.arrayContaining(['.env.example', '.env.staging.example'])
    )
  })

  it.each(exampleFiles)('%s can be copied to .env', (file) => {
    const problems = readFileSync(join(ROOT, file), 'utf8')
      .split(/\r?\n/)
      .map((line, index) => ({
        line: index + 1,
        problem: envLineProblem(line),
      }))
      .filter((entry) => entry.problem !== null)
    expect(problems).toEqual([])
  })

  it.each([
    ['SMTP_FROM="Translately <noreply@translately.com>"', null],
    ["NAME='a b'", null],
    ['JWT_SECRET=', null],
    ['URL=http://x/{{lng}}?a=b', null],
    ['# comment "with quotes"', null],
    [
      'SMTP_FROM="Translately" <noreply@translately.com>',
      'quote not closed at the end of the value',
    ],
    ['A="open', 'quote not closed at the end of the value'],
    ['A="x"y"', 'quote inside a quoted value'],
    ['A=say "hi"', 'quote inside an unquoted value'],
    ['not a variable', 'not KEY=value'],
  ])('rule: %s', (line, expected) => {
    expect(envLineProblem(line)).toBe(expected)
  })
})
