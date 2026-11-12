import { describe, expect, it } from 'vitest'
import { formatCzk, parseCzk } from './money'

describe('formatCzk', () => {
  it('formats whole crowns with thousands separator', () => {
    expect(formatCzk(42000)).toBe('42\u00a0000,-\u00a0Kč')
    expect(formatCzk(8500)).toBe('8\u00a0500,-\u00a0Kč')
    expect(formatCzk(0)).toBe('0,-\u00a0Kč')
  })
})

describe('parseCzk', () => {
  it('parses common input forms', () => {
    expect(parseCzk('42 000')).toBe(42000)
    expect(parseCzk('42000 Kč')).toBe(42000)
    expect(parseCzk('42\u00a0000,-')).toBe(42000)
    expect(parseCzk('42000\u00a0Kč')).toBe(42000)
  })
  it('returns null for empty or non-numeric input', () => {
    expect(parseCzk('')).toBeNull()
    expect(parseCzk('abc')).toBeNull()
  })
})
