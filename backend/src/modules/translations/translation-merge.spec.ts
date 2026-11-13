import { mergeBrandFile } from './translation-merge'

describe('mergeBrandFile', () => {
  it('overlays overrides on defaults', () => {
    expect(mergeBrandFile({ a: '1', b: '2' }, { b: 'B', c: 'C' })).toEqual({
      a: '1',
      b: 'B',
      c: 'C',
    })
  })

  it('does not mutate its inputs', () => {
    const defaults = { a: '1' }
    const overrides = { a: 'A' }
    mergeBrandFile(defaults, overrides)
    expect(defaults).toEqual({ a: '1' })
    expect(overrides).toEqual({ a: 'A' })
  })

  it('treats Object.prototype member names as ordinary keys', () => {
    const res = mergeBrandFile({ toString: 'x' }, { hasOwnProperty: 'y' })
    expect(res.toString).toBe('x')
    expect(res.hasOwnProperty).toBe('y')
  })
})
