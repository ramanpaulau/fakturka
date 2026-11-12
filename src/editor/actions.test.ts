import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { savedData } from '../app/state'
import { suggestNumber } from '../domain/numbering'
import type { Invoice } from '../domain/types'
import { renderInvoicePdf } from '../pdf/renderPdf'
import { emptySavedData } from '../storage/dataStore'
import { getBackend, MemoryBackend } from '../storage/backend'
import { fixtureInvoice } from '../test/fixtures'
import { revealItemInDir } from '../history/opener'
import { confirmDialog } from '../ui/Dialog'
import { toast } from '../ui/Toast'
import { bootEditor, handleCloseRequest, printCurrent, saveCurrent, startNew } from './actions'
import { editorReady, invoice, isSaved, loadedNumber, loadIntoEditor, setField, takenNumbers } from './editorState'

vi.mock('../pdf/renderPdf', () => ({ renderInvoicePdf: vi.fn(async () => new Uint8Array([1])) }))
vi.mock('../ui/Dialog', () => ({ confirmDialog: vi.fn(async () => true) }))
vi.mock('../ui/Toast', () => ({ toast: vi.fn() }))
vi.mock('../history/opener', () => ({ openPath: vi.fn(async () => {}), revealItemInDir: vi.fn(async () => {}) }))

const DIR = '/Dokumenty/Faktury'
const PDF = `${DIR}/pdf/2026-11_faktura-202611.pdf`
const JSON_PATH = `${DIR}/json/2026-11_faktura-202611.json`
const backend = () => getBackend() as MemoryBackend
const confirmMock = vi.mocked(confirmDialog)
const toastMock = vi.mocked(toast)
const renderMock = vi.mocked(renderInvoicePdf)
const revealMock = vi.mocked(revealItemInDir)

const OVERWRITE = (n: string) => ({ title: 'Přepsat fakturu?', body: `Faktura ${n} už existuje. Chcete ji nahradit?`, confirm: 'Přepsat', danger: true })

async function putRecord(inv: Invoice) {
  const base = `${inv.issueDate.slice(0, 7)}_faktura-${inv.number}`
  await backend().writeInvoice(DIR, base, new Uint8Array([9]), JSON.stringify(inv))
}

