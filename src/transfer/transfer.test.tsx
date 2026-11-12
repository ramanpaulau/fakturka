import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { App } from '../app/App'
import { currentTab, savedData } from '../app/state'
import type { Invoice, InvoiceRecord, InvoiceText, Party, Payment, SavedData } from '../domain/types'
import { editorReady, isSaved, loadedNumber, takenNumbers } from '../editor/editorState'
import { getBackend, MemoryBackend } from '../storage/backend'
import type { ZipContents } from '../storage/backend'
import { emptySavedData } from '../storage/dataStore'
import { listInvoices } from '../storage/invoiceStore'
import { fixtureInvoice } from '../test/fixtures'
import { DialogHost } from '../ui/Dialog'
import { dismissAllToasts, ToastHost } from '../ui/Toast'
import { applySavedMerge, buildExtraction, exportAll, exportFileName, importFromZip, planImport } from './transfer'

const backend = () => getBackend() as MemoryBackend
const DIR = '/Dokumenty/Faktury'

const supplier: Party = { id: 's1', name: 'Jan Novák', street: 'Dlouhá 12', city: '110 00 Praha', ico: '12345679', dic: 'CZ12345679', note: '' }
const customer: Party = { id: 'c1', name: 'Příklad s.r.o.', street: 'Krátká 5', city: '602 00 Brno', ico: '87654321', dic: '', note: '' }
const payment: Payment = { id: 'p1', method: 'Převodem', bank: 'Fiktivní banka', account: '123456789/0100' }
const text: InvoiceText = { id: 't1', text: 'Vývoj softwaru' }
const full = (): SavedData => ({ ...emptySavedData(), suppliers: [supplier], customers: [customer], payments: [payment], texts: [text] })

const inv = (number: string, issueDate = '2026-11-30'): Invoice => ({ ...fixtureInvoice, number, issueDate, dueDate: '2026-12-15' })
const base = (i: Invoice) => `${i.issueDate.slice(0, 7)}_faktura-${i.number}`
const json = (i: Invoice) => JSON.stringify(i)

function putInvoice(i: Invoice, pdf = true): void {
  backend().files.set(`${DIR}/${base(i)}.json`, json(i))
  if (pdf) backend().files.set(`${DIR}/${base(i)}.pdf`, new Uint8Array([1, 2, 3]))
}

function zipOf(invoices: Invoice[], data: SavedData | null, extra: [string, string | Uint8Array][] = []): Map<string, string | Uint8Array> {
  const m = new Map<string, string | Uint8Array>()
  for (const i of invoices) {
    m.set(`faktury/${base(i)}.json`, json(i))
    m.set(`faktury/${base(i)}.pdf`, new Uint8Array([9, 9]))
  }
  if (data) m.set('faktura-data.json', JSON.stringify(data))
  for (const [k, v] of extra) m.set(k, v)
  return m
}

/** Where an import (or a 0.2.1 save) puts an invoice's files. */
const newJson = (i: Invoice) => `${DIR}/json/${base(i)}.json`
const newPdf = (i: Invoice) => `${DIR}/pdf/${base(i)}.pdf`
const record2 = (i: Invoice): InvoiceRecord => ({ kind: 'invoice', invoice: i, jsonPath: newJson(i), pdfPath: newPdf(i), baseName: base(i) })

const contents = (over: Partial<ZipContents> = {}): ZipContents => ({ invoiceJsons: [], pdfNames: [], dataJson: null, ...over })
const record = (i: Invoice, pdf = true): InvoiceRecord => ({
  kind: 'invoice', invoice: i, jsonPath: `${DIR}/${base(i)}.json`, pdfPath: pdf ? `${DIR}/${base(i)}.pdf` : null, baseName: base(i),
})

beforeEach(() => {
  const b = backend()
  b.files.clear()
  b.zips.clear()
  b.dataFile = null
  b.bakFile = null
  b.pickedSavePath = null
  b.pickedZip = null
  savedData.value = null
  currentTab.value = 'faktura'
  editorReady.value = false
  takenNumbers.value = new Set()
  loadedNumber.value = null
  isSaved.value = true
  dismissAllToasts()
  vi.restoreAllMocks()
})
afterEach(cleanup)

