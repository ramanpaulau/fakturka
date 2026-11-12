import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { currentTab, savedData } from '../app/state'
import { formatCzk } from '../domain/money'
import type { Invoice } from '../domain/types'
import { editorReady, invoice, isSaved, loadedNumber, loadIntoEditor, takenNumbers } from '../editor/editorState'
import { saveCurrent } from '../editor/actions'
import { renderInvoicePdf } from '../pdf/renderPdf'
import { emptySavedData } from '../storage/dataStore'
import { getBackend, MemoryBackend } from '../storage/backend'
import { fixtureInvoice } from '../test/fixtures'
import { DialogHost } from '../ui/Dialog'
import { dismissAllToasts, ToastHost } from '../ui/Toast'
import { HistoryPage } from './HistoryPage'
import { historyRange } from './historyModel'
import { openPath, revealItemInDir } from './opener'

vi.mock('../pdf/renderPdf', () => ({ renderInvoicePdf: vi.fn(async () => new Uint8Array([1])) }))
vi.mock('./opener', () => ({
  openPath: vi.fn(async () => {}),
  revealItemInDir: vi.fn(async () => {}),
}))

const backend = () => getBackend() as MemoryBackend
const DIR = '/Dokumenty/Faktury'
const path = (name: string) => `${DIR}/${name}`

const inv = (number: string, issueDate: string, amount: number, customer = 'Příklad s.r.o.', ico = '87654321'): Invoice => ({
  ...fixtureInvoice,
  number,
  issueDate,
  dueDate: '2026-12-15',
  amount,
  customer: { ...fixtureInvoice.customer, name: customer, ico },
})

function put(i: Invoice, withPdf = true) {
  const base = `${i.issueDate.slice(0, 7)}_faktura-${i.number}`
  backend().files.set(path(`${base}.json`), JSON.stringify(i))
  if (withPdf) backend().files.set(path(`${base}.pdf`), new Uint8Array([1, 2, 3]))
  return base
}

beforeEach(() => {
  backend().files.clear()
  savedData.value = emptySavedData()
  currentTab.value = 'historie'
  historyRange.value = null
  editorReady.value = true
  takenNumbers.value = new Set()
  loadIntoEditor(fixtureInvoice, true)
  dismissAllToasts()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})
afterEach(cleanup)

function mount() {
  return render(
    <>
      <HistoryPage />
      <DialogHost />
      <ToastHost />
    </>,
  )
}

/** The row of an invoice, found by its number (or a lone PDF's file name). */
const row = async (text: string) => (await screen.findByText(text)).closest<HTMLElement>('.hist-row')!
const openMenu = (r: HTMLElement) => fireEvent.click(within(r).getByRole('button', { name: 'Další akce' }))

