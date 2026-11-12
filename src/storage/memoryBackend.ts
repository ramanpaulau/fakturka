import type { Backend, DataLoadResult, DirEntry, ZipContents } from './backend'

function isValidJson(s: string): boolean {
  try { JSON.parse(s); return true } catch { return false }
}

// Mirrors the Rust limits in zipio.rs.
const MAX_INVOICE_JSON = 5 * 1024 * 1024

const hasExt = (name: string, ext: string) => name.length > ext.length && name.toLowerCase().endsWith(ext)

/** Same rules as Rust `validate_name` + the .json/.pdf restriction of zipio.rs. */
function validInvoiceFile(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\\0:]/.test(name) && (hasExt(name, '.json') || hasExt(name, '.pdf'))
}

/** The flattened name of a `faktury/<name>` zip entry, or null for anything else. */
function invoiceEntryName(entry: string): string | null {
  if (!entry.startsWith('faktury/')) return null
  const name = entry.slice('faktury/'.length)
  return validInvoiceFile(name) ? name : null
}

const DUPLICATE_ZIP = 'Záloha obsahuje duplicitní soubory.'

/** Two `faktury/` entries that flatten to the same name (case-insensitive) make the zip unusable. */
function rejectDuplicates(zip: Map<string, Uint8Array | string>): void {
  const seen = new Set<string>()
  for (const entry of zip.keys()) {
    const name = invoiceEntryName(entry)
    if (name === null) continue
    if (seen.has(name.toLowerCase())) throw new Error(DUPLICATE_ZIP)
    seen.add(name.toLowerCase())
  }
}

const asText = (c: Uint8Array | string) => (typeof c === 'string' ? c : new TextDecoder().decode(c))

/** In-memory Backend for browser dev and tests. Mirrors the Rust commands' load/backup semantics. */
export class MemoryBackend implements Backend {
  files = new Map<string, Uint8Array | string>()
  dataFile: string | null = null
  bakFile: string | null = null
  /** When set, writeInvoice into this directory (or below) rejects without writing anything. */
  failWritesUnder?: string
  /** What pickFolder resolves to (tests set it; null = the dialog was cancelled). */
  pickedFolder: string | null = null
  /** What pickSavePath / pickZip resolve to (null = cancelled). */
  pickedSavePath: string | null = null
  pickedZip: string | null = null
  /** The save dialog's default name, as the last pickSavePath call received it. */
  lastSaveName: string | null = null
  /** "Zip files" by path: entry name (`faktury/a.json`, `faktura-data.json`) to content. Not a real zip; entry names are taken literally. */
  zips = new Map<string, Map<string, Uint8Array | string>>()
  private clock = 0
  private modified = new Map<string, number>()

  async dataLoad(): Promise<DataLoadResult> {
    if (this.dataFile !== null && isValidJson(this.dataFile)) {
      return { contents: this.dataFile, recoveredFromBackup: false, error: null }
    }
    if (this.bakFile !== null && isValidJson(this.bakFile)) {
      return { contents: this.bakFile, recoveredFromBackup: true, error: null }
    }
    if (this.dataFile === null && this.bakFile === null) {
      return { contents: null, recoveredFromBackup: false, error: null }
    }
    return { contents: null, recoveredFromBackup: false, error: 'Nelze načíst soubor s daty ani zálohu' }
  }

  async dataSave(contents: string): Promise<void> {
    if (this.dataFile !== null) this.bakFile = this.dataFile
    this.dataFile = contents
  }

  async dataFilePath(): Promise<string> {
    return '(paměť)/faktura-data.json'
  }

  async defaultInvoiceDir(): Promise<string> {
    return '/Dokumenty/Faktury'
  }

  async writeInvoice(dir: string, baseName: string, pdf: Uint8Array, json: string): Promise<void> {
    if (this.failWritesUnder !== undefined && dir.startsWith(this.failWritesUnder)) {
      throw new Error('Nelze zapsat soubor')
    }
    this.put(this.join(dir, `${baseName}.pdf`), pdf)
    this.put(this.join(dir, `${baseName}.json`), json)
  }

  async listDir(dir: string): Promise<DirEntry[]> {
    const prefix = dir.endsWith('/') ? dir : dir + '/'
    const out: DirEntry[] = []
    for (const [path, content] of this.files) {
      if (!path.startsWith(prefix)) continue
      const name = path.slice(prefix.length)
      if (name === '' || name.includes('/')) continue
      out.push({ name, size: typeof content === 'string' ? content.length : content.length, modifiedMs: this.modified.get(path) ?? 0 })
    }
    return out
  }

