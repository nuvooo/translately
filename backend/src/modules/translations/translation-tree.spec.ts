import { MAX_KEY_LENGTH } from './limits'
import {
  buildTree,
  findKeyConflict,
  findKeyConflicts,
  flattenTree,
} from './translation-tree'

const sample = {
  common: {
    save: 'Speichern',
    nav: { menu: { open: 'Menü öffnen', close: 'Menü schließen' } },
  },
  cart: {
    item_one: '{{count}} Artikel',
    item_other: '{{count}} Artikel',
  },
  title: 'Willkommen',
}

describe('flattenTree', () => {
  it('flattens nested objects into dot keys', () => {
    expect(flattenTree({ a: { b: 'x' }, c: 'y' }).entries).toEqual({
      'a.b': 'x',
      c: 'y',
    })
  })

  it('takes already flat dotted keys as they are', () => {
    expect(flattenTree({ 'a.b': 'x' }).entries).toEqual({ 'a.b': 'x' })
  })

  it('skips non-strings and empty strings, in order of occurrence', () => {
    expect(flattenTree({ n: 1, l: ['x'], z: null, e: '', ok: 'v' })).toEqual({
      entries: { ok: 'v' },
      skipped: [
        { key: 'n', reason: 'not_string' },
        { key: 'l', reason: 'not_string' },
        { key: 'z', reason: 'not_string' },
        { key: 'e', reason: 'empty' },
      ],
    })
  })

  it('reports forbidden segments and never pollutes prototypes', () => {
    expect(flattenTree(JSON.parse('{"__proto__":{"x":"1"},"ok":"v"}'))).toEqual(
      {
        entries: { ok: 'v' },
        skipped: [{ key: '__proto__.x', reason: 'invalid_key' }],
      }
    )
    expect(({} as any).x).toBeUndefined()
  })

  it('reports once per leaf beneath a forbidden key and nothing for empty objects', () => {
    const res = flattenTree(
      JSON.parse('{"__proto__":{"x":"1","y":{"z":"2"},"w":{}},"ok":"v"}')
    )
    expect(res.skipped).toEqual([
      { key: '__proto__.x', reason: 'invalid_key' },
      { key: '__proto__.y.z', reason: 'invalid_key' },
    ])
    expect(res.entries).toEqual({ ok: 'v' })
  })

  it('rejects too long values', () => {
    expect(flattenTree({ a: 'x'.repeat(10_001) }).skipped).toEqual([
      { key: 'a', reason: 'too_long' },
    ])
  })

  it('keeps a value of exactly the maximum length', () => {
    expect(flattenTree({ a: 'x'.repeat(10_000) }).skipped).toEqual([])
  })

  it('reports leaf/parent conflicts and keeps the earlier entry', () => {
    const res = flattenTree({ a: 'x', 'a.b': 'y' })
    expect(res.skipped).toEqual([{ key: 'a.b', reason: 'conflict' }])
    expect(res.entries).toEqual({ a: 'x' })
  })

  it('reports a conflict when a parent comes after its child', () => {
    const res = flattenTree({ 'a.b': 'y', a: 'x' })
    expect(res.skipped).toEqual([{ key: 'a', reason: 'conflict' }])
    expect(res.entries).toEqual({ 'a.b': 'y' })
  })

  it('reports invalid keys', () => {
    expect(flattenTree({ 'a..b': 'x', '.a': 'x' }).skipped).toEqual([
      { key: 'a..b', reason: 'invalid_key' },
      { key: '.a', reason: 'invalid_key' },
    ])
  })

  it('returns empty result for non-objects', () => {
    expect(flattenTree('nope')).toEqual({ entries: {}, skipped: [] })
    expect(flattenTree(5)).toEqual({ entries: {}, skipped: [] })
    expect(flattenTree(null)).toEqual({ entries: {}, skipped: [] })
    expect(flattenTree(['a'])).toEqual({ entries: {}, skipped: [] })
    expect(flattenTree(undefined)).toEqual({ entries: {}, skipped: [] })
  })

  it('does not crash on 10,000 nested levels and reports them once', () => {
    let deep: Record<string, unknown> = { z: 'x' }
    for (let i = 0; i < 10_000; i++) deep = { a: deep }
    let result: ReturnType<typeof flattenTree> | undefined
    expect(() => {
      result = flattenTree(deep)
    }).not.toThrow()
    expect(result?.entries).toEqual({})
    expect(result?.skipped).toHaveLength(1)
    expect(result?.skipped[0].reason).toBe('invalid_key')
  })

  it('still flattens nesting as deep as the key cap allows', () => {
    let deep: Record<string, unknown> = { z: 'x' }
    for (let i = 0; i < 127; i++) deep = { a: deep }
    const key = `${'a.'.repeat(127)}z`
    expect(key.length).toBeLessThanOrEqual(MAX_KEY_LENGTH)
    const res = flattenTree(deep)
    expect(res.skipped).toEqual([])
    expect(res.entries).toEqual({ [key]: 'x' })
  })

  it('rejects an empty segment below the root', () => {
    expect(flattenTree(JSON.parse('{"":{"a":"x"},"ok":"v"}'))).toEqual({
      entries: { ok: 'v' },
      skipped: [{ key: '.a', reason: 'invalid_key' }],
    })
  })

  it('rejects an empty key at the root', () => {
    expect(flattenTree({ '': 'x' })).toEqual({
      entries: {},
      skipped: [{ key: '', reason: 'invalid_key' }],
    })
  })

  it('rejects nested empty segments', () => {
    expect(flattenTree(JSON.parse('{"":{"":{"a":"x"}}}'))).toEqual({
      entries: {},
      skipped: [{ key: '..a', reason: 'invalid_key' }],
    })
    expect(flattenTree(JSON.parse('{"a":{"":{"b":"x"}}}')).skipped).toEqual([
      { key: 'a..b', reason: 'invalid_key' },
    ])
  })

  it('truncates reported keys of skipped entries', () => {
    const res = flattenTree({ ['k'.repeat(5000)]: 'v' })
    expect(res.skipped[0].reason).toBe('invalid_key')
    expect(res.skipped[0].key.length).toBe(MAX_KEY_LENGTH + 1)
    expect(res.skipped[0].key.endsWith('…')).toBe(true)
  })

  it('treats Object.prototype member names as ordinary keys', () => {
    const { entries } = flattenTree({ toString: 'x' })
    expect(Object.keys(entries)).toContain('toString')
    expect(entries.toString).toBe('x')
  })

  it('does not read inherited properties', () => {
    const input = Object.create({ inherited: 'x' })
    input.own = 'y'
    expect(flattenTree(input).entries).toEqual({ own: 'y' })
  })
})

