import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { savedData } from '../app/state'
import { isValidIco } from '../domain/ico'
import { DEFAULT_SETTINGS } from '../domain/types'
import type { SavedData } from '../domain/types'
import { getBackend, MemoryBackend } from '../storage/backend'
import { dismissAllToasts, ToastHost } from '../ui/Toast'
import { Onboarding } from './Onboarding'

const backend = () => getBackend() as MemoryBackend

beforeEach(() => {
  backend().dataFile = null
  backend().bakFile = null
  savedData.value = null
  dismissAllToasts()
  vi.restoreAllMocks()
})
afterEach(cleanup)

const fill = (label: RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } })
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Pokračovat' }))
const start = () => fireEvent.click(screen.getByRole('button', { name: /Začít – zadat moje údaje/ }))

function fillStep1(ico = '12345679') {
  fill(/^Jméno a příjmení/, 'Jan Novák')
  fill(/^Ulice a číslo/, 'Dlouhá 12')
  fill(/^PSČ a město/, '110 00 Praha')
  fill(/^IČO/, ico)
}
function fillStep2() {
  fill(/^Banka/, 'Fio banka')
  fill(/^Číslo účtu/, '123456789/2010')
}

describe('welcome', () => {
  it('shows the exact welcome text and the two choices', () => {
    const { container } = render(<Onboarding onDone={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Vítejte ve Fakturce' })).toBeInTheDocument()
    expect(screen.getByText('Jednoduché faktury pro OSVČ. Údaje se ukládají jen v tomto počítači.')).toBeInTheDocument()
    expect(container.textContent).not.toContain('neplátce DPH')
    expect(screen.getByRole('button', { name: /Začít – zadat moje údaje/ })).toBeEnabled()
    const restore = screen.getByRole('button', { name: /Obnovit ze zálohy \(\.zip\)/ })
    expect(restore).toBeEnabled()
  })

  it('"Začít" opens step 1 with all supplier fields and empty inputs', () => {
    render(<Onboarding onDone={() => {}} />)
    start()
    expect(screen.getByText('Vaše údaje')).toBeInTheDocument()
    for (const l of [/^Jméno a příjmení \/ název/, /^Ulice a číslo/, /^PSČ a město/, /^IČO/, /^DIČ \(nepovinné\)/, /^Doplňující údaj \(nepovinné\)/]) {
      expect((screen.getByLabelText(l) as HTMLInputElement).value).toBe('')
    }
    expect(screen.getByLabelText(/^Jméno a příjmení/)).toHaveAttribute('placeholder', 'Jan Novák')
  })
})

describe('wizard navigation', () => {
  it('"Pokračovat" is disabled until the required fields are filled', () => {
    render(<Onboarding onDone={() => {}} />)
    start()
    const btn = screen.getByRole('button', { name: 'Pokračovat' })
    expect(btn).toBeDisabled()
    fill(/^Jméno a příjmení/, 'Jan Novák')
    fill(/^Ulice a číslo/, 'Dlouhá 12')
    fill(/^PSČ a město/, '   ')
    fill(/^IČO/, '12345679')
    expect(btn).toBeDisabled() // whitespace only does not count
    fill(/^PSČ a město/, '110 00 Praha')
    expect(btn).toBeEnabled()
  })

  it('IČO with a bad checksum warns but does not block; a valid IČO confirms', () => {
    render(<Onboarding onDone={() => {}} />)
    start()
    fillStep1('12345678')
    expect(screen.getByText('IČO nemá platný kontrolní součet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeEnabled()
    fill(/^IČO/, '12345679')
    expect(screen.queryByText('IČO nemá platný kontrolní součet')).toBeNull()
    expect(screen.getByText('✓ platné IČO')).toBeInTheDocument()
  })

  it('Zpět returns to the previous step and keeps the typed values', () => {
    render(<Onboarding onDone={() => {}} />)
    start()
    fillStep1()
    next()
    expect(screen.getByText('Bankovní účet')).toBeInTheDocument()
    expect((screen.getByLabelText(/^Forma úhrady/) as HTMLInputElement).value).toBe('Bankovním převodem')
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Zpět' }))
    expect(screen.getByText('Vaše údaje')).toBeInTheDocument()
    expect((screen.getByLabelText(/^Jméno a příjmení/) as HTMLInputElement).value).toBe('Jan Novák')
  })

  it('Zpět on step 1 returns to the welcome screen', () => {
    render(<Onboarding onDone={() => {}} />)
    start()
    fireEvent.click(screen.getByRole('button', { name: 'Zpět' }))
    expect(screen.getByText('Vítejte ve Fakturce')).toBeInTheDocument()
  })

  it('shows a 3-segment progress bar', () => {
    const { container } = render(<Onboarding onDone={() => {}} />)
    start()
    const bar = screen.getByRole('progressbar', { name: 'Krok 1 ze 3' })
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    expect(bar).toHaveAttribute('aria-valuemin', '1')
    expect(bar).toHaveAttribute('aria-valuemax', '3')
    expect(container.querySelectorAll('.ob-steps > span')).toHaveLength(3)
    expect(container.querySelectorAll('.ob-steps > span.on')).toHaveLength(1)
    fillStep1()
    next()
    expect(container.querySelectorAll('.ob-steps > span.on')).toHaveLength(2)
    expect(screen.getByRole('progressbar', { name: 'Krok 2 ze 3' })).toHaveAttribute('aria-valuenow', '2')
  })

  it('the IČO hint is outside the label, describes the input and is announced politely', () => {
    render(<Onboarding onDone={() => {}} />)
    start()
    const ico = screen.getByRole('textbox', { name: 'IČO' })
    fill(/^IČO/, '12345678')
    expect(ico).toHaveAccessibleName('IČO')
    expect(ico).toHaveAccessibleDescription('IČO nemá platný kontrolní součet')
    const hint = screen.getByText('IČO nemá platný kontrolní součet')
    expect(hint.closest('label')).toBeNull()
    expect(hint.closest('[aria-live="polite"]')).not.toBeNull()
    fill(/^IČO/, '12345679')
    expect(ico).toHaveAccessibleDescription('✓ platné IČO')
  })
})

describe('bank account', () => {
  it('the account comes before the bank, and a known code fills in the bank name', () => {
    render(<Onboarding onDone={() => {}} />)
    start()
    fillStep1()
    next()
    const inputs = [...document.querySelectorAll('input')]
    expect(inputs.indexOf(screen.getByLabelText(/^Číslo účtu/) as HTMLInputElement)).toBeLessThan(inputs.indexOf(screen.getByLabelText(/^Banka/) as HTMLInputElement))
    fill(/^Číslo účtu/, '2900123456/5500')
    expect((screen.getByLabelText(/^Banka/) as HTMLInputElement).value).toBe('Raiffeisenbank')
    expect(screen.getByLabelText(/^Banka/)).toHaveAttribute('list')
  })
})

describe('finish', () => {
  async function toStep3() {
    start()
    fillStep1()
    next()
    fillStep2()
    next()
    expect(screen.getByText('První odběratel')).toBeInTheDocument()
  }

  it('saves 1 supplier, 1 payment and 1 customer with default settings, then calls onDone', async () => {
    const onDone = vi.fn()
    render(<Onboarding onDone={onDone} />)
    await toStep3()
    fill(/^Jméno a příjmení \/ název/, 'Příklad s.r.o.')
    fill(/^Ulice a číslo/, 'Krátká 5')
    fill(/^PSČ a město/, '602 00 Brno')
    fill(/^IČO/, '87654321')
    fireEvent.click(screen.getByRole('button', { name: 'Dokončit' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    const data = JSON.parse(backend().dataFile!) as SavedData
    expect(data.suppliers).toHaveLength(1)
    expect(data.suppliers[0]).toMatchObject({ name: 'Jan Novák', street: 'Dlouhá 12', city: '110 00 Praha', ico: '12345679', dic: '', note: '' })
    expect(data.payments).toHaveLength(1)
    expect(data.payments[0]).toMatchObject({ method: 'Bankovním převodem', bank: 'Fio banka', account: '123456789/2010' })
    expect(data.texts.map(t => t.text)).toEqual(['Fakturuji Vám za úklidové a pomocné práce částku oboustranně odsouhlasenou'])
    expect(data.customers).toHaveLength(1)
    expect(data.customers[0]).toMatchObject({ name: 'Příklad s.r.o.', ico: '87654321', note: '' })
    expect(data.settings).toEqual(DEFAULT_SETTINGS)
    const ids = [data.suppliers[0].id, data.payments[0].id, data.customers[0].id]
    expect(new Set(ids).size).toBe(3)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(savedData.value).toEqual(data)
  })

  it('"Přeskočit" saves without a customer', async () => {
    const onDone = vi.fn()
    render(<Onboarding onDone={onDone} />)
    await toStep3()
    fireEvent.click(screen.getByRole('button', { name: 'Přeskočit' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    const data = JSON.parse(backend().dataFile!) as SavedData
    expect(data.suppliers).toHaveLength(1)
    expect(data.payments).toHaveLength(1)
    expect(data.customers).toHaveLength(0)
  })

  it('"Přeskočit" ignores a half-typed customer', async () => {
    const onDone = vi.fn()
    render(<Onboarding onDone={onDone} />)
    await toStep3()
    fill(/^Jméno a příjmení \/ název/, 'Příklad s.r.o.')
    fireEvent.click(screen.getByRole('button', { name: 'Přeskočit' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(JSON.parse(backend().dataFile!).customers).toHaveLength(0)
  })

  it('"Dokončit" stays disabled until the customer name, street and city are filled', async () => {
    render(<Onboarding onDone={() => {}} />)
    await toStep3()
    const done = screen.getByRole('button', { name: 'Dokončit' })
    expect(done).toBeDisabled()
    fill(/^Jméno a příjmení \/ název/, 'Příklad s.r.o.')
    fill(/^Ulice a číslo/, 'Krátká 5')
    fill(/^PSČ a město/, '602 00 Brno')
    expect(done).toBeEnabled() // customer IČO is optional
  })

  it('labels the customer IČO as optional and its example is a checksum-valid fake IČO', async () => {
    render(<Onboarding onDone={() => {}} />)
    await toStep3()
    const ico = screen.getByRole('textbox', { name: 'IČO (nepovinné)' }) as HTMLInputElement
    expect(ico.placeholder).toBe('25596641')
    expect(isValidIco(ico.placeholder)).toBe(true)
  })

  it('keeps the optional supplier fields (DIČ, Doplňující údaj)', async () => {
    const onDone = vi.fn()
    render(<Onboarding onDone={onDone} />)
    start()
    fillStep1()
    fill(/^DIČ/, 'CZ12345679')
    fill(/^Doplňující údaj/, 'Nejsem plátce DPH')
    next()
    fillStep2()
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Přeskočit' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(JSON.parse(backend().dataFile!).suppliers[0]).toMatchObject({ dic: 'CZ12345679', note: 'Nejsem plátce DPH' })
  })

  it('a failed save shows an error toast, keeps the wizard and all inputs, and does not finish', async () => {
    const onDone = vi.fn()
    vi.spyOn(backend(), 'dataSave').mockRejectedValue(new Error('disk plný'))
    render(<><Onboarding onDone={onDone} /><ToastHost /></>)
    await toStep3()
    fireEvent.click(screen.getByRole('button', { name: 'Přeskočit' }))
    expect(await screen.findByText('Uložení se nezdařilo: disk plný')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
    expect(savedData.value).toBeNull()
    expect(screen.getByText('První odběratel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Přeskočit' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Zpět' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zpět' }))
    expect((screen.getByLabelText(/^Jméno a příjmení/) as HTMLInputElement).value).toBe('Jan Novák')
    next()
    expect((screen.getByLabelText(/^Banka/) as HTMLInputElement).value).toBe('Fio banka')
  })
})
