import type { SavedData, Snap } from './types'

export type EntityKind = 'supplier' | 'customer' | 'payment' | 'text'
export type SectionState = 'matches' | 'edited' | 'new'

/** The SavedData list that holds each kind of entry. */
export const SAVED_LIST = { supplier: 'suppliers', customer: 'customers', payment: 'payments', text: 'texts' } as const satisfies Record<EntityKind, keyof SavedData>

type Fields = Record<string, unknown>

const MIDDLE_DOT = ' · '
const LABEL_TEXT_MAX = 60

const trimmed = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Lower-cases and strips diacritics, for searching. */
export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function toSnap<T extends { id: string }>(e: T): Snap<T> {
  const { id, ...rest } = e
  return { ...rest, sourceId: id } as unknown as Snap<T>
}

function snapFields<T extends { id: string }>(current: Snap<T>): string[] {
  return Object.keys(current).filter((k) => k !== 'sourceId')
}

/** Fields of the snapshot that differ from the saved entry it came from (trimmed). Empty when there is no source. */
export function changedFields<T extends { id: string }>(current: Snap<T>, saved: T[]): (keyof Omit<T, 'id'>)[] {
  const source = saved.find((s) => s.id === current.sourceId)
  if (!source) return []
  const cur = current as unknown as Fields
  const src = source as unknown as Fields
  return snapFields(current).filter((k) => trimmed(cur[k]) !== trimmed(src[k])) as (keyof Omit<T, 'id'>)[]
}

export function sectionState<T extends { id: string }>(current: Snap<T>, saved: T[]): SectionState {
  if (current.sourceId === null || !saved.some((s) => s.id === current.sourceId)) return 'new'
  return changedFields(current, saved).length === 0 ? 'matches' : 'edited'
}

/** Identity key used to detect duplicates; null means the entity can never be a duplicate. */
function identityKey(kind: EntityKind, e: object): string | null {
  const f = e as Fields
  switch (kind) {
    case 'supplier':
    case 'customer': {
      const ico = typeof f.ico === 'string' ? f.ico.replace(/\s+/g, '') : ''
      return ico === '' ? null : ico
    }
    case 'payment':
      return [f.method, f.bank, f.account].map(trimmed).join('\u0000')
    case 'text':
      return trimmed(f.text)
  }
}

/** true when an edit changes what findDuplicate compares (IČO for parties, the payment details, the text). */
export function identityChanged(kind: EntityKind, before: object, after: object): boolean {
  return identityKey(kind, before) !== identityKey(kind, after)
}

export function findDuplicate(kind: EntityKind, candidate: object, list: { id: string }[]): { id: string } | null {
  const key = identityKey(kind, candidate)
  if (key === null) return null
  return list.find((e) => identityKey(kind, e) === key) ?? null
}

const icoPart = (f: Fields): string => (trimmed(f.ico) ? `IČO ${trimmed(f.ico)}` : '')
const join = (parts: string[]): string => parts.filter((p) => p !== '').join(MIDDLE_DOT)

/** Short text for tags. */
export function entityLabel(kind: EntityKind, e: object): string {
  const f = e as Fields
  switch (kind) {
    case 'supplier':
    case 'customer':
      return join([trimmed(f.name), icoPart(f)])
    case 'payment':
      return join([trimmed(f.account), trimmed(f.bank)])
    case 'text': {
      const t = trimmed(f.text)
      return t.length > LABEL_TEXT_MAX ? t.slice(0, LABEL_TEXT_MAX) + '…' : t
    }
  }
}

/** Second line of a picker row. */
export function entitySubtitle(kind: EntityKind, e: object): string {
  const f = e as Fields
  switch (kind) {
    case 'supplier':
    case 'customer':
      return join([icoPart(f), [trimmed(f.street), trimmed(f.city)].filter((p) => p !== '').join(', ')])
    case 'payment':
      return join([trimmed(f.account), trimmed(f.bank)])
    case 'text': {
      // The picker's bold line already shows the first LABEL_TEXT_MAX characters.
      const t = trimmed(f.text)
      return t.length > LABEL_TEXT_MAX ? t : ''
    }
  }
}

export function matchesQuery(_kind: EntityKind, e: object, q: string): boolean {
  const needle = fold(q.trim())
  if (needle === '') return true
  const hay = Object.entries(e as Fields)
    .filter(([k, v]) => k !== 'id' && k !== 'sourceId' && typeof v === 'string')
    .map(([, v]) => fold(v as string))
    .join('\n')
  return hay.includes(needle)
}