beforeEach(() => {
  savedData.value = emptySavedData()
  loadIntoEditor(fixtureInvoice, false)
  takenNumbers.value = new Set()
  editorReady.value = false
  backend().files.clear()
  backend().failWritesUnder = undefined
  confirmMock.mockReset().mockResolvedValue(true)
  toastMock.mockReset()
  renderMock.mockReset().mockResolvedValue(new Uint8Array([1]))
  revealMock.mockReset().mockResolvedValue(undefined)
  vi.useRealTimers()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveCurrent', () => {
  it('without an amount: returns false, shows the error toast and writes nothing', async () => {
    loadIntoEditor({ ...fixtureInvoice, amount: null }, false)
    expect(await saveCurrent()).toBe(false)
    expect(toastMock).toHaveBeenCalledWith('Zadejte částku.', 'error')
    expect(backend().files.size).toBe(0)
    expect(isSaved.value).toBe(false)
  })

  it('without an invoice number: returns false, shows the error toast and writes nothing', async () => {
    for (const number of ['', '   ']) {
      toastMock.mockReset()
      loadIntoEditor({ ...fixtureInvoice, number }, false)
      expect(await saveCurrent()).toBe(false)
      expect(toastMock).toHaveBeenCalledWith('Zadejte číslo faktury.', 'error')
      expect(backend().files.size).toBe(0)
      expect(isSaved.value).toBe(false)
    }
  })

  it('writes the PDF + JSON pair and marks the invoice saved', async () => {
    expect(await saveCurrent()).toBe(true)
    expect(backend().files.get(PDF)).toEqual(new Uint8Array([1]))
    const json = JSON.parse(backend().files.get(JSON_PATH) as string)
    expect(json.number).toBe('202611')
    expect(typeof json.savedAt).toBe('string')
    expect(Number.isNaN(Date.parse(json.savedAt))).toBe(false)
    expect(renderMock).toHaveBeenCalledWith(expect.objectContaining({ number: '202611', savedAt: json.savedAt }))
    expect(isSaved.value).toBe(true)
    expect(loadedNumber.value).toBe('202611')
    expect(invoice.value.savedAt).toBe(json.savedAt)
    expect(takenNumbers.value).toEqual(new Set(['202611']))
    expect(toastMock).toHaveBeenCalledWith('Faktura uložena')
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('a second click while saving joins the running save instead of writing twice', async () => {
    const write = vi.spyOn(backend(), 'writeInvoice')
    const [a, b] = await Promise.all([saveCurrent(), saveCurrent()])
    expect([a, b]).toEqual([true, true])
    expect(write).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledTimes(1)
  })

  it('a different invoice with a taken number asks; declining writes nothing', async () => {
    await putRecord(fixtureInvoice)
    const before = new Map(backend().files)
    const write = vi.spyOn(backend(), 'writeInvoice')
    loadIntoEditor({ ...fixtureInvoice, customer: { ...fixtureInvoice.customer, name: 'Jiná firma' } }, false)
    confirmMock.mockResolvedValue(false)
    expect(await saveCurrent()).toBe(false)
    expect(confirmMock).toHaveBeenCalledWith(OVERWRITE('202611'))
    expect(write).not.toHaveBeenCalled()
    expect(backend().files).toEqual(before)
    expect(isSaved.value).toBe(false)
  })

  it('confirming the overwrite replaces the record', async () => {
    await putRecord(fixtureInvoice)
    loadIntoEditor({ ...fixtureInvoice, customer: { ...fixtureInvoice.customer, name: 'Jiná firma' } }, false)
    expect(await saveCurrent()).toBe(true)
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(backend().files.get(JSON_PATH) as string).customer.name).toBe('Jiná firma')
  })

  it('re-saving the loaded record does not ask', async () => {
    expect(await saveCurrent()).toBe(true)
    setField('customer.street', 'Nová 8')
    expect(isSaved.value).toBe(false)
    expect(await saveCurrent()).toBe(true)
    expect(confirmMock).not.toHaveBeenCalled()
    expect(JSON.parse(backend().files.get(JSON_PATH) as string).customer.street).toBe('Nová 8')
  })

  it('the loaded record renumbered onto another saved number asks', async () => {
    await putRecord({ ...fixtureInvoice, number: '202610', issueDate: '2026-10-31' })
    expect(await saveCurrent()).toBe(true)
    setField('number', '202610')
    confirmMock.mockResolvedValue(false)
    expect(await saveCurrent()).toBe(false)
    expect(confirmMock).toHaveBeenCalledWith(OVERWRITE('202610'))
  })

  it('a lone PDF with the same file name asks, naming the file', async () => {
    backend().files.set(PDF, new Uint8Array([7]))
    confirmMock.mockResolvedValue(false)
    expect(await saveCurrent()).toBe(false)
    expect(confirmMock).toHaveBeenCalledWith(OVERWRITE('2026-11_faktura-202611.pdf'))
    expect(backend().files.get(PDF)).toEqual(new Uint8Array([7]))
  })

  it('a failed write: false, error toast, isSaved stays false and the invoice is unchanged', async () => {
    backend().failWritesUnder = DIR
    const before = invoice.value
    expect(await saveCurrent()).toBe(false)
    expect(toastMock).toHaveBeenCalledWith('Uložení se nezdařilo: Nelze zapsat soubor', 'error')
    expect(isSaved.value).toBe(false)
    expect(invoice.value).toBe(before)
    expect(invoice.value.savedAt).toBeNull()
    expect(loadedNumber.value).toBeNull()
    expect(backend().files.size).toBe(0)
  })

  it('a failed PDF render (e.g. fonts not loaded): false and error toast', async () => {
    renderMock.mockRejectedValue(new Error('Font x: HTTP 404'))
    expect(await saveCurrent()).toBe(false)
    expect(toastMock).toHaveBeenCalledWith('Uložení se nezdařilo: Font x: HTTP 404', 'error')
    expect(isSaved.value).toBe(false)
    expect(backend().files.size).toBe(0)
  })
})

describe('Uložit PDF shows the saved PDF in the file manager', () => {
  it('reveals the PDF just written (in pdf/) once', async () => {
    expect(await saveCurrent()).toBe(true)
    expect(revealMock).toHaveBeenCalledTimes(1)
    expect(revealMock).toHaveBeenCalledWith(PDF)
  })

  it('reveals once when a second click joins the running save', async () => {
    await Promise.all([saveCurrent(), saveCurrent()])
    expect(revealMock).toHaveBeenCalledTimes(1)
  })

  it('does not reveal when printing (which saves first)', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})
    await printCurrent()
    expect(backend().files.has(PDF)).toBe(true)
    expect(revealMock).not.toHaveBeenCalled()
  })

  it('does not reveal after a failed, cancelled or invalid save, nor on a later print', async () => {
    backend().failWritesUnder = DIR
    expect(await saveCurrent()).toBe(false)
    backend().failWritesUnder = undefined
    await putRecord(fixtureInvoice)
    loadIntoEditor({ ...fixtureInvoice, amount: 1 }, false)
    confirmMock.mockResolvedValue(false)
    expect(await saveCurrent()).toBe(false)
    loadIntoEditor({ ...fixtureInvoice, amount: null }, false)
    expect(await saveCurrent()).toBe(false)
    loadIntoEditor({ ...fixtureInvoice, amount: 2 }, false)
    confirmMock.mockResolvedValue(true)
    vi.spyOn(window, 'print').mockImplementation(() => {})
    await printCurrent()
    expect(revealMock).not.toHaveBeenCalled()
  })

  it('ignores a failing reveal: the save still succeeds without an error toast', async () => {
    revealMock.mockRejectedValue(new Error('Funguje jen v aplikaci'))
    expect(await saveCurrent()).toBe(true)
    await new Promise(r => setTimeout(r, 0))
    expect(toastMock.mock.calls).toEqual([['Faktura uložena']])
  })
})

