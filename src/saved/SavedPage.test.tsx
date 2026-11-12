import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { savedData } from '../app/state'
import type { Invoice, InvoiceRecord, Party, SavedData } from '../domain/types'
import { getBackend, MemoryBackend } from '../storage/backend'
import { emptySavedData } from '../storage/dataStore'
import { fixtureInvoice } from '../test/fixtures'
import { DialogHost } from '../ui/Dialog'
import { dismissAllToasts, ToastHost } from '../ui/Toast'
import { SavedPage, usageCounts } from './SavedPage'

/** Fake data only. */
const jan: Party = { id: 's1', name: 'Jan Novák', street: 'Dlouhá 12', city: '110 00 Praha', ico: '12345679', dic: 'CZ12345679', note: '' }
const acme: Party = { id: 'c1', name: 'Příklad s.r.o.', street: 'Krátká 5', city: '602 00 Brno', ico: '87654321', dic: 'CZ87654321', note: '' }
const twin: Party = { id: 'c2', name: 'Příklad s.r.o.', street: 'Polní 3', city: '301 00 Plzeň', ico: '11223344', dic: '', note: '' }
const beta: Party = { id: 'c3', name: 'Firma Beta a.s.', street: 'Hlavní 1', city: '702 00 Ostrava', ico: '55667788', dic: '', note: '' }
const pay = { id: 'p1', method: 'Převodem', bank: 'Fiktivní banka', account: '123456789/0100' }
const txt = { id: 't1', text: 'Fakturuji Vám za vývoj softwaru' }

const backend = () => getBackend() as MemoryBackend
const DIR = '/Dokumenty/Faktury'

const data = (over: Partial<SavedData> = {}): SavedData => ({ ...emptySavedData(), suppliers: [jan], customers: [acme, twin, beta], payments: [pay], texts: [txt], ...over })
const persisted = (): SavedData => JSON.parse(backend().dataFile!)

function putInvoice(number: string, ids: { customer?: string | null; supplier?: string | null; payment?: string | null; text?: string | null }) {
  const inv: Invoice = {
    ...fixtureInvoice,
    number,
    supplier: { ...fixtureInvoice.supplier, sourceId: ids.supplier ?? null },
    customer: { ...fixtureInvoice.customer, sourceId: ids.customer ?? null },
    payment: { ...fixtureInvoice.payment, sourceId: ids.payment ?? null },
    text: { ...fixtureInvoice.text, sourceId: ids.text ?? null },
  }
  backend().files.set(`${DIR}/2026-11_faktura-${number}.json`, JSON.stringify(inv))
}

beforeEach(() => {
  backend().files.clear()
  backend().dataFile = null
  backend().bakFile = null
  savedData.value = data()
  dismissAllToasts()
  vi.restoreAllMocks()
})
afterEach(cleanup)

function mount() {
  return render(
    <>
      <SavedPage />
      <DialogHost />
      <ToastHost />
    </>,
  )
}

const tab = (name: RegExp) => screen.getByRole('tab', { name })
const row = (text: string, nth = 0) => screen.getAllByText(text)[nth].closest<HTMLElement>('.sv-row')!
const openRow = (text: string, nth = 0) => fireEvent.click(within(row(text, nth)).getByRole('button', { name: new RegExp(text) }))
const panel = () => screen.getByRole('complementary')
const field = (label: RegExp) => within(panel()).getByLabelText(label) as HTMLInputElement
const type = (label: RegExp, value: string) => fireEvent.input(field(label), { target: { value } })
const button = (name: string) => within(panel()).getByRole('button', { name })

