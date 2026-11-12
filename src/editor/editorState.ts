import { signal } from '@preact/signals'
import { savedData } from '../app/state'
import { linkBank } from '../domain/banks'
import type { EntityKind } from '../domain/entities'
import { parseCzk } from '../domain/money'
import { newInvoiceFrom } from '../domain/newInvoice'
import type { Invoice } from '../domain/types'
import { FIELD_PATHS } from '../sheet/content'
import { getBackend } from '../storage/backend'
import { emptySavedData } from '../storage/dataStore'
import { listInvoices, resolveInvoiceDir } from '../storage/invoiceStore'

/** The invoice on the sheet. Until `bootEditor` runs it holds a blank placeholder that is never shown. */
export const invoice = signal<Invoice>(newInvoiceFrom(null, emptySavedData(), new Date(), new Set()))
/** false after any edit; true after save (and for a fresh, untouched invoice: nothing to lose). */
export const isSaved = signal(true)
/** Numbers of the saved invoices in the invoice folder. */
export const takenNumbers = signal<Set<string>>(new Set())
/** Number of the saved record the editor shows, or null for an invoice that is not saved yet. */
export const loadedNumber = signal<string | null>(null)
/** true once the first invoice is in place (bootEditor); the editor renders nothing before. */
export const editorReady = signal(false)

function update(next: Invoice) {
  invoice.value = next
  isSaved.value = false
}

/** Sets a text field, e.g. 'customer.street', 'number', 'text.text'; marks the invoice unsaved when it changes. */
export function setField(path: string, value: string): void {
  if (!FIELD_PATHS.has(path)) throw new Error(`Pole ${path} nelze upravit`)
  const inv = invoice.value
  const [section, key] = path.split('.') as [keyof Invoice, string | undefined]
  if (key === undefined) {
    if (inv[section] === value) return
    update({ ...inv, [section]: value })
    return
  }
  const part = inv[section] as unknown as Record<string, string>
  if (part[key] === value) return
  if (path === 'payment.account') {
    update({ ...inv, payment: { ...inv.payment, ...linkBank(inv.payment, { ...inv.payment, account: value }) } })
    return
  }
  update({ ...inv, [section]: { ...part, [key]: value } })
}

/** The snapshot type of each entity section of the invoice. */
export type SectionSnap<K extends EntityKind> = Invoice[K]

const sameSnap = (a: object, b: object): boolean => {
  const ka = Object.keys(a)
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  return ka.length === Object.keys(b).length && ka.every((k) => ra[k] === rb[k])
}

/**
 * Replaces a whole section (fields and `sourceId`): picking a saved entry, "＋ Nový …", Vrátit, relinking after a save.
 * Marks the invoice unsaved unless the snapshot is unchanged.
 */
export function setSnap<K extends EntityKind>(kind: K, snap: SectionSnap<K>): void {
  const inv = invoice.value
  if (sameSnap(inv[kind], snap)) return
  update({ ...inv, [kind]: { ...snap } })
}

/** Parses the amount as typed; anything that is not a whole number of crowns (incl. empty) gives null. */
export function setAmountFromInput(s: string): void {
  const amount = parseCzk(s)
  if (invoice.value.amount === amount) return
  update({ ...invoice.value, amount })
}

export function setIssueDate(iso: string): void {
  if (invoice.value.issueDate !== iso) update({ ...invoice.value, issueDate: iso })
}

export function setDueDate(iso: string): void {
  if (invoice.value.dueDate !== iso) update({ ...invoice.value, dueDate: iso })
}

export function toggleDic(): void {
  update({ ...invoice.value, showDic: !invoice.value.showDic })
}

let session = 0
/**
 * Changes whenever the editor gets another invoice (loadIntoEditor) or loses its saved record (forgetLoadedRecord).
 * Async work compares it before and after awaiting, so a late result never lands on an invoice it was not meant for.
 */
export const editorSession = (): number => session

/** Shows `inv`. `saved` = it is the invoice saved under its number (e.g. opened from Historie). */
export function loadIntoEditor(inv: Invoice, saved: boolean): void {
  session++
  invoice.value = inv
  isSaved.value = saved
  loadedNumber.value = saved ? inv.number : null
}

/**
 * The saved record the editor shows is gone or no longer in the invoice folder (deleted, replaced, folder changed):
 * the sheet stays, but its next save is checked against every record and an open invoice counts as unsaved.
 */
export function forgetLoadedRecord(): void {
  session++
  if (loadedNumber.value === null) return
  loadedNumber.value = null
  isSaved.value = false
}

/** Re-reads the invoice folder into `takenNumbers` (call after save/delete). A folder that can't be read counts as empty. */
export async function refreshTakenNumbers(): Promise<void> {
  const data = savedData.value
  if (!data) return
  try {
    const b = getBackend()
    const records = await listInvoices(b, await resolveInvoiceDir(b, data))
    takenNumbers.value = new Set(records.flatMap(r => (r.kind === 'invoice' ? [r.invoice.number] : [])))
  } catch {
    takenNumbers.value = new Set()
  }
}
