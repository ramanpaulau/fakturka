import { MemoryBackend } from './memoryBackend'
import { createTauriBackend } from './tauriBackend'

export interface DataLoadResult { contents: string | null; recoveredFromBackup: boolean; error: string | null }
export interface DirEntry { name: string; size: number; modifiedMs: number }
/** What a backup zip holds: invoice JSONs (name + text, flattened from `faktury/`), PDF names and the saved-details JSON. */
export interface ZipContents { invoiceJsons: [string, string][]; pdfNames: string[]; dataJson: string | null }

export interface Backend {
  dataLoad(): Promise<DataLoadResult>
  dataSave(contents: string): Promise<void>
  /** Full path of the main data file (a `.bak` sits next to it). */
  dataFilePath(): Promise<string>
  defaultInvoiceDir(): Promise<string>
  /** Writes `<dir>/pdf/<baseName>.pdf` and `<dir>/json/<baseName>.json` all or nothing, creating the sub-folders as needed. */
  writeInvoice(dir: string, baseName: string, pdf: Uint8Array, json: string): Promise<void>
  listDir(dir: string): Promise<DirEntry[]>
  readText(path: string): Promise<string>
  trash(paths: string[]): Promise<void>
  deletePaths(paths: string[]): Promise<void>
  /**
   * Safe folder move (Rust `move_invoices`): copies + verifies every name, then deletes the originals. Names are paths
   * relative to the folders (`x.pdf`, `pdf/x.pdf`, `json/x.json`; see `isValidRelName` in layout.ts) and keep their relative path.
   * A name that already exists in `to` and is not in `overwrite` rejects with "Konflikt: <name>" before anything is copied.
   */
  moveInvoices(from: string, to: string, names: string[], overwrite: string[]): Promise<{ moved: number }>
  /**
   * Writes a backup zip (Rust `export_zip`): `faktury/<file name>` for every relative name in `files` (read from `dir`, e.g.
   * `pdf/x.pdf` is stored as `faktury/x.pdf`) plus `faktura-data.json`. Two names with one file name reject.
   * Written to a temporary file first, so a failure never leaves a broken or half-replaced zip at `dest`.
   */
  exportZip(dir: string, files: string[], dataJson: string, dest: string): Promise<void>
  /** Lists a backup zip (Rust `zip_list`). Only `faktury/<plain name>.json|.pdf` entries and the root data file count; oversized invoice JSONs are skipped. */
  zipList(path: string): Promise<ZipContents>
  /**
   * Extracts `faktury/<name>` for every name into `destDir` (Rust `zip_extract`), PDFs into `pdf/`, JSONs into `json/`, all or nothing. Names must be plain `.json`/`.pdf`
   * file names that exist in the zip, otherwise it rejects before writing anything. Like `moveInvoices`, a name that already exists in
   * `destDir` (case-insensitive) and is not in `overwrite` rejects with "Konflikt: <name>" before anything is written.
   * A zip with two `faktury/` entries of the same name (case-insensitive) is rejected by `zipList` and `zipExtract`.
   */
  zipExtract(path: string, names: string[], destDir: string, overwrite: string[]): Promise<void>
  /** Folder chooser dialog; null when cancelled. */
  pickFolder(): Promise<string | null>
  /** Save dialog for a zip; null when cancelled. */
  pickSavePath(defaultName: string): Promise<string | null>
  /** Open dialog for a zip; null when cancelled. */
  pickZip(): Promise<string | null>
  join(dir: string, name: string): string
}

let singleton: Backend | null = null

/** Tauri backend inside the desktop shell, otherwise a shared in-memory backend (browser dev, tests). */
export function getBackend(): Backend {
  if (!singleton) {
    singleton = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? createTauriBackend() : new MemoryBackend()
  }
  return singleton
}

export { MemoryBackend }