describe('usageCounts', () => {
  const rec = (inv: Invoice): InvoiceRecord => ({ kind: 'invoice', invoice: inv, jsonPath: 'x.json', pdfPath: null, baseName: 'x' })
  const withIds = (s: string | null, c: string | null, p: string | null, t: string | null): Invoice => ({
    ...fixtureInvoice,
    supplier: { ...fixtureInvoice.supplier, sourceId: s },
    customer: { ...fixtureInvoice.customer, sourceId: c },
    payment: { ...fixtureInvoice.payment, sourceId: p },
    text: { ...fixtureInvoice.text, sourceId: t },
  })

  it('counts every snapshot sourceId (supplier, customer, payment, text), ignoring snapshots without one and lone PDFs', () => {
    const counts = usageCounts([
      rec(withIds('s1', 'c1', 'p1', 't1')),
      rec(withIds('s1', 'c1', 'p1', null)),
      rec(withIds('s1', 'c2', null, 't1')),
      rec(withIds(null, null, null, null)),
      { kind: 'pdfOnly', pdfPath: 'a.pdf', fileName: 'a.pdf' },
    ])
    expect(Object.fromEntries(counts)).toEqual({ s1: 3, c1: 2, c2: 1, p1: 2, t1: 2 })
  })

  it('is empty without records', () => {
    expect(usageCounts([]).size).toBe(0)
  })
})

describe('list', () => {
  it('has the four kinds with counts, starting on Dodavatelé', () => {
    mount()
    expect(tab(/Dodavatelé/)).toHaveTextContent('1')
    expect(tab(/Odběratelé/)).toHaveTextContent('3')
    expect(tab(/Platební údaje/)).toHaveTextContent('1')
    expect(tab(/Texty/)).toHaveTextContent('1')
    expect(tab(/Dodavatelé/)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Jan Novák')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Přidat dodavatele/ })).toBeInTheDocument()
  })

  it('lists customers with address subtitles and IČO / DIČ, and the add button follows the kind', () => {
    mount()
    fireEvent.click(tab(/Odběratelé/))
    expect(screen.getAllByText('Příklad s.r.o.')).toHaveLength(2)
    expect(screen.getByText('Krátká 5, 602 00 Brno')).toBeInTheDocument()
    expect(screen.getByText('IČO 87654321 · DIČ CZ87654321')).toBeInTheDocument()
    expect(screen.getByText('IČO 11223344')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Přidat odběratele/ })).toBeInTheDocument()
    fireEvent.click(tab(/Platební údaje/))
    expect(screen.getByText('123456789/0100 · Fiktivní banka')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Přidat platební údaj/ })).toBeInTheDocument()
    fireEvent.click(tab(/Texty/))
    expect(screen.getByText('Fakturuji Vám za vývoj softwaru')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Přidat text/ })).toBeInTheDocument()
  })

  it('search filters the rows, ignoring diacritics, and says when nothing matches', () => {
    mount()
    fireEvent.click(tab(/Odběratelé/))
    const search = screen.getByRole('searchbox', { name: 'Hledat' })
    fireEvent.input(search, { target: { value: 'plzen' } })
    expect(screen.getAllByText('Příklad s.r.o.')).toHaveLength(1)
    expect(screen.queryByText('Firma Beta a.s.')).toBeNull()
    fireEvent.input(search, { target: { value: '55667788' } })
    expect(screen.getByText('Firma Beta a.s.')).toBeInTheDocument()
    fireEvent.input(search, { target: { value: 'nic takového' } })
    expect(screen.getByText('Nic nenalezeno.')).toBeInTheDocument()
  })

  it('shows how many saved invoices use each entry', async () => {
    putInvoice('202611', { customer: 'c1' })
    putInvoice('202610', { customer: 'c1' })
    putInvoice('202609', { customer: 'c2' })
    mount()
    fireEvent.click(tab(/Odběratelé/))
    expect(await screen.findByText('na 2 fakturách')).toBeInTheDocument()
    expect(screen.getByText('na 1 faktuře')).toBeInTheDocument()
    expect(screen.getByText('nepoužito')).toBeInTheDocument()
  })

  it('counts five and more invoices in the same form as two', async () => {
    for (let i = 0; i < 5; i++) putInvoice(`20260${i}`, { customer: 'c1' })
    mount()
    fireEvent.click(tab(/Odběratelé/))
    expect(await screen.findByText('na 5 fakturách')).toBeInTheDocument()
  })

  it('shows an empty list with a hint', () => {
    savedData.value = data({ texts: [] })
    mount()
    fireEvent.click(tab(/Texty/))
    expect(screen.getByText('Zatím tu nejsou žádné texty.')).toBeInTheDocument()
  })
})