describe('list', () => {
  beforeEach(() => {
    put(inv('202611', '2026-11-30', 42000))
    put(inv('20261002', '2026-10-31', 8500, 'Firma Beta a.s.', '55667788'))
    put(inv('202510', '2025-10-31', 10000))
    backend().files.set(path('stara-faktura.pdf'), new Uint8Array([9]))
  })

  it('shows the folder, the summary of the range and year groups newest first with count and total', async () => {
    const { container } = mount()
    await screen.findByText('202611')
    expect(container.querySelector('.hist-path')?.textContent).toContain(DIR)
    expect(screen.getByRole('button', { name: 'Otevřít složku' })).toBeInTheDocument()
    expect(container.querySelector('.hist-meta .hist-sum')?.textContent).toBe(`4 faktury · celkem ${formatCzk(60500)}`)
    const heads = [...container.querySelectorAll('.hist-year-head')].map(h => h.textContent)
    expect(heads).toEqual([`2026 2 faktury · celkem ${formatCzk(50500)}`, `2025 1 faktura · celkem ${formatCzk(10000)}`, 'Ostatní 1 soubor'])
  })

  it('a row shows number, dates, customer with IČO and the amount', async () => {
    mount()
    const r = await row('202611')
    expect(r.textContent).toContain('30. 11. 2026')
    expect(r.textContent).toContain('15. 12. 2026')
    expect(r.textContent).toContain('Příklad s.r.o.')
    expect(r.textContent).toContain('IČO 87654321')
    expect(r.querySelector('.hist-amt')?.textContent).toBe(formatCzk(42000))
  })

  it('a lone PDF shows its file name and the badge, and has no Otevřít', async () => {
    mount()
    const r = await row('stara-faktura.pdf')
    expect(within(r).getByText('jen PDF – nelze upravit')).toBeInTheDocument()
    expect(within(r).queryByRole('button', { name: 'Otevřít' })).toBeNull()
    openMenu(r)
    expect(screen.queryByRole('menuitem', { name: 'Nová faktura podle této' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Zobrazit ve složce' })).toBeInTheDocument()
  })

  it('search narrows the list and the summary, diacritics-insensitive', async () => {
    const { container } = mount()
    await screen.findByText('202611')
    fireEvent.input(screen.getByRole('searchbox', { name: 'Hledat' }), { target: { value: 'prik' } })
    expect(screen.queryByText('20261002')).toBeNull()
    expect(screen.getByText('202611')).toBeInTheDocument()
    expect(container.querySelector('.hist-meta .hist-sum')?.textContent).toBe(`2 faktury · celkem ${formatCzk(52000)}`)
    fireEvent.input(screen.getByRole('searchbox', { name: 'Hledat' }), { target: { value: 'zzz' } })
    expect(screen.getByText('Nic nenalezeno.')).toBeInTheDocument()
  })

  it('a range keeps the invoices issued in it and drops lone PDFs', async () => {
    historyRange.value = { from: '2026-10', to: '2026-10' }
    mount()
    await screen.findByText('20261002')
    expect(screen.queryByText('202611')).toBeNull()
    expect(screen.queryByText('stara-faktura.pdf')).toBeNull()
  })

  it('a year header collapses and expands its rows', async () => {
    mount()
    await screen.findByText('202510')
    const head = screen.getByRole('button', { name: /^2025/ })
    expect(head).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(head)
    expect(head).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('202510')).toBeNull()
    fireEvent.click(head)
    expect(screen.getByText('202510')).toBeInTheDocument()
  })

  it('Import and Export are enabled, and Import refreshes the list afterwards', async () => {
    mount()
    await screen.findByText('202611')
    for (const name of ['Import', 'Export']) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }
    backend().zips.set('/z.zip', new Map([
      ['faktury/2026-10_faktura-202610.json', JSON.stringify(inv('202610', '2026-10-30', 1000))],
    ]))
    backend().pickedZip = '/z.zip'
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Importovat' }))
    expect(await screen.findByText('202610')).toBeInTheDocument()
    expect(screen.getByText('Import hotov')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Období/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Nová faktura$/ })).toBeNull()
  })

  it('the column header is shown once, on the first expanded group', async () => {
    const { container } = mount()
    await screen.findByText('202510')
    const heads = () => [...container.querySelectorAll('.hist-year')].map(y => y.querySelector('.hist-head') !== null)
    expect(heads()).toEqual([true, false, false])
    fireEvent.click(screen.getByRole('button', { name: /^2026/ }))
    expect(heads()).toEqual([false, true, false])
    fireEvent.click(screen.getByRole('button', { name: /^2025/ }))
    expect(heads()).toEqual([false, false, true])
    fireEvent.click(screen.getByRole('button', { name: /^2026/ }))
    expect(heads()).toEqual([true, false, false])
  })

  describe('range picker', () => {
    const open = async () => {
      mount()
      await screen.findByText('202611')
      fireEvent.click(screen.getByRole('button', { name: /^Období/ }))
    }
    const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

    it('applying a range filters the list and the summary', async () => {
      const { container } = mount()
      await screen.findByText('202611')
      fireEvent.click(screen.getByRole('button', { name: /^Období/ }))
      click('Roky')
      click('2025')
      click('Použít')
      expect(historyRange.value).toEqual({ from: '2025-01', to: '2025-12' })
      expect(screen.getByRole('button', { name: /^Období/ })).toHaveTextContent('Období: 2025')
      expect(screen.queryByText('202611')).toBeNull()
      expect(screen.getByText('202510')).toBeInTheDocument()
      expect(container.querySelector('.hist-meta .hist-sum')?.textContent).toBe(`1 faktura · celkem ${formatCzk(10000)}`)
      // one year only: its heading does not repeat the summary line
      expect(container.querySelector('.hist-year-head')?.textContent).toBe('2025')
      expect(container.querySelector('.hist-year .hist-sum')).toBeNull()
    })

    it('shows the applied range in the field and the footer counts its invoices, not lone PDFs', async () => {
      historyRange.value = { from: '2026-10', to: '2026-11' }
      mount()
      await screen.findByText('202611')
      const field = screen.getByRole('button', { name: /^Období/ })
      expect(field).toHaveTextContent('Období: říjen 2026 – listopad 2026')
      fireEvent.click(field)
      expect(document.querySelector('.rp-foot span')?.textContent).toBe('2 měsíce · 2 faktury')
      click('Vše')
      expect(document.querySelector('.rp-foot span')?.textContent).toBe('3 faktury')
    })

    it('puts a dot on the months that have an invoice', async () => {
      await open()
      const dotted = [...document.querySelectorAll('.rp-cell')].filter(c => c.querySelector('.rp-dot')).map(c => c.textContent)
      expect(dotted).toEqual(['říj', 'lis'])
    })

    it('cancelling leaves the range alone', async () => {
      await open()
      click('Tento rok')
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(historyRange.value).toBeNull()
      expect(screen.getByText('stara-faktura.pdf')).toBeInTheDocument()
    })
  })

  it('shows an empty message for an empty folder', async () => {
    backend().files.clear()
    mount()
    expect(await screen.findByText('Zatím tu nejsou žádné faktury.')).toBeInTheDocument()
  })

  it('shows an error when the folder cannot be read', async () => {
    vi.spyOn(backend(), 'listDir').mockRejectedValue(new Error('Nelze číst'))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Nelze číst')
  })
})

