import { diffEntries } from './translation-diff'

describe('diffEntries', () => {
  it('classifies entries', () => {
    expect(
      diffEntries({ a: '1', b: '2', c: '3' }, { b: '2', c: 'X', d: '4' })
    ).toEqual({
      added: ['a'],
      changed: ['c'],
      unchanged: ['b'],
      targetOnly: ['d'],
    })
  })

  it('sorts all lists by code unit order', () => {
    const res = diffEntries(
      { b: '1', B: '1', a: '1' },
      { z: '1', Z: '1', y: '1' }
    )
    expect(res.added).toEqual(['B', 'a', 'b'])
    expect(res.targetOnly).toEqual(['Z', 'y', 'z'])
  })

  it('uses own-property checks', () => {
    expect(diffEntries({ toString: 'x' }, {}).added).toEqual(['toString'])
    expect(diffEntries({}, { constructor: 'x' }).targetOnly).toEqual([
      'constructor',
    ])
  })

  it('handles empty inputs', () => {
    expect(diffEntries({}, {})).toEqual({
      added: [],
      changed: [],
      unchanged: [],
      targetOnly: [],
    })
  })
})
