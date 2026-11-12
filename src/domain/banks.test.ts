import { describe, expect, it } from 'vitest'
import { BANKS, bankCodeForName, bankCodeOf, bankNameFor, linkBank } from './banks'

describe('bank list', () => {
  it('has unique codes and names, all 4 digits', () => {
    expect(new Set(BANKS.map(b => b.code)).size).toBe(BANKS.length)
    expect(new Set(BANKS.map(b => b.name)).size).toBe(BANKS.length)
    for (const b of BANKS) expect(b.code).toMatch(/^\d{4}$/)
  })

  it('knows the common banks', () => {
    expect(bankNameFor('5500')).toBe('Raiffeisenbank')
    expect(bankNameFor('0800')).toBe('Česká spořitelna')
    expect(bankNameFor('0100')).toBe('Komerční banka')
    expect(bankNameFor('0300')).toBe('ČSOB')
    expect(bankNameFor('2010')).toBe('Fio banka')
    expect(bankNameFor('3030')).toBe('Air Bank')
    expect(bankNameFor('9999')).toBeNull()
    expect(bankCodeForName(' fio BANKA ')).toBe('2010')
    expect(bankCodeForName('Moje banka')).toBeNull()
  })
})

describe('bankCodeOf', () => {
  it('reads the 4 digits after "/"', () => {
    expect(bankCodeOf('123456789/5500')).toBe('5500')
    expect(bankCodeOf('19-123456789 / 0800 ')).toBe('0800')
  })
  it('null without a complete code', () => {
    expect(bankCodeOf('123456789')).toBeNull()
    expect(bankCodeOf('123456789/55')).toBeNull()
    expect(bankCodeOf('123456789/55001')).toBeNull()
  })
})

describe('linkBank', () => {
  const p = (bank: string, account: string) => ({ bank, account })
  it('fills an empty bank from the account code', () => {
    expect(linkBank(p('', '123/550'), p('', '123/5500'))).toEqual(p('Raiffeisenbank', '123/5500'))
  })
  it('replaces a bank name from the list when the code changes', () => {
    expect(linkBank(p('Fio banka', '123/2010'), p('Fio banka', '123/0100'))).toEqual(p('Komerční banka', '123/0100'))
  })
  it("keeps the user's own bank name", () => {
    expect(linkBank(p('Moje banka', '123'), p('Moje banka', '123/0100'))).toEqual(p('Moje banka', '123/0100'))
  })
  it('leaves the bank for an unknown code', () => {
    expect(linkBank(p('', '123'), p('', '123/9999'))).toEqual(p('', '123/9999'))
  })
  it('editing the bank never changes the account', () => {
    expect(linkBank(p('', '123456789'), p('Fio banka', '123456789'))).toEqual(p('Fio banka', '123456789'))
  })
  it('keeps other fields', () => {
    const prev = { method: 'Převodem', bank: '', account: '1' }
    expect(linkBank(prev, { ...prev, account: '1/3030' })).toEqual({ method: 'Převodem', bank: 'Air Bank', account: '1/3030' })
  })
})
