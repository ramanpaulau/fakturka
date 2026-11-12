import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { savedData } from '../app/state'
import { formatCzk } from '../domain/money'
import { emptySavedData } from '../storage/dataStore'
import { fixtureInvoice } from '../test/fixtures'
import { editorReady, invoice, isSaved, loadIntoEditor, takenNumbers } from './editorState'
import { EditorPage } from './EditorPage'
import { printCurrent, saveCurrent, startNew } from './actions'

vi.mock('./actions', () => ({
  bootEditor: vi.fn(async () => {}),
  saveCurrent: vi.fn(async () => true),
  printCurrent: vi.fn(async () => {}),
  startNew: vi.fn(async () => {}),
}))

beforeEach(() => {
  savedData.value = emptySavedData()
  loadIntoEditor(fixtureInvoice, true)
  takenNumbers.value = new Set()
  editorReady.value = true
  vi.clearAllMocks()
})
afterEach(cleanup)

const field = (c: Element, path: string) => c.querySelector<HTMLElement>(`[data-field="${path}"]`)!

/** Simulates typing: the browser changes the text, then fires `input`. */
function type(el: HTMLElement, text: string) {
  fireEvent.focus(el)
  el.textContent = text
  fireEvent.input(el)
}

describe('EditorPage', () => {
  it('renders the sheet in edit mode with the toolbar', () => {
    const { container } = render(<EditorPage />)
    expect(container.querySelector('.sheet[data-mode="edit"]')).not.toBeNull()
    for (const name of ['Nová', 'Skrýt DIČ', 'Tisknout', 'Uložit PDF']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Uložit PDF' })).toHaveClass('btn-primary')
    expect(container.querySelector('.editor-toolbar')).toHaveClass('controls')
  })

  it('the toolbar buttons run Nová, Tisknout and Uložit PDF', () => {
    render(<EditorPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Nová' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tisknout' }))
    fireEvent.click(screen.getByRole('button', { name: 'Uložit PDF' }))
    expect(startNew).toHaveBeenCalledTimes(1)
    expect(printCurrent).toHaveBeenCalledTimes(1)
    expect(saveCurrent).toHaveBeenCalledTimes(1)
  })

  it('the number field is a plain-text editable', () => {
    const { container } = render(<EditorPage />)
    const num = screen.getByRole('textbox', { name: 'Číslo faktury' })
    expect(num).toBe(field(container, 'number'))
    expect(num).toHaveAttribute('contenteditable', 'true')
    expect(num).toHaveTextContent('202611')
  })

  it('typing a number that is already taken shows the warning', () => {
    takenNumbers.value = new Set(['202610'])
    const { container } = render(<EditorPage />)
    expect(screen.queryByText('Faktura s tímto číslem už existuje.')).toBeNull()
    type(field(container, 'number'), '202610')
    expect(invoice.value.number).toBe('202610')
    const warn = screen.getByText('Faktura s tímto číslem už existuje.')
    expect(warn.closest('.controls')).not.toBeNull()
  })

  it('no warning for the number of the record that is loaded', () => {
    takenNumbers.value = new Set(['202611'])
    loadIntoEditor(fixtureInvoice, true)
    render(<EditorPage />)
    expect(screen.queryByText('Faktura s tímto číslem už existuje.')).toBeNull()
  })

  it('the variabilní symbol mirrors the number and is read-only', () => {
    const { container } = render(<EditorPage />)
    type(field(container, 'number'), '20261105')
    const vs = container.querySelector('[data-mirror="number"]')!
    expect(vs).toHaveTextContent('20261105')
    expect(vs).not.toHaveAttribute('contenteditable')
  })

  it('editing a field commits on input and shows "Neuloženo"', () => {
    const { container } = render(<EditorPage />)
    expect(screen.queryByText('Neuloženo')).toBeNull()
    type(field(container, 'customer.street'), 'Nová 8')
    expect(invoice.value.customer.street).toBe('Nová 8')
    expect(isSaved.value).toBe(false)
    expect(screen.getByText('Neuloženo')).toBeInTheDocument()
  })

  it('does not rewrite the text of a focused field while typing (caret stays)', () => {
    const { container } = render(<EditorPage />)
    const el = field(container, 'customer.street')
    fireEvent.focus(el)
    const node = el.firstChild
    el.firstChild!.textContent = 'Nová 8'
    fireEvent.input(el)
    expect(el.firstChild).toBe(node)
    expect(el.textContent).toBe('Nová 8')
  })

  it('Enter blurs the field instead of inserting a line', () => {
    const { container } = render(<EditorPage />)
    const el = field(container, 'customer.city')
    el.focus()
    expect(document.activeElement).toBe(el)
    const ev = fireEvent.keyDown(el, { key: 'Enter' })
    expect(ev).toBe(false) // default prevented
    expect(document.activeElement).not.toBe(el)
  })

  it('Enter during an IME / dead-key composition is left to the browser', () => {
    const { container } = render(<EditorPage />)
    const el = field(container, 'customer.city')
    el.focus()
    const ev = fireEvent.keyDown(el, { key: 'Enter', isComposing: true })
    expect(ev).toBe(true) // not prevented
    expect(document.activeElement).toBe(el)
  })

  it('the Enter that ends a composition in WebKit (keyCode 229) is left to the browser', () => {
    const { container } = render(<EditorPage />)
    const el = field(container, 'customer.city')
    el.focus()
    const ev = fireEvent.keyDown(el, { key: 'Enter', keyCode: 229 })
    expect(ev).toBe(true) // not prevented
    expect(document.activeElement).toBe(el)
  })

  it('Space on an open date field does not scroll the page', () => {
    render(<EditorPage />)
    const date = screen.getByRole('button', { name: /Datum vystavení/ })
    fireEvent.click(date)
    expect(screen.getByText('listopad 2026')).toBeInTheDocument()
    expect(fireEvent.keyDown(date, { key: ' ' })).toBe(false)
  })

  it('the calendar closes when focus leaves the date field, so arrows and Enter elsewhere are not captured', () => {
    const { container } = render(<EditorPage />)
    const date = screen.getByRole('button', { name: /Datum vystavení/ })
    fireEvent.click(date)
    const other = field(container, 'customer.city')
    fireEvent.blur(date, { relatedTarget: other })
    expect(screen.queryByText('listopad 2026')).toBeNull()
    expect(fireEvent.keyDown(other, { key: 'ArrowDown' })).toBe(true)
    expect(invoice.value.issueDate).toBe(fixtureInvoice.issueDate)
  })

  it('the calendar stays open when focus moves into it', () => {
    render(<EditorPage />)
    const date = screen.getByRole('button', { name: /Datum vystavení/ })
    fireEvent.click(date)
    fireEvent.blur(date, { relatedTarget: screen.getByRole('button', { name: '20. 11. 2026' }) })
    expect(screen.getByText('listopad 2026')).toBeInTheDocument()
  })

  it('paste inserts plain text only', () => {
    const { container } = render(<EditorPage />)
    const el = field(container, 'customer.name')
    el.focus()
    el.textContent = ''
    const getData = vi.fn((t: string) => (t === 'text/plain' ? 'Vložená\nfirma' : '<b>x</b>'))
    const ev = fireEvent.paste(el, { clipboardData: { getData } })
    expect(ev).toBe(false)
    expect(getData).toHaveBeenCalledWith('text/plain')
    expect(el.innerHTML).not.toContain('<b>')
    expect(invoice.value.customer.name).toBe('Vložená firma')
  })

  it('blur resyncs the field with the committed value', () => {
    const { container } = render(<EditorPage />)
    const el = field(container, 'customer.street')
    type(el, 'Nová 8 ')
    fireEvent.blur(el)
    expect(invoice.value.customer.street).toBe('Nová 8')
    expect(el.textContent).toBe('Nová 8')
  })

  it('amount: raw while editing, formatted after blur, mirrored read-only in the text row', () => {
    const { container } = render(<EditorPage />)
    const el = field(container, 'amount')
    expect(el.textContent).toBe(formatCzk(42000))
    fireEvent.focus(el)
    expect(el.textContent).toBe('42000')
    el.textContent = '50 000'
    fireEvent.input(el)
    expect(invoice.value.amount).toBe(50000)
    const mirror = container.querySelector('[data-mirror="amount"]')!
    expect(mirror.textContent).toBe(formatCzk(50000))
    expect(mirror).not.toHaveAttribute('contenteditable')
    fireEvent.blur(el)
    expect(el.textContent).toBe(formatCzk(50000))
  })

  it('amount: unparsable input leaves the amount empty', () => {
    const { container } = render(<EditorPage />)
    type(field(container, 'amount'), 'abc')
    expect(invoice.value.amount).toBeNull()
    expect(container.querySelector('[data-mirror="amount"]')).toBeNull()
  })

  it('the DIČ toggle hides and shows the DIČ lines', () => {
    const { container } = render(<EditorPage />)
    expect(container.querySelector('.sheet')!.textContent).toContain('CZ87654321')
    fireEvent.click(screen.getByRole('button', { name: 'Skrýt DIČ' }))
    expect(invoice.value.showDic).toBe(false)
    expect(container.querySelector('.sheet')!.textContent).not.toContain('DIČ')
    fireEvent.click(screen.getByRole('button', { name: 'Zobrazit DIČ' }))
    expect(invoice.value.showDic).toBe(true)
  })

  it('has no "+N dní" button (the date picker replaces it)', () => {
    render(<EditorPage />)
    expect(screen.queryByRole('button', { name: /dní$/ })).toBeNull()
  })

  it('clicking a date opens the Czech calendar and picking a day sets it', () => {
    render(<EditorPage />)
    fireEvent.click(screen.getByRole('button', { name: /Datum vystavení/ }))
    expect(screen.getByText('listopad 2026')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '20. 11. 2026' }))
    expect(invoice.value.issueDate).toBe('2026-11-20')
    expect(screen.queryByText('listopad 2026')).toBeNull()
  })

  it('toolbar actions without wiring do nothing', () => {
    render(<EditorPage />)
    for (const name of ['Nová', 'Tisknout', 'Uložit PDF']) fireEvent.click(screen.getByRole('button', { name }))
    expect(invoice.value).toEqual(fixtureInvoice)
    expect(isSaved.value).toBe(true)
  })

  it('reflects external invoice changes in unfocused fields', () => {
    const { container } = render(<EditorPage />)
    act(() => loadIntoEditor({ ...fixtureInvoice, customer: { ...fixtureInvoice.customer, street: 'Jiná 1' } }, true))
    expect(field(container, 'customer.street').textContent).toBe('Jiná 1')
  })

  it('renders nothing until the editor is initialised', () => {
    editorReady.value = false
    savedData.value = null
    const { container } = render(<EditorPage />)
    expect(container.querySelector('.sheet')).toBeNull()
  })
})
