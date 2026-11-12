import { DEFAULT_SETTINGS } from '../domain/types'
import type { SavedData } from '../domain/types'
import type { Backend } from './backend'

export type LoadResult =
  | { status: 'fresh' }
  | { status: 'ok'; data: SavedData; recovered: boolean }
  | { status: 'error'; message: string }

export function emptySavedData(): SavedData {
  return { schemaVersion: 1, suppliers: [], customers: [], payments: [], texts: [], settings: { ...DEFAULT_SETTINGS } }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function normalize(raw: unknown): SavedData | null {
  if (!isRecord(raw) || raw.schemaVersion !== 1) return null
  const { suppliers, customers, payments, texts, settings } = raw
  if (!Array.isArray(suppliers) || !Array.isArray(customers) || !Array.isArray(payments) || !Array.isArray(texts)) return null
  if (settings !== undefined && !isRecord(settings)) return null
  return {
    schemaVersion: 1,
    suppliers: suppliers as SavedData['suppliers'],
    customers: customers as SavedData['customers'],
    payments: payments as SavedData['payments'],
    texts: texts as SavedData['texts'],
    settings: { ...DEFAULT_SETTINGS, ...(settings as Partial<SavedData['settings']> | undefined) },
  }
}

/** Parses and validates the text of a saved-details file (also the one inside a backup zip); null when it is not one. */
export function parseSavedData(json: string): SavedData | null {
  try { return normalize(JSON.parse(json)) } catch { return null }
}

/**
 * Read-only: never writes. When this returns `error`, the caller must not call
 * saveSavedData (the stored file could be overwritten with an empty state).
 */
export async function loadSavedData(b: Backend): Promise<LoadResult> {
  try {
    const r = await b.dataLoad()
    if (r.error !== null) return { status: 'error', message: r.error }
    if (r.contents === null) return { status: 'fresh' }
    let data: SavedData | null
    try { data = normalize(JSON.parse(r.contents)) } catch { data = null }
    if (!data) return { status: 'error', message: 'Soubor s daty má neočekávaný formát' }
    return { status: 'ok', data, recovered: r.recoveredFromBackup }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) }
  }
}

/** Only call from code paths that got `fresh` or `ok` from loadSavedData. */
export async function saveSavedData(b: Backend, d: SavedData): Promise<void> {
  await b.dataSave(JSON.stringify(d, null, 2))
}
