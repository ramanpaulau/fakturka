import { describe, expect, it } from 'vitest'
import { MemoryBackend } from './memoryBackend'
import { findConflict, invoiceBaseName, invoicePdfPath, listInvoices, loadInvoice, parseInvoice, recordPaths, resolveInvoiceDir, saveInvoice } from './invoiceStore'
import { toSnap } from '../domain/entities'
import { DEFAULT_SETTINGS } from '../domain/types'
import type { Invoice, SavedData } from '../domain/types'

const supplier = { id: 's1', name: 'Jan Novák', street: 'Dlouhá 1', city: '110 00 Praha', ico: '12345679', dic: '', note: '' }
const customer = { id: 'c1', name: 'Příklad s.r.o.', street: 'Krátká 5', city: '602 00 Brno', ico: '12345679', dic: 'CZ12345679', note: '' }
const payment = { id: 'p1', method: 'Bankovní převod', bank: 'Fio banka', account: '123456789/0100' }
const text = { id: 't1', text: 'Fakturujeme Vám dle dohody.' }

function inv(number: string, issueDate: string): Invoice {
  return {
    schemaVersion: 1, number, issueDate, dueDate: '2026-12-15',
    supplier: toSnap(supplier), customer: toSnap(customer), payment: toSnap(payment), text: toSnap(text),
    amount: 1500, showDic: true, savedAt: null,
  }
}
const pdf = new Uint8Array([37, 80, 68, 70])
const DIR = '/faktury'

describe('invoiceBaseName', () => {
  it('uses issue month and number', () => {
    expect(invoiceBaseName(inv('202611', '2026-11-30'))).toBe('2026-11_faktura-202611')
  })
  it('replaces slashes', () => {
    expect(invoiceBaseName(inv('2026/11', '2026-11-30'))).toBe('2026-11_faktura-2026-11')
  })
  it('replaces characters illegal in file names (Review Focus 5)', () => {
    expect(invoiceBaseName(inv('a:b*c?', '2026-11-30'))).toBe('2026-11_faktura-a-b-c-')
    expect(invoiceBaseName(inv('<>"\\|x\u0001\u001f', '2026-11-30'))).toBe('2026-11_faktura------x--')
  })
})

describe('parseInvoice', () => {
  const valid = inv('202611', '2026-11-30')
  it('accepts a valid invoice', () => {
    expect(parseInvoice(JSON.stringify(valid))).toEqual(valid)
  })
  it('rejects garbage without throwing', () => {
    for (const s of ['', 'nope', 'null', '[]', '42', '"x"', '{"foo":1}', JSON.stringify({ ...valid, schemaVersion: 2 })]) {
      expect(parseInvoice(s)).toBeNull()
    }
  })
  it('rejects missing or mistyped required fields', () => {
    for (const k of ['number', 'issueDate', 'dueDate', 'supplier', 'customer', 'payment', 'text', 'showDic']) {
      const o: Record<string, unknown> = { ...valid }
      delete o[k]
      expect(parseInvoice(JSON.stringify(o))).toBeNull()
    }
    expect(parseInvoice(JSON.stringify({ ...valid, number: 5 }))).toBeNull()
    expect(parseInvoice(JSON.stringify({ ...valid, showDic: 'yes' }))).toBeNull()
    expect(parseInvoice(JSON.stringify({ ...valid, supplier: null }))).toBeNull()
  })
})

