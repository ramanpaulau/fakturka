import type { Invoice, InvoiceRecord, SavedData } from '../domain/types'
import type { Backend } from './backend'
import { JSON_DIR, PDF_DIR } from './layout'

function sanitize(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
}

export function invoiceBaseName(inv: Invoice): string {
  return `${inv.issueDate.slice(0, 7)}_faktura-${sanitize(inv.number)}`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseInvoice(json: string): Invoice | null {
  let o: unknown
  try { o = JSON.parse(json) } catch { return null }
  if (!isRecord(o) || o.schemaVersion !== 1) return null
  if (typeof o.number !== 'string' || typeof o.issueDate !== 'string' || typeof o.dueDate !== 'string') return null
  if (!isRecord(o.supplier) || !isRecord(o.customer) || !isRecord(o.payment) || !isRecord(o.text)) return null
  if (typeof o.showDic !== 'boolean') return null
  return {
    ...(o as unknown as Invoice),
    amount: typeof o.amount === 'number' ? o.amount : null,
    savedAt: typeof o.savedAt === 'string' ? o.savedAt : null,
  }
}

const stem = (name: string, ext: string): string | null =>
  name.length > ext.length && name.toLowerCase().endsWith(ext) ? name.slice(0, -ext.length) : null

/** Files with extension `ext` directly in `dir`, by stem. A missing folder lists as empty. */
async function filesByStem(b: Backend, dir: string, ext: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const e of await b.listDir(dir)) {
    const s = stem(e.name, ext)
    if (s !== null) out.set(s, b.join(dir, e.name))
  }
  return out
}

/** Paths of `stem` in the given places, in order of preference; missing ones left out. */
const candidates = (stem: string, ...places: Map<string, string>[]): string[] =>
  places.flatMap(p => (p.has(stem) ? [p.get(stem)!] : []))

const withExtras = <T extends object>(r: T, extra: string[]): T => (extra.length > 0 ? { ...r, extraPaths: extra } : r)

/**
 * Lists the invoice folder: `json/` and `pdf/` (where saves write since 0.2.1) and the folder itself (0.1.0/0.2.0,
 * "legacy"). JSON and PDF pair by base name across all three places; when a base name exists both in a sub-folder and in
 * the folder itself, the sub-folder copy is the one shown and the legacy copy goes into `extraPaths`, so it is one record.
 */
export async function listInvoices(b: Backend, dir: string): Promise<InvoiceRecord[]> {
  const [newJsons, newPdfs, rootJsons, rootPdfs] = await Promise.all([
    filesByStem(b, b.join(dir, JSON_DIR), '.json'),
    filesByStem(b, b.join(dir, PDF_DIR), '.pdf'),
    filesByStem(b, dir, '.json'),
    filesByStem(b, dir, '.pdf'),
  ])

  const claimed = new Set<string>() // PDF stems that belong to an invoice
  const invoices: Extract<InvoiceRecord, { kind: 'invoice' }>[] = []
  for (const base of new Set([...newJsons.keys(), ...rootJsons.keys()])) {
    // The first readable JSON (new before legacy) is the record; any other readable one is an older copy of it.
    const readable: { path: string; invoice: Invoice }[] = []
    for (const path of candidates(base, newJsons, rootJsons)) {
      let invoice: Invoice | null
      try { invoice = parseInvoice(await b.readText(path)) } catch { invoice = null }
      if (invoice) readable.push({ path, invoice })
    }
    if (readable.length === 0) continue
    const pdfs = candidates(base, newPdfs, rootPdfs)
    if (pdfs.length > 0) claimed.add(base)
    invoices.push(withExtras({
      kind: 'invoice' as const,
      invoice: readable[0].invoice,
      jsonPath: readable[0].path,
      pdfPath: pdfs[0] ?? null,
      baseName: base,
    }, [...readable.slice(1).map(r => r.path), ...pdfs.slice(1)]))
  }
  invoices.sort((a, c) =>
    c.invoice.issueDate.localeCompare(a.invoice.issueDate) ||
    c.invoice.number.localeCompare(a.invoice.number, undefined, { numeric: true }))

  const pdfOnly: Extract<InvoiceRecord, { kind: 'pdfOnly' }>[] = []
  for (const base of new Set([...newPdfs.keys(), ...rootPdfs.keys()])) {
    if (claimed.has(base)) continue
    const [pdfPath, ...extra] = candidates(base, newPdfs, rootPdfs)
    pdfOnly.push(withExtras({ kind: 'pdfOnly' as const, pdfPath, fileName: fileNameOf(pdfPath) }, extra))
  }
  pdfOnly.sort((a, c) => a.fileName.localeCompare(c.fileName))

  return [...invoices, ...pdfOnly]
}