describe('row actions', () => {
  beforeEach(() => {
    put(inv('202611', '2026-11-30', 42000))
    put(inv('202610', '2026-10-31', 8500, 'Firma Beta a.s.', '55667788'), false)
  })

  it('PDF opens the stored PDF and is disabled without one', async () => {
    mount()
    const r = await row('202611')
    fireEvent.click(within(r).getByRole('button', { name: 'PDF' }))
    expect(openPath).toHaveBeenCalledWith(path('2026-11_faktura-202611.pdf'))
    expect(within(await row('202610')).getByRole('button', { name: 'PDF' })).toBeDisabled()
  })

  it('Zobrazit ve složce reveals the PDF', async () => {
    mount()
    openMenu(await row('202611'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zobrazit ve složce' }))
    expect(revealItemInDir).toHaveBeenCalledWith(path('2026-11_faktura-202611.pdf'))
  })

  it('Otevřít složku opens the invoice folder', async () => {
    mount()
    await screen.findByText('202611')
    fireEvent.click(screen.getByRole('button', { name: 'Otevřít složku' }))
    expect(openPath).toHaveBeenCalledWith(DIR)
  })

  it('a failing opener shows an error toast', async () => {
    vi.mocked(openPath).mockRejectedValueOnce(new Error('Funguje jen v aplikaci'))
    mount()
    fireEvent.click(within(await row('202611')).getByRole('button', { name: 'PDF' }))
    expect(await screen.findByText('PDF se nepodařilo otevřít: Funguje jen v aplikaci')).toBeInTheDocument()
  })

  it('Tisknout draws the invoice into the print sheet and calls window.print()', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { container } = mount()
    expect(container.querySelector('.hist-print')).toBeNull()
    fireEvent.click(within(await row('202611')).getByRole('button', { name: 'Tisknout' }))
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    const sheet = container.querySelector('.hist-print .sheet[data-mode="static"]')
    expect(sheet?.textContent).toContain('Příklad s.r.o.')
    expect(openPath).not.toHaveBeenCalled()
  })

  it('a second click while printing does not print again', async () => {
    let finish!: () => void
    const print = vi.spyOn(window, 'print').mockImplementation(() => new Promise<void>(r => (finish = r)) as unknown as void)
    mount()
    const btn = within(await row('202611')).getByRole('button', { name: 'Tisknout' })
    fireEvent.click(btn)
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    fireEvent.click(btn)
    fireEvent.click(btn)
    await new Promise(r => setTimeout(r, 100))
    expect(print).toHaveBeenCalledTimes(1)
    finish()
    await new Promise(r => setTimeout(r, 10))
    fireEvent.click(btn)
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2))
  })

  it('a failed print releases the guard', async () => {
    const print = vi.spyOn(window, 'print').mockImplementationOnce(() => { throw new Error('bez oprávnění') })
    mount()
    const btn = within(await row('202611')).getByRole('button', { name: 'Tisknout' })
    fireEvent.click(btn)
    await screen.findByText('Tisk se nezdařil: bez oprávnění')
    print.mockImplementation(() => {})
    fireEvent.click(btn)
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2))
  })

  it('Tisknout of a lone PDF opens it in the system viewer', async () => {
    backend().files.set(path('stara-faktura.pdf'), new Uint8Array([9]))
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    mount()
    fireEvent.click(within(await row('stara-faktura.pdf')).getByRole('button', { name: 'Tisknout' }))
    await waitFor(() => expect(openPath).toHaveBeenCalledWith(path('stara-faktura.pdf')))
    expect(print).not.toHaveBeenCalled()
  })

  it('a failing print shows an error toast', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => { throw new Error('bez oprávnění') })
    mount()
    fireEvent.click(within(await row('202611')).getByRole('button', { name: 'Tisknout' }))
    expect(await screen.findByText('Tisk se nezdařil: bez oprávnění')).toBeInTheDocument()
  })
})