describe('listInvoices', () => {
  it('pairs JSON and PDF into an invoice with pdfPath', async () => {
    const b = new MemoryBackend()
    await saveInvoice(b, DIR, inv('202611', '2026-11-30'), pdf, [])
    const list = await listInvoices(b, DIR)
    expect(list).toHaveLength(1)
    const r = list[0]
    expect(r.kind).toBe('invoice')
    if (r.kind === 'invoice') {
      expect(r.pdfPath).toBe('/faktury/pdf/2026-11_faktura-202611.pdf')
      expect(r.jsonPath).toBe('/faktury/json/2026-11_faktura-202611.json')
      expect(r.baseName).toBe('2026-11_faktura-202611')
      expect(r.invoice.number).toBe('202611')
    }
  })

  it('lists a JSON without PDF with pdfPath null', async () => {
    const b = new MemoryBackend()
    b.files.set('/faktury/x.json', JSON.stringify(inv('1', '2026-01-05')))
    const list = await listInvoices(b, DIR)
    expect(list).toHaveLength(1)
    expect(list[0].kind === 'invoice' && list[0].pdfPath).toBeNull()
  })

  it('lists a PDF alone as pdfOnly', async () => {
    const b = new MemoryBackend()
    b.files.set('/faktury/old.pdf', pdf)
    expect(await listInvoices(b, DIR)).toEqual([{ kind: 'pdfOnly', pdfPath: '/faktury/old.pdf', fileName: 'old.pdf' }])
  })

  it('treats a JSON that is not an invoice as absent, so its PDF is pdfOnly (Review Focus 3)', async () => {
    const b = new MemoryBackend()
    b.files.set('/faktury/other.json', '{"foo":1}')
    b.files.set('/faktury/other.pdf', pdf)
    expect(await listInvoices(b, DIR)).toEqual([{ kind: 'pdfOnly', pdfPath: '/faktury/other.pdf', fileName: 'other.pdf' }])
  })

  it('ignores an unparseable JSON and unrelated files without throwing', async () => {
    const b = new MemoryBackend()
    b.files.set('/faktury/bad.json', '{nope')
    b.files.set('/faktury/readme.txt', 'hi')
    expect(await listInvoices(b, DIR)).toEqual([])
  })

  it('returns [] for a missing directory', async () => {
    expect(await listInvoices(new MemoryBackend(), '/nowhere')).toEqual([])
  })

  it('does not list files from other directories', async () => {
    const b = new MemoryBackend()
    b.files.set('/faktury/sub/a.pdf', pdf)
    b.files.set('/faktury/pdf/sub/c.pdf', pdf)
    b.files.set('/faktury/PDF/d.pdf', pdf)
    b.files.set('/faktury2/b.pdf', pdf)
    b.files.set('/faktury2/pdf/e.pdf', pdf)
    expect(await listInvoices(b, DIR)).toEqual([])
  })

  it('sorts invoices newest first (ties by number desc), then pdfOnly by name', async () => {
    const b = new MemoryBackend()
    await saveInvoice(b, DIR, inv('202609', '2026-09-30'), pdf, [])
    await saveInvoice(b, DIR, inv('202611', '2026-11-30'), pdf, [])
    await saveInvoice(b, DIR, inv('202611b', '2026-11-30'), pdf, [])
    b.files.set('/faktury/zzz.pdf', pdf)
    b.files.set('/faktury/aaa.pdf', pdf)
    const list = await listInvoices(b, DIR)
    expect(list.map(r => (r.kind === 'invoice' ? r.invoice.number : r.fileName))).toEqual(['202611b', '202611', '202609', 'aaa.pdf', 'zzz.pdf'])
  })
})

