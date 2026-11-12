import { signal } from '@preact/signals'
import type { SavedData } from '../domain/types'
import { getBackend } from '../storage/backend'
import { saveSavedData } from '../storage/dataStore'
import { toast } from '../ui/Toast'

export type Tab = 'faktura' | 'historie' | 'udaje' | 'nastaveni'

export const currentTab = signal<Tab>('faktura')
/** null until loadSavedData returned `ok` (or onboarding finished); never set in the error state. */
export const savedData = signal<SavedData | null>(null)

let queue: Promise<unknown> = Promise.resolve()

/**
 * Applies `fn` to the current data, publishes it and persists it. Updates run one after another so
 * the file always reflects the latest state. No-op while nothing is loaded, so the error state can never save.
 * Resolves true once the data is written; false when nothing is loaded or the write failed. A failed write
 * shows an error toast and rolls the signal back (unless a later update replaced it), so the app never shows
 * data that is not on disk as saved.
 */
export function updateSavedData(fn: (d: SavedData) => SavedData): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const current = savedData.value
    if (!current) return false
    const next = fn(current)
    // Nothing changed: nothing to write.
    if (next === current) return true
    savedData.value = next
    try {
      await saveSavedData(getBackend(), next)
      return true
    } catch (e) {
      if (savedData.value === next) savedData.value = current
      toast(`Data se nepodařilo uložit: ${e instanceof Error ? e.message : String(e)}`, 'error')
      return false
    }
  }
  const p = queue.then(run)
  queue = p.catch(() => {})
  return p
}
