import { savedData } from '../app/state'
import { newInvoiceFrom } from '../domain/newInvoice'
import type { Invoice, InvoiceRecord } from '../domain/types'
import { getBackend } from '../storage/backend'
import { revealItemInDir } from '../history/opener'
import { findConflict, invoicePdfPath, listInvoices, resolveInvoiceDir, saveInvoice } from '../storage/invoiceStore'
import { confirmDialog } from '../ui/Dialog'
import { toast } from '../ui/Toast'
import { editorReady, editorSession, invoice, isSaved, loadedNumber, loadIntoEditor, refreshTakenNumbers, takenNumbers } from './editorState'

/**
 * How Tisknout prints (docs/superpowers/plans/print-decision.md):
 * 'webview' = window.print() of the live sheet (print CSS shows only the A4 sheet);
 * 'pdf-viewer' = open the saved PDF in the system viewer and let the user print from there.
 */
export const PRINT_MODE: 'webview' | 'pdf-viewer' = 'webview'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Path of the PDF written by the last successful save. */
let lastPdfPath: string | null = null

/**
 * Uložit PDF: writes the PDF + JSON pair of the invoice on the sheet into the invoice folder, then shows the PDF in the
 * system file manager. Asks before replacing any saved record other than the one the editor shows. Resolves true when
 * saved; on any failure the editor is left as it was and an error toast is shown (and nothing is revealed).
 */
export function saveCurrent(): Promise<boolean> {
  revealRequested = true
  return runSave()
}

/** The save itself, shared by Uložit PDF and Tisknout. A second call while saving joins the running save instead of writing (and asking) twice. */
function runSave(): Promise<boolean> {
  saving ??= doSave()
    .then(ok => {
      if (ok && revealRequested && lastPdfPath) revealSaved(lastPdfPath)
      return ok
    })
    .finally(() => {
      saving = null
      revealRequested = false
    })
  return saving
}

let saving: Promise<boolean> | null = null
/** Set by Uložit PDF (also when it joins a running save), so only that action reveals the PDF, once per save. */
let revealRequested = false

/** Fire-and-forget: a failure (or the browser build without Tauri) is ignored silently; the save already succeeded. */
function revealSaved(path: string): void {
  Promise.resolve()
    .then(() => revealItemInDir(path))
    .catch(() => {})
}

/**
 * Resolves once no save is running. Anything that replaces the invoice on the sheet awaits it first, so the folder
 * it reads already holds the record being written and the save's result lands on the invoice it saved.
 */
export async function waitForSave(): Promise<void> {
  while (saving) await saving
}

async function doSave(): Promise<boolean> {
  const data = savedData.value
  if (!data) return false
  const inv = invoice.value
  if (inv.number.trim() === '') {
    toast('Zadejte číslo faktury.', 'error')
    return false
  }
  if (inv.amount === null) {
    toast('Zadejte částku.', 'error')
    return false
  }
  const session = editorSession()
  try {
    const b = getBackend()
    const dir = await resolveInvoiceDir(b, data)
    const existing = await listInvoices(b, dir)
    const loaded = loadedNumber.value
    const isLoaded = (r: InvoiceRecord) => r.kind === 'invoice' && loaded !== null && r.invoice.number === loaded
    const other = findConflict(inv, existing.filter(r => !isLoaded(r)))
    if (other) {
      const n = other.kind === 'invoice' ? other.invoice.number : other.fileName
      const ok = await confirmDialog({ title: 'Přepsat fakturu?', body: `Faktura ${n} už existuje. Chcete ji nahradit?`, confirm: 'Přepsat', danger: true })
      if (!ok) return false
    }
    const saved: Invoice = { ...inv, savedAt: new Date().toISOString() }
    // Loaded on first save: pdf-lib + fontkit stay out of the startup bundle.
    const { renderInvoicePdf } = await import('../pdf/renderPdf')
    const pdf = await renderInvoicePdf(saved)
    await saveInvoice(b, dir, saved, pdf, existing)
    lastPdfPath = invoicePdfPath(b, dir, saved)
    if (editorSession() !== session) {
      // Another invoice was loaded (or the folder changed) meanwhile: the record is written, but the sheet is not it.
    } else if (invoice.value === inv) {
      loadIntoEditor(saved, true)
    } else {
      // Edited while saving: the record exists now, but the sheet holds newer, unsaved changes.
      loadedNumber.value = saved.number
    }
    await refreshTakenNumbers()
    toast('Faktura uložena')
    return true
  } catch (e) {
    toast(`Uložení se nezdařilo: ${message(e)}`, 'error')
    return false
  }
}

