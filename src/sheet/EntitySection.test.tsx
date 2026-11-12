import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { savedData } from '../app/state'
import { toSnap } from '../domain/entities'
import type { Party } from '../domain/types'
import { editorReady, invoice, isSaved, loadIntoEditor, takenNumbers } from '../editor/editorState'
import { EditorPage } from '../editor/EditorPage'
import { getBackend, MemoryBackend } from '../storage/backend'
import { emptySavedData } from '../storage/dataStore'
import { fixtureInvoice } from '../test/fixtures'
import { DialogHost } from '../ui/Dialog'
import { dismissAllToasts, ToastHost } from '../ui/Toast'

/** Fake data only. */
const saved: Party = { id: 'c1', name: 'Příklad s.r.o.', street: 'Krátká 5', city: '602 00 Brno', ico: '12345679', dic: 'CZ12345679', note: '' }
const beta: Party = { id: 'c2', name: 'Firma Beta a.s.', street: 'Hlavní 1', city: '702 00 Ostrava', ico: '55667788', dic: '', note: '' }
const twin: Party = { id: 'c3', name: 'Příklad s.r.o.', street: 'Polní 3', city: '301 00 Plzeň', ico: '11223344', dic: '', note: '' }

const backend = () => getBackend() as MemoryBackend

function setup(customers: Party[] = [saved]) {
  savedData.value = { ...emptySavedData(), customers }
  loadIntoEditor({ ...fixtureInvoice, customer: toSnap(saved) }, true)
  return render(
    <>
      <EditorPage />
      <ToastHost />
      <DialogHost />
    </>,
  )
}