  async readText(path: string): Promise<string> {
    const c = this.files.get(path)
    if (c === undefined) throw new Error('Nelze načíst soubor: soubor neexistuje')
    return typeof c === 'string' ? c : new TextDecoder().decode(c)
  }

  async trash(paths: string[]): Promise<void> {
    await this.deletePaths(paths)
  }

  async deletePaths(paths: string[]): Promise<void> {
    for (const p of paths) {
      this.files.delete(p)
      this.modified.delete(p)
    }
  }

  async moveInvoices(from: string, to: string, names: string[], overwrite: string[]): Promise<{ moved: number }> {
    for (const n of [...names, ...overwrite]) {
      if (n === '' || n === '.' || n === '..' || /[/\\\0:]/.test(n)) throw new Error(`Neplatný název souboru: ${n}`)
    }
    const norm = (d: string) => d.replace(/\/+$/, '')
    if (norm(from) === norm(to)) throw new Error('Zdrojová a cílová složka je stejná')
    const unique = [...new Set(names)]
    for (const n of unique) {
      if (!overwrite.includes(n) && this.files.has(this.join(to, n))) throw new Error(`Konflikt: ${n}`)
    }
    // Verify every source first, so a failure leaves both folders as they were.
    for (const n of unique) {
      if (!this.files.has(this.join(from, n))) throw new Error(`Nelze načíst soubor ${this.join(from, n)}`)
    }
    for (const n of unique) {
      this.put(this.join(to, n), this.files.get(this.join(from, n))!)
    }
    await this.deletePaths(unique.map(n => this.join(from, n)))
    return { moved: unique.length }
  }

  async exportZip(dir: string, files: string[], dataJson: string, dest: string): Promise<void> {
    const unique = [...new Set(files)]
    for (const f of unique) {
      if (!validInvoiceFile(f)) throw new Error(`Neplatný název souboru: ${f}`)
    }
    const entries = new Map<string, Uint8Array | string>()
    for (const f of unique) {
      const c = this.files.get(this.join(dir, f))
      if (c === undefined) throw new Error(`Nelze načíst soubor ${this.join(dir, f)}`)
      entries.set(`faktury/${f}`, c)
    }
    entries.set('faktura-data.json', dataJson)
    this.zips.set(dest, entries)
  }

  async zipList(path: string): Promise<ZipContents> {
    const zip = this.zips.get(path)
    if (!zip) throw new Error('Nelze načíst soubor: soubor neexistuje')
    rejectDuplicates(zip)
    const out: ZipContents = { invoiceJsons: [], pdfNames: [], dataJson: null }
    const seen = new Set<string>()
    for (const [entry, content] of zip) {
      if (entry === 'faktura-data.json') { out.dataJson = asText(content); continue }
      const name = invoiceEntryName(entry)
      if (name === null || seen.has(name)) continue
      seen.add(name)
      if (hasExt(name, '.pdf')) out.pdfNames.push(name)
      else if ((typeof content === 'string' ? content.length : content.length) <= MAX_INVOICE_JSON) out.invoiceJsons.push([name, asText(content)])
    }
    return out
  }

  async zipExtract(path: string, names: string[], destDir: string, overwrite: string[]): Promise<void> {
    const unique = [...new Set(names)]
    for (const n of [...unique, ...overwrite]) {
      if (!validInvoiceFile(n)) throw new Error(`Neplatný název souboru: ${n}`)
    }
    const zip = this.zips.get(path)
    if (!zip) throw new Error('Nelze načíst soubor: soubor neexistuje')
    rejectDuplicates(zip)
    for (const n of unique) {
      if (!zip.has(`faktury/${n}`)) throw new Error(`V záloze chybí soubor ${n}`)
    }
    // The file system lookup of the Rust side is case-insensitive on Windows and macOS, so match the same way.
    const existing = new Set([...this.files.keys()].map(k => k.toLowerCase()))
    for (const n of unique) {
      if (!overwrite.includes(n) && existing.has(this.join(destDir, n).toLowerCase())) throw new Error(`Konflikt: ${n}`)
    }
    for (const n of unique) this.put(this.join(destDir, n), zip.get(`faktury/${n}`)!)
  }

  async pickSavePath(defaultName: string): Promise<string | null> {
    this.lastSaveName = defaultName
    return this.pickedSavePath
  }

  async pickZip(): Promise<string | null> {
    return this.pickedZip
  }

  async pickFolder(): Promise<string | null> {
    return this.pickedFolder
  }

  join(dir: string, name: string): string {
    return dir.endsWith('/') ? dir + name : `${dir}/${name}`
  }

  private put(path: string, content: Uint8Array | string): void {
    this.files.set(path, content)
    this.modified.set(path, ++this.clock)
  }
}
