import { extractPlaceholders, samePlaceholders } from './placeholders'

describe('placeholders', () => {
  it('extracts interpolations, nesting and tags', () => {
    const found = extractPlaceholders(
      'Hallo {{name}}, <0>mehr</0> $t(common.ok)<br/>'
    )
    expect([...found].sort()).toEqual(
      ['{{name}}', '<0>', '</0>', '$t(common.ok)', '<br/>'].sort()
    )
    expect(found).toHaveLength(5)
  })

  it('accepts a translation with the same placeholders', () => {
    expect(samePlaceholders('{{count}} Dateien', '{{count}} files')).toBe(true)
  })

  it('rejects renamed, removed and dropped duplicate placeholders', () => {
    expect(samePlaceholders('{{count}} Dateien', '{{Anzahl}} files')).toBe(
      false
    )
    expect(samePlaceholders('<0>a</0>', 'a')).toBe(false)
    expect(samePlaceholders('{{a}} {{a}}', '{{a}}')).toBe(false)
  })

  it('accepts texts without placeholders', () => {
    expect(samePlaceholders('Speichern', 'Save')).toBe(true)
  })
})
