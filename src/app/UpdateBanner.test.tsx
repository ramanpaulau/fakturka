import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { DialogHost } from '../ui/Dialog'
import { dismissAllToasts, ToastHost } from '../ui/Toast'
import { isSaved } from '../editor/editorState'

const invoke = vi.fn()
const inTauri = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock('./tauriEnv', () => ({ inTauri: () => inTauri() }))
const waitForSave = vi.fn()
vi.mock('../editor/actions', () => ({ waitForSave: () => waitForSave() }))

import { UpdateBanner } from './UpdateBanner'
import { MIN_INSTALL_SCREEN_MS, resetUpdateSession, updateReady } from './updates'

const commands = () => invoke.mock.calls.map(c => c[0])
const installScreen = () => screen.queryByRole('heading', { name: /Instaluji novou verzi/ })

function renderBanner() {
  return render(
    <>
      <UpdateBanner />
      <DialogHost />
      <ToastHost />
    </>,
  )
}

/** Lets pending promises (and the effects they trigger) run under fake timers. */
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

beforeEach(() => {
  vi.useFakeTimers()
  invoke.mockReset()
  inTauri.mockReset()
  inTauri.mockReturnValue(true)
  resetUpdateSession()
  isSaved.value = true
  dismissAllToasts()
  waitForSave.mockReset()
  waitForSave.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('UpdateBanner', () => {
  it('is hidden without a downloaded version', () => {
    renderBanner()
    expect(screen.queryByText(/Je připravená nová verze/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Aktualizovat' })).toBeNull()
  })

  it('shows the version and both buttons once an update is ready', () => {
    updateReady.value = '0.3.0'
    renderBanner()
    expect(screen.getByText('Je připravená nová verze 0.3.0.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aktualizovat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Později' })).toBeInTheDocument()
    expect(screen.getByText('Je připravená nová verze 0.3.0.').closest('[role="status"]')).not.toBeNull()
  })

  it('Později hides it for the session and installs nothing', async () => {
    updateReady.value = '0.3.0'
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Později' }))
    expect(screen.queryByText(/Je připravená nová verze/)).toBeNull()
    await flush()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('Aktualizovat with a saved invoice shows the install screen, then installs after the minimum time', async () => {
    invoke.mockReturnValue(new Promise(() => {}))
    updateReady.value = '0.3.0'
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Aktualizovat' }))
    await flush()
    expect(installScreen()).toHaveTextContent('Instaluji novou verzi 0.3.0…')
    expect(screen.getByRole('progressbar', { name: 'Instalace aktualizace' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_INSTALL_SCREEN_MS - 1) })
    expect(commands()).not.toContain('update_install_pending')
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(commands()).toEqual(['update_install_pending'])
  })

  it('Aktualizovat is disabled while the install runs (no double start)', async () => {
    invoke.mockReturnValue(new Promise(() => {}))
    updateReady.value = '0.3.0'
    renderBanner()
    const button = screen.getByRole('button', { name: 'Aktualizovat' })
    fireEvent.click(button)
    expect(button).toBeDisabled()
    fireEvent.click(button)
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_INSTALL_SCREEN_MS * 3) })
    expect(commands()).toEqual(['update_install_pending'])
  })

  it('with an unsaved invoice asks first; cancel keeps the banner and calls nothing', async () => {
    isSaved.value = false
    updateReady.value = '0.3.0'
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Aktualizovat' }))
    await flush()
    const dialog = screen.getByRole('dialog', { name: 'Faktura není uložená' })
    expect(dialog).toHaveTextContent('Aktualizace aplikaci restartuje a neuložené změny se ztratí.')
    expect(installScreen()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Zrušit' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_INSTALL_SCREEN_MS * 2) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(installScreen()).toBeNull()
    expect(screen.getByText('Je připravená nová verze 0.3.0.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aktualizovat' })).not.toBeDisabled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('with an unsaved invoice: confirming proceeds to the install', async () => {
    invoke.mockReturnValue(new Promise(() => {}))
    isSaved.value = false
    updateReady.value = '0.3.0'
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Aktualizovat' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Zahodit a aktualizovat' }))
    await flush()
    expect(installScreen()).not.toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_INSTALL_SCREEN_MS) })
    expect(commands()).toEqual(['update_install_pending'])
  })

  it('install rejection: overlay and banner gone, one warning toast', async () => {
    invoke.mockRejectedValue(new Error('install failed'))
    updateReady.value = '0.3.0'
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Aktualizovat' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_INSTALL_SCREEN_MS) })
    await flush()
    expect(installScreen()).toBeNull()
    expect(screen.queryByText(/Je připravená nová verze/)).toBeNull()
    const toasts = screen.getAllByTestId('toast')
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toHaveAttribute('data-kind', 'warning')
    expect(toasts[0]).toHaveTextContent('Aktualizaci se nepodařilo spustit. Zkusím to při příštím spuštění.')
    expect(document.body.textContent).not.toContain('install failed')
  })

  it('waits for a running save before checking whether the invoice is saved', async () => {
    invoke.mockReturnValue(new Promise(() => {}))
    let finishSave!: () => void
    waitForSave.mockReturnValue(new Promise<void>(r => { finishSave = r }))
    isSaved.value = false // the save in progress will mark it saved
    updateReady.value = '0.3.0'
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Aktualizovat' }))
    await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(installScreen()).toBeNull()
    isSaved.value = true
    finishSave()
    await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(installScreen()).not.toBeNull()
  })

  it('waits again for a save that runs during the install screen before installing', async () => {
    invoke.mockReturnValue(new Promise(() => {}))
    updateReady.value = '0.3.0'
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Aktualizovat' }))
    await flush()
    let finishSave!: () => void
    waitForSave.mockReturnValue(new Promise<void>(r => { finishSave = r }))
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_INSTALL_SCREEN_MS * 2) })
    expect(invoke).not.toHaveBeenCalled()
    finishSave()
    await flush()
    expect(commands()).toEqual(['update_install_pending'])
  })

  it('does not install when the invoice became unsaved during the install screen; the banner stays', async () => {
    invoke.mockReturnValue(new Promise(() => {}))
    updateReady.value = '0.3.0'
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Aktualizovat' }))
    await flush()
    expect(installScreen()).not.toBeNull()
    isSaved.value = false
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_INSTALL_SCREEN_MS * 2) })
    expect(invoke).not.toHaveBeenCalled()
    expect(installScreen()).toBeNull()
    expect(screen.getByRole('button', { name: 'Aktualizovat' })).not.toBeDisabled()
  })

  it('a confirmed discard still installs after the install screen', async () => {
    invoke.mockReturnValue(new Promise(() => {}))
    isSaved.value = false
    updateReady.value = '0.3.0'
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Aktualizovat' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Zahodit a aktualizovat' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_INSTALL_SCREEN_MS) })
    await flush()
    expect(commands()).toEqual(['update_install_pending'])
  })

  it('two clicks in the same task start only one install', async () => {
    invoke.mockReturnValue(new Promise(() => {}))
    updateReady.value = '0.3.0'
    renderBanner()
    const button = screen.getByRole('button', { name: 'Aktualizovat' })
    act(() => {
      button.click()
      button.click()
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_INSTALL_SCREEN_MS * 3) })
    expect(waitForSave).toHaveBeenCalledTimes(2) // once before, once after the install screen
    expect(commands()).toEqual(['update_install_pending'])
  })
})
