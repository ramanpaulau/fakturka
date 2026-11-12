import type { InvoiceRecord } from '../domain/types'

export const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/**
 * The files of `r` that a folder move carries along. An invoice moves its JSON and PDF; a lone PDF only
 * when it follows the app's `_faktura-` naming, so unrelated PDFs in the folder stay where they are.
 */
export function movableNames(r: InvoiceRecord): string[] {
  const names = r.kind === 'invoice'
    ? [fileName(r.jsonPath), ...(r.pdfPath ? [fileName(r.pdfPath)] : [])]
    : r.fileName.toLowerCase().endsWith('.pdf') && r.fileName.includes('_faktura-') ? [r.fileName] : []
  // The move command only takes plain file names (a colon would be a drive prefix on Windows); such a record stays put.
  return names.some(n => n.includes(':')) ? [] : names
}

/** "Faktura 202611" for an invoice, "Soubor x.pdf" for a lone PDF. */
export function recordLabel(r: InvoiceRecord): string {
  return r.kind === 'invoice' ? `Faktura ${r.invoice.number}` : `Soubor ${r.fileName}`
}

export type MoveConflict = {
  /** The record in the old folder. */
  source: InvoiceRecord
  /** What the move would carry for it. */
  names: string[]
  /** Records in the target that share its invoice number or one of its file names. */
  existing: InvoiceRecord[]
}

/** Records in `from` that clash with records in `to`: same invoice number, or a file name that already exists (case-insensitive). */
export function findMoveConflicts(from: InvoiceRecord[], to: InvoiceRecord[]): MoveConflict[] {
  const out: MoveConflict[] = []
  for (const source of from) {
    const names = movableNames(source)
    if (names.length === 0) continue
    const lower = new Set(names.map(n => n.toLowerCase()))
    const existing = to.filter(t =>
      (source.kind === 'invoice' && t.kind === 'invoice' && t.invoice.number === source.invoice.number) ||
      movableNames(t).some(n => lower.has(n.toLowerCase())) ||
      (t.kind === 'pdfOnly' && lower.has(t.fileName.toLowerCase())))
    if (existing.length > 0) out.push({ source, names, existing })
  }
  return out
}

const recordPaths = (r: InvoiceRecord): string[] =>
  r.kind === 'invoice' ? (r.pdfPath ? [r.jsonPath, r.pdfPath] : [r.jsonPath]) : [r.pdfPath]

export type Decision = { conflict: MoveConflict; choice: 'keep' | 'replace' }

export type MovePlan = {
  /** Every file to move: all movable names except those of records whose target the user kept. */
  names: string[]
  /** The names that may replace an existing target file. */
  overwrite: string[]
  /** Target files to trash after the move: what a replace leaves behind under another file name. */
  leftovers: string[]
}

/**
 * Turns the user's decisions into the move command's arguments. Leftovers are computed once, after all
 * decisions, and never include a file the move writes or a target record the user chose to keep.
 */
export function planMove(fromRecords: InvoiceRecord[], decisions: Decision[]): MovePlan {
  const keptNames = new Set(decisions.filter(d => d.choice === 'keep').flatMap(d => d.conflict.names))
  const keptTargets = new Set(decisions.filter(d => d.choice === 'keep').flatMap(d => d.conflict.existing))
  const names = [...new Set(fromRecords.flatMap(movableNames))].filter(n => !keptNames.has(n))
  const overwrite = [...new Set(decisions.filter(d => d.choice === 'replace').flatMap(d => d.conflict.names))].filter(n => !keptNames.has(n))
  const written = new Set(names.map(n => n.toLowerCase()))
  const leftovers = [...new Set(
    decisions
      .filter(d => d.choice === 'replace')
      .flatMap(d => d.conflict.existing)
      .filter(r => !keptTargets.has(r))
      .flatMap(recordPaths)
      .filter(p => !written.has(fileName(p).toLowerCase())),
  )]
  return { names, overwrite, leftovers }
}

/** Start of the error the Rust command returns when the copies are in the new folder but some originals stayed behind (keep in sync with moves.rs). */
export const PARTIAL_MOVE_MARKER = 'Faktury byly zkopírovány do nové složky'
