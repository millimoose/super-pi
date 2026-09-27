import { describe, expect, it } from 'vitest'
import { createAnchor, findAnchor } from './anchor'

const DOC = '# Spec\n\nThe system shall support dark mode.\n\nThe system shall log events.\n'

describe('createAnchor', () => {
  it('captures exact plus 64-char context windows', () => {
    const from = DOC.indexOf('dark mode')
    const anchor = createAnchor(DOC, from, from + 9)
    expect(anchor.exact).toBe('dark mode')
    expect(anchor.prefix.endsWith('support ')).toBe(true)
    expect(anchor.suffix.startsWith('.\n')).toBe(true)
  })
})

describe('findAnchor', () => {
  it('locates a unique exact match', () => {
    const from = DOC.indexOf('dark mode')
    const anchor = createAnchor(DOC, from, from + 9)
    expect(findAnchor(DOC, anchor)).toEqual({ from, to: from + 9 })
  })

  it('disambiguates duplicates via prefix/suffix context', () => {
    const first = DOC.indexOf('The system shall')
    const second = DOC.indexOf('The system shall', first + 1)
    const a1 = createAnchor(DOC, second, second + 16)
    expect(findAnchor(DOC, a1)).toEqual({ from: second, to: second + 16 })
  })

  it('re-finds a span shifted by an earlier edit via context match', () => {
    const from = DOC.indexOf('log events')
    const anchor = createAnchor(DOC, from, from + 10)
    const edited = DOC.replace('dark mode', 'dark and light themes') // shifts positions
    const relocated = findAnchor(edited, anchor)
    if (relocated === 'orphaned') throw new Error('expected relocation')
    expect(edited.slice(relocated.from, relocated.to)).toBe('log events')
  })

  it('returns orphaned when the text is gone', () => {
    const from = DOC.indexOf('dark mode')
    expect(findAnchor(DOC.replace('dark mode', 'light mode'), createAnchor(DOC, from, from + 9))).toBe(
      'orphaned'
    )
  })

  it('returns orphaned when still ambiguous after context filtering', () => {
    const dup = 'same same\nsame same'
    // no context at all: all four occurrences match equally
    expect(findAnchor(dup, { exact: 'same', prefix: '', suffix: '' })).toBe('orphaned')
  })

  it('returns orphaned for an empty exact span', () => {
    expect(findAnchor(DOC, { exact: '', prefix: '', suffix: '' })).toBe('orphaned')
  })
})
