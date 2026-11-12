import { describe, expect, it } from 'vitest'
import { newInvoiceFrom } from './newInvoice'
import { toSnap } from './entities'
import { DEFAULT_SETTINGS } from './types'
import type { Invoice, Party, SavedData } from './types'

const supplier: Party = { id: 's1', name: 'Dodavatel Test', street: 'Dlouhá 1', city: '110 00 Praha', ico: '87654321', dic: '', note: '' }
const customer: Party = { id: 'c1', name: 'Příklad s.r.o.', street: 'Krátká 5', city: '602 00 Brno', ico: '12345679', dic: 'CZ12345679', note: '' }
const payment = { id: 'p1', method: 'Bankovní převod', bank: 'Fio banka', account: '123456789/0100' }
const text = { id: 't1', text: 'Fakturujeme Vám dle dohody.' }

const data: SavedData = { schemaVersion: 1, suppliers: [supplier], customers: [customer], payments: [payment], texts: [text], settings: DEFAULT_SETTINGS }
const today = new Date(2026, 10, 9)

describe('newInvoiceFrom with a previous invoice', () => {
  const last: Invoice = {
    schemaVersion: 1, number: '202610', issueDate: '2026-10-31', dueDate: '2026-11-15',
    supplier: toSnap(supplier), customer: toSnap(customer), payment: toSnap(payment), text: toSnap(text),
    amount: 1500, showDic: false, savedAt: '2026-10-31T10:00:00.000Z',
  }
  it('copies content and resets number, dates and savedAt', () => {
    const inv = newInvoiceFrom(last, data, today, new Set(['202610']))
    expect(inv.supplier).toEqual(last.supplier)
    expect(inv.customer).toEqual(last.customer)
    expect(inv.payment).toEqual(last.payment)
    expect(inv.text).toEqual(last.text)
    expect(inv.amount).toBe(1500)
    expect(inv.showDic).toBe(false)
    expect(inv.number).toBe('202611')
    expect(inv.issueDate).toBe('2026-11-30')
    expect(inv.dueDate).toBe('2026-12-15')
    expect(inv.savedAt).toBeNull()
    expect(inv.schemaVersion).toBe(1)
  })
  it('does not share references with the previous invoice', () => {
    const inv = newInvoiceFrom(last, data, today, new Set())
    expect(inv.supplier).not.toBe(last.supplier)
  })
  it('skips taken numbers', () => {
    expect(newInvoiceFrom(last, data, today, new Set(['202611'])).number).toBe('20261102')
  })
})

describe('newInvoiceFrom without a previous invoice', () => {
  it('uses the first saved entries', () => {
    const inv = newInvoiceFrom(null, data, today, new Set())
    expect(inv.supplier).toEqual(toSnap(supplier))
    expect(inv.customer).toEqual(toSnap(customer))
    expect(inv.payment).toEqual(toSnap(payment))
    expect(inv.text).toEqual(toSnap(text))
    expect(inv.amount).toBeNull()
    expect(inv.showDic).toBe(DEFAULT_SETTINGS.showDicDefault)
    expect(inv.savedAt).toBeNull()
  })
  it('falls back to empty snapshots', () => {
    const empty: SavedData = { ...data, suppliers: [], customers: [], payments: [], texts: [], settings: { ...DEFAULT_SETTINGS, showDicDefault: false } }
    const inv = newInvoiceFrom(null, empty, today, new Set())
    expect(inv.customer).toEqual({ name: '', street: '', city: '', ico: '', dic: '', note: '', sourceId: null })
    expect(inv.supplier).toEqual(inv.customer)
    expect(inv.payment).toEqual({ method: '', bank: '', account: '', sourceId: null })
    expect(inv.text).toEqual({ text: '', sourceId: null })
    expect(inv.showDic).toBe(false)
  })
})