describe('planImport', () => {
  it('dedups a customer by IČO and flags an invoice conflict by number', () => {
    const current = { ...emptySavedData(), customers: [customer] }
    const incomingData: SavedData = { ...full(), customers: [{ ...customer, id: 'other-id' }] }
    const i = inv('202611')
    const plan = planImport(
      contents({ invoiceJsons: [[`${base(i)}.json`, json(i)]], pdfNames: [`${base(i)}.pdf`], dataJson: JSON.stringify(incomingData) }),
      current,
      [record(i)],
    )
    expect(plan.skippedDuplicates).toBe(1)
    expect(plan.newEntries.customers).toEqual([])
    expect(plan.newEntries.suppliers).toEqual([supplier])
    expect(plan.invoices).toEqual([{ name: base(i), number: '202611', conflict: true }])
    expect(plan.pdfOnly).toEqual([])
  })

  it('flags a conflict by number even under a different file name, and a new number as no conflict', () => {
    const old = inv('202611', '2026-10-31')
    const incoming = inv('202611')
    const fresh = inv('202612', '2026-12-31')
    const plan = planImport(
      contents({ invoiceJsons: [[`${base(incoming)}.json`, json(incoming)], [`${base(fresh)}.json`, json(fresh)]] }),
      emptySavedData(),
      [record(old)],
    )
    expect(plan.invoices.map(x => [x.number, x.conflict])).toEqual([['202611', true], ['202612', false]])
  })

  it('ignores foreign JSONs and keeps their sibling PDF as PDF-only', () => {
    const plan = planImport(
      contents({ invoiceJsons: [['foreign.json', '{"hello":1}'], ['broken.json', '{nope']], pdfNames: ['foreign.pdf', 'lone.pdf'] }),
      emptySavedData(),
      [],
    )
    expect(plan.invoices).toEqual([])
    expect(plan.pdfOnly).toEqual(['foreign.pdf', 'lone.pdf'])
  })

  it('skips PDF-only files whose name already exists in the folder', () => {
    const plan = planImport(contents({ pdfNames: ['x.pdf', 'new.pdf'] }), emptySavedData(), [{ kind: 'pdfOnly', pdfPath: `${DIR}/X.pdf`, fileName: 'X.pdf' }])
    expect(plan.pdfOnly).toEqual(['new.pdf'])
  })

  it('treats the same entry from an earlier export as a duplicate even without an IČO, and renames an id clash', () => {
    const noIco: Party = { ...customer, id: 'c9', ico: '' }
    const clash: Party = { ...customer, id: 'c9', name: 'Jiný odběratel', ico: '' }
    const current = { ...emptySavedData(), customers: [noIco] }
    const same = planImport(contents({ dataJson: JSON.stringify({ ...emptySavedData(), customers: [noIco] }) }), current, [])
    expect(same.skippedDuplicates).toBe(1)
    const other = planImport(contents({ dataJson: JSON.stringify({ ...emptySavedData(), customers: [clash] }) }), current, [])
    expect(other.skippedDuplicates).toBe(0)
    expect(other.newEntries.customers).toHaveLength(1)
    expect(other.newEntries.customers[0].id).not.toBe('c9')
    expect(other.newEntries.customers[0].name).toBe('Jiný odběratel')
  })

  it('dedups payments and texts and entries repeated inside the zip', () => {
    const data = { ...full(), texts: [text, { id: 't2', text: ' Vývoj softwaru ' }], payments: [payment, { ...payment, id: 'p2' }] }
    const plan = planImport(contents({ dataJson: JSON.stringify(data) }), { ...emptySavedData(), payments: [payment] }, [])
    expect(plan.newEntries.payments).toEqual([])
    expect(plan.newEntries.texts).toEqual([text])
    expect(plan.skippedDuplicates).toBe(3)
  })

  it('an invalid data file yields no entries', () => {
    const plan = planImport(contents({ dataJson: '{"schemaVersion":2}' }), emptySavedData(), [])
    expect(plan.newEntries).toEqual({ suppliers: [], customers: [], payments: [], texts: [] })
  })
})

describe('applySavedMerge', () => {
  it('appends new entries and keeps the existing settings', () => {
    const current: SavedData = { ...emptySavedData(), settings: { ...emptySavedData().settings, dueRule: { kind: 'daysAfterIssue' as const, days: 7 }, theme: 'dark', invoiceDir: '/x' } }
    const incoming: SavedData = { ...full(), settings: { ...emptySavedData().settings, dueRule: { kind: 'daysAfterIssue' as const, days: 99 }, theme: 'light', invoiceDir: '/other' } }
    const plan = planImport(contents({ dataJson: JSON.stringify(incoming) }), current, [])
    const merged = applySavedMerge(current, plan)
    expect(merged.settings).toEqual(current.settings)
    expect(merged.suppliers).toEqual([supplier])
    expect(merged.customers).toEqual([customer])
    expect(merged.payments).toEqual([payment])
    expect(merged.texts).toEqual([text])
  })
})

