import { describe, expect, it } from 'vitest'
import { isValidIco } from './ico'

describe('isValidIco', () => {
  it('accepts valid IČO', () => {
    expect(isValidIco('12345679')).toBe(true)
    expect(isValidIco('00000019')).toBe(true)
  })
  it('rejects bad checksum, length and characters', () => {
    expect(isValidIco('12345678')).toBe(false)
    expect(isValidIco('1234567')).toBe(false)
    expect(isValidIco('1234567a')).toBe(false)
  })
  it('ignores whitespace', () => {
    expect(isValidIco(' 1234 5679 ')).toBe(true)
  })
})
