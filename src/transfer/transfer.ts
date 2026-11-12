import { savedData, updateSavedData } from '../app/state'
import { findDuplicate, type EntityKind } from '../domain/entities'
import { DEFAULT_SETTINGS, type InvoiceRecord, type InvoiceText, type Party, type Payment, type SavedData } from '../domain/types'
import { forgetLoadedRecord, loadedNumber, refreshTakenNumbers } from '../editor/editorState'
import { plural } from '../history/historyModel'
import { fileName } from '../settings/folderMove'
import { getBackend, type ZipContents } from '../storage/backend'
import { emptySavedData, parseSavedData, saveSavedData } from '../storage/dataStore'
import { listInvoices, parseInvoice, primaryPaths, recordBaseName, recordPaths, resolveInvoiceDir } from '../storage/invoiceStore'
import { importRelName, relativeName } from '../storage/layout'
import { choiceDialog } from '../ui/Dialog'
import { toast } from '../ui/Toast'

/** Start of the error `zip_extract` returns for an existing file that is not meant to be overwritten. */
const CONFLICT_MARKER = 'Konflikt: '
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const lower = (s: string): string => s.toLowerCase()

export type ImportPlan = {
  /** `name` is the base name shared by the invoice's files in the zip (`2026-11_faktura-1` for `2026-11_faktura-1.json` + `.pdf`). */
  invoices: { name: string; number: string; conflict: boolean }[]
  /** PDFs without a usable invoice JSON (file names), minus those whose name already exists in the folder. */
  pdfOnly: string[]
  newEntries: { suppliers: Party[]; customers: Party[]; payments: Payment[]; texts: InvoiceText[] }
  /** Lone PDFs left out because a file of that name is already in the folder. */
  skippedPdfs: number
  /** Saved entries from the zip that are already present (same IČO / account / text, or the same entry from an earlier export). */
  skippedDuplicates: number
}

const jsonBase = (name: string): string => name.slice(0, -'.json'.length)

/** Existing records an imported invoice would clash with: same invoice number, or the same base name (case-insensitive). */
function clashingRecords(base: string, number: string, existing: InvoiceRecord[]): InvoiceRecord[] {
  return existing.filter(r => (r.kind === 'invoice' && r.invoice.number === number) || lower(recordBaseName(r)) === lower(base))
}

function isEntity(v: unknown): v is { id: string } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as { id?: unknown }).id === 'string'
}

/**
 * Adds the incoming entries that are not duplicates of `current` (or of an entry added before them).
 * An entry whose id is taken by a different entry gets a fresh id so ids stay unique.
 */
function mergeEntries<T extends { id: string }>(kind: EntityKind, incoming: unknown[], current: T[]): { added: T[]; skipped: number } {
  const all: T[] = [...current]
  const added: T[] = []
  let skipped = 0
  for (const raw of incoming) {
    if (!isEntity(raw)) continue
    const entry = raw as T
    const sameId = all.find(e => e.id === entry.id)
    const isSameEntry = sameId !== undefined && JSON.stringify(sameId) === JSON.stringify(entry)
    if (isSameEntry || findDuplicate(kind, entry, all)) {
      skipped++
      continue
    }
    const fresh = sameId ? { ...entry, id: crypto.randomUUID() } : entry
    all.push(fresh)
    added.push(fresh)
  }
  return { added, skipped }
}

