import { describe, expect, test } from 'vitest'
import { fitParagraphs, wrapText } from './wrap'

const m = (s: string) => s.length

describe('wrapText', () => {
  test('wraps words to the width', () => {
    expect(wrapText('aa bb cc', 5, m)).toEqual(['aa bb', 'cc'])
  })
  test('splits a single overlong word by character', () => {
    expect(wrapText('abcdefghijk', 4, m)).toEqual(['abcd', 'efgh', 'ijk'])
    expect(wrapText('xx abcdefg', 4, m)).toEqual(['xx', 'abcd', 'efg'])
  })
  test('empty text gives one empty line', () => {
    expect(wrapText('', 5, m)).toEqual([''])
  })
  test('keeps non-breaking spaces together', () => {
    expect(wrapText('a 42 000,- Kč', 12, m)).toEqual(['a', '42 000,- Kč'])
  })
  test('honours explicit newlines', () => {
    expect(wrapText('aa\nbb cc', 10, m)).toEqual(['aa', 'bb cc'])
  })
})

describe('fitParagraphs', () => {
  // width in "chars" scaled by size: a char is size/10 units wide
  const measure = (s: string, size: number) => (s.length * size) / 10
  const lineMm = (size: number) => (size * 1.35 * 25.4) / 72

  test('keeps the base size when everything fits', () => {
    const r = fitParagraphs([{ text: 'aa bb' }], 10, 10, measure, { base: 10, lineHeight: 1.35 })
    expect(r.size).toBe(10)
    expect(r.lines).toEqual([{ text: 'aa bb', bold: false }])
  })

  test('shrinks in 0.5 pt steps until the lines fit the height', () => {
    // 20 chars, width 10 at size 10 -> 2 lines; height for exactly 1 line at 8 pt
    const r = fitParagraphs([{ text: 'aaaa bbbb cccc ddddd' }], 10, lineMm(10) * 1.6, measure, { base: 10, lineHeight: 1.35 })
    expect(r.size % 0.5).toBe(0)
    expect(r.size).toBeLessThan(10)
    expect(r.lines.length * lineMm(r.size)).toBeLessThanOrEqual(lineMm(10) * 1.6 + 1e-9)
  })

  test('never goes below 7 pt and clamps lines to the height', () => {
    const long = 'word '.repeat(200).trim()
    const h = lineMm(7) * 3.5
    const r = fitParagraphs([{ text: long, bold: true }], 10, h, measure, { base: 10, lineHeight: 1.35 })
    expect(r.size).toBe(7)
    expect(r.lines).toHaveLength(3)
    expect(r.lines[0].bold).toBe(true)
  })
})