beforeEach(() => {
  backend().files.clear()
  backend().dataFile = null
  backend().bakFile = null
  takenNumbers.value = new Set()
  editorReady.value = true
  dismissAllToasts()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const section = (kind: string) => document.querySelector<HTMLElement>(`[data-entity="${kind}"]`)!
const field = (path: string) => document.querySelector<HTMLElement>(`[data-field="${path}"]`)!
const tag = (kind: string) => section(kind).querySelector<HTMLElement>('.ent-tag')!
const ACTIONS = ['Uložit změny', 'Uložit jako nový', 'Vrátit', 'Uložit do údajů']

/** Simulates typing and leaving the field, as a click on a section button would. */
function type(path: string, text: string) {
  const el = field(path)
  fireEvent.focus(el)
  el.textContent = text
  fireEvent.input(el)
  fireEvent.blur(el)
}

const openPicker = (kind = 'customer') => {
  fireEvent.click(tag(kind))
  return screen.getByRole('listbox')
}
const options = () => screen.getAllByRole('option')
const picker = () => document.querySelector<HTMLElement>('.ent-picker')!

describe('EntitySection', () => {
  it('wraps supplier, customer, payment and text', () => {
    setup()
    for (const k of ['supplier', 'customer', 'payment', 'text']) expect(section(k)).not.toBeNull()
  })

  it('a section that matches its saved entry has no action buttons and a hover tag', () => {
    setup()
    const sec = section('customer')
    expect(sec).toHaveAttribute('data-state', 'matches')
    for (const name of ACTIONS) expect(within(sec).queryByRole('button', { name })).toBeNull()
    expect(tag('customer')).toHaveTextContent('Příklad s.r.o. · IČO 12345679')
    expect(tag('customer').closest('.controls')).not.toBeNull()
  })

  it('editing the street shows "upraveno", the changed field and the 3 buttons', () => {
    setup()
    type('customer.street', 'Nová 8')
    const sec = section('customer')
    expect(sec).toHaveAttribute('data-state', 'edited')
    expect(tag('customer')).toHaveTextContent('Příklad s.r.o. · IČO 12345679 · upraveno')
    for (const name of ['Uložit změny', 'Uložit jako nový', 'Vrátit']) {
      expect(within(sec).getByRole('button', { name }).closest('.controls')).not.toBeNull()
    }
    expect(within(sec).getByRole('button', { name: 'Uložit změny' })).toHaveClass('primary')
    expect(field('customer.street')).toHaveAttribute('data-changed')
    expect(field('customer.name')).not.toHaveAttribute('data-changed')
  })

  it('"Uložit změny" updates the saved customer, then the section matches again', async () => {
    setup()
    type('customer.street', 'Nová 8')
    fireEvent.click(within(section('customer')).getByRole('button', { name: 'Uložit změny' }))
    expect(await screen.findByText('Uloženo')).toBeInTheDocument()
    expect(section('customer')).toHaveAttribute('data-state', 'matches')
    expect(savedData.value!.customers).toEqual([{ ...saved, street: 'Nová 8' }])
    expect(invoice.value.customer).toEqual({ ...toSnap(saved), street: 'Nová 8' })
    expect(backend().dataFile).toContain('Nová 8')
    for (const name of ACTIONS) expect(within(section('customer')).queryByRole('button', { name })).toBeNull()
  })

  it('"Uložit změny" with the IČO of another saved customer asks; "Zrušit" writes nothing', async () => {
    setup([saved, beta])
    type('customer.ico', '55667788')
    fireEvent.click(within(section('customer')).getByRole('button', { name: 'Uložit změny' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Už existuje')).toBeInTheDocument()
    expect(within(dialog).getByText('Firma Beta a.s. · IČO 55667788 už je uložen.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zrušit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(savedData.value!.customers).toEqual([saved, beta])
    expect(backend().dataFile).toBeNull()
    expect(section('customer')).toHaveAttribute('data-state', 'edited')
  })

  it('"Uložit změny" with the IČO of another saved customer: "Přesto uložit" updates the linked entry', async () => {
    setup([saved, beta])
    type('customer.ico', '55667788')
    fireEvent.click(within(section('customer')).getByRole('button', { name: 'Uložit změny' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Přesto uložit' }))
    expect(await screen.findByText('Uloženo')).toBeInTheDocument()
    expect(savedData.value!.customers).toEqual([{ ...saved, ico: '55667788' }, beta])
  })

  it('"Uložit změny" with the IČO unchanged does not ask, even if another entry shares it', async () => {
    setup([saved, { ...twin, ico: saved.ico }])
    type('customer.street', 'Nová 8')
    fireEvent.click(within(section('customer')).getByRole('button', { name: 'Uložit změny' }))
    expect(await screen.findByText('Uloženo')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(savedData.value!.customers[0]).toEqual({ ...saved, street: 'Nová 8' })
  })

  it('"Vrátit" restores the saved values', () => {
    setup()
    type('customer.street', 'Nová 8')
    fireEvent.click(within(section('customer')).getByRole('button', { name: 'Vrátit' }))
    expect(invoice.value.customer.street).toBe('Krátká 5')
    expect(field('customer.street').textContent).toBe('Krátká 5')
    expect(section('customer')).toHaveAttribute('data-state', 'matches')
  })

  it('"Uložit jako nový" on an edited entry warns about the same IČO; "Přesto uložit" adds and links a new entry', async () => {
    setup()
    type('customer.street', 'Nová 8')
    fireEvent.click(within(section('customer')).getByRole('button', { name: 'Uložit jako nový' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Přesto uložit' }))
    await waitFor(() => expect(savedData.value!.customers).toHaveLength(2))
    const added = savedData.value!.customers[1]
    expect(added.id).not.toBe('c1')
    expect(added.street).toBe('Nová 8')
    expect(savedData.value!.customers[0]).toEqual(saved)
    await waitFor(() => expect(invoice.value.customer.sourceId).toBe(added.id))
    expect(section('customer')).toHaveAttribute('data-state', 'matches')
    expect(await screen.findByText('Uloženo')).toBeInTheDocument()
  })

  it('"＋ Nový odběratel" in the picker clears the section and offers "Uložit do údajů"', () => {
    setup()
    openPicker()
    expect(screen.getByPlaceholderText('Hledat podle názvu, IČO nebo města…')).toBeInTheDocument()
    fireEvent.click(screen.getByText('＋ Nový odběratel'))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(invoice.value.customer).toEqual({ name: '', street: '', city: '', ico: '', dic: '', note: '', sourceId: null })
    expect(isSaved.value).toBe(false)
    const sec = section('customer')
    expect(sec).toHaveAttribute('data-state', 'new')
    expect(tag('customer')).toHaveTextContent('＋ Nový odběratel')
    expect(within(sec).getByRole('button', { name: 'Uložit do údajů' })).toBeInTheDocument()
    for (const name of ['Uložit změny', 'Uložit jako nový', 'Vrátit']) expect(within(sec).queryByRole('button', { name })).toBeNull()
  })

  describe('saving a new customer whose IČO already exists', () => {
    function newWithSameIco() {
      setup()
      openPicker()
      fireEvent.click(screen.getByText('＋ Nový odběratel'))
      type('customer.name', 'Firma Gama s.r.o.')
      type('customer.ico', '12345679')
      fireEvent.click(within(section('customer')).getByRole('button', { name: 'Uložit do údajů' }))
    }

    it('shows "Už existuje" naming the saved entry', async () => {
      newWithSameIco()
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('Už existuje')).toBeInTheDocument()
      expect(within(dialog).getByText('Příklad s.r.o. · IČO 12345679 už je uložen.')).toBeInTheDocument()
    })

    it('"Použít ten" relinks to the saved entry without adding one', async () => {
      newWithSameIco()
      fireEvent.click(await screen.findByRole('button', { name: 'Použít ten' }))
      await waitFor(() => expect(invoice.value.customer).toEqual(toSnap(saved)))
      expect(savedData.value!.customers).toEqual([saved])
      expect(section('customer')).toHaveAttribute('data-state', 'matches')
    })

    it('"Přesto uložit" adds a second entry and links it', async () => {
      newWithSameIco()
      fireEvent.click(await screen.findByRole('button', { name: 'Přesto uložit' }))
      await waitFor(() => expect(savedData.value!.customers).toHaveLength(2))
      const added = savedData.value!.customers[1]
      expect(added).toMatchObject({ name: 'Firma Gama s.r.o.', ico: '12345679' })
      await waitFor(() => expect(invoice.value.customer.sourceId).toBe(added.id))
      expect(await screen.findByText('Uloženo')).toBeInTheDocument()
    })
  })

  describe('picker', () => {
    it('search "brno" filters to the matching rows', () => {
      setup([saved, beta])
      openPicker()
      expect(options()).toHaveLength(2)
      fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'brno' } })
      expect(options()).toHaveLength(1)
      expect(options()[0]).toHaveTextContent('Příklad s.r.o.')
    })

    it('two entries with the same name show different subtitles; the linked one is checked', () => {
      setup([saved, twin])
      openPicker()
      const [a, b] = options()
      expect(a.querySelector('.ent-row-name')).toHaveTextContent('Příklad s.r.o.')
      expect(b.querySelector('.ent-row-name')).toHaveTextContent('Příklad s.r.o.')
      expect(a.querySelector('.ent-row-sub')).toHaveTextContent('IČO 12345679 · Krátká 5, 602 00 Brno')
      expect(b.querySelector('.ent-row-sub')).toHaveTextContent('IČO 11223344 · Polní 3, 301 00 Plzeň')
      expect(a).toHaveAttribute('data-linked')
      expect(b).not.toHaveAttribute('data-linked')
    })

    it('picking a row loads that entry and closes', () => {
      setup([saved, twin])
      openPicker()
      fireEvent.click(options()[1])
      expect(invoice.value.customer).toEqual(toSnap(twin))
      expect(isSaved.value).toBe(false)
      expect(screen.queryByRole('listbox')).toBeNull()
      expect(field('customer.street').textContent).toBe('Polní 3')
    })

    it('arrow keys and Enter pick a row', () => {
      setup([saved, twin])
      openPicker()
      const input = screen.getByRole('searchbox')
      expect(document.activeElement).toBe(input)
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      expect(options()[1]).toHaveAttribute('aria-selected', 'true')
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(invoice.value.customer).toEqual(toSnap(twin))
      expect(screen.queryByRole('listbox')).toBeNull()
    })

    it('Esc closes without changes', () => {
      setup([saved, twin])
      openPicker()
      fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
      expect(screen.queryByRole('listbox')).toBeNull()
      expect(invoice.value.customer).toEqual(toSnap(saved))
    })

    it('closes when focus leaves it, so its keys stop applying', () => {
      setup([saved, twin])
      openPicker()
      const other = field('customer.city')
      fireEvent.blur(screen.getByRole('searchbox'), { relatedTarget: other })
      expect(screen.queryByRole('listbox')).toBeNull()
      expect(fireEvent.keyDown(other, { key: 'ArrowDown' })).toBe(true) // not captured
    })

    it('payment and text pickers use their own placeholders and footers', () => {
      setup()
      openPicker('payment')
      expect(screen.getByPlaceholderText('Hledat podle účtu nebo banky…')).toBeInTheDocument()
      expect(within(picker()).getByText('＋ Nový platební údaj')).toBeInTheDocument()
      fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
      openPicker('text')
      expect(screen.getByPlaceholderText('Hledat v textech…')).toBeInTheDocument()
      expect(within(picker()).getByText('＋ Nový text')).toBeInTheDocument()
      expect(picker()).toHaveClass('controls')
    })
  })

  describe('when the data file cannot be written', () => {
    const failWrites = () => vi.spyOn(backend(), 'dataSave').mockRejectedValue(new Error('disk full'))

    it('"Uložit změny" shows the error, not "Uloženo", and the section stays edited', async () => {
      setup()
      failWrites()
      type('customer.street', 'Nová 8')
      fireEvent.click(within(section('customer')).getByRole('button', { name: 'Uložit změny' }))
      expect(await screen.findByText(/Data se nepodařilo uložit/)).toBeInTheDocument()
      expect(screen.queryByText('Uloženo')).toBeNull()
      expect(section('customer')).toHaveAttribute('data-state', 'edited')
      expect(savedData.value!.customers).toEqual([saved])
      expect(invoice.value.customer.sourceId).toBe('c1')
    })

    it('"Uložit jako nový" shows the error, not "Uloženo", and the section stays edited', async () => {
      setup()
      failWrites()
      type('customer.street', 'Nová 8')
      fireEvent.click(within(section('customer')).getByRole('button', { name: 'Uložit jako nový' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Přesto uložit' }))
      expect(await screen.findByText(/Data se nepodařilo uložit/)).toBeInTheDocument()
      expect(screen.queryByText('Uloženo')).toBeNull()
      expect(section('customer')).toHaveAttribute('data-state', 'edited')
      expect(savedData.value!.customers).toEqual([saved])
      expect(invoice.value.customer.sourceId).toBe('c1')
    })
  })
})
