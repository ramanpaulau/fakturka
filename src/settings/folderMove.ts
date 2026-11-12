import type { InvoiceRecord } from '../domain/types'
import { recordPaths } from '../storage/invoiceStore'
import { relativeName } from '../storage/layout'

export const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/**
 * The files of `r` that a folder move carries along, as names relative to `dir` (the folder `r` was listed from):
 * `pdf/<name>`, `json/<name>` or a plain name for a legacy file in the folder itself. An invoice moves all its files
 * (older legacy copies too); a lone PDF only when it follows the app's `_faktura-` naming, so unrelated PDFs stay.
 */
export function movableNames(r: InvoiceRecord, dir: string): string[] {
  if (r.kind === 'pdfOnly' && !(r.fileName.toLowerCase().endsWith('.pdf') && r.fileName.includes('_faktura-'))) return []
  const names = recordPaths(r).map(p => relativeName(dir, p))
  // The move command only takes valid relative names (a colon would be a drive prefix on Windows); such a record stays put.
  return names.every((n): n is string => n !== null) ? names : []
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

/**
 * Records in `from` (listed from `fromDir`) that clash with records in `to`: same invoice number, or a file name that
 * already exists there (case-insensitive, in whichever of the three places: a legacy `x.pdf` clashes with `pdf/x.pdf`).
 */
export function findMoveConflicts(from: InvoiceRecord[], to: InvoiceRecord[], fromDir: string): MoveConflict[] {
  const out: MoveConflict[] = []
  for (const source of from) {
    const names = movableNames(source, fromDir)
    if (names.length === 0) continue
    const lower = new Set(names.map(n => fileName(n).toLowerCase()))
    const existing = to.filter(t =>
      (source.kind === 'invoice' && t.kind === 'invoice' && t.invoice.number === source.invoice.number) ||
      recordPaths(t).some(p => lower.has(fileName(p).toLowerCase())))
    if (existing.length > 0) out.push({ source, names, existing })
  }
  return out
}

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
export function planMove(fromRecords: InvoiceRecord[], decisions: Decision[], fromDir: string, toDir: string): MovePlan {
  const keptNames = new Set(decisions.filter(d => d.choice === 'keep').flatMap(d => d.conflict.names))
  const keptTargets = new Set(decisions.filter(d => d.choice === 'keep').flatMap(d => d.conflict.existing))
  const names = [...new Set(fromRecords.flatMap(r => movableNames(r, fromDir)))].filter(n => !keptNames.has(n))
  const overwrite = [...new Set(decisions.filter(d => d.choice === 'replace').flatMap(d => d.conflict.names))].filter(n => !keptNames.has(n))
  const written = new Set(names.map(n => n.toLowerCase()))
  const leftovers = [...new Set(
    decisions
      .filter(d => d.choice === 'replace')
      .flatMap(d => d.conflict.existing)
      .filter(r => !keptTargets.has(r))
      .flatMap(recordPaths)
      // A file the move writes over (same relative path) is not a leftover. A path that cannot be named is never trashed.
      .filter(p => {
        const rel = relativeName(toDir, p)
        return rel !== null && !written.has(rel.toLowerCase())
      }),
  )]
  return { names, overwrite, leftovers }
}

/** Start of the error the Rust command returns when the copies are in the new folder but some originals stayed behind (keep in sync with moves.rs). */
export const PARTIAL_MOVE_MARKER = 'Faktury byly zkopírovány do nové složky'