/** Pure: decides what an import would do. Foreign or malformed JSONs in the zip are ignored and counted nowhere. */
export function planImport(zip: ZipContents, current: SavedData, existing: InvoiceRecord[]): ImportPlan {
  const invoices: ImportPlan['invoices'] = []
  const claimedPdfs = new Set<string>()
  const pdfByLower = new Map(zip.pdfNames.map(n => [lower(n), n]))
  const seenBases = new Set<string>()
  for (const [name, contents] of zip.invoiceJsons) {
    const inv = parseInvoice(contents)
    if (!inv || name.length <= '.json'.length) continue
    const base = jsonBase(name)
    if (seenBases.has(lower(base))) continue
    seenBases.add(lower(base))
    const pdf = pdfByLower.get(lower(`${base}.pdf`))
    if (pdf !== undefined) claimedPdfs.add(pdf)
    invoices.push({ name: base, number: inv.number, conflict: clashingRecords(base, inv.number, existing).length > 0 })
  }

  const existingFiles = new Set(existing.flatMap(r => recordPaths(r).map(p => lower(fileName(p)))))
  const loneNames = zip.pdfNames.filter(n => !claimedPdfs.has(n))
  const pdfOnly = loneNames.filter(n => !existingFiles.has(lower(n)))

  const incoming = zip.dataJson === null ? null : parseSavedData(zip.dataJson)
  const suppliers = mergeEntries<Party>('supplier', incoming?.suppliers ?? [], current.suppliers)
  const customers = mergeEntries<Party>('customer', incoming?.customers ?? [], current.customers)
  const payments = mergeEntries<Payment>('payment', incoming?.payments ?? [], current.payments)
  const texts = mergeEntries<InvoiceText>('text', incoming?.texts ?? [], current.texts)
  return {
    invoices,
    pdfOnly,
    skippedPdfs: loneNames.length - pdfOnly.length,
    newEntries: { suppliers: suppliers.added, customers: customers.added, payments: payments.added, texts: texts.added },
    skippedDuplicates: suppliers.skipped + customers.skipped + payments.skipped + texts.skipped,
  }
}

/** Appends the plan's new entries. Settings are never taken from a backup. */
export function applySavedMerge(current: SavedData, plan: ImportPlan): SavedData {
  const { suppliers, customers, payments, texts } = plan.newEntries
  return {
    ...current,
    suppliers: [...current.suppliers, ...suppliers],
    customers: [...current.customers, ...customers],
    payments: [...current.payments, ...payments],
    texts: [...current.texts, ...texts],
  }
}

export type Choice = 'keep' | 'replace'

export type Extraction = {
  /** Zip entry names (flattened) to extract into the invoice folder (PDFs land in `pdf/`, JSONs in `json/`). */
  names: string[]
  /** The subset of `names` that may replace an existing file: the files of invoices the user chose to replace. */
  overwrite: string[]
  /** Existing records the extraction replaces (their invoices are overwritten or trashed). */
  replaced: InvoiceRecord[]
  /** Files of replaced records that the extraction does not overwrite: same invoice number under another file name, or legacy (0.2.0) files in the folder itself. */
  leftovers: string[]
}

/**
 * Turns the plan and the user's decisions (keyed by `ImportPlan.invoices[].name`) into the extraction. An invoice whose
 * decision is 'keep' is left out; a conflict without a decision is kept, so nothing is overwritten by accident.
 */
export function buildExtraction(plan: ImportPlan, zip: ZipContents, existing: InvoiceRecord[], decisions: ReadonlyMap<string, Choice>, dir: string): Extraction {
  const pdfByLower = new Map(zip.pdfNames.map(n => [lower(n), n]))
  const jsonByBase = new Map(zip.invoiceJsons.map(([n]) => [lower(jsonBase(n)), n]))
  const names: string[] = []
  const overwrite: string[] = []
  const replaced: InvoiceRecord[] = []
  for (const inv of plan.invoices) {
    if (inv.conflict && decisions.get(inv.name) !== 'replace') continue
    const json = jsonByBase.get(lower(inv.name))
    if (json === undefined) continue
    const files = [json]
    const pdf = pdfByLower.get(lower(`${inv.name}.pdf`))
    if (pdf !== undefined) files.push(pdf)
    names.push(...files)
    if (inv.conflict) {
      overwrite.push(...files)
      replaced.push(...clashingRecords(inv.name, inv.number, existing))
    }
  }
  names.push(...plan.pdfOnly)
  // Compared by relative path: a legacy `x.json` is not overwritten by the import's `json/x.json`. A path that cannot be named is never trashed.
  const written = new Set(names.map(n => lower(importRelName(n))))
  const leftovers = [...new Set(replaced.flatMap(recordPaths))].filter(p => {
    const rel = relativeName(dir, p)
    return rel !== null && !written.has(lower(rel))
  })
  return { names, overwrite, replaced, leftovers }
}

/** `faktury-export-YYYY-MM-DD.zip` for the local date of `now`. */
export function exportFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `faktury-export-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.zip`
}

