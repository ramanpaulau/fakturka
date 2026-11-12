import { describe, expect, it } from 'vitest'
import { isNumberTaken, suggestNumber } from './numbering'

describe('numbering', () => {
  it('suggests YYYYMM then YYYYMMNN', () => {
    expect(suggestNumber('2026-11-30', new Set())).toBe('202611')
    expect(suggestNumber('2026-11-30', new Set(['202611']))).toBe('20261102')
    expect(suggestNumber('2026-11-30', new Set(['202611', '20261102']))).toBe('20261103')
  })
  it('isNumberTaken', () => {
    expect(isNumberTaken('202611', new Set(['202611']))).toBe(true)
    expect(isNumberTaken('202612', new Set(['202611']))).toBe(false)
  })
})
