import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { getVersion } from '@tauri-apps/api/app'
import { savedData } from '../app/state'
import type { Invoice, SavedData } from '../domain/types'
import { saveCurrent } from '../editor/actions'
import { isSaved, loadedNumber, loadIntoEditor, takenNumbers } from '../editor/editorState'
import { getBackend, MemoryBackend } from '../storage/backend'
import { emptySavedData } from '../storage/dataStore'
import { fixtureInvoice } from '../test/fixtures'
import { DialogHost } from '../ui/Dialog'
import { dismissAllToasts, ToastHost } from '../ui/Toast'
import { SettingsPage } from './SettingsPage'

vi.mock('../pdf/renderPdf', () => ({ renderInvoicePdf: vi.fn(async () => new Uint8Array([1])) }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '1.2.3') }))

const backend = () => getBackend() as MemoryBackend
const OLD = '/Dokumenty/Faktury'
const NEW = '/USB/Faktury'
const persisted = (): SavedData => JSON.parse(backend().dataFile!)

/** Fake invoice files (JSON + PDF) in `dir`; returns the two file names. */
function put(dir: string, number: string, month = '2026-11', pdf = true): string[] {
  const inv: Invoice = { ...fixtureInvoice, number, issueDate: `${month}-30` }
  const base = `${month}_faktura-${number}`
  backend().files.set(`${dir}/${base}.json`, JSON.stringify(inv))
  if (pdf) backend().files.set(`${dir}/${base}.pdf`, new Uint8Array([1, 2, 3]))
  return pdf ? [`${base}.json`, `${base}.pdf`] : [`${base}.json`]
}
const names = (dir: string) => backend().listDir(dir).then(es => es.map(e => e.name).sort())

beforeEach(() => {
  backend().files.clear()
  backend().dataFile = null
  backend().bakFile = null
  backend().pickedFolder = null
  savedData.value = emptySavedData()
  takenNumbers.value = new Set()
  dismissAllToasts()
  vi.restoreAllMocks()
  vi.mocked(getVersion).mockResolvedValue('1.2.3')
})
afterEach(cleanup)

function mount() {
  return render(
    <>
      <SettingsPage />
      <DialogHost />
      <ToastHost />
    </>,
  )
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const dialogButton = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }))

describe('layout', () => {
  it('shows the folder, the sections and the app version', async () => {
    mount()
    expect(await screen.findByText(OLD)).toBeInTheDocument()
    for (const h of ['Složka s fakturami', 'Výchozí hodnoty', 'Záloha', 'O aplikaci']) {
      expect(screen.getByRole('heading', { name: h })).toBeInTheDocument()
    }
    expect(await screen.findByText('1.2.3')).toBeInTheDocument()
    expect(screen.getByText(/^Fakturka, verze/)).toBeInTheDocument()
  })

  it('O aplikaci names the authors and says the data stay on this computer', async () => {
    mount()
    await screen.findByText(OLD)
    expect(screen.getByText('Autoři: Raman Paulau a Claude Opus')).toBeInTheDocument()
    expect(screen.getByText(/ukládají jen lokálně do tohoto počítače/)).toBeInTheDocument()
    expect(screen.getByText('Aplikace vytvořená s pomocí AI (vibecoding) pro osobní použití. Bez záruky a bez podpory.')).toBeInTheDocument()
    expect(screen.getByText('github.com/ramanpaulau/fakturka')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /github/ })).toBeNull()
  })

  it('shows a dash when the version is unavailable (browser build)', async () => {
    vi.mocked(getVersion).mockRejectedValue(new Error('no tauri'))
    mount()
    await screen.findByText(OLD)
    expect(screen.getByText('–')).toBeInTheDocument()
  })

  it('Exportovat… writes the zip the user picked and confirms with a toast', async () => {
    put(OLD, '202611')
    backend().zips.clear()
    backend().pickedSavePath = '/Stažené/zaloha.zip'
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Exportovat…' }))
    expect(await screen.findByText('Export hotov')).toBeInTheDocument()
    expect([...backend().zips.get('/Stažené/zaloha.zip')!.keys()].sort()).toEqual(['faktura-data.json', 'faktury/2026-11_faktura-202611.json', 'faktury/2026-11_faktura-202611.pdf'])
    expect(backend().lastSaveName).toMatch(/^faktury-export-\d{4}-\d{2}-\d{2}\.zip$/)
  })

  it('Importovat… opens the preview for the picked zip, and cancelling changes nothing', async () => {
    backend().zips.set('/z.zip', new Map([
      ['faktury/2026-10_faktura-202610.json', JSON.stringify({ ...fixtureInvoice, number: '202610', issueDate: '2026-10-30' })],
      ['faktura-data.json', JSON.stringify(emptySavedData())],
    ]))
    backend().pickedZip = '/z.zip'
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Importovat…' }))
    expect(await screen.findByText('Importovat ze zálohy')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zrušit' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Importovat…' })).toBeEnabled())
    expect(await names(OLD)).toEqual([])
  })

  it('shows the configured folder instead of the default', async () => {
    savedData.value = { ...emptySavedData(), settings: { ...emptySavedData().settings, invoiceDir: NEW } }
    mount()
    expect(await screen.findByText(NEW)).toBeInTheDocument()
  })
})