describe('listInvoices across json/, pdf/ and the legacy folder root', () => {
  const J = (i: Invoice) => JSON.stringify(i)
  const base = '2026-11_faktura-1'

  it('still lists a legacy root pair (0.1.0/0.2.0 layout) with its root paths', async () => {
    const b = new MemoryBackend()
    b.files.set(`/faktury/${base}.json`, J(inv('1', '2026-11-30')))
    b.files.set(`/faktury/${base}.pdf`, pdf)
    expect(await listInvoices(b, DIR)).toEqual([
      { kind: 'invoice', invoice: inv('1', '2026-11-30'), jsonPath: `/faktury/${base}.json`, pdfPath: `/faktury/${base}.pdf`, baseName: base },
    ])
  })

  it('pairs a json/ JSON with a root PDF and a root JSON with a pdf/ PDF', async () => {
    const b = new MemoryBackend()
    b.files.set(`/faktury/json/${base}.json`, J(inv('1', '2026-11-30')))
    b.files.set(`/faktury/${base}.pdf`, pdf)
    b.files.set('/faktury/2026-10_faktura-2.json', J(inv('2', '2026-10-30')))
    b.files.set('/faktury/pdf/2026-10_faktura-2.pdf', pdf)
    const list = await listInvoices(b, DIR)
    expect(list.map(r => r.kind === 'invoice' && [r.jsonPath, r.pdfPath])).toEqual([
      [`/faktury/json/${base}.json`, `/faktury/${base}.pdf`],
      ['/faktury/2026-10_faktura-2.json', '/faktury/pdf/2026-10_faktura-2.pdf'],
    ])
  })

  it('shows a base name saved in both layouts once, preferring the new files and keeping the legacy ones in the record', async () => {
    const b = new MemoryBackend()
    b.files.set(`/faktury/${base}.json`, J({ ...inv('1', '2026-11-30'), amount: 1 }))
    b.files.set(`/faktury/${base}.pdf`, pdf)
    b.files.set(`/faktury/json/${base}.json`, J({ ...inv('1', '2026-11-30'), amount: 2 }))
    b.files.set(`/faktury/pdf/${base}.pdf`, pdf)
    const list = await listInvoices(b, DIR)
    expect(list).toHaveLength(1)
    const r = list[0]
    if (r.kind !== 'invoice') throw new Error('expected an invoice')
    expect(r.invoice.amount).toBe(2)
    expect(r.jsonPath).toBe(`/faktury/json/${base}.json`)
    expect(r.pdfPath).toBe(`/faktury/pdf/${base}.pdf`)
    expect(recordPaths(r).sort()).toEqual([`/faktury/${base}.json`, `/faktury/${base}.pdf`, `/faktury/json/${base}.json`, `/faktury/pdf/${base}.pdf`])
  })

  it('falls back to the legacy JSON when the new one is not a readable invoice', async () => {
    const b = new MemoryBackend()
    b.files.set(`/faktury/${base}.json`, J(inv('1', '2026-11-30')))
    b.files.set(`/faktury/json/${base}.json`, '{broken')
    b.files.set(`/faktury/pdf/${base}.pdf`, pdf)
    const list = await listInvoices(b, DIR)
    expect(list).toHaveLength(1)
    expect(list[0].kind === 'invoice' && [list[0].jsonPath, list[0].pdfPath]).toEqual([`/faktury/${base}.json`, `/faktury/pdf/${base}.pdf`])
  })

  it('lists a lone PDF in pdf/ and the root once, as one pdfOnly record holding both files', async () => {
    const b = new MemoryBackend()
    b.files.set('/faktury/pdf/sken.pdf', pdf)
    b.files.set('/faktury/sken.pdf', pdf)
    b.files.set('/faktury/pdf/other.pdf', pdf)
    const list = await listInvoices(b, DIR)
    expect(list.map(r => r.kind === 'pdfOnly' && r.pdfPath)).toEqual(['/faktury/pdf/other.pdf', '/faktury/pdf/sken.pdf'])
    expect(recordPaths(list[1]).sort()).toEqual(['/faktury/pdf/sken.pdf', '/faktury/sken.pdf'])
  })

  it('ignores PDFs in json/ and JSONs in pdf/', async () => {
    const b = new MemoryBackend()
    b.files.set('/faktury/json/x.pdf', pdf)
    b.files.set('/faktury/pdf/y.json', J(inv('1', '2026-11-30')))
    expect(await listInvoices(b, DIR)).toEqual([])
  })
})