/** Writes every invoice file (JSON + PDF, lone PDFs too) and the saved details into a zip the user picks. Resolves true when written. */
export async function exportAll(): Promise<boolean> {
  const data = savedData.value
  if (!data) return false
  const b = getBackend()
  try {
    const dest = await b.pickSavePath(exportFileName(new Date()))
    if (!dest) return false
    const dir = await resolveInvoiceDir(b, data)
    const records = await listInvoices(b, dir)
    // Paths relative to the folder (`pdf/x.pdf`, legacy `x.pdf`); the zip stores them flat. Older legacy copies that a
    // newer file of the same name shadows are left out, so every file name is in the zip once.
    const files = [...new Set(records.flatMap(primaryPaths).map(p => {
      const rel = relativeName(dir, p)
      if (rel === null) throw new Error(`Neplatný název souboru: ${p}`)
      return rel
    }))]
    await b.exportZip(dir, files, JSON.stringify(data, null, 2), dest)
    toast('Export hotov')
    return true
  } catch (e) {
    toast(`Export se nezdařil: ${message(e)}`, 'error')
    return false
  }
}

const bits = (plan: ImportPlan): string => {
  const e = plan.newEntries
  const parts = [
    plural(plan.invoices.length, 'faktura', 'faktury', 'faktur'),
    plural(e.customers.length, 'odběratel', 'odběratelé', 'odběratelů'),
    plural(e.suppliers.length, 'dodavatel', 'dodavatelé', 'dodavatelů'),
    plural(e.payments.length, 'účet', 'účty', 'účtů'),
    plural(e.texts.length, 'text', 'texty', 'textů'),
  ]
  if (plan.pdfOnly.length > 0) parts.push(plural(plan.pdfOnly.length, 'samostatné PDF', 'samostatná PDF', 'samostatných PDF'))
  return parts.join(', ')
}

function previewBody(plan: ImportPlan): string {
  const conflicts = plan.invoices.filter(i => i.conflict).length
  let body = `Záloha obsahuje: ${bits(plan)}.`
  if (plan.skippedDuplicates > 0) body += ` ${plan.skippedDuplicates} už existuje.`
  if (plan.skippedPdfs > 0) body += ` ${plan.skippedPdfs} PDF přeskočeno (už existuje).`
  if (conflicts > 0) body += ` U ${conflicts} už existujících faktur se stejným číslem se zeptám, kterou ponechat.`
  return body
}

/**
 * What the conflict dialog says. "Faktura N už … je" only fits when the number is unambiguous and the existing record has it;
 * otherwise (a clash by file name only, or several zip invoices with that number) the file is named.
 */
function conflictBody(inv: ImportPlan['invoices'][number], plan: ImportPlan, existing: InvoiceRecord[]): string {
  const sameNumberInZip = plan.invoices.filter(i => i.number === inv.number).length
  const existingHasNumber = clashingRecords(inv.name, inv.number, existing).some(r => r.kind === 'invoice' && r.invoice.number === inv.number)
  if (sameNumberInZip === 1 && existingHasNumber) return `Faktura ${inv.number} už ve složce s fakturami je.`
  return `Soubor ${inv.name}.json ze zálohy (faktura ${inv.number}) koliduje s existujícím souborem ve složce s fakturami.`
}

const isEmptyPlan = (p: ImportPlan): boolean =>
  p.invoices.length === 0 && p.pdfOnly.length === 0 && Object.values(p.newEntries).every(l => l.length === 0)

/**
 * Restores from a backup zip: pick, preview, then extract the invoice files first and merge the saved details afterwards.
 * In onboarding the details are written to a fresh data file instead (and need at least one supplier).
 * Resolves true when something was imported.
 */
