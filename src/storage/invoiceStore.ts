import type { Invoice, InvoiceRecord, SavedData } from '../domain/types'
import type { Backend } from './backend'

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

export async function listInvoices(b: Backend, dir: string): Promise<InvoiceRecord[]> {
  const entries = await b.listDir(dir)
  const pdfs = new Map<string, string>() // stem -> file name
  for (const e of entries) {
    const s = stem(e.name, '.pdf')
    if (s !== null) pdfs.set(s, e.name)
  }

  const claimed = new Set<string>()
  const invoices: Extract<InvoiceRecord, { kind: 'invoice' }>[] = []
  for (const e of entries) {
    const base = stem(e.name, '.json')
    if (base === null) continue
    let invoice: Invoice | null
    try { invoice = parseInvoice(await b.readText(b.join(dir, e.name))) } catch { invoice = null }
    if (!invoice) continue
    const pdfName = pdfs.get(base)
    if (pdfName !== undefined) claimed.add(pdfName)
    invoices.push({
      kind: 'invoice',
      invoice,
      jsonPath: b.join(dir, e.name),
      pdfPath: pdfName !== undefined ? b.join(dir, pdfName) : null,
      baseName: base,
    })
  }
  invoices.sort((a, c) =>
    c.invoice.issueDate.localeCompare(a.invoice.issueDate) ||
    c.invoice.number.localeCompare(a.invoice.number, undefined, { numeric: true }))

  const pdfOnly: Extract<InvoiceRecord, { kind: 'pdfOnly' }>[] = []
  for (const name of pdfs.values()) {
    if (!claimed.has(name)) pdfOnly.push({ kind: 'pdfOnly', pdfPath: b.join(dir, name), fileName: name })
  }
  pdfOnly.sort((a, c) => a.fileName.localeCompare(c.fileName))

  return [...invoices, ...pdfOnly]
}

export async function resolveInvoiceDir(b: Backend, d: SavedData): Promise<string> {
  return d.settings.invoiceDir ?? (await b.defaultInvoiceDir())
}

export function recordBaseName(r: InvoiceRecord): string {
  return r.kind === 'invoice' ? r.baseName : (stem(r.fileName, '.pdf') ?? r.fileName)
}

export function recordPaths(r: InvoiceRecord): string[] {
  return r.kind === 'invoice' ? (r.pdfPath ? [r.jsonPath, r.pdfPath] : [r.jsonPath]) : [r.pdfPath]
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
 * Writes the PDF+JSON pair, then deletes the files of conflicting records (see findConflict)
 * that are not the pair just written. The caller has already confirmed the overwrite.
 */
export async function saveInvoice(
  b: Backend, dir: string, inv: Invoice, pdf: Uint8Array, existing: InvoiceRecord[],
): Promise<{ replaced: boolean }> {
  const baseName = invoiceBaseName(inv)
  const hit = conflicts(inv, existing)
  await b.writeInvoice(dir, baseName, pdf, JSON.stringify(inv, null, 2))
  // Case-insensitive so that, on a case-insensitive filesystem, we never delete the pair just written.
  const keep = new Set([b.join(dir, `${baseName}.pdf`), b.join(dir, `${baseName}.json`)].map(p => p.toLowerCase()))
  const stale = [...new Set(hit.flatMap(recordPaths))].filter(p => !keep.has(p.toLowerCase()))
  if (stale.length > 0) await b.deletePaths(stale)
  return { replaced: hit.length > 0 }
}

export async function loadInvoice(b: Backend, path: string): Promise<Invoice> {
  const inv = parseInvoice(await b.readText(path))
  if (!inv) throw new Error('Soubor není platná faktura')
  return inv
}