describe('defaults', () => {
  it('changing the due rule persists to the data file', async () => {
    mount()
    expect(screen.getByRole('radio', { name: 'Den v následujícím měsíci' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Dní od vystavení' }))
    await waitFor(() => expect(persisted().settings.dueRule).toEqual({ kind: 'daysAfterIssue', days: 30 }))
    expect(screen.getByRole('radio', { name: 'Dní od vystavení' })).toBeChecked()
  })

  it('edits the day of the next month and keeps the other rule value for switching back', async () => {
    mount()
    fireEvent.input(screen.getByLabelText('Den v měsíci'), { target: { value: '20' } })
    await waitFor(() => expect(persisted().settings.dueRule).toEqual({ kind: 'dayOfNextMonth', day: 20 }))
    fireEvent.click(screen.getByRole('radio', { name: 'Dní od vystavení' }))
    fireEvent.input(screen.getByLabelText('Počet dní'), { target: { value: '14' } })
    await waitFor(() => expect(persisted().settings.dueRule).toEqual({ kind: 'daysAfterIssue', days: 14 }))
    fireEvent.click(screen.getByRole('radio', { name: 'Den v následujícím měsíci' }))
    await waitFor(() => expect(persisted().settings.dueRule).toEqual({ kind: 'dayOfNextMonth', day: 20 }))
  })

  it('does not save an out-of-range day and snaps back on blur', async () => {
    mount()
    const input = screen.getByLabelText('Den v měsíci') as HTMLInputElement
    fireEvent.input(input, { target: { value: '40' } })
    fireEvent.blur(input)
    await waitFor(() => expect(input.value).toBe('15'))
    expect(backend().dataFile).toBeNull()
  })

  it('persists the DIČ switch; there is no "+N dní" setting any more', async () => {
    mount()
    expect(screen.queryByLabelText('Posun splatnosti (dní)')).toBeNull()
    const sw = screen.getByRole('switch', { name: 'Zobrazovat DIČ' })
    expect(sw).toBeChecked()
    fireEvent.click(sw)
    await waitFor(() => expect(persisted().settings.showDicDefault).toBe(false))
    expect(sw).not.toBeChecked()
  })
})

describe('changing the invoice folder', () => {
  it('"Jen ukládat do nové složky" updates invoiceDir without moving anything', async () => {
    const [json] = put(OLD, '202611')
    put(NEW, '202610', '2026-10')
    backend().pickedFolder = NEW
    const move = vi.spyOn(backend(), 'moveInvoices')
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await dialogButton('Jen ukládat do nové složky')
    await waitFor(() => expect(persisted().settings.invoiceDir).toBe(NEW))
    expect(move).not.toHaveBeenCalled()
    expect(backend().files.has(`${OLD}/${json}`)).toBe(true)
    expect(await screen.findByText(NEW)).toBeInTheDocument()
    expect(await screen.findByText('Faktury se nyní ukládají do nové složky.')).toBeInTheDocument()
    // the editor's number suggestions now come from the new folder
    await waitFor(() => expect([...takenNumbers.value]).toEqual(['202610']))
  })

  it('after a folder change, saving the open invoice asks before replacing the new folder\'s invoice with its number', async () => {
    put(OLD, '202611')
    const [json] = put(NEW, '202611')
    const theirs = backend().files.get(`${NEW}/${json}`)
    loadIntoEditor({ ...fixtureInvoice, number: '202611', issueDate: '2026-11-30' }, true)
    backend().pickedFolder = NEW
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await dialogButton('Jen ukládat do nové složky')
    await waitFor(() => expect(persisted().settings.invoiceDir).toBe(NEW))
    expect(loadedNumber.value).toBeNull()
    expect(isSaved.value).toBe(false)
    const saving = saveCurrent()
    expect(await screen.findByText('Přepsat fakturu?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zrušit' }))
    expect(await saving).toBe(false)
    expect(backend().files.get(`${NEW}/${json}`)).toBe(theirs)
  })

  it('"Přesunout faktury" moves the pairs, leaves other files and updates invoiceDir', async () => {
    const a = put(OLD, '202611')
    const b = put(OLD, '202610', '2026-10')
    backend().files.set(`${OLD}/poznamky.txt`, 'stays')
    backend().files.set(`${OLD}/cizi.pdf`, new Uint8Array([9]))
    backend().pickedFolder = NEW
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await dialogButton('Přesunout faktury')
    await waitFor(() => expect(persisted().settings.invoiceDir).toBe(NEW))
    expect(await names(NEW)).toEqual([...a, ...b].sort())
    expect(await names(OLD)).toEqual(['cizi.pdf', 'poznamky.txt'])
    expect(await screen.findByText('Faktury byly přesunuty do nové složky.')).toBeInTheDocument()
    await waitFor(() => expect([...takenNumbers.value].sort()).toEqual(['202610', '202611']))
  })

  it('moves a lone PDF only when it follows the _faktura- naming', async () => {
    backend().files.set(`${OLD}/2026-11_faktura-5.pdf`, new Uint8Array([1]))
    backend().files.set(`${OLD}/sken.pdf`, new Uint8Array([2]))
    backend().pickedFolder = NEW
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await dialogButton('Přesunout faktury')
    await waitFor(() => expect(persisted().settings.invoiceDir).toBe(NEW))
    expect(await names(NEW)).toEqual(['2026-11_faktura-5.pdf'])
    expect(await names(OLD)).toEqual(['sken.pdf'])
  })

  it('on a number clash, "Ponechat cílovou" keeps the target and leaves the source pair in the old folder', async () => {
    const clash = put(OLD, '202611')
    const other = put(OLD, '202610', '2026-10')
    put(NEW, '202611')
    backend().files.set(`${NEW}/${clash[1]}`, new Uint8Array([7, 7]))
    backend().pickedFolder = NEW
    const move = vi.spyOn(backend(), 'moveInvoices')
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await dialogButton('Přesunout faktury')
    expect(await screen.findByText('Faktura 202611 už v cílové složce je.')).toBeInTheDocument()
    await dialogButton('Ponechat cílovou')
    await waitFor(() => expect(persisted().settings.invoiceDir).toBe(NEW))
    expect(move).toHaveBeenCalledWith(OLD, NEW, other, [])
    expect(await names(OLD)).toEqual(clash)
    expect(backend().files.get(`${NEW}/${clash[1]}`)).toEqual(new Uint8Array([7, 7]))
    expect(await names(NEW)).toEqual([...clash, ...other].sort())
  })

  it('on a number clash, "Nahradit v cílové složce" overwrites the target pair', async () => {
    const clash = put(OLD, '202611')
    put(NEW, '202611')
    backend().files.set(`${NEW}/${clash[1]}`, new Uint8Array([7, 7]))
    backend().pickedFolder = NEW
    const move = vi.spyOn(backend(), 'moveInvoices')
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await dialogButton('Přesunout faktury')
    await dialogButton('Nahradit v cílové složce')
    await waitFor(() => expect(persisted().settings.invoiceDir).toBe(NEW))
    expect(move).toHaveBeenCalledWith(OLD, NEW, clash, clash)
    expect(backend().files.get(`${NEW}/${clash[1]}`)).toEqual(new Uint8Array([1, 2, 3]))
    expect(await names(OLD)).toEqual([])
  })

  it('a replaced invoice does not linger under another file name in the target', async () => {
    // same invoice number, different month -> different file names
    const src = put(OLD, '202611', '2026-11')
    const stale = put(NEW, '202611', '2026-10')
    backend().pickedFolder = NEW
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await dialogButton('Přesunout faktury')
    await dialogButton('Nahradit v cílové složce')
    await waitFor(() => expect(persisted().settings.invoiceDir).toBe(NEW))
    await waitFor(async () => expect(await names(NEW)).toEqual(src))
    expect(stale.length).toBe(2)
  })

  it('a failed move leaves invoiceDir unchanged and shows the error toast', async () => {
    const a = put(OLD, '202611')
    backend().pickedFolder = NEW
    vi.spyOn(backend(), 'moveInvoices').mockRejectedValue(new Error('Nelze zkopírovat soubor'))
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await dialogButton('Přesunout faktury')
    const t = await screen.findByTestId('toast')
    expect(t).toHaveAttribute('data-kind', 'error')
    expect(t).toHaveTextContent('Faktury se nepodařilo přesunout: Nelze zkopírovat soubor')
    expect(savedData.value?.settings.invoiceDir).toBeNull()
    expect(backend().dataFile).toBeNull()
    expect(await names(OLD)).toEqual(a)
    expect(screen.getByText(OLD)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Změnit…' })).toBeEnabled()
  })

  it('does nothing when the folder dialog is cancelled', async () => {
    backend().pickedFolder = null
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Změnit…' })).toBeEnabled())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(backend().dataFile).toBeNull()
  })

  it('does nothing when the choice dialog is dismissed', async () => {
    put(OLD, '202611')
    backend().pickedFolder = NEW
    const move = vi.spyOn(backend(), 'moveInvoices')
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(move).not.toHaveBeenCalled()
    expect(savedData.value?.settings.invoiceDir).toBeNull()
  })

  it('picking the current folder again is a no-op with a hint', async () => {
    backend().pickedFolder = `${OLD}/`
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    expect(await screen.findByText('Tato složka je už nastavená.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports it when the moved invoices are in the new folder but the setting could not be saved', async () => {
    put(OLD, '202611')
    backend().pickedFolder = NEW
    vi.spyOn(backend(), 'dataSave').mockRejectedValue(new Error('disk'))
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await dialogButton('Přesunout faktury')
    await screen.findByText(`Faktury byly přesunuty do složky ${NEW}, ale nastavení se nepodařilo uložit.`)
    expect(savedData.value?.settings.invoiceDir).toBeNull()
  })

  it('the move reports an error after copying: the toast names the new folder and does not claim nothing happened', async () => {
    put(OLD, '202611')
    backend().pickedFolder = NEW
    vi.spyOn(backend(), 'moveInvoices').mockRejectedValue(
      new Error('Faktury byly zkopírovány do nové složky, ale původní soubory zůstaly na místě: /Dokumenty/Faktury/2026-11_faktura-202611.pdf (změněn po zkopírování)'),
    )
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await dialogButton('Přesunout faktury')
    const t = await screen.findByTestId('toast')
    expect(t).toHaveAttribute('data-kind', 'error')
    expect(t).toHaveTextContent(`Faktury byly zkopírovány do složky ${NEW}`)
    expect(t).toHaveTextContent('změněn po zkopírování')
    expect(t).not.toHaveTextContent('beze změny')
    expect(savedData.value?.settings.invoiceDir).toBeNull()
  })

  it('A: with two replaced sources of one number, the invoice just moved in is not trashed', async () => {
    const a = put(OLD, '5', '2026-11')
    const b = put(OLD, '5', '2026-10')
    put(NEW, '5', '2026-10')
    backend().files.set(`${NEW}/${b[1]}`, new Uint8Array([7]))
    backend().pickedFolder = NEW
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await dialogButton('Přesunout faktury')
    await dialogButton('Nahradit v cílové složce')
    await dialogButton('Nahradit v cílové složce')
    await waitFor(() => expect(persisted().settings.invoiceDir).toBe(NEW))
    expect(await names(NEW)).toEqual([...a, ...b].sort())
    expect(backend().files.get(`${NEW}/${b[1]}`)).toEqual(new Uint8Array([1, 2, 3]))
    expect(await names(OLD)).toEqual([])
  })

  it('B: a target record the user keeps is not trashed because another replace matches it by number', async () => {
    // x clashes with the target by file name only (its number differs), y by number only
    const x = '2026-11_faktura-5'
    backend().files.set(`${OLD}/${x}.json`, JSON.stringify({ ...fixtureInvoice, number: '6', issueDate: '2026-11-30' }))
    backend().files.set(`${OLD}/${x}.pdf`, new Uint8Array([4]))
    const y = put(OLD, '5', '2026-10')
    const target = put(NEW, '5', '2026-11')
    backend().pickedFolder = NEW
    mount()
    await screen.findByText(OLD)
    click('Změnit…')
    await dialogButton('Přesunout faktury')
    await screen.findByText('Faktura 6 už v cílové složce je.')
    await dialogButton('Ponechat cílovou')
    await screen.findByText('Faktura 5 už v cílové složce je.')
    await dialogButton('Nahradit v cílové složce')
    await waitFor(() => expect(persisted().settings.invoiceDir).toBe(NEW))
    expect(await names(NEW)).toEqual([...target, ...y].sort())
    expect(await names(OLD)).toEqual([`${x}.json`, `${x}.pdf`])
  })
})