describe('buildTree', () => {
  it('builds nested objects', () => {
    expect(buildTree({ 'a.b': 'x', 'a.c': 'y', d: 'z' })).toEqual({
      a: { b: 'x', c: 'y' },
      d: 'z',
    })
  })

  it('lets the leaf win on conflicts', () => {
    expect(buildTree({ a: 'x', 'a.b': 'y' })).toEqual({ a: 'x' })
  })

  it('lets the leaf win independent of key order', () => {
    expect(buildTree({ 'a.b': 'y', a: 'x' })).toEqual({ a: 'x' })
  })

  it('round-trips with flattenTree', () => {
    expect(buildTree(flattenTree(sample).entries)).toEqual(sample)
  })

  it('drops forbidden keys silently and never pollutes', () => {
    expect(buildTree({ '__proto__.polluted': 'x' })).toEqual({})
    expect(({} as any).polluted).toBeUndefined()
    expect(
      buildTree({ 'constructor.prototype.p': 'x', 'a.prototype': 'y' })
    ).toEqual({})
    expect(({} as any).p).toBeUndefined()
  })

  it('returns plain objects and handles Object.prototype names as data', () => {
    const tree = buildTree({ toString: 'x', 'a.hasOwnProperty': 'y' })
    expect(tree).toEqual({ toString: 'x', a: { hasOwnProperty: 'y' } })
    expect(Object.getPrototypeOf(tree)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(tree.a)).toBe(Object.prototype)
    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree)
  })

  it('never throws on invalid keys', () => {
    expect(() => buildTree({ '': 'x', 'a..b': 'y', '.a': 'z' })).not.toThrow()
    expect(buildTree({ '': 'x', 'a..b': 'y' })).toEqual({})
  })
})

