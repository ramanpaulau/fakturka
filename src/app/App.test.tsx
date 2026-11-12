import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { fixtureInvoice } from '../test/fixtures'
import { emptySavedData } from '../storage/dataStore'
import { getBackend, MemoryBackend } from '../storage/backend'
import { App } from './App'
import { seedDemo } from './demo'
import { currentTab, savedData } from './state'
import { dismissAllToasts } from '../ui/Toast'
import { editorReady } from '../editor/editorState'

const invoke = vi.fn()
const inTauri = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock('./tauriEnv', () => ({ inTauri: () => inTauri() }))
import { MIN_INSTALL_SCREEN_MS, resetUpdateSession } from './updates'

const backend = () => getBackend() as MemoryBackend

beforeEach(() => {
  backend().dataFile = null
  backend().bakFile = null
  currentTab.value = 'faktura'
  savedData.value = null
  editorReady.value = false
  dismissAllToasts()
  vi.restoreAllMocks()
  invoke.mockReset()
  inTauri.mockReset()
  inTauri.mockReturnValue(false)
  resetUpdateSession()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('App boot', () => {
  it('ok: renders the shell with the editor on the Faktura tab', async () => {
    backend().dataFile = JSON.stringify({ ...emptySavedData(), suppliers: [{ id: 's1', name: 'Jan Novák', street: 'Dlouhá 12', city: '110 00 Praha', ico: '12345679', dic: '', note: '' }] })
    const { container } = render(<App />)
    expect(await screen.findByRole('button', { name: 'Historie' })).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('.sheet[data-mode="edit"]')).not.toBeNull())
    expect(container.textContent).toContain('Jan Novák')
  })

  it('ok: the Nastavení tab shows the settings page', async () => {
    backend().dataFile = JSON.stringify(emptySavedData())
    currentTab.value = 'nastaveni'
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Složka s fakturami' })).toBeInTheDocument()
    expect(screen.queryByText('Připravujeme')).toBeNull()
  })

  it('ok: the Uložené údaje tab shows the saved entries', async () => {
    backend().dataFile = JSON.stringify({ ...emptySavedData(), suppliers: [{ id: 's1', name: 'Jan Novák', street: 'Dlouhá 12', city: '110 00 Praha', ico: '12345679', dic: '', note: '' }] })
    currentTab.value = 'udaje'
    render(<App />)
    expect(await screen.findByRole('tab', { name: /Dodavatelé/ })).toBeInTheDocument()
    expect(screen.getByText('Jan Novák')).toBeInTheDocument()
    expect(screen.queryByText('Připravujeme')).toBeNull()
  })

  it('ok: the Historie tab shows the invoice list', async () => {
    backend().dataFile = JSON.stringify(emptySavedData())
    currentTab.value = 'historie'
    render(<App />)
    expect(await screen.findByRole('searchbox', { name: 'Hledat' })).toBeInTheDocument()
    expect(screen.queryByText('Připravujeme')).toBeNull()
  })

  it('ok + recovered: shows the backup warning toast', async () => {
    backend().dataFile = '{broken'
    backend().bakFile = JSON.stringify(emptySavedData())
    render(<App />)
    expect(await screen.findByText('Data byla obnovena ze zálohy.')).toBeInTheDocument()
  })

  it('fresh: renders the onboarding welcome and no shell', async () => {
    render(<App />)
    expect(await screen.findByText('Vítejte ve Fakturce')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Historie' })).toBeNull()
  })

  it('fresh: finishing onboarding saves, switches to the shell and boots the editor', async () => {
    const { container } = render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Začít – zadat moje údaje/ }))
    const fill = (label: RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } })
    fill(/^Jméno a příjmení/, 'Jan Novák')
    fill(/^Ulice a číslo/, 'Dlouhá 12')
    fill(/^PSČ a město/, '110 00 Praha')
    fill(/^IČO/, '12345679')
    fireEvent.click(screen.getByRole('button', { name: 'Pokračovat' }))
    fill(/^Banka/, 'Fio banka')
    fill(/^Číslo účtu/, '123456789/0100')
    fireEvent.click(screen.getByRole('button', { name: 'Pokračovat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Přeskočit' }))
    expect(await screen.findByRole('button', { name: 'Historie' })).toBeInTheDocument()
    expect(screen.queryByText('Vítejte ve Fakturce')).toBeNull()
    expect(savedData.value?.suppliers[0].name).toBe('Jan Novák')
    expect(JSON.parse(backend().dataFile!).suppliers[0].name).toBe('Jan Novák')
    await waitFor(() => expect(container.querySelector('.sheet[data-mode="edit"]')).not.toBeNull())
    expect(container.textContent).toContain('Jan Novák')
  })

  it('error: renders the full-screen error, no shell, and never saves', async () => {
    backend().dataFile = '{broken'
    backend().bakFile = '{also broken'
    const save = vi.spyOn(backend(), 'dataSave')
    const { container } = render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Nelze načíst soubor s daty ani zálohu')
    expect(await screen.findByText('(paměť)/faktura-data.json')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Historie' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Faktura' })).toBeNull()
    expect(container.querySelector('.sheet')).toBeNull()
    expect(screen.queryByText('Vítejte ve Fakturce')).toBeNull()
    expect(screen.getByText('(paměť)/faktura-data.json')).toBeInTheDocument()
    expect(container).toHaveTextContent('.bak')
    expect(savedData.value).toBeNull()
    expect(save).not.toHaveBeenCalled()
    // give any stray async save a chance to run
    await new Promise(r => setTimeout(r, 20))
    expect(save).not.toHaveBeenCalled()
    expect(backend().dataFile).toBe('{broken')
  })
})