describe('editing', () => {
  it('opens the side panel with labelled fields, the IČO hint and the note', () => {
    mount()
    fireEvent.click(tab(/Odběratelé/))
    openRow('Firma Beta a.s.')
    expect(field(/Jméno a příjmení/).value).toBe('Firma Beta a.s.')
    expect(field(/Ulice/).value).toBe('Hlavní 1')
    expect(field(/PSČ a město/).value).toBe('702 00 Ostrava')
    expect(field(/^IČO/).value).toBe('55667788')
    expect(within(panel()).getByText('IČO nemá platný kontrolní součet')).toBeInTheDocument()
    expect(within(panel()).getByText('Změna se projeví jen na nových fakturách. Uložené faktury zůstanou beze změny.')).toBeInTheDocument()
    expect(within(panel()).queryByLabelText(/Doplňující údaj/)).toBeNull() // suppliers only
    expect(row('Firma Beta a.s.')).toHaveClass('sel')
  })

  it('suppliers have "Doplňující údaj"; payments and texts have their own fields', () => {
    mount()
    openRow('Jan Novák')
    expect(within(panel()).getByLabelText(/Doplňující údaj/)).toBeInTheDocument()
    expect(within(panel()).getByText('✓ platné IČO')).toBeInTheDocument()
    fireEvent.click(tab(/Platební údaje/))
    openRow('Převodem')
    expect(field(/Forma úhrady/).value).toBe('Převodem')
    expect(field(/Banka/).value).toBe('Fiktivní banka')
    expect(field(/Číslo účtu/).value).toBe('123456789/0100')
    fireEvent.click(tab(/Texty/))
    openRow('Fakturuji Vám za vývoj softwaru')
    expect(field(/Text/).value).toBe('Fakturuji Vám za vývoj softwaru')
  })

  it('outlines changed fields in amber and enables Uložit only for a change', () => {
    mount()
    fireEvent.click(tab(/Odběratelé/))
    openRow('Firma Beta a.s.')
    expect(button('Uložit')).toBeDisabled()
    expect(panel().querySelector('.changed')).toBeNull()
    type(/Ulice/, 'Nová 8')
    expect(field(/Ulice/).closest('.fld')).toHaveClass('changed')
    expect(field(/PSČ a město/).closest('.fld')).not.toHaveClass('changed')
    expect(button('Uložit')).toBeEnabled()
    type(/Ulice/, 'Hlavní 1')
    expect(panel().querySelector('.changed')).toBeNull()
  })

  it('saving updates the entry in the data file, toasts, and keeps the id', async () => {
    mount()
    fireEvent.click(tab(/Odběratelé/))
    openRow('Firma Beta a.s.')
    type(/Ulice/, '  Nová 8 ')
    fireEvent.click(button('Uložit'))
    expect(await screen.findByText('Uloženo')).toBeInTheDocument()
    const beta2 = persisted().customers.find((c) => c.id === 'c3')!
    expect(beta2).toMatchObject({ name: 'Firma Beta a.s.', street: 'Nová 8', ico: '55667788' })
    expect(persisted().customers).toHaveLength(3)
    expect(screen.getByText('Nová 8, 702 00 Ostrava')).toBeInTheDocument()
    expect(panel().querySelector('.changed')).toBeNull()
  })

  it('saves a payment and a text', async () => {
    mount()
    fireEvent.click(tab(/Platební údaje/))
    openRow('Převodem')
    type(/Banka/, 'Jiná banka')
    fireEvent.click(button('Uložit'))
    await screen.findByText('Uloženo')
    expect(persisted().payments[0]).toEqual({ ...pay, bank: 'Jiná banka' })
    fireEvent.click(tab(/Texty/))
    openRow('Fakturuji Vám za vývoj softwaru')
    type(/Text/, 'Nový text faktury')
    fireEvent.click(button('Uložit'))
    await waitFor(() => expect(persisted().texts[0]).toEqual({ id: 't1', text: 'Nový text faktury' }))
  })

  it('a failed write keeps the panel and the edits, shows the error and no "Uloženo"', async () => {
    mount()
    fireEvent.click(tab(/Odběratelé/))
    openRow('Firma Beta a.s.')
    type(/Ulice/, 'Nová 8')
    vi.spyOn(backend(), 'dataSave').mockRejectedValue(new Error('disk full'))
    fireEvent.click(button('Uložit'))
    expect(await screen.findByText(/Data se nepodařilo uložit/)).toBeInTheDocument()
    expect(screen.queryByText('Uloženo')).toBeNull()
    expect(field(/Ulice/).value).toBe('Nová 8')
    expect(field(/Ulice/).closest('.fld')).toHaveClass('changed')
    expect(savedData.value!.customers.find((c) => c.id === 'c3')!.street).toBe('Hlavní 1')
  })

  it('Zrušit closes the panel without saving', () => {
    mount()
    fireEvent.click(tab(/Odběratelé/))
    openRow('Firma Beta a.s.')
    fireEvent.click(button('Zrušit'))
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(row('Firma Beta a.s.')).not.toHaveClass('sel')
  })

  it('asks before an unsaved edit is dropped by opening another entry', async () => {
    mount()
    fireEvent.click(tab(/Odběratelé/))
    openRow('Firma Beta a.s.')
    type(/Ulice/, 'Nová 8')
    openRow('Příklad s.r.o.', 0)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Zahodit změny?')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zrušit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(field(/Ulice/).value).toBe('Nová 8')
    openRow('Příklad s.r.o.', 0)
    fireEvent.click(await screen.findByRole('button', { name: 'Zahodit' }))
    await waitFor(() => expect(field(/Ulice/).value).toBe('Krátká 5'))
  })
})