describe('printCurrent', () => {
  it('does not print when the save is declined', async () => {
    await putRecord(fixtureInvoice)
    loadIntoEditor({ ...fixtureInvoice, amount: 1 }, false)
    confirmMock.mockResolvedValue(false)
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await printCurrent()
    expect(print).not.toHaveBeenCalled()
  })

  it('does not print without an amount', async () => {
    loadIntoEditor({ ...fixtureInvoice, amount: null }, false)
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await printCurrent()
    expect(print).not.toHaveBeenCalled()
  })

  it('saves first, then prints with body[data-printing] set during the call', async () => {
    let flag: string | undefined
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      flag = document.body.dataset.printing
      expect(backend().files.has(PDF)).toBe(true)
    })
    await printCurrent()
    expect(print).toHaveBeenCalledTimes(1)
    expect(flag).toBe('1')
    expect(document.body.dataset.printing).toBeUndefined()
    expect(isSaved.value).toBe(true)
  })

  it('a second click while printing does not print twice', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await Promise.all([printCurrent(), printCurrent()])
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('a rejected print (e.g. permission missing) shows an error toast', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => Promise.reject(new Error('webview.print not allowed')) as unknown as void)
    await printCurrent()
    expect(toastMock).toHaveBeenCalledWith('Tisk se nezdařil: webview.print not allowed', 'error')
    expect(document.body.dataset.printing).toBeUndefined()
  })
})

describe('startNew', () => {
  it('with unsaved edits asks; declining keeps the invoice', async () => {
    setField('customer.street', 'Nová 8')
    const before = invoice.value
    confirmMock.mockResolvedValue(false)
    await startNew()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(invoice.value).toBe(before)
    expect(isSaved.value).toBe(false)
  })

  it('confirmed: a copy of the latest saved invoice with the next free number', async () => {
    await putRecord({ ...fixtureInvoice, number: '202609', issueDate: '2026-09-30', customer: { ...fixtureInvoice.customer, name: 'Starší s.r.o.' } })
    await putRecord({ ...fixtureInvoice, number: '202610', issueDate: '2026-10-31', customer: { ...fixtureInvoice.customer, name: 'Poslední s.r.o.' }, amount: 1234 })
    setField('customer.street', 'Nová 8')
    await startNew()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(takenNumbers.value).toEqual(new Set(['202609', '202610']))
    expect(invoice.value.number).toBe(suggestNumber(invoice.value.issueDate, takenNumbers.value))
    expect(invoice.value.customer.name).toBe('Poslední s.r.o.')
    expect(invoice.value.amount).toBe(1234)
    expect(invoice.value.savedAt).toBeNull()
    expect(isSaved.value).toBe(true)
    expect(loadedNumber.value).toBeNull()
  })

  it('a saved invoice is replaced without asking', async () => {
    loadIntoEditor(fixtureInvoice, true)
    await putRecord(fixtureInvoice)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 10))
    await startNew()
    expect(confirmMock).not.toHaveBeenCalled()
    expect(invoice.value.issueDate).toBe('2026-11-30')
    expect(invoice.value.number).toBe('20261102')
  })
})