describe('Otevřít', () => {
  beforeEach(() => {
    put(inv('202611', '2026-11-30', 42000, 'Firma Beta a.s.', '55667788'))
  })

  it('loads the invoice into the editor as saved and switches to the Faktura tab', async () => {
    mount()
    fireEvent.click(within(await row('202611')).getByRole('button', { name: 'Otevřít' }))
    await waitFor(() => expect(currentTab.value).toBe('faktura'))
    expect(invoice.value.number).toBe('202611')
    expect(invoice.value.customer.name).toBe('Firma Beta a.s.')
    expect(isSaved.value).toBe(true)
    expect(loadedNumber.value).toBe('202611')
  })

  it('asks first when the editor is unsaved; cancelling keeps everything', async () => {
    isSaved.value = false
    mount()
    fireEvent.click(within(await row('202611')).getByRole('button', { name: 'Otevřít' }))
    expect(await screen.findByText('Zahodit neuloženou fakturu?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zrušit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(currentTab.value).toBe('historie')
    expect(invoice.value.number).toBe(fixtureInvoice.number)
  })

  it('opens after the discard is confirmed', async () => {
    isSaved.value = false
    mount()
    fireEvent.click(within(await row('202611')).getByRole('button', { name: 'Otevřít' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Zahodit' }))
    await waitFor(() => expect(currentTab.value).toBe('faktura'))
    expect(invoice.value.customer.name).toBe('Firma Beta a.s.')
  })

  it('an unreadable file shows an error toast and stays on Historie', async () => {
    mount()
    const r = await row('202611')
    backend().files.set(path('2026-11_faktura-202611.json'), '{broken')
    fireEvent.click(within(r).getByRole('button', { name: 'Otevřít' }))
    expect(await screen.findByText(/Fakturu se nepodařilo otevřít/)).toBeInTheDocument()
    expect(currentTab.value).toBe('historie')
  })

  it('Nová faktura podle této copies it into the editor with a new number and dates, unsaved-free', async () => {
    mount()
    openMenu(await row('202611'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Nová faktura podle této' }))
    await waitFor(() => expect(currentTab.value).toBe('faktura'))
    expect(invoice.value.customer.name).toBe('Firma Beta a.s.')
    expect(invoice.value.amount).toBe(42000)
    expect(invoice.value.number).not.toBe('202611')
    expect(takenNumbers.value.has('202611')).toBe(true)
    expect(loadedNumber.value).toBeNull()
    expect(isSaved.value).toBe(true)
  })
})

describe('while the editor is saving', () => {
  beforeEach(() => {
    put(inv('202611', '2026-11-30', 42000, 'Firma Beta a.s.', '55667788'))
    // a fresh invoice in the editor whose save is still running
    loadIntoEditor({ ...fixtureInvoice, number: '202612' }, false)
  })

  /** Starts saving the editor's invoice with the PDF render held until the returned function is called. */
  async function pendingSave(): Promise<{ release: () => void; done: Promise<boolean> }> {
    let release!: () => void
    vi.mocked(renderInvoicePdf).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(new Uint8Array([1])) }))
    const done = saveCurrent()
    await waitFor(() => expect(release).toBeDefined())
    return { release: () => release(), done }
  }

  it('Otevřít waits for the save, then opens the record as the loaded one', async () => {
    mount()
    const r = await row('202611')
    const save = await pendingSave()
    fireEvent.click(within(r).getByRole('button', { name: 'Otevřít' }))
    save.release()
    expect(await save.done).toBe(true)
    await waitFor(() => expect(currentTab.value).toBe('faktura'))
    expect(screen.queryByText('Zahodit neuloženou fakturu?')).toBeNull()
    expect(invoice.value.number).toBe('202611')
    expect(loadedNumber.value).toBe('202611')
    expect(isSaved.value).toBe(true)
    expect(backend().files.has(path('json/2026-11_faktura-202612.json'))).toBe(true)
  })

  it('Nová faktura podle této waits for the save and does not reuse its number', async () => {
    mount()
    const r = await row('202611')
    const save = await pendingSave()
    openMenu(r)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Nová faktura podle této' }))
    save.release()
    expect(await save.done).toBe(true)
    await waitFor(() => expect(currentTab.value).toBe('faktura'))
    expect(screen.queryByText('Zahodit neuloženou fakturu?')).toBeNull()
    expect(invoice.value.customer.name).toBe('Firma Beta a.s.')
    expect(['202611', '202612']).not.toContain(invoice.value.number)
    expect(takenNumbers.value).toEqual(new Set(['202611', '202612']))
    expect(loadedNumber.value).toBeNull()
  })
})

describe('Smazat', () => {
  beforeEach(() => {
    put(inv('202611', '2026-11-30', 42000))
    put(inv('202610', '2026-10-31', 8500))
  })

  it('confirms, moves both files to the trash and refreshes the list', async () => {
    const trash = vi.spyOn(backend(), 'trash')
    mount()
    openMenu(await row('202611'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Smazat…' }))
    expect(await screen.findByText('Smazat fakturu 202611?')).toBeInTheDocument()
    expect(screen.getByText('Soubory se přesunou do koše.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Smazat' }))
    await waitFor(() => expect(screen.queryByText('202611')).toBeNull())
    expect(trash).toHaveBeenCalledWith([path('2026-11_faktura-202611.json'), path('2026-11_faktura-202611.pdf')])
    expect(screen.getByText('202610')).toBeInTheDocument()
    expect(backend().files.has(path('2026-11_faktura-202611.pdf'))).toBe(false)
  })

  it('an invoice saved in both layouts is one row, and deleting it trashes the new and the legacy files', async () => {
    const i = inv('202611', '2026-11-30', 42000)
    backend().files.set(path('json/2026-11_faktura-202611.json'), JSON.stringify(i))
    backend().files.set(path('pdf/2026-11_faktura-202611.pdf'), new Uint8Array([4]))
    const trash = vi.spyOn(backend(), 'trash')
    mount()
    openMenu(await row('202611'))
    expect(screen.getAllByText('202611')).toHaveLength(1)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Smazat…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Smazat' }))
    await waitFor(() => expect(screen.queryByText('202611')).toBeNull())
    expect([...trash.mock.calls[0][0]].sort()).toEqual([
      path('2026-11_faktura-202611.json'),
      path('2026-11_faktura-202611.pdf'),
      path('json/2026-11_faktura-202611.json'),
      path('pdf/2026-11_faktura-202611.pdf'),
    ])
  })

  it('cancelling deletes nothing', async () => {
    const trash = vi.spyOn(backend(), 'trash')
    mount()
    openMenu(await row('202611'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Smazat…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Zrušit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trash).not.toHaveBeenCalled()
    expect(screen.getByText('202611')).toBeInTheDocument()
  })

  it('a lone PDF is trashed on its own', async () => {
    backend().files.set(path('stara-faktura.pdf'), new Uint8Array([9]))
    const trash = vi.spyOn(backend(), 'trash')
    mount()
    openMenu(await row('stara-faktura.pdf'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Smazat…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Smazat' }))
    await waitFor(() => expect(trash).toHaveBeenCalledWith([path('stara-faktura.pdf')]))
  })

  it('a failing trash shows an error toast and keeps the row', async () => {
    vi.spyOn(backend(), 'trash').mockRejectedValue(new Error('Koš není dostupný'))
    mount()
    openMenu(await row('202611'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Smazat…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Smazat' }))
    expect(await screen.findByText('Smazání se nezdařilo: Koš není dostupný')).toBeInTheDocument()
    expect(screen.getByText('202611')).toBeInTheDocument()
  })

  it('deleting the invoice the editor shows marks the editor unsaved', async () => {
    loadIntoEditor({ ...fixtureInvoice, number: '202611' }, true)
    mount()
    openMenu(await row('202611'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Smazat…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Smazat' }))
    await waitFor(() => expect(screen.queryByText('202611')).toBeNull())
    expect(isSaved.value).toBe(false)
    expect(loadedNumber.value).toBeNull()
  })
})
