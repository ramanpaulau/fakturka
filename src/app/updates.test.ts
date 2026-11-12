import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const inTauri = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock('./tauriEnv', () => ({ inTauri: () => inTauri() }))

import { downloadUpdateInBackground, installPendingUpdate, pendingUpdate, resetUpdateSession, updateReady } from './updates'

beforeEach(() => {
  invoke.mockReset()
  inTauri.mockReset()
  inTauri.mockReturnValue(true)
  resetUpdateSession()
})

describe('pendingUpdate', () => {
  it('returns null outside Tauri and does not call invoke', async () => {
    inTauri.mockReturnValue(false)
    expect(await pendingUpdate()).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('returns the version when update_pending resolves one', async () => {
    invoke.mockResolvedValue('0.3.0')
    expect(await pendingUpdate()).toBe('0.3.0')
    expect(invoke).toHaveBeenCalledWith('update_pending')
  })

  it('returns null when update_pending resolves null or rejects', async () => {
    invoke.mockResolvedValueOnce(null)
    expect(await pendingUpdate()).toBeNull()
    invoke.mockRejectedValueOnce(new Error('boom'))
    expect(await pendingUpdate()).toBeNull()
  })
})

describe('installPendingUpdate', () => {
  it('invokes update_install_pending and rejects on failure', async () => {
    invoke.mockRejectedValue(new Error('nope'))
    await expect(installPendingUpdate()).rejects.toThrow('nope')
    expect(invoke).toHaveBeenCalledWith('update_install_pending')
  })
})

describe('downloadUpdateInBackground', () => {
  it('calls update_download once even when called twice', () => {
    invoke.mockResolvedValue(null)
    downloadUpdateInBackground()
    downloadUpdateInBackground()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('update_download')
  })

  it('does nothing outside Tauri', () => {
    inTauri.mockReturnValue(false)
    downloadUpdateInBackground()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('swallows a rejection: no throw, no toast', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    invoke.mockRejectedValue(new Error('offline'))
    expect(() => downloadUpdateInBackground()).not.toThrow()
    await new Promise(r => setTimeout(r, 10))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('offline')
  })

  it('swallows a synchronous throw from invoke', () => {
    invoke.mockImplementation(() => { throw new Error('sync') })
    expect(() => downloadUpdateInBackground()).not.toThrow()
  })
})

describe('updateReady', () => {
  const settle = () => new Promise(r => setTimeout(r, 0))

  it('is set to the version update_download resolves', async () => {
    invoke.mockResolvedValue('0.3.0')
    downloadUpdateInBackground()
    await settle()
    expect(updateReady.value).toBe('0.3.0')
  })

  it('stays null when update_download resolves null', async () => {
    invoke.mockResolvedValue(null)
    downloadUpdateInBackground()
    await settle()
    expect(updateReady.value).toBeNull()
  })

  it('stays null when update_download rejects', async () => {
    invoke.mockRejectedValue(new Error('offline'))
    downloadUpdateInBackground()
    await settle()
    expect(updateReady.value).toBeNull()
  })

  it('resetUpdateSession clears it', async () => {
    invoke.mockResolvedValue('0.3.0')
    downloadUpdateInBackground()
    await settle()
    resetUpdateSession()
    expect(updateReady.value).toBeNull()
  })
})
