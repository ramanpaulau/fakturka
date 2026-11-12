import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySavedData } from '../storage/dataStore'
import { getBackend, MemoryBackend } from '../storage/backend'
import { savedData, updateSavedData } from './state'

const backend = () => getBackend() as MemoryBackend

beforeEach(() => {
  backend().dataFile = null
  backend().bakFile = null
  savedData.value = null
  vi.restoreAllMocks()
})

describe('updateSavedData', () => {
  it('applies fn, updates the signal and persists', async () => {
    savedData.value = emptySavedData()
    await updateSavedData(d => ({ ...d, settings: { ...d.settings, showDicDefault: false } }))
    expect(savedData.value?.settings.showDicDefault).toBe(false)
    expect(JSON.parse(backend().dataFile!).settings.showDicDefault).toBe(false)
  })

  it('does nothing and never saves while no data is loaded', async () => {
    const save = vi.spyOn(backend(), 'dataSave')
    await updateSavedData(d => ({ ...d, texts: [{ id: 'x', text: 'y' }] }))
    expect(save).not.toHaveBeenCalled()
    expect(savedData.value).toBeNull()
  })

  it('serializes concurrent updates so none is lost', async () => {
    savedData.value = emptySavedData()
    await Promise.all([
      updateSavedData(d => ({ ...d, settings: { ...d.settings, dueRule: { kind: 'daysAfterIssue' as const, days: 7 } } })),
      updateSavedData(d => ({ ...d, settings: { ...d.settings, showDicDefault: false } })),
    ])
    const saved = JSON.parse(backend().dataFile!)
    expect(saved.settings.dueRule).toEqual({ kind: 'daysAfterIssue', days: 7 })
    expect(saved.settings.showDicDefault).toBe(false)
  })

  it('resolves true once the data is written', async () => {
    savedData.value = emptySavedData()
    await expect(updateSavedData(d => ({ ...d, settings: { ...d.settings, dueRule: { kind: 'daysAfterIssue' as const, days: 9 } } }))).resolves.toBe(true)
  })

  it('resolves false while no data is loaded', async () => {
    await expect(updateSavedData(d => d)).resolves.toBe(false)
  })

  it('resolves false when the write fails and rolls the signal back', async () => {
    const before = emptySavedData()
    savedData.value = before
    vi.spyOn(backend(), 'dataSave').mockRejectedValue(new Error('disk full'))
    await expect(updateSavedData(d => ({ ...d, settings: { ...d.settings, dueRule: { kind: 'daysAfterIssue' as const, days: 9 } } }))).resolves.toBe(false)
    expect(savedData.value).toBe(before)
  })
})
