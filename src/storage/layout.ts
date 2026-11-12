/**
 * Where invoice files live inside the invoice folder. Since 0.2.1 a save writes `pdf/<base>.pdf` and `json/<base>.json`;
 * 0.1.0/0.2.0 wrote both into the folder itself ("legacy"), and those files stay there until the invoice is saved again.
 * Keep in sync with PDF_DIR/JSON_DIR and `validate_rel_name` in src-tauri/src (files.rs, moves.rs).
 */
export const PDF_DIR = 'pdf'
export const JSON_DIR = 'json'

const isPlainName = (n: string): boolean => n !== '' && n !== '.' && n !== '..' && !/[/\\\0:]/.test(n)

/**
 * A name the move/export commands accept: a plain file name (a legacy file in the folder itself) or `pdf/<name>` /
 * `json/<name>` (one lowercase prefix, a forward slash, a plain name). Mirrors Rust `validate_rel_name`.
 */
export function isValidRelName(rel: string): boolean {
  const i = rel.indexOf('/')
  if (i === -1) return isPlainName(rel)
  const sub = rel.slice(0, i)
  return (sub === PDF_DIR || sub === JSON_DIR) && isPlainName(rel.slice(i + 1))
}

/** The file name of a relative name (`pdf/a.pdf` -> `a.pdf`). */
export const flatName = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1)

/**
 * `path` relative to `dir`, as `isValidRelName` expects it (`a.pdf`, `pdf/a.pdf`), or null when `path` is not a file
 * directly in `dir` or in its `pdf`/`json` sub-folder. `path` must have been built from the same `dir` string (as
 * `listInvoices` does), so the prefix comparison is exact; either separator counts.
 */
export function relativeName(dir: string, path: string): string | null {
  const root = dir.replace(/[\\/]+$/, '')
  if (!path.startsWith(root)) return null
  const rest = path.slice(root.length)
  if (!/^[\\/]/.test(rest)) return null
  const parts = rest.slice(1).split(/[\\/]/)
  const rel = parts.length === 1 ? parts[0] : parts.length === 2 && (parts[0] === PDF_DIR || parts[0] === JSON_DIR) ? `${parts[0]}/${parts[1]}` : null
  return rel !== null && isValidRelName(rel) ? rel : null
}

const hasExt = (name: string, ext: string): boolean => name.length > ext.length && name.toLowerCase().endsWith(ext)

/** Sub-folder an imported file goes to (by extension): PDFs to `pdf/`, JSONs to `json/`, anything else stays in the folder. */
export function importSubdir(name: string): string | null {
  return hasExt(name, '.pdf') ? PDF_DIR : hasExt(name, '.json') ? JSON_DIR : null
}

/** Relative name an imported zip file (flat `name`) is written to. */
export const importRelName = (name: string): string => {
  const sub = importSubdir(name)
  return sub === null ? name : `${sub}/${name}`
}