describe('App startup update flow', () => {
  const commands = () => invoke.mock.calls.map(c => c[0])

  function mockCommands(opts: { pending: string | null; install?: 'reject' | 'never'; download?: string | null }) {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'update_pending') return Promise.resolve(opts.pending)
      if (cmd === 'update_install_pending') return opts.install === 'never' ? new Promise(() => {}) : Promise.reject(new Error('install failed'))
      if (cmd === 'update_download') return Promise.resolve(opts.download ?? null)
      return Promise.reject(new Error('unexpected ' + cmd))
    })
  }

  it('startup with a pending update shows the install screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    inTauri.mockReturnValue(true)
    backend().dataFile = JSON.stringify(emptySavedData())
    mockCommands({ pending: '0.3.0', install: 'never' })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Instaluji novou verzi 0.3.0…' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Instalace aktualizace' })).toBeInTheDocument()
    expect(screen.getByText('Aplikace se za chvíli sama znovu spustí.')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_INSTALL_SCREEN_MS) })
    expect(commands()).toContain('update_install_pending')
    await new Promise(r => setTimeout(r, 20))
    expect(screen.queryByRole('button', { name: 'Historie' })).toBeNull()
    expect(screen.queryByText('Vítejte ve Fakturce')).toBeNull()
    expect(commands()).not.toContain('update_download')
  })

  it('startup: the install screen stays visible for MIN_INSTALL_SCREEN_MS before installing', async () => {
    vi.useFakeTimers()
    inTauri.mockReturnValue(true)
    backend().dataFile = JSON.stringify(emptySavedData())
    mockCommands({ pending: '0.3.0', install: 'never' })
    render(<App />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByRole('heading', { name: 'Instaluji novou verzi 0.3.0…' })).toBeInTheDocument()
    expect(commands()).not.toContain('update_install_pending')
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_INSTALL_SCREEN_MS - 1) })
    expect(commands()).not.toContain('update_install_pending')
    expect(screen.getByRole('progressbar', { name: 'Instalace aktualizace' })).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(commands()).toContain('update_install_pending')
  })

  it('a finished background download shows the update banner over the app', async () => {
    inTauri.mockReturnValue(true)
    backend().dataFile = JSON.stringify(emptySavedData())
    mockCommands({ pending: null, download: '0.3.0' })
    render(<App />)
    expect(await screen.findByText('Je připravená nová verze 0.3.0.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Historie' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aktualizovat' })).toBeInTheDocument()
    expect(commands()).not.toContain('update_install_pending')
  })

  it('no update banner on the onboarding screen', async () => {
    inTauri.mockReturnValue(true)
    mockCommands({ pending: null, download: '0.3.0' })
    render(<App />)
    expect(await screen.findByText('Vítejte ve Fakturce')).toBeInTheDocument()
    await waitFor(() => expect(commands()).toContain('update_download'))
    await new Promise(r => setTimeout(r, 20))
    expect(screen.queryByText(/Je připravená nová verze/)).toBeNull()
  })

  it('startup: install fails -> app boots, silently', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    inTauri.mockReturnValue(true)
    mockCommands({ pending: '0.3.0', install: 'reject' })
    render(<App />)
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_INSTALL_SCREEN_MS) })
    expect(await screen.findByText('Vítejte ve Fakturce')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.textContent).not.toContain('install failed')
  })

  it('startup without a pending update boots straight away and downloads once (ok)', async () => {
    inTauri.mockReturnValue(true)
    backend().dataFile = JSON.stringify(emptySavedData())
    mockCommands({ pending: null })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Historie' })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    await waitFor(() => expect(commands().filter(c => c === 'update_download')).toHaveLength(1))
    expect(commands()).not.toContain('update_install_pending')
    expect(commands().indexOf('update_pending')).toBeLessThan(commands().indexOf('update_download'))
  })

  it('startup without a pending update downloads once after a fresh boot', async () => {
    inTauri.mockReturnValue(true)
    mockCommands({ pending: null })
    render(<App />)
    expect(await screen.findByText('Vítejte ve Fakturce')).toBeInTheDocument()
    await waitFor(() => expect(commands().filter(c => c === 'update_download')).toHaveLength(1))
  })

  it('startup: install fails -> an ok boot still downloads once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    inTauri.mockReturnValue(true)
    backend().dataFile = JSON.stringify(emptySavedData())
    mockCommands({ pending: '0.3.0', install: 'reject' })
    render(<App />)
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_INSTALL_SCREEN_MS) })
    expect(await screen.findByRole('button', { name: 'Historie' })).toBeInTheDocument()
    await waitFor(() => expect(commands().filter(c => c === 'update_download')).toHaveLength(1))
    expect(commands().indexOf('update_install_pending')).toBeLessThan(commands().indexOf('update_download'))
  })

  it('downloads once even when the data fails to load (the error screen can still get a fix)', async () => {
    inTauri.mockReturnValue(true)
    backend().dataFile = '{broken'
    backend().bakFile = '{also broken'
    const save = vi.spyOn(backend(), 'dataSave')
    mockCommands({ pending: null })
    render(<App />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await waitFor(() => expect(commands().filter(c => c === 'update_download')).toHaveLength(1))
    expect(save).not.toHaveBeenCalled()
    expect(backend().dataFile).toBe('{broken')
  })

  it('outside Tauri nothing is invoked', async () => {
    render(<App />)
    expect(await screen.findByText('Vítejte ve Fakturce')).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('seedDemo (dev only)', () => {
  it('seeds fake data that loads as ok', async () => {
    await seedDemo(backend())
    const data = JSON.parse(backend().dataFile!)
    expect(data.suppliers[0].name).toBe(fixtureInvoice.supplier.name)
    const { container } = render(<App />)
    expect(await screen.findByRole('button', { name: 'Historie' })).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('.sheet')).not.toBeNull())
  })

  it('can preselect a theme', async () => {
    await seedDemo(backend(), 'dark')
    expect(JSON.parse(backend().dataFile!).settings.theme).toBe('dark')
  })
})