describe('saveInvoice', () => {
  it('writes both files and loadInvoice reads it back', async () => {
    const b = new MemoryBackend()
    const i = inv('202611', '2026-11-30')
    const res = await saveInvoice(b, DIR, i, pdf, [])
    expect(res).toEqual({ replaced: false })
    expect(b.files.get('/faktury/pdf/2026-11_faktura-202611.pdf')).toEqual(pdf)
    expect(await loadInvoice(b, '/faktury/json/2026-11_faktura-202611.json')).toEqual(i)
    expect(invoicePdfPath(b, DIR, i)).toBe('/faktury/pdf/2026-11_faktura-202611.pdf')
  })

  it('loadInvoice throws on a non-invoice file', async () => {
    const b = new MemoryBackend()
    b.files.set('/faktury/x.json', '{"foo":1}')
    await expect(loadInvoice(b, '/faktury/x.json')).rejects.toThrow()
  })

  it('deletes the old pair when the same number moves to another month', async () => {
    const b = new MemoryBackend()
    await saveInvoice(b, DIR, inv('202611', '2026-11-30'), pdf, [])
    const existing = await listInvoices(b, DIR)
    const res = await saveInvoice(b, DIR, inv('202611', '2026-12-01'), pdf, existing)
    expect(res).toEqual({ replaced: true })
    expect([...b.files.keys()].sort()).toEqual(['/faktury/json/2026-12_faktura-202611.json', '/faktury/pdf/2026-12_faktura-202611.pdf'])
  })

  it('reports replaced and keeps the files when overwriting the same base name', async () => {
    const b = new MemoryBackend()
    await saveInvoice(b, DIR, inv('202611', '2026-11-30'), pdf, [])
    const existing = await listInvoices(b, DIR)
    const res = await saveInvoice(b, DIR, inv('202611', '2026-11-15'), pdf, existing)
    expect(res).toEqual({ replaced: true })
    expect(b.files.size).toBe(2)
  })

  it('does not touch other invoices', async () => {
    const b = new MemoryBackend()
    await saveInvoice(b, DIR, inv('202610', '2026-10-31'), pdf, [])
    const existing = await listInvoices(b, DIR)
    const res = await saveInvoice(b, DIR, inv('202611', '2026-11-30'), pdf, existing)
    expect(res).toEqual({ replaced: false })
    expect(b.files.size).toBe(4)
  })

  it('rejects when the write fails and leaves no partial record (Review Focus 2)', async () => {
    const b = new MemoryBackend()
    b.failWritesUnder = '/faktury'
    await expect(saveInvoice(b, DIR, inv('202611', '2026-11-30'), pdf, [])).rejects.toThrow()
    expect(await listInvoices(b, DIR)).toEqual([])
  })

  it('does not delete the old pair when the new write fails', async () => {
    const b = new MemoryBackend()
    await saveInvoice(b, DIR, inv('202611', '2026-11-30'), pdf, [])
    const existing = await listInvoices(b, DIR)
    b.failWritesUnder = '/faktury'
    await expect(saveInvoice(b, DIR, inv('202611', '2026-12-01'), pdf, existing)).rejects.toThrow()
    expect(b.files.size).toBe(2)
  })
})

describe('saving a legacy (0.2.0) invoice again', () => {
  const legacy = (b: MemoryBackend, i: Invoice) => {
    b.files.set(`/faktury/${invoiceBaseName(i)}.json`, JSON.stringify(i))
    b.files.set(`/faktury/${invoiceBaseName(i)}.pdf`, pdf)
  }

  it('moves it to the new layout: the pair is written to pdf/ and json/ and the legacy root files are deleted', async () => {
    const b = new MemoryBackend()
    legacy(b, inv('202611', '2026-11-30'))
    legacy(b, inv('202610', '2026-10-31'))
    const existing = await listInvoices(b, DIR)
    const res = await saveInvoice(b, DIR, { ...inv('202611', '2026-11-30'), amount: 999 }, pdf, existing)
    expect(res).toEqual({ replaced: true })
    expect([...b.files.keys()].sort()).toEqual([
      '/faktury/2026-10_faktura-202610.json',
      '/faktury/2026-10_faktura-202610.pdf',
      '/faktury/json/2026-11_faktura-202611.json',
      '/faktury/pdf/2026-11_faktura-202611.pdf',
    ])
    const list = await listInvoices(b, DIR)
    expect(list.map(r => r.kind === 'invoice' && [r.invoice.number, r.invoice.amount, r.jsonPath])).toEqual([
      ['202611', 999, '/faktury/json/2026-11_faktura-202611.json'],
      ['202610', 1500, '/faktury/2026-10_faktura-202610.json'],
    ])
  })

  it('also deletes legacy files shadowed by a newer copy of the same base name', async () => {
    const b = new MemoryBackend()
    legacy(b, inv('202611', '2026-11-30'))
    await saveInvoice(b, DIR, inv('202611', '2026-11-30'), pdf, []) // both layouts now hold 2026-11_faktura-202611
    const existing = await listInvoices(b, DIR)
    expect(existing).toHaveLength(1)
    await saveInvoice(b, DIR, inv('202611', '2026-12-01'), pdf, existing)
    expect([...b.files.keys()].sort()).toEqual(['/faktury/json/2026-12_faktura-202611.json', '/faktury/pdf/2026-12_faktura-202611.pdf'])
  })

  it('keeps the legacy files when the new write fails', async () => {
    const b = new MemoryBackend()
    legacy(b, inv('202611', '2026-11-30'))
    const existing = await listInvoices(b, DIR)
    b.failWritesUnder = '/faktury'
    await expect(saveInvoice(b, DIR, inv('202611', '2026-11-30'), pdf, existing)).rejects.toThrow()
    expect([...b.files.keys()].sort()).toEqual(['/faktury/2026-11_faktura-202611.json', '/faktury/2026-11_faktura-202611.pdf'])
  })
})