describe('switching invoices while a save is running', () => {
  /** Makes the next PDF render wait until the returned function is called. */
  function holdRender(): () => void {
    let release!: () => void
    renderMock.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(new Uint8Array([1])) }))
    return () => release()
  }

  it('Nová waits for the save; a new invoice given the same number asks before overwriting it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 10))
    const release = holdRender()
    const save = saveCurrent()
    const next = startNew()
    await vi.waitFor(() => expect(renderMock).toHaveBeenCalled())
    release()
    expect(await save).toBe(true)
    await next
    expect(confirmMock).not.toHaveBeenCalled()
    expect(loadedNumber.value).toBeNull()
    expect(invoice.value.number).not.toBe('202611')
    expect(takenNumbers.value).toEqual(new Set(['202611']))
    setField('number', '202611')
    confirmMock.mockResolvedValue(false)
    expect(await saveCurrent()).toBe(false)
    expect(confirmMock).toHaveBeenCalledWith(OVERWRITE('202611'))
  })

  it('a save that lands after another invoice was loaded leaves that invoice alone', async () => {
    const other: Invoice = { ...fixtureInvoice, number: '202610', issueDate: '2026-10-31' }
    const release = holdRender()
    const save = saveCurrent()
    await vi.waitFor(() => expect(renderMock).toHaveBeenCalled())
    // e.g. a caller that did not wait for the save
    loadIntoEditor(other, false)
    release()
    expect(await save).toBe(true)
    expect(invoice.value).toBe(other)
    expect(loadedNumber.value).toBeNull()
    expect(isSaved.value).toBe(false)
  })

  it('a slow start does not replace an invoice loaded meanwhile (e.g. opened from Historie)', async () => {
    const opened: Invoice = { ...fixtureInvoice, number: '202610', issueDate: '2026-10-31' }
    let list!: () => void
    const listDir = backend().listDir.bind(backend())
    vi.spyOn(backend(), 'listDir').mockImplementationOnce(dir => new Promise(resolve => { list = () => resolve(listDir(dir)) }))
    const boot = bootEditor()
    await vi.waitFor(() => expect(list).toBeDefined())
    loadIntoEditor(opened, true)
    list()
    await boot
    expect(invoice.value).toBe(opened)
    expect(loadedNumber.value).toBe('202610')
    expect(isSaved.value).toBe(true)
  })
})

describe('bootEditor', () => {
  it('shows a copy of the latest invoice without asking and marks the editor ready', async () => {
    await putRecord({ ...fixtureInvoice, customer: { ...fixtureInvoice.customer, name: 'Poslední s.r.o.' } })
    loadIntoEditor(fixtureInvoice, false)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 10))
    await bootEditor()
    expect(confirmMock).not.toHaveBeenCalled()
    expect(editorReady.value).toBe(true)
    expect(invoice.value.customer.name).toBe('Poslední s.r.o.')
    expect(invoice.value.number).toBe('20261102')
    expect(isSaved.value).toBe(true)
    expect(loadedNumber.value).toBeNull()
  })

  it('with no history builds the invoice from the saved data with an empty amount', async () => {
    savedData.value = { ...emptySavedData(), customers: [{ id: 'c1', name: 'Příklad s.r.o.', street: '', city: '', ico: '', dic: '', note: '' }] }
    await bootEditor()
    expect(invoice.value.customer).toMatchObject({ name: 'Příklad s.r.o.', sourceId: 'c1' })
    expect(invoice.value.amount).toBeNull()
  })

  it('runs only once, so switching tabs keeps the edits', async () => {
    await bootEditor()
    setField('customer.street', 'Nová 8')
    await bootEditor()
    expect(invoice.value.customer.street).toBe('Nová 8')
  })

  it('still starts when the invoice folder cannot be listed', async () => {
    vi.spyOn(backend(), 'listDir').mockRejectedValueOnce(new Error('nelze'))
    await bootEditor()
    expect(editorReady.value).toBe(true)
    expect(takenNumbers.value.size).toBe(0)
  })

  it('does nothing while no data is loaded', async () => {
    savedData.value = null
    await bootEditor()
    expect(editorReady.value).toBe(false)
  })
})

describe('handleCloseRequest', () => {
  const event = () => ({ preventDefault: vi.fn() })

  it('a saved invoice closes without asking', async () => {
    loadIntoEditor(fixtureInvoice, true)
    const e = event()
    await handleCloseRequest(e)
    expect(confirmMock).not.toHaveBeenCalled()
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('an unsaved invoice asks; cancelling keeps the window open', async () => {
    confirmMock.mockResolvedValue(false)
    const e = event()
    await handleCloseRequest(e)
    expect(confirmMock).toHaveBeenCalledWith({ title: 'Zavřít bez uložení?', body: 'Faktura není uložená. Změny se ztratí.', confirm: 'Zavřít', danger: true })
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('an unsaved invoice closes when confirmed', async () => {
    const e = event()
    await handleCloseRequest(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })
})
