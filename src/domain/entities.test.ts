import { describe, expect, it } from 'vitest'
import { changedFields, entityLabel, entitySubtitle, findDuplicate, matchesQuery, sectionState, toSnap } from './entities'
import type { InvoiceText, Party, Payment } from './types'

const party: Party = { id: 'c1', name: 'Příklad s.r.o.', street: 'Krátká 5', city: '602 00 Brno', ico: '12345679', dic: 'CZ12345679', note: '' }
const payment: Payment = { id: 'p1', method: 'Bankovní převod', bank: 'Fio banka', account: '123456789/0100' }
const text: InvoiceText = { id: 't1', text: 'Fakturujeme Vám dle dohody.' }

describe('toSnap', () => {
  it('drops id and records it as sourceId', () => {
    expect(toSnap(party)).toEqual({ name: 'Příklad s.r.o.', street: 'Krátká 5', city: '602 00 Brno', ico: '12345679', dic: 'CZ12345679', note: '', sourceId: 'c1' })
  })
})

describe('sectionState', () => {
  it("is 'matches' when fields are equal after trimming", () => {
    const snap = { ...toSnap(party), name: '  Příklad s.r.o. ' }
    expect(sectionState(snap, [party])).toBe('matches')
  })
  it("is 'edited' when fields differ and changedFields lists them", () => {
    const snap = { ...toSnap(party), street: 'Dlouhá 7' }
    expect(sectionState(snap, [party])).toBe('edited')
    expect(changedFields(snap, [party])).toEqual(['street'])
  })
  it("is 'new' when sourceId is null or deleted", () => {
    expect(sectionState({ ...toSnap(party), sourceId: null }, [party])).toBe('new')
    expect(sectionState(toSnap(party), [])).toBe('new')
    expect(changedFields(toSnap(party), [])).toEqual([])
  })
})

describe('findDuplicate', () => {
  it('matches parties on ico ignoring whitespace', () => {
    expect(findDuplicate('customer', { ...toSnap(party), ico: '123 456 79' }, [party])).toBe(party)
  })
  it('never matches an empty ico', () => {
    const a = { ...party, ico: '' }
    expect(findDuplicate('customer', { ...a, id: 'x' }, [a])).toBeNull()
    expect(findDuplicate('supplier', { ...a, ico: '  ' }, [a])).toBeNull()
  })
  it('ignores note for parties', () => {
    expect(findDuplicate('supplier', { ...party, note: 'jiná poznámka' }, [party])).toBe(party)
  })
  it('matches payments on method + bank + account', () => {
    expect(findDuplicate('payment', { method: 'Bankovní převod', bank: 'Fio banka', account: '123456789/0100' }, [payment])).toBe(payment)
    expect(findDuplicate('payment', { method: 'Hotově', bank: 'Fio banka', account: '123456789/0100' }, [payment])).toBeNull()
  })
  it('matches texts on trimmed text', () => {
    expect(findDuplicate('text', { text: '  Fakturujeme Vám dle dohody.  ' }, [text])).toBe(text)
    expect(findDuplicate('text', { text: 'Jiný text' }, [text])).toBeNull()
  })
})

describe('entityLabel and entitySubtitle', () => {
  it('labels a customer with ico', () => {
    expect(entityLabel('customer', party)).toBe('Příklad s.r.o. · IČO 12345679')
  })
  it('labels a party without ico by name only', () => {
    expect(entityLabel('supplier', { ...party, ico: '' })).toBe('Příklad s.r.o.')
  })
  it('labels a payment', () => {
    expect(entityLabel('payment', payment)).toBe('123456789/0100 · Fio banka')
  })
  it('truncates long text at 60 characters', () => {
    const long = 'a'.repeat(70)
    expect(entityLabel('text', { text: long })).toBe('a'.repeat(60) + '…')
    expect(entityLabel('text', text)).toBe('Fakturujeme Vám dle dohody.')
  })
  it('gives a customer subtitle', () => {
    expect(entitySubtitle('customer', party)).toBe('IČO 12345679 · Krátká 5, 602 00 Brno')
  })
  it('gives a payment subtitle of account and bank', () => {
    expect(entitySubtitle('payment', { ...payment, account: ' 123456789/0100 ', bank: ' Fio banka ' })).toBe('123456789/0100 · Fio banka')
  })
  it('gives no text subtitle for text up to 60 characters', () => {
    expect(entitySubtitle('text', { text: 'a'.repeat(60) })).toBe('')
    expect(entitySubtitle('text', text)).toBe('')
  })
  it('gives the full trimmed text as subtitle when longer than 60 characters', () => {
    expect(entitySubtitle('text', { text: 'a'.repeat(61) })).toBe('a'.repeat(61))
    const long = 'Fakturujeme Vám dle dohody ' + 'x'.repeat(60)
    expect(entitySubtitle('text', { text: `  ${long}  ` })).toBe(long)
  })
})

describe('matchesQuery', () => {
  it('is case and diacritics insensitive', () => {
    expect(matchesQuery('customer', party, 'brno')).toBe(true)
    expect(matchesQuery('customer', party, 'prik')).toBe(true)
    expect(matchesQuery('customer', party, 'PŘÍKLAD')).toBe(true)
    expect(matchesQuery('customer', party, 'ostrava')).toBe(false)
  })
  it('matches everything for an empty query', () => {
    expect(matchesQuery('payment', payment, '  ')).toBe(true)
  })
  it('searches payments and texts', () => {
    expect(matchesQuery('payment', payment, 'fio')).toBe(true)
    expect(matchesQuery('text', text, 'dohody')).toBe(true)
  })
})