describe('collisions between different numbers', () => {
  it('finds and replaces a record whose number sanitises to the same base name', async () => {
    const b = new MemoryBackend()
    await saveInvoice(b, DIR, inv('2026-11', '2026-11-05'), pdf, [])
    const existing = await listInvoices(b, DIR)
    const incoming = inv('2026/11', '2026-11-20')
    const hit = findConflict(incoming, existing)
    expect(hit).toBe(existing[0])
    const res = await saveInvoice(b, DIR, incoming, pdf, existing)
    expect(res).toEqual({ replaced: true })
    expect([...b.files.keys()].sort()).toEqual(['/faktury/json/2026-11_faktura-2026-11.json', '/faktury/pdf/2026-11_faktura-2026-11.pdf'])
    const list = await listInvoices(b, DIR)
    expect(list).toHaveLength(1)
    expect(list[0].kind === 'invoice' && list[0].invoice.number).toBe('2026/11')
  })

  it('finds a case-only difference and does not delete the pair just written', async () => {
    const b = new MemoryBackend()
    await saveInvoice(b, DIR, inv('a1', '2026-11-05'), pdf, [])
    const existing = await listInvoices(b, DIR)
    const incoming = inv('A1', '2026-11-05')
    expect(findConflict(incoming, existing)).not.toBeNull()
    const res = await saveInvoice(b, DIR, incoming, pdf, existing)
    expect(res.replaced).toBe(true)
    // the new pair must exist (MemoryBackend is case-sensitive, so the old lower-case pair may linger or be gone)
    expect(b.files.has('/faktury/json/2026-11_faktura-A1.json')).toBe(true)
    expect(b.files.has('/faktury/pdf/2026-11_faktura-A1.pdf')).toBe(true)
  })

  it('finds a lone PDF with the same base name', () => {
    const rec = { kind: 'pdfOnly' as const, pdfPath: '/faktury/2026-11_faktura-202611.pdf', fileName: '2026-11_faktura-202611.pdf' }
    expect(findConflict(inv('202611', '2026-11-30'), [rec])).toBe(rec)
  })

  it('returns null when nothing conflicts', () => {
    expect(findConflict(inv('202611', '2026-11-30'), [])).toBeNull()
  })
})

describe('resolveInvoiceDir', () => {
  const base: SavedData = { schemaVersion: 1, suppliers: [], customers: [], payments: [], texts: [], settings: { ...DEFAULT_SETTINGS } }
  it('uses the configured directory', async () => {
    const d = { ...base, settings: { ...base.settings, invoiceDir: '/custom' } }
    expect(await resolveInvoiceDir(new MemoryBackend(), d)).toBe('/custom')
  })
  it('falls back to the default directory', async () => {
    const b = new MemoryBackend()
    expect(await resolveInvoiceDir(b, base)).toBe(await b.defaultInvoiceDir())
  })
})