describe('buildExtraction', () => {
  const zipInv = inv('202611')
  const zip = contents({ invoiceJsons: [[`${base(zipInv)}.json`, json(zipInv)]], pdfNames: [`${base(zipInv)}.pdf`, 'lone.pdf'] })

  it('keeps conflicts unless they are replaced, and always extracts non-conflicting files', () => {
    const plan = planImport(zip, emptySavedData(), [record(zipInv)])
    expect(buildExtraction(plan, zip, [record(zipInv)], new Map(), DIR).names).toEqual(['lone.pdf'])
    expect(buildExtraction(plan, zip, [record(zipInv)], new Map([[base(zipInv), 'keep']]), DIR).names).toEqual(['lone.pdf'])
    const replace = buildExtraction(plan, zip, [record2(zipInv)], new Map([[base(zipInv), 'replace']]), DIR)
    expect(replace.names).toEqual([`${base(zipInv)}.json`, `${base(zipInv)}.pdf`, 'lone.pdf'])
    expect(replace.leftovers).toEqual([])
  })

  it('replacing a legacy (0.2.0) record of the same name trashes its files in the folder itself, since the import writes json/ and pdf/', () => {
    const plan = planImport(zip, emptySavedData(), [record(zipInv)])
    const r = buildExtraction(plan, zip, [record(zipInv)], new Map([[base(zipInv), 'replace']]), DIR)
    expect(r.overwrite).toEqual([`${base(zipInv)}.json`, `${base(zipInv)}.pdf`])
    expect(r.leftovers).toEqual([`${DIR}/${base(zipInv)}.json`, `${DIR}/${base(zipInv)}.pdf`])
  })

  it('a replace leaves the old pair behind under another name as a leftover to trash', () => {
    const old = inv('202611', '2026-10-31')
    const plan = planImport(zip, emptySavedData(), [record(old)])
    const r = buildExtraction(plan, zip, [record(old)], new Map([[base(zipInv), 'replace']]), DIR)
    expect(r.leftovers).toEqual([`${DIR}/${base(old)}.json`, `${DIR}/${base(old)}.pdf`])
  })

  it('a replace by a JSON-only invoice also removes the old PDF with the same base name', () => {
    const jsonOnly = contents({ invoiceJsons: [[`${base(zipInv)}.json`, json(zipInv)]] })
    const plan = planImport(jsonOnly, emptySavedData(), [record2(zipInv)])
    const r = buildExtraction(plan, jsonOnly, [record2(zipInv)], new Map([[base(zipInv), 'replace']]), DIR)
    expect(r.names).toEqual([`${base(zipInv)}.json`])
    expect(r.leftovers).toEqual([newPdf(zipInv)])
  })
})

describe('exportFileName', () => {
  it('uses the local date', () => {
    expect(exportFileName(new Date(2026, 10, 9, 23, 59))).toBe('faktury-export-2026-11-09.zip')
  })
})

describe('exportAll', () => {
  it('writes every invoice pair, lone PDFs and the data file; ignores foreign JSONs', async () => {
    savedData.value = full()
    putInvoice(inv('202611'))
    putInvoice(inv('202610', '2026-10-31'), false)
    backend().files.set(`${DIR}/lone.pdf`, new Uint8Array([7]))
    backend().files.set(`${DIR}/notes.json`, '{"x":1}')
    backend().pickedSavePath = '/out.zip'
    expect(await exportAll()).toBe(true)
    const z = backend().zips.get('/out.zip')!
    expect([...z.keys()].sort()).toEqual([
      'faktura-data.json',
      'faktury/2026-10_faktura-202610.json',
      'faktury/2026-11_faktura-202611.json',
      'faktury/2026-11_faktura-202611.pdf',
      'faktury/lone.pdf',
    ])
    expect(JSON.parse(z.get('faktura-data.json') as string).suppliers).toEqual([supplier])
  })

  it('exports invoices from json/, pdf/ and the folder itself with flat names, each file name once', async () => {
    savedData.value = full()
    const a = inv('202611')
    const b2 = inv('202612', '2026-12-31')
    putInvoice({ ...a, amount: 1 }) // legacy copy, shadowed by the newer one below
    backend().files.set(newJson(a), json({ ...a, amount: 2 }))
    backend().files.set(newPdf(a), new Uint8Array([2]))
    backend().files.set(newJson(b2), json(b2))
    backend().files.set(`${DIR}/${base(b2)}.pdf`, new Uint8Array([3])) // legacy PDF paired with the new JSON
    backend().files.set(`${DIR}/pdf/lone.pdf`, new Uint8Array([7]))
    backend().pickedSavePath = '/out.zip'
    expect(await exportAll()).toBe(true)
    const z = backend().zips.get('/out.zip')!
    expect([...z.keys()].sort()).toEqual([
      'faktura-data.json',
      `faktury/${base(a)}.json`,
      `faktury/${base(a)}.pdf`,
      `faktury/${base(b2)}.json`,
      `faktury/${base(b2)}.pdf`,
      'faktury/lone.pdf',
    ])
    expect(JSON.parse(z.get(`faktury/${base(a)}.json`) as string).amount).toBe(2)
    expect(z.get(`faktury/${base(b2)}.pdf`)).toEqual(new Uint8Array([3]))
  })

  it('does nothing when the save dialog is cancelled', async () => {
    savedData.value = full()
    expect(await exportAll()).toBe(false)
    expect(backend().zips.size).toBe(0)
  })

  it('shows an error toast and leaves no zip when a file cannot be read', async () => {
    savedData.value = full()
    putInvoice(inv('202611'))
    backend().pickedSavePath = '/out.zip'
    vi.spyOn(backend(), 'exportZip').mockRejectedValueOnce(new Error('disk plný'))
    render(<ToastHost />)
    expect(await exportAll()).toBe(false)
    expect(await screen.findByText('Export se nezdařil: disk plný')).toBeInTheDocument()
  })
})