const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** Where saving `inv` into `dir` writes its PDF. */
export function invoicePdfPath(b: Backend, dir: string, inv: Invoice): string {
  return b.join(b.join(dir, PDF_DIR), `${invoiceBaseName(inv)}.pdf`)
}

/** Where saving `inv` into `dir` writes its JSON. */
export function invoiceJsonPath(b: Backend, dir: string, inv: Invoice): string {
  return b.join(b.join(dir, JSON_DIR), `${invoiceBaseName(inv)}.json`)
}

export async function resolveInvoiceDir(b: Backend, d: SavedData): Promise<string> {
  return d.settings.invoiceDir ?? (await b.defaultInvoiceDir())
}

export function recordBaseName(r: InvoiceRecord): string {
  return r.kind === 'invoice' ? r.baseName : (stem(r.fileName, '.pdf') ?? r.fileName)
}

/** The files shown for `r` (no older legacy copies). */
export function primaryPaths(r: InvoiceRecord): string[] {
  return r.kind === 'invoice' ? (r.pdfPath ? [r.jsonPath, r.pdfPath] : [r.jsonPath]) : [r.pdfPath]
}

/** Every file of `r`, including older legacy copies of the same file names (see InvoiceRecord). */
export function recordPaths(r: InvoiceRecord): string[] {
  return [...primaryPaths(r), ...(r.extraPaths ?? [])]
}

function conflicts(inv: Invoice, existing: InvoiceRecord[]): InvoiceRecord[] {
  const base = invoiceBaseName(inv).toLowerCase()
  return existing.filter(r =>
    (r.kind === 'invoice' && r.invoice.number === inv.number) || recordBaseName(r).toLowerCase() === base)
}

/**
 * The existing record that saving `inv` would overwrite or replace: an invoice with the same
 * number, or any record (including a lone PDF) whose base name equals the new one, compared
 * case-insensitively (numbers like "2026/11" and "2026-11" sanitise to the same file name).
 */
export function findConflict(inv: Invoice, existing: InvoiceRecord[]): InvoiceRecord | null {
  return conflicts(inv, existing)[0] ?? null
}

/**
 * Writes the PDF+JSON pair (into `pdf/` and `json/`), then deletes the files of conflicting records (see findConflict)
 * that are not the pair just written. The caller has already confirmed the overwrite.
 */
export async function saveInvoice(
  b: Backend, dir: string, inv: Invoice, pdf: Uint8Array, existing: InvoiceRecord[],
): Promise<{ replaced: boolean }> {
  const baseName = invoiceBaseName(inv)
  const hit = conflicts(inv, existing)
  await b.writeInvoice(dir, baseName, pdf, JSON.stringify(inv, null, 2))
  // Case-insensitive so that, on a case-insensitive filesystem, we never delete the pair just written.
  // Legacy files of the replaced record (0.2.0 layout, in the folder itself) are not in it, so they go: see listInvoices.
  const keep = new Set([invoicePdfPath(b, dir, inv), invoiceJsonPath(b, dir, inv)].map(p => p.toLowerCase()))
  const stale = [...new Set(hit.flatMap(recordPaths))].filter(p => !keep.has(p.toLowerCase()))
  if (stale.length > 0) await b.deletePaths(stale)
  return { replaced: hit.length > 0 }
}

export async function loadInvoice(b: Backend, path: string): Promise<Invoice> {
  const inv = parseInvoice(await b.readText(path))
  if (!inv) throw new Error('Soubor není platná faktura')
  return inv
}