describe('findKeyConflict', () => {
  it('finds a candidate below an existing leaf', () => {
    expect(findKeyConflict(['a.b'], ['a'])).toEqual({
      key: 'a.b',
      conflictsWith: 'a',
    })
  })

  it('finds a candidate above an existing key', () => {
    expect(findKeyConflict(['a'], ['a.b.c'])).toEqual({
      key: 'a',
      conflictsWith: 'a.b.c',
    })
  })

  it('does not treat string prefixes as conflicts', () => {
    expect(findKeyConflict(['ab'], ['a'])).toBeNull()
    expect(findKeyConflict(['a'], ['ab'])).toBeNull()
  })

  it('finds conflicts between candidates', () => {
    expect(findKeyConflict(['x', 'x.y'], [])).toEqual({
      key: 'x.y',
      conflictsWith: 'x',
    })
    expect(findKeyConflict(['x.y', 'x'], [])).toEqual({
      key: 'x',
      conflictsWith: 'x.y',
    })
  })

  it('does not treat identical keys as conflict', () => {
    expect(findKeyConflict(['a.b'], ['a.b'])).toBeNull()
    expect(findKeyConflict(['a', 'a'], [])).toBeNull()
  })

  it('returns the first conflicting candidate', () => {
    expect(findKeyConflict(['ok', 'a.b', 'c.d'], ['a', 'c'])).toEqual({
      key: 'a.b',
      conflictsWith: 'a',
    })
  })

  it('handles 20,000 candidates against 20,000 existing keys', () => {
    const existing = Array.from({ length: 20_000 }, (_, i) => `e.k${i}.leaf`)
    const candidates = Array.from({ length: 20_000 }, (_, i) => `c.k${i}.leaf`)
    const start = performance.now()
    expect(findKeyConflict(candidates, existing)).toBeNull()
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it('finds a conflict of the last candidate with the last existing key', () => {
    const existing = Array.from({ length: 20_000 }, (_, i) => `e.k${i}.leaf`)
    const candidates = Array.from({ length: 20_000 }, (_, i) => `c.k${i}.leaf`)
    candidates[19_999] = 'e.k19999.leaf.child'
    const start = performance.now()
    expect(findKeyConflict(candidates, existing)).toEqual({
      key: 'e.k19999.leaf.child',
      conflictsWith: 'e.k19999.leaf',
    })
    expect(performance.now() - start).toBeLessThan(2000)
  })
})

describe('findKeyConflicts', () => {
  it('splits candidates into accepted keys and conflicts with existing keys', () => {
    expect(
      findKeyConflicts(['ok', 'a.b', 'nav', 'same'], ['a', 'nav.open', 'same'])
    ).toEqual({
      accepted: ['ok', 'same'],
      conflicts: [
        { key: 'a.b', conflictsWith: 'a' },
        { key: 'nav', conflictsWith: 'nav.open' },
      ],
    })
  })

  it('does not treat string prefixes or identical keys as conflicts', () => {
    expect(findKeyConflicts(['ab', 'a', 'x.y'], ['a', 'x.y'])).toEqual({
      accepted: ['ab', 'a', 'x.y'],
      conflicts: [],
    })
  })

  it('checks candidates against earlier accepted candidates', () => {
    expect(findKeyConflicts(['x', 'x.y', 'z.w', 'z'], [])).toEqual({
      accepted: ['x', 'z.w'],
      conflicts: [
        { key: 'x.y', conflictsWith: 'x' },
        { key: 'z', conflictsWith: 'z.w' },
      ],
    })
  })

  it('handles 20,000 candidates against 20,000 existing keys in linear time', () => {
    const existing = Array.from({ length: 20_000 }, (_, i) => `e.k${i}.leaf`)
    const candidates = Array.from({ length: 20_000 }, (_, i) =>
      i % 2 === 0 ? `e.k${i}.leaf.child` : `c.k${i}.leaf`
    )
    const start = performance.now()
    const result = findKeyConflicts(candidates, existing)
    expect(performance.now() - start).toBeLessThan(2000)
    expect(result.accepted).toHaveLength(10_000)
    expect(result.conflicts).toHaveLength(10_000)
    expect(result.conflicts[0]).toEqual({
      key: 'e.k0.leaf.child',
      conflictsWith: 'e.k0.leaf',
    })
  })
})
