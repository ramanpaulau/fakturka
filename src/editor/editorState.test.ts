import { beforeEach, describe, expect, it, vi } from 'vitest'
import { savedData } from '../app/state'
import { emptySavedData } from '../storage/dataStore'
import { getBackend, MemoryBackend } from '../storage/backend'
import { invoiceBaseName } from '../storage/invoiceStore'
import { fixtureInvoice } from '../test/fixtures'
import {
  invoice,
  isSaved,
  loadedNumber,
  loadIntoEditor,
  refreshTakenNumbers,
  setAmountFromInput,
  setDueDate,
  setField,
  setIssueDate,
  setSnap,
  takenNumbers,
  toggleDic,
} from './editorState'

const backend = () => getBackend() as MemoryBackend

beforeEach(() => {
  savedData.value = emptySavedData()
  loadIntoEditor(fixtureInvoice, true)
  takenNumbers.value = new Set()
  backend().files.clear()
  vi.useRealTimers()
})

describe('setField', () => {
  it('editing the account fills the bank name from a known code, keeping the payment section linked', () => {
    loadIntoEditor({ ...fixtureInvoice, payment: { ...fixtureInvoice.payment, bank: 'Fio banka', account: '123/2010' } }, true)
    setField('payment.account', '987654321/5500')
    expect(invoice.value.payment.bank).toBe('Raiffeisenbank')
    expect(invoice.value.payment.account).toBe('987654321/5500')
    expect(invoice.value.payment.sourceId).toBe(fixtureInvoice.payment.sourceId)
    setField('payment.bank', 'Moje banka')
    setField('payment.account', '987654321/0100')
    expect(invoice.value.payment.bank).toBe('Moje banka')
  })

  it('updates a nested field and marks the invoice unsaved', () => {
    setField('customer.street', 'Nová 8')
    expect(invoice.value.customer.street).toBe('Nová 8')
    expect(invoice.value.customer.name).toBe(fixtureInvoice.customer.name)
    expect(isSaved.value).toBe(false)
  })

  it('updates top-level and text fields', () => {
    setField('number', '20261102')
    setField('text.text', 'Jiný text')
    expect(invoice.value.number).toBe('20261102')
    expect(invoice.value.text.text).toBe('Jiný text')
  })

  it('keeps isSaved when the value does not change', () => {
    setField('customer.street', fixtureInvoice.customer.street)
    expect(isSaved.value).toBe(true)
  })

  it('rejects paths that are not editable text fields', () => {
    expect(() => setField('customer.sourceId', 'x')).toThrow()
    expect(() => setField('amount', '1')).toThrow()
    expect(() => setField('nope.field', 'x')).toThrow()
    expect(invoice.value).toEqual(fixtureInvoice)
  })
})

describe('setAmountFromInput', () => {
  it('parses Czech amounts', () => {
    setAmountFromInput('42 000')
    expect(invoice.value.amount).toBe(42000)
    setAmountFromInput('50 000,- Kč')
    expect(invoice.value.amount).toBe(50000)
    expect(isSaved.value).toBe(false)
  })

  it('stores null for unparsable or empty input', () => {
    setAmountFromInput('x')
    expect(invoice.value.amount).toBeNull()
    setAmountFromInput('')
    expect(invoice.value.amount).toBeNull()
  })
})

describe('dates', () => {
  it('sets issue and due date', () => {
    setIssueDate('2026-11-20')
    setDueDate('2026-12-31')
    expect(invoice.value.issueDate).toBe('2026-11-20')
    expect(invoice.value.dueDate).toBe('2026-12-31')
    expect(isSaved.value).toBe(false)
  })

})

describe('toggleDic', () => {
  it('flips showDic', () => {
    toggleDic()
    expect(invoice.value.showDic).toBe(false)
    expect(isSaved.value).toBe(false)
    toggleDic()
    expect(invoice.value.showDic).toBe(true)
  })
})

describe('loadIntoEditor', () => {
  it('sets the invoice, the saved flag and the loaded number', () => {
    loadIntoEditor({ ...fixtureInvoice, number: '202610' }, true)
    expect(invoice.value.number).toBe('202610')
    expect(isSaved.value).toBe(true)
    expect(loadedNumber.value).toBe('202610')
  })

  it('an unsaved invoice has no loaded record', () => {
    loadIntoEditor(fixtureInvoice, false)
    expect(isSaved.value).toBe(false)
    expect(loadedNumber.value).toBeNull()
  })
})

describe('refreshTakenNumbers', () => {
  async function putInvoice(number: string) {
    const inv = { ...fixtureInvoice, number }
    await backend().writeInvoice(await backend().defaultInvoiceDir(), invoiceBaseName(inv), new Uint8Array([1]), JSON.stringify(inv))
  }

  it('re-reads the folder', async () => {
    await putInvoice('202609')
    await refreshTakenNumbers()
    expect(takenNumbers.value).toEqual(new Set(['202609']))
  })

  it('a folder that cannot be listed counts as empty', async () => {
    takenNumbers.value = new Set(['x'])
    vi.spyOn(backend(), 'listDir').mockRejectedValueOnce(new Error('nelze'))
    await refreshTakenNumbers()
    expect(takenNumbers.value.size).toBe(0)
  })
})

describe('setSnap', () => {
  it('replaces the whole section snapshot including sourceId and marks the invoice unsaved', () => {
    const snap = { name: 'Firma Beta a.s.', street: 'Hlavní 1', city: '702 00 Ostrava', ico: '55667788', dic: '', note: '', sourceId: 'c2' }
    setSnap('customer', snap)
    expect(invoice.value.customer).toEqual(snap)
    expect(invoice.value.supplier).toEqual(fixtureInvoice.supplier)
    expect(isSaved.value).toBe(false)
  })

  it('works for payment and text', () => {
    setSnap('payment', { method: 'Hotově', bank: '', account: '', sourceId: null })
    setSnap('text', { text: 'Jiný text', sourceId: 't1' })
    expect(invoice.value.payment).toEqual({ method: 'Hotově', bank: '', account: '', sourceId: null })
    expect(invoice.value.text).toEqual({ text: 'Jiný text', sourceId: 't1' })
  })

  it('keeps isSaved when the snapshot is unchanged', () => {
    setSnap('customer', { ...fixtureInvoice.customer })
    expect(isSaved.value).toBe(true)
  })
})