/** Tisknout: always saves first (incl. the overwrite question); prints only when the save succeeded. */
export function printCurrent(): Promise<void> {
  printing ??= doPrint().finally(() => {
    printing = null
  })
  return printing
}

let printing: Promise<void> | null = null

async function doPrint(): Promise<void> {
  if (!(await runSave())) return
  try {
    if (PRINT_MODE === 'webview') {
      document.body.dataset.printing = '1'
      try {
        // In Tauri on macOS window.print() returns the invoke promise (rejects e.g. without the permission).
        await (window.print() as unknown)
      } finally {
        delete document.body.dataset.printing
      }
    } else if (lastPdfPath) {
      const { openPath } = await import('@tauri-apps/plugin-opener')
      await openPath(lastPdfPath)
      toast('Fakturu vytiskněte z prohlížeče PDF.')
    }
  } catch (e) {
    toast(`Tisk se nezdařil: ${message(e)}`, 'error')
  }
}

/** Replaces the sheet with a fresh invoice copied from the latest saved one (or built from the saved data). */
async function showNewInvoice(): Promise<void> {
  await waitForSave()
  const data = savedData.value
  if (!data) return
  const session = editorSession()
  let records: InvoiceRecord[] = []
  try {
    const b = getBackend()
    records = await listInvoices(b, await resolveInvoiceDir(b, data))
  } catch {
    // A folder that can't be read counts as empty, like refreshTakenNumbers.
  }
  // Another invoice was loaded while listing (e.g. opened from Historie during a slow start): keep it.
  if (editorSession() !== session) return
  const invoices = records.flatMap(r => (r.kind === 'invoice' ? [r.invoice] : []))
  // listInvoices sorts invoice records newest first.
  const last = invoices[0] ?? null
  takenNumbers.value = new Set(invoices.map(i => i.number))
  // A fresh, untouched invoice counts as saved: there is nothing to lose.
  loadIntoEditor(newInvoiceFrom(last, data, new Date(), takenNumbers.value), false)
  isSaved.value = true
}

/** ＋ Nová: asks before discarding unsaved changes, then shows a new invoice. */
export async function startNew(): Promise<void> {
  await waitForSave()
  if (!isSaved.value) {
    const ok = await confirmDialog({ title: 'Zahodit neuloženou fakturu?', body: 'Faktura není uložená. Změny se ztratí.', confirm: 'Zahodit', danger: true })
    if (!ok) return
  }
  await showNewInvoice()
}

let booting: Promise<void> | null = null

/**
 * App start: shows a new invoice without asking. Runs once per app session (needs the saved data),
 * so leaving and re-entering the Faktura tab keeps the edits.
 */
export function bootEditor(): Promise<void> {
  if (editorReady.value) return Promise.resolve()
  if (booting) return booting
  if (!savedData.value) return Promise.resolve()
  booting = showNewInvoice()
    .then(() => {
      editorReady.value = true
    })
    .finally(() => {
      booting = null
    })
  return booting
}

/** Close-window guard: an unsaved invoice asks first; cancelling keeps the window open. */
export async function handleCloseRequest(event: { preventDefault(): void }): Promise<void> {
  if (isSaved.value) return
  const ok = await confirmDialog({ title: 'Zavřít bez uložení?', body: 'Faktura není uložená. Změny se ztratí.', confirm: 'Zavřít', danger: true })
  if (!ok) event.preventDefault()
}

/** Registers the close guard on the Tauri window. No-op outside Tauri (browser dev, tests). Resolves to an unlisten function. */
export async function installCloseGuard(): Promise<() => void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return () => {}
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().onCloseRequested(handleCloseRequest)
}
