import { describe, expect, it, vi } from 'vitest'
import { MemoryBackend } from './memoryBackend'
import { emptySavedData, loadSavedData, saveSavedData } from './dataStore'
import { DEFAULT_SETTINGS } from '../domain/types'
import type { SavedData } from '../domain/types'

const sample: SavedData = {
  schemaVersion: 1,
  suppliers: [{ id: 's1', name: 'Jan Novák', street: 'Dlouhá 1', city: '110 00 Praha', ico: '12345679', dic: '', note: '' }],
  customers: [{ id: 'c1', name: 'Příklad s.r.o.', street: 'Krátká 5', city: '602 00 Brno', ico: '12345679', dic: 'CZ12345679', note: '' }],
  payments: [{ id: 'p1', method: 'Bankovní převod', bank: 'Fio banka', account: '123456789/0100' }],
  texts: [{ id: 't1', text: 'Fakturujeme Vám dle dohody.' }],
  settings: { ...DEFAULT_SETTINGS },
}

describe('loadSavedData', () => {
  it('returns fresh when nothing is stored', async () => {
    const b = new MemoryBackend()
    expect(await loadSavedData(b)).toEqual({ status: 'fresh' })
  })

  it('returns ok for a valid file', async () => {
    const b = new MemoryBackend()
    b.dataFile = JSON.stringify(sample)
    expect(await loadSavedData(b)).toEqual({ status: 'ok', data: sample, recovered: false })
  })

  it('fills missing settings with defaults', async () => {
    const b = new MemoryBackend()
    b.dataFile = JSON.stringify({ ...sample, settings: { theme: 'dark' } })
    const r = await loadSavedData(b)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.data.settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' })
  })

  it('reports recovery from the backup', async () => {
    const b = new MemoryBackend()
    b.dataFile = '{broken'
    b.bakFile = JSON.stringify(sample)
    expect(await loadSavedData(b)).toEqual({ status: 'ok', data: sample, recovered: true })
  })

  it('returns error when both files are corrupt, and never saves (Review Focus 1)', async () => {
    const b = new MemoryBackend()
    b.dataFile = '{broken'
    b.bakFile = 'also broken'
    const save = vi.spyOn(b, 'dataSave')
    const r = await loadSavedData(b)
    expect(r.status).toBe('error')
    if (r.status === 'error') expect(r.message.length).toBeGreaterThan(0)
    expect(save).not.toHaveBeenCalled()
    expect(b.dataFile).toBe('{broken')
    expect(b.bakFile).toBe('also broken')
  })

  it('returns error (and does not save) for valid JSON of the wrong shape', async () => {
    const b = new MemoryBackend()
    b.dataFile = JSON.stringify({ schemaVersion: 2, foo: 1 })
    const save = vi.spyOn(b, 'dataSave')
    expect((await loadSavedData(b)).status).toBe('error')
    expect(save).not.toHaveBeenCalled()
  })

  it('returns error when the backend throws', async () => {
    const b = new MemoryBackend()
    vi.spyOn(b, 'dataLoad').mockRejectedValue(new Error('boom'))
    const save = vi.spyOn(b, 'dataSave')
    const r = await loadSavedData(b)
    expect(r.status).toBe('error')
    expect(save).not.toHaveBeenCalled()
  })
})

describe('saveSavedData', () => {
  it('round-trips through the backend and keeps a backup', async () => {
    const b = new MemoryBackend()
    await saveSavedData(b, sample)
    await saveSavedData(b, { ...sample, suppliers: [] })
    expect(b.bakFile).not.toBeNull()
    const r = await loadSavedData(b)
    expect(r).toEqual({ status: 'ok', data: { ...sample, suppliers: [] }, recovered: false })
  })
})

describe('emptySavedData', () => {
  it('has no entities and default settings', () => {
    expect(emptySavedData()).toEqual({ schemaVersion: 1, suppliers: [], customers: [], payments: [], texts: [], settings: DEFAULT_SETTINGS })
  })
})