describe('editing: duplicate check', () => {
  it('changing the IČO to another entry\'s asks; "Zrušit" writes nothing and keeps the panel', async () => {
    mount()
    fireEvent.click(tab(/Odběratelé/))
    openRow('Firma Beta a.s.')
    type(/^IČO/, '87654321')
    fireEvent.click(button('Uložit'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Už existuje')).toBeInTheDocument()
    expect(within(dialog).getByText('Příklad s.r.o. · IČO 87654321 už je uložen.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Použít ten' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zrušit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(backend().dataFile).toBeNull()
    expect(field(/^IČO/).value).toBe('87654321')
  })

  it('changing the IČO to another entry\'s: "Přesto uložit" saves the edit', async () => {
    mount()
    fireEvent.click(tab(/Odběratelé/))
    openRow('Firma Beta a.s.')
    type(/^IČO/, '87654321')
    fireEvent.click(button('Uložit'))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Přesto uložit' }))
    expect(await screen.findByText('Uloženo')).toBeInTheDocument()
    expect(persisted().customers.find(c => c.id === 'c3')).toMatchObject({ ico: '87654321' })
    expect(persisted().customers).toHaveLength(3)
  })

  it('an edit that keeps the identity key does not ask, even when another entry shares it', async () => {
    savedData.value = data({ customers: [acme, { ...beta, ico: acme.ico }] })
    mount()
    fireEvent.click(tab(/Odběratelé/))
    openRow('Firma Beta a.s.')
    type(/Ulice/, 'Nová 8')
    fireEvent.click(button('Uložit'))
    expect(await screen.findByText('Uloženo')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('changing a payment\'s account or a text onto an existing one asks', async () => {
    savedData.value = data({ payments: [pay, { ...pay, id: 'p2', method: 'Hotově', account: '987654321/0300' }], texts: [txt, { id: 't2', text: 'Děkuji za spolupráci' }] })
    mount()
    fireEvent.click(tab(/Platební údaje/))
    openRow('Hotově')
    type(/Forma úhrady/, pay.method)
    type(/Číslo účtu/, pay.account)
    fireEvent.click(button('Uložit'))
    expect(await screen.findByText('Už existuje')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Zrušit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(tab(/Texty/))
    // the panel still holds the cancelled edit
    fireEvent.click(await screen.findByRole('button', { name: 'Zahodit' }))
    await waitFor(() => expect(tab(/Texty/)).toHaveAttribute('aria-selected', 'true'))
    openRow('Děkuji za spolupráci')
    type(/Text/, txt.text)
    fireEvent.click(button('Uložit'))
    expect(await screen.findByText('Už existuje')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Zrušit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(backend().dataFile).toBeNull()
  })
})

describe('deleting', () => {
  it('the only supplier cannot be deleted: button and menu item are disabled with a reason', () => {
    mount()
    openRow('Jan Novák')
    expect(button('Smazat')).toBeDisabled()
    expect(button('Smazat')).toHaveAttribute('title', 'Musí zůstat alespoň jeden dodavatel')
    fireEvent.click(within(row('Jan Novák')).getByRole('button', { name: 'Další akce' }))
    expect(screen.getByRole('menuitem', { name: /Smazat/ })).toBeDisabled()
  })

  it('with two suppliers one can be deleted', async () => {
    savedData.value = data({ suppliers: [jan, { ...jan, id: 's2', name: 'Eva Svobodová', ico: '' }] })
    mount()
    openRow('Eva Svobodová')
    expect(button('Smazat')).toBeEnabled()
  })

  it('a supplier delete that would leave no supplier (data changed while confirming) changes nothing and says why', async () => {
    const eva = { ...jan, id: 's2', name: 'Eva Svobodová', ico: '' }
    savedData.value = data({ suppliers: [jan, eva] })
    mount()
    openRow('Eva Svobodová')
    fireEvent.click(button('Smazat'))
    const dialog = await screen.findByRole('dialog')
    // e.g. the other supplier was removed meanwhile
    savedData.value = data({ suppliers: [eva] })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Smazat' }))
    expect(await screen.findByText('Musí zůstat alespoň jeden dodavatel')).toBeInTheDocument()
    expect(savedData.value!.suppliers).toEqual([eva])
    expect(backend().dataFile).toBeNull()
    expect(screen.queryByText('Smazáno')).toBeNull()
  })

  it('confirms, removes the entry from the data file and closes the panel', async () => {
    putInvoice('202611', { customer: 'c3' })
    mount()
    fireEvent.click(tab(/Odběratelé/))
    openRow('Firma Beta a.s.')
    fireEvent.click(button('Smazat'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Smazat Firma Beta a.s. · IČO 55667788?')).toBeInTheDocument()
    expect(within(dialog).getByText('Uložené faktury se nezmění.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Smazat' }))
    await waitFor(() => expect(persisted().customers.map((c) => c.id)).toEqual(['c1', 'c2']))
    expect(screen.queryByText('Firma Beta a.s.')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
    // the saved invoice is untouched
    expect(JSON.parse(backend().files.get(`${DIR}/2026-11_faktura-202611.json`) as string).customer.sourceId).toBe('c3')
  })

  it('keeps the entry when the confirmation is cancelled', async () => {
    mount()
    fireEvent.click(tab(/Odběratelé/))
    fireEvent.click(within(row('Firma Beta a.s.')).getByRole('button', { name: 'Další akce' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Smazat/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Zrušit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(savedData.value!.customers).toHaveLength(3)
  })

  it('a failed write keeps the entry and the panel, with no success toast', async () => {
    mount()
    fireEvent.click(tab(/Odběratelé/))
    openRow('Firma Beta a.s.')
    vi.spyOn(backend(), 'dataSave').mockRejectedValue(new Error('disk full'))
    fireEvent.click(button('Smazat'))
    fireEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Smazat' }))
    expect(await screen.findByText(/Data se nepodařilo uložit/)).toBeInTheDocument()
    expect(screen.queryByText('Smazáno')).toBeNull()
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(savedData.value!.customers).toHaveLength(3)
  })
})

describe('adding', () => {
  const addCustomer = (name: string, ico: string) => {
    fireEvent.click(tab(/Odběratelé/))
    fireEvent.click(screen.getByRole('button', { name: /Přidat odběratele/ }))
    type(/Jméno a příjmení/, name)
    type(/^IČO/, ico)
  }

  it('opens an empty panel without Smazat; saving adds an entry with a fresh id', async () => {
    mount()
    addCustomer('Firma Gama s.r.o.', '12345679')
    expect(within(panel()).queryByRole('button', { name: 'Smazat' })).toBeNull()
    fireEvent.click(button('Uložit'))
    expect(await screen.findByText('Uloženo')).toBeInTheDocument()
    const added = persisted().customers
    expect(added).toHaveLength(4)
    expect(added[3]).toMatchObject({ name: 'Firma Gama s.r.o.', ico: '12345679', street: '', dic: '' })
    expect(['c1', 'c2', 'c3']).not.toContain(added[3].id)
    expect(tab(/Odběratelé/)).toHaveTextContent('4')
    // the panel now shows the saved entry
    expect(field(/Jméno a příjmení/).value).toBe('Firma Gama s.r.o.')
    expect(within(panel()).getByText('Firma Gama s.r.o.', { selector: 'h3' })).toBeInTheDocument()
  })

  it('needs a name before Uložit is enabled', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Přidat dodavatele/ }))
    expect(button('Uložit')).toBeDisabled()
    type(/Jméno a příjmení/, 'Eva Svobodová')
    expect(button('Uložit')).toBeEnabled()
  })

  it('an existing IČO asks "Už existuje"; "Přesto uložit" adds it anyway', async () => {
    mount()
    addCustomer('Firma Gama s.r.o.', '87654321')
    fireEvent.click(button('Uložit'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Už existuje')).toBeInTheDocument()
    expect(within(dialog).getByText('Příklad s.r.o. · IČO 87654321 už je uložen.')).toBeInTheDocument()
    expect(backend().dataFile).toBeNull() // nothing written yet
    fireEvent.click(within(dialog).getByRole('button', { name: 'Přesto uložit' }))
    await waitFor(() => expect(persisted().customers).toHaveLength(4))
  })

  it('"Použít ten" adds nothing and opens the saved entry', async () => {
    mount()
    addCustomer('Firma Gama s.r.o.', '87654321')
    fireEvent.click(button('Uložit'))
    fireEvent.click(await screen.findByRole('button', { name: 'Použít ten' }))
    await waitFor(() => expect(field(/Jméno a příjmení/).value).toBe('Příklad s.r.o.'))
    expect(savedData.value!.customers).toHaveLength(3)
  })

  it('closing the dialog cancels the save and keeps the panel as typed', async () => {
    mount()
    addCustomer('Firma Gama s.r.o.', '87654321')
    fireEvent.click(button('Uložit'))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(field(/Jméno a příjmení/).value).toBe('Firma Gama s.r.o.')
    expect(savedData.value!.customers).toHaveLength(3)
  })

  it('a failed write keeps the panel open with the typed values', async () => {
    mount()
    addCustomer('Firma Gama s.r.o.', '12345679')
    vi.spyOn(backend(), 'dataSave').mockRejectedValue(new Error('disk full'))
    fireEvent.click(button('Uložit'))
    expect(await screen.findByText(/Data se nepodařilo uložit/)).toBeInTheDocument()
    expect(screen.queryByText('Uloženo')).toBeNull()
    expect(field(/Jméno a příjmení/).value).toBe('Firma Gama s.r.o.')
    expect(savedData.value!.customers).toHaveLength(3)
  })

  it('adds a payment and a text', async () => {
    mount()
    fireEvent.click(tab(/Platební údaje/))
    fireEvent.click(screen.getByRole('button', { name: /Přidat platební údaj/ }))
    type(/Forma úhrady/, 'Hotově')
    type(/Číslo účtu/, '987654321/0300')
    fireEvent.click(button('Uložit'))
    await screen.findByText('Uloženo')
    expect(persisted().payments[1]).toMatchObject({ method: 'Hotově', bank: 'ČSOB', account: '987654321/0300' }) // bank filled in from the code
    fireEvent.click(tab(/Texty/))
    fireEvent.click(screen.getByRole('button', { name: /Přidat text/ }))
    type(/Text/, 'Děkuji za spolupráci')
    fireEvent.click(button('Uložit'))
    await waitFor(() => expect(persisted().texts.map((t) => t.text)).toEqual([txt.text, 'Děkuji za spolupráci']))
  })
})