export async function importFromZip(opts: { onboarding?: boolean } = {}): Promise<boolean> {
  const onboarding = opts.onboarding === true
  const live = savedData.value
  if (!onboarding && !live) return false
  const b = getBackend()

  let path: string | null
  try { path = await b.pickZip() } catch (e) { toast(`Soubor se nepodařilo vybrat: ${message(e)}`, 'error'); return false }
  if (!path) return false

  let zip: ZipContents
  try {
    zip = await b.zipList(path)
  } catch (e) {
    toast(`Zálohu se nepodařilo načíst: ${message(e)}`, 'error')
    return false
  }
  const zipData = zip.dataJson === null ? null : parseSavedData(zip.dataJson)
  if (zip.dataJson !== null && zipData === null) {
    toast('Soubor s údaji v záloze je poškozený nebo má neznámý formát. Nic se neimportovalo.', 'error')
    return false
  }
  // A restore keeps the backup's preferences, but not its invoice folder: that path may not exist on this machine.
  const current: SavedData = onboarding
    ? { ...emptySavedData(), settings: { ...(zipData?.settings ?? DEFAULT_SETTINGS), invoiceDir: DEFAULT_SETTINGS.invoiceDir } }
    : live!

  let existing: InvoiceRecord[]
  let dir: string
  try {
    dir = await resolveInvoiceDir(b, current)
    existing = await listInvoices(b, dir)
  } catch (e) {
    toast(`Zálohu se nepodařilo načíst: ${message(e)}`, 'error')
    return false
  }

  const plan = planImport(zip, current, existing)
  const merged = applySavedMerge(current, plan)
  if (onboarding && merged.suppliers.length === 0) {
    toast('Záloha neobsahuje údaje dodavatele.', 'error')
    return false
  }
  if (isEmptyPlan(plan)) {
    toast('V záloze není nic nového k importu.', 'warning')
    return false
  }

  const go = await choiceDialog({
    title: 'Importovat ze zálohy',
    body: previewBody(plan),
    choices: [
      { value: 'cancel' as const, label: 'Zrušit' },
      { value: 'import' as const, label: 'Importovat', primary: true },
    ],
  })
  if (go !== 'import') return false

  const decisions = new Map<string, Choice>()
  for (const inv of plan.invoices.filter(i => i.conflict)) {
    const choice = await choiceDialog({
      title: 'Faktura už existuje',
      body: conflictBody(inv, plan, existing),
      choices: [
        { value: 'keep' as const, label: 'Ponechat stávající' },
        { value: 'replace' as const, label: 'Nahradit', primary: true },
      ],
    })
    if (choice === null) return false
    decisions.set(inv.name, choice)
  }

  const { names, overwrite, replaced, leftovers } = buildExtraction(plan, zip, existing, decisions, dir)
  if (names.length === 0 && Object.values(plan.newEntries).every(l => l.length === 0)) {
    toast('Nic se neimportovalo, všechny faktury zůstaly stávající.', 'warning')
    return false
  }
  try {
    if (names.length > 0) await b.zipExtract(path, names, dir, overwrite)
  } catch (e) {
    const msg = message(e)
    toast(
      msg.startsWith(CONFLICT_MARKER)
        // a file the invoice list did not know about (unreadable JSON, or one that appeared meanwhile)
        ? `Import se nezdařil, nic se nezměnilo: ve složce s fakturami už je soubor ${msg.slice(CONFLICT_MARKER.length)}, který aplikace nepoznala jako fakturu. Přejmenujte ho nebo ho odstraňte.`
        : `Import se nezdařil, nic se nezměnilo: ${msg}`,
      'error',
    )
    return false
  }
  if (loadedNumber.value !== null && replaced.some(r => r.kind === 'invoice' && r.invoice.number === loadedNumber.value)) {
    // The editor still shows it, but it is no longer the saved one (same as deleting it in Historie).
    forgetLoadedRecord()
  }
  if (leftovers.length > 0) {
    // Same invoice number under another file name: the replaced copy must not linger next to the new one.
    await b.trash(leftovers).catch(e => toast(`Nahrazenou fakturu se nepodařilo odstranit ze složky: ${message(e)}`, 'warning'))
  }

  let saved = true
  if (onboarding) {
    try {
      await saveSavedData(b, merged)
    } catch (e) {
      toast(`Uložení údajů se nezdařilo: ${message(e)}`, 'error')
      return false
    }
    savedData.value = merged
  } else if (Object.values(plan.newEntries).some(l => l.length > 0)) {
    saved = await updateSavedData(d => applySavedMerge(d, plan))
    if (!saved) toast('Faktury byly naimportovány, ale uložené údaje se nepodařilo zapsat.', 'warning')
  }
  await refreshTakenNumbers()
  if (saved) toast('Import hotov')
  return true
}