function mountHost() {
  return render(<><DialogHost /><ToastHost /></>)
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

describe('importFromZip', () => {
  it('previews the counts, extracts the invoices and merges the saved data (settings untouched)', async () => {
    const mine: SavedData = { ...emptySavedData(), suppliers: [supplier], settings: { ...emptySavedData().settings, dueRule: { kind: 'daysAfterIssue' as const, days: 7 } } }
    savedData.value = mine
    backend().dataFile = JSON.stringify(mine)
    const a = inv('202611')
    const b = inv('202612', '2026-12-31')
    backend().zips.set('/z.zip', zipOf([a, b], { ...full(), settings: { ...emptySavedData().settings, dueRule: { kind: 'daysAfterIssue' as const, days: 99 } } }))
    backend().pickedZip = '/z.zip'
    mountHost()
    const done = importFromZip()
    expect(await screen.findByText(/Záloha obsahuje: 2 faktury, 1 odběratel, 0 dodavatelů, 1 účet, 1 text\./)).toBeInTheDocument()
    expect(screen.getByText(/1 už existuje\./)).toBeInTheDocument()
    click('Importovat')
    expect(await done).toBe(true)
    expect(await screen.findByText('Import hotov')).toBeInTheDocument()
    expect((await listInvoices(backend(), DIR)).map(r => (r.kind === 'invoice' ? r.invoice.number : '')).sort()).toEqual(['202611', '202612'])
    expect(savedData.value!.customers).toEqual([customer])
    expect(savedData.value!.settings.dueRule).toEqual({ kind: 'daysAfterIssue', days: 7 })
    expect(JSON.parse(backend().dataFile!).customers).toEqual([customer])
    expect([...takenNumbers.value].sort()).toEqual(['202611', '202612'])
  })

  it('cancelling the preview imports nothing', async () => {
    savedData.value = emptySavedData()
    backend().zips.set('/z.zip', zipOf([inv('202611')], full()))
    backend().pickedZip = '/z.zip'
    mountHost()
    const done = importFromZip()
    await screen.findByText('Importovat ze zálohy')
    click('Zrušit')
    expect(await done).toBe(false)
    expect(backend().files.size).toBe(0)
    expect(savedData.value).toEqual(emptySavedData())
  })

  it('a conflict asks per invoice: Ponechat stávající keeps the file, Nahradit overwrites it', async () => {
    savedData.value = emptySavedData()
    const keep = inv('202611')
    const replace = inv('202612', '2026-12-31')
    putInvoice({ ...keep, amount: 1 })
    putInvoice({ ...replace, amount: 2 })
    backend().zips.set('/z.zip', zipOf([{ ...keep, amount: 111 }, { ...replace, amount: 222 }], null))
    backend().pickedZip = '/z.zip'
    mountHost()
    const done = importFromZip()
    await screen.findByText('Importovat ze zálohy')
    click('Importovat')
    expect(await screen.findByText('Faktura 202611 už ve složce s fakturami je.')).toBeInTheDocument()
    click('Ponechat stávající')
    expect(await screen.findByText('Faktura 202612 už ve složce s fakturami je.')).toBeInTheDocument()
    click('Nahradit')
    expect(await done).toBe(true)
    const amount = (path: string) => JSON.parse(backend().files.get(path) as string).amount
    expect(amount(`${DIR}/${base(keep)}.json`)).toBe(1)
    expect(amount(newJson(replace))).toBe(222)
    expect(backend().files.get(newPdf(replace))).toEqual(new Uint8Array([9, 9]))
    // the replaced legacy (0.2.0) files do not linger in the folder itself
    expect(backend().files.has(`${DIR}/${base(replace)}.json`)).toBe(false)
    expect(backend().files.has(`${DIR}/${base(replace)}.pdf`)).toBe(false)
    expect((await listInvoices(backend(), DIR)).map(r => r.kind === 'invoice' && r.invoice.amount).sort()).toEqual([1, 222])
  })

  it('replacing an invoice with the same number from another month trashes the old pair only after extraction', async () => {
    savedData.value = emptySavedData()
    const old = inv('202611', '2026-10-31')
    const incoming = inv('202611')
    putInvoice(old)
    backend().zips.set('/z.zip', zipOf([incoming], null))
    backend().pickedZip = '/z.zip'
    const trash = vi.spyOn(backend(), 'trash')
    mountHost()
    const done = importFromZip()
    await screen.findByText('Importovat ze zálohy')
    click('Importovat')
    await screen.findByText('Faktura 202611 už ve složce s fakturami je.')
    click('Nahradit')
    expect(await done).toBe(true)
    expect(trash).toHaveBeenCalledWith([`${DIR}/${base(old)}.json`, `${DIR}/${base(old)}.pdf`])
    expect([...backend().files.keys()].sort()).toEqual([newJson(incoming), newPdf(incoming)])
  })

  it('a failed extraction keeps the old files, writes no saved data and shows an error', async () => {
    const mine = { ...emptySavedData(), suppliers: [supplier] }
    savedData.value = mine
    const old = inv('202611', '2026-10-31')
    putInvoice(old)
    backend().zips.set('/z.zip', zipOf([inv('202611')], full()))
    backend().pickedZip = '/z.zip'
    vi.spyOn(backend(), 'zipExtract').mockRejectedValueOnce(new Error('disk plný'))
    const trash = vi.spyOn(backend(), 'trash')
    mountHost()
    const done = importFromZip()
    await screen.findByText('Importovat ze zálohy')
    click('Importovat')
    await screen.findByText('Faktura 202611 už ve složce s fakturami je.')
    click('Nahradit')
    expect(await done).toBe(false)
    expect(await screen.findByText(/Import se nezdařil, nic se nezměnilo: disk plný/)).toBeInTheDocument()
    expect(trash).not.toHaveBeenCalled()
    expect(backend().files.has(`${DIR}/${base(old)}.json`)).toBe(true)
    expect(backend().dataFile).toBeNull()
    expect(savedData.value).toEqual(mine)
  })

  it('an invalid data file in the zip is an error and nothing is written', async () => {
    savedData.value = emptySavedData()
    backend().zips.set('/z.zip', zipOf([inv('202611')], null, [['faktura-data.json', '{"schemaVersion":2}']]))
    backend().pickedZip = '/z.zip'
    mountHost()
    expect(await importFromZip()).toBe(false)
    expect(await screen.findByText(/poškozený nebo má neznámý formát/)).toBeInTheDocument()
    expect(backend().files.size).toBe(0)
    expect(backend().dataFile).toBeNull()
  })

  it('ignores foreign JSONs and traversal entries in the zip', async () => {
    savedData.value = emptySavedData()
    backend().zips.set('/z.zip', zipOf([inv('202611')], null, [
      ['faktury/foreign.json', '{"a":1}'],
      ['faktury/../evil.json', json(inv('666'))],
      ['faktury/sub/deep.json', json(inv('777'))],
      ['other/x.json', json(inv('888'))],
    ]))
    backend().pickedZip = '/z.zip'
    mountHost()
    const done = importFromZip()
    expect(await screen.findByText(/Záloha obsahuje: 1 faktura,/)).toBeInTheDocument()
    click('Importovat')
    expect(await done).toBe(true)
    expect([...backend().files.keys()].sort()).toEqual([newJson(inv('202611')), newPdf(inv('202611'))])
  })

  it('a zip with nothing new says so', async () => {
    savedData.value = emptySavedData()
    backend().zips.set('/z.zip', zipOf([], emptySavedData()))
    backend().pickedZip = '/z.zip'
    mountHost()
    expect(await importFromZip()).toBe(false)
    expect(await screen.findByText('V záloze není nic nového k importu.')).toBeInTheDocument()
  })

  it('a cancelled file dialog does nothing', async () => {
    savedData.value = emptySavedData()
    mountHost()
    expect(await importFromZip()).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('an unreadable zip shows an error', async () => {
    savedData.value = emptySavedData()
    backend().pickedZip = '/missing.zip'
    mountHost()
    expect(await importFromZip()).toBe(false)
    expect(await screen.findByText(/Zálohu se nepodařilo načíst/)).toBeInTheDocument()
  })

  it('does not overwrite an existing file the app cannot read as an invoice, and says so', async () => {
    const mine = { ...emptySavedData(), suppliers: [supplier] }
    savedData.value = mine
    const i = inv('202611')
    backend().files.set(`${DIR}/${base(i)}.json`, '{corrupt')
    backend().zips.set('/z.zip', zipOf([i], full()))
    backend().pickedZip = '/z.zip'
    mountHost()
    const done = importFromZip()
    await screen.findByText('Importovat ze zálohy')
    click('Importovat')
    expect(await done).toBe(false)
    expect(await screen.findByText(new RegExp(`${base(i)}\\.json`))).toBeInTheDocument()
    expect(screen.getByTestId('toast')).toHaveAttribute('data-kind', 'error')
    expect(backend().files.get(`${DIR}/${base(i)}.json`)).toBe('{corrupt')
    expect(backend().files.has(`${DIR}/${base(i)}.pdf`)).toBe(false)
    expect(backend().files.has(newJson(i))).toBe(false)
    expect(backend().files.has(newPdf(i))).toBe(false)
    expect(backend().dataFile).toBeNull()
    expect(savedData.value).toEqual(mine)
  })

  it('also refuses when the unreadable file is in json/', async () => {
    savedData.value = { ...emptySavedData(), suppliers: [supplier] }
    const i = inv('202611')
    backend().files.set(newJson(i), '{corrupt')
    backend().zips.set('/z.zip', zipOf([i], full()))
    backend().pickedZip = '/z.zip'
    mountHost()
    const done = importFromZip()
    await screen.findByText('Importovat ze zálohy')
    click('Importovat')
    expect(await done).toBe(false)
    expect(backend().files.get(newJson(i))).toBe('{corrupt')
    expect(backend().files.has(newPdf(i))).toBe(false)
  })

  it('sees a new-layout invoice as a conflict, and replacing it overwrites it in place', async () => {
    savedData.value = emptySavedData()
    const i = inv('202611')
    backend().files.set(newJson(i), json({ ...i, amount: 1 }))
    backend().files.set(newPdf(i), new Uint8Array([1]))
    backend().zips.set('/z.zip', zipOf([{ ...i, amount: 5 }], null))
    backend().pickedZip = '/z.zip'
    const trash = vi.spyOn(backend(), 'trash')
    mountHost()
    const done = importFromZip()
    await screen.findByText('Importovat ze zálohy')
    click('Importovat')
    await screen.findByText('Faktura 202611 už ve složce s fakturami je.')
    click('Nahradit')
    expect(await done).toBe(true)
    expect(trash).not.toHaveBeenCalled()
    expect(JSON.parse(backend().files.get(newJson(i)) as string).amount).toBe(5)
    expect([...backend().files.keys()].sort()).toEqual([newJson(i), newPdf(i)])
  })

  it('only names the user chose to replace may overwrite (extraction gets exactly those)', async () => {
    savedData.value = emptySavedData()
    const a = inv('202611')
    const c = inv('202612', '2026-12-31')
    putInvoice(a)
    backend().zips.set('/z.zip', zipOf([a, c], null))
    backend().pickedZip = '/z.zip'
    const extract = vi.spyOn(backend(), 'zipExtract')
    mountHost()
    const done = importFromZip()
    await screen.findByText('Importovat ze zálohy')
    click('Importovat')
    await screen.findByText('Faktura 202611 už ve složce s fakturami je.')
    click('Nahradit')
    expect(await done).toBe(true)
    expect(extract).toHaveBeenCalledTimes(1)
    const [, names, , overwrite] = extract.mock.calls[0]
    expect([...names].sort()).toEqual([`${base(a)}.json`, `${base(a)}.pdf`, `${base(c)}.json`, `${base(c)}.pdf`])
    expect([...overwrite].sort()).toEqual([`${base(a)}.json`, `${base(a)}.pdf`])
  })

  it('a zip with duplicate file names is refused with a clear error and nothing is written', async () => {
    savedData.value = emptySavedData()
    backend().zips.set('/z.zip', new Map<string, string | Uint8Array>([['faktury/A.json', json(inv('1'))], ['faktury/a.json', json(inv('2'))]]))
    backend().pickedZip = '/z.zip'
    mountHost()
    expect(await importFromZip()).toBe(false)
    expect(await screen.findByText(/Záloha obsahuje duplicitní soubory\./)).toBeInTheDocument()
    expect(backend().files.size).toBe(0)
  })

  it('counts lone PDFs skipped because the name already exists in the preview', async () => {
    savedData.value = emptySavedData()
    backend().files.set(`${DIR}/lone.pdf`, new Uint8Array([7]))
    backend().zips.set('/z.zip', zipOf([inv('202611')], null, [['faktury/lone.pdf', new Uint8Array([1])], ['faktury/lone2.pdf', new Uint8Array([1])]]))
    backend().pickedZip = '/z.zip'
    mountHost()
    const done = importFromZip()
    expect(await screen.findByText(/1 PDF přeskočeno \(už existuje\)\./)).toBeInTheDocument()
    click('Importovat')
    expect(await done).toBe(true)
    expect(backend().files.get(`${DIR}/lone.pdf`)).toEqual(new Uint8Array([7]))
    expect(backend().files.has(`${DIR}/pdf/lone2.pdf`)).toBe(true)
  })

  it('a conflict by file name with a different invoice number names the file in the dialog', async () => {
    savedData.value = emptySavedData()
    const i = inv('202611')
    // an existing invoice with another number under the file name the zip invoice would use
    backend().files.set(`${DIR}/${base(i)}.json`, json({ ...i, number: '999' }))
    backend().zips.set('/z.zip', zipOf([i], null))
    backend().pickedZip = '/z.zip'
    mountHost()
    const done = importFromZip()
    await screen.findByText('Importovat ze zálohy')
    click('Importovat')
    expect(await screen.findByText(new RegExp(`${base(i)}\\.json`))).toBeInTheDocument()
    expect(screen.queryByText('Faktura 202611 už ve složce s fakturami je.')).toBeNull()
    click('Ponechat stávající')
    expect(await done).toBe(false)
  })

  it('two zip invoices with the same number get distinguishable prompts', async () => {
    savedData.value = emptySavedData()
    const oct = inv('202611', '2026-10-31')
    const nov = inv('202611')
    putInvoice(oct)
    backend().zips.set('/z.zip', zipOf([oct, nov], null))
    backend().pickedZip = '/z.zip'
    mountHost()
    const done = importFromZip()
    await screen.findByText('Importovat ze zálohy')
    click('Importovat')
    const first = await screen.findByRole('dialog')
    expect(first.textContent).toContain(base(oct))
    click('Ponechat stávající')
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain(base(nov)))
    click('Ponechat stávající')
    await done
  })

  it('replacing the invoice that is open in the editor marks the editor invoice as unsaved', async () => {
    savedData.value = emptySavedData()
    const i = inv('202611')
    putInvoice(i)
    loadedNumber.value = '202611'
    isSaved.value = true
    backend().zips.set('/z.zip', zipOf([i], null))
    backend().pickedZip = '/z.zip'
    mountHost()
    const done = importFromZip()
    await screen.findByText('Importovat ze zálohy')
    click('Importovat')
    await screen.findByText('Faktura 202611 už ve složce s fakturami je.')
    click('Nahradit')
    expect(await done).toBe(true)
    expect(loadedNumber.value).toBeNull()
    expect(isSaved.value).toBe(false)
  })

  it('keeping the existing invoice leaves the editor state alone', async () => {
    savedData.value = emptySavedData()
    const i = inv('202611')
    putInvoice(i)
    loadedNumber.value = '202611'
    backend().zips.set('/z.zip', zipOf([i, inv('202612', '2026-12-31')], null))
    backend().pickedZip = '/z.zip'
    mountHost()
    const done = importFromZip()
    await screen.findByText('Importovat ze zálohy')
    click('Importovat')
    await screen.findByText('Faktura 202611 už ve složce s fakturami je.')
    click('Ponechat stávající')
    expect(await done).toBe(true)
    expect(loadedNumber.value).toBe('202611')
    expect(isSaved.value).toBe(true)
  })

  describe('onboarding', () => {
    it('without a supplier in the backup shows the error and writes nothing', async () => {
      backend().zips.set('/z.zip', zipOf([inv('202611')], { ...full(), suppliers: [] }))
      backend().pickedZip = '/z.zip'
      mountHost()
      expect(await importFromZip({ onboarding: true })).toBe(false)
      expect(await screen.findByText('Záloha neobsahuje údaje dodavatele.')).toBeInTheDocument()
      expect(backend().files.size).toBe(0)
      expect(backend().dataFile).toBeNull()
      expect(savedData.value).toBeNull()
    })

    it('a backup without a data file is not enough either', async () => {
      backend().zips.set('/z.zip', zipOf([inv('202611')], null))
      backend().pickedZip = '/z.zip'
      mountHost()
      expect(await importFromZip({ onboarding: true })).toBe(false)
      expect(await screen.findByText('Záloha neobsahuje údaje dodavatele.')).toBeInTheDocument()
    })

    it('writes the data file from the backup entries and settings, but with the default invoice folder, then publishes it', async () => {
      const zipSettings = { ...emptySavedData().settings, theme: 'dark' as const, showDicDefault: false, dueRule: { kind: 'daysAfterIssue' as const, days: 14 }, invoiceDir: '/elsewhere' }
      backend().zips.set('/z.zip', zipOf([inv('202611')], { ...full(), settings: zipSettings }))
      backend().pickedZip = '/z.zip'
      mountHost()
      const done = importFromZip({ onboarding: true })
      await screen.findByText('Importovat ze zálohy')
      click('Importovat')
      expect(await done).toBe(true)
      const written = JSON.parse(backend().dataFile!) as SavedData
      expect(written.suppliers).toEqual([supplier])
      expect(written.settings).toEqual({ ...zipSettings, invoiceDir: null })
      expect(savedData.value).toEqual(written)
      // the invoices went to the default folder, not to the path from the other machine
      expect(backend().files.has(newJson(inv('202611')))).toBe(true)
      expect([...backend().files.keys()].some(k => k.startsWith('/elsewhere'))).toBe(false)
    })

    it('falls back to the default settings when the backup has no data file settings', async () => {
      const { settings: _drop, ...noSettings } = full()
      backend().zips.set('/z.zip', zipOf([], null, [['faktura-data.json', JSON.stringify(noSettings)]]))
      backend().pickedZip = '/z.zip'
      mountHost()
      const done = importFromZip({ onboarding: true })
      await screen.findByText('Importovat ze zálohy')
      click('Importovat')
      expect(await done).toBe(true)
      expect(savedData.value!.settings).toEqual(emptySavedData().settings)
    })

    it('does not publish the data when the write fails', async () => {
      backend().zips.set('/z.zip', zipOf([], full()))
      backend().pickedZip = '/z.zip'
      vi.spyOn(backend(), 'dataSave').mockRejectedValueOnce(new Error('zamčeno'))
      mountHost()
      const done = importFromZip({ onboarding: true })
      await screen.findByText('Importovat ze zálohy')
      click('Importovat')
      expect(await done).toBe(false)
      expect(await screen.findByText(/Uložení údajů se nezdařilo: zamčeno/)).toBeInTheDocument()
      expect(savedData.value).toBeNull()
    })
  })
})

describe('backup and restore through the app', () => {
  it('export, wipe everything, boot to onboarding, restore: Historie lists all invoices and the data is back', async () => {
    // 1. A working installation with data and invoices.
    const data: SavedData = { ...full(), suppliers: [supplier, { ...supplier, id: 's2', name: 'Jan Novák ml.', ico: '87654322' }] }
    savedData.value = data
    const invoices = [inv('202609', '2026-09-30'), inv('202610', '2026-10-31'), inv('202611')]
    for (const i of invoices) putInvoice(i)
    backend().files.set(`${DIR}/lone.pdf`, new Uint8Array([7]))
    backend().pickedSavePath = '/zaloha.zip'
    expect(await exportAll()).toBe(true)

    // 2. A fresh machine: nothing on disk.
    backend().files.clear()
    backend().dataFile = null
    backend().bakFile = null
    savedData.value = null
    editorReady.value = false
    dismissAllToasts()
    backend().pickedZip = '/zaloha.zip'

    // 3. The app boots to onboarding and restores from the zip.
    render(<App />)
    expect(await screen.findByText('Vítejte ve Fakturce')).toBeInTheDocument()
    click(/Obnovit ze zálohy/)
    expect(await screen.findByText(/Záloha obsahuje: 3 faktury, 1 odběratel, 2 dodavatelé, 1 účet, 1 text, 1 samostatné PDF\./)).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Importovat' }))

    // 4. The shell is up, Historie lists everything, the saved details are back.
    fireEvent.click(await screen.findByRole('button', { name: 'Historie' }))
    for (const i of invoices) expect(await screen.findByText(i.number)).toBeInTheDocument()
    expect(screen.getByText('lone.pdf')).toBeInTheDocument()
    expect(savedData.value!.suppliers).toEqual(data.suppliers)
    expect(savedData.value!.customers).toEqual(data.customers)
    expect(JSON.parse(backend().dataFile!).suppliers).toEqual(data.suppliers)
    await waitFor(() => expect([...takenNumbers.value].sort()).toEqual(['202609', '202610', '202611']))
  })

  it('a rejected restore keeps the onboarding on screen', async () => {
    backend().zips.set('/z.zip', zipOf([inv('202611')], { ...full(), suppliers: [] }))
    backend().pickedZip = '/z.zip'
    render(<App />)
    await screen.findByText('Vítejte ve Fakturce')
    click(/Obnovit ze zálohy/)
    expect(await screen.findByText('Záloha neobsahuje údaje dodavatele.')).toBeInTheDocument()
    expect(screen.getByText('Vítejte ve Fakturce')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Obnovit ze zálohy/ })).toBeEnabled()
  })
})
