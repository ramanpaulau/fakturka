# Faktura Modernisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old Node/React/Express invoice app with a single-file Tauri 2 desktop app. It's built around an inline-editable A4 invoice, with real PDF output, printing, invoice history, saved details, onboarding, dark mode and zip export/import.

**Architecture:**
- **Frontend:** a Preact + TypeScript frontend (Vite) holds all domain logic as pure, unit-tested modules.
- **Rust side:** thin Tauri commands do what the webview can't do safely: atomic writes, trash, zip, copy-verify-delete moves.
- **One layout source:** a single layout module in millimetres drives both the on-screen sheet (CSS `mm`) and the PDF (pdf-lib), so the two can't drift apart.
- **Browser fallback:** when the app runs outside Tauri (plain `vite dev` in a browser), an in-memory backend is used. That makes the UI testable and lets you take screenshots without the desktop shell.

**Tech Stack:**
- Tauri 2, with the plugins `dialog`, `opener` and `window-state` (optional)
- Rust crates: `zip`, `trash`, `tempfile` (tests)
- Vite, Preact, `@preact/signals`, TypeScript, `lucide-preact`
- `pdf-lib` + `@pdf-lib/fontkit`, Roboto TTF
- Vitest + `@testing-library/preact` + jsdom

**Spec:** `docs/superpowers/specs/2026-11-09-faktura-modernization-design.md`. Read it before any task; section numbers below (§) refer to it. Reference mockups are in `.superpowers/brainstorm/26009-1794258476/content/`: `entity-states-v2.html`, `picker.html`, `history-v3.html`, `range-picker-v2.html`, `saved-details-v2.html`, `onboarding.html`.

## Global Constraints

- **Priority:** the editor is the main focus. Users must be able to do everything from the editor alone. Build order is editor + PDF/print + storage → onboarding → Historie → Uložené údaje → folder move and export/import.
- Czech-only UI strings. The invoice is in Czech.
- **No personal data** anywhere: code, tests, fixtures, docs, screenshots. Use fake data only: "Jan Novák", "Dlouhá 12", "110 00 Praha", "Příklad s.r.o.", "Krátká 5", "602 00 Brno", IČ `12345679` (valid) / `12345678` (invalid), account `123456789/0100`.
- Fully offline; no network at runtime.
- **Windows:** no console window (`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` in `main.rs`).
- **Fixed copy on the sheet:**
  - title **"Faktura"**
  - "Nejsem plátce DPH"
  - section labels: "Dodavatel", "Odběratel", "Platební podmínky", "Forma úhrady:", "Bankovní spojení:", "Číslo účtu:", "Variabilní symbol:", "Datum vystavení:", "Datum splatnosti:", "Cena celkem:", "Podpis", "Razítko"
- Amount format: whole crowns, `42 000,- Kč`, with U+00A0 as the thousands separator and before "Kč".
- Dates on the sheet: `30. 11. 2026`. Dates stored as ISO `YYYY-MM-DD`.
- **Theme:** "Systém / Světlý / Tmavý", default Systém. The A4 sheet, PDF and printout are always white paper with black text.
- **Visual rules:** one 32 px control height, lucide icons only (no emoji), tabular numerals for amounts and dates, one blue accent (`#2563eb`).
- **Saved-details file:** `faktura-data.json` in the Tauri app-data dir, with `schemaVersion: 1`, an atomic write, and a `.bak` of the previous version.
- **Invoice files:** `<YYYY-MM>_faktura-<number>.pdf` + `.json` in the invoice folder, default `<Documents>/Faktury`. Invoice JSON has `schemaVersion: 1`.
- **Commit messages:** a subject line only. No body, no trailers. This is the user's global rule.
- Commits are local only. Never add a remote or push.

## Review Focus

1. **Corrupt or unreadable `faktura-data.json`:**
   - Load `.bak` and show a warning toast.
   - If both are bad, show a blocking error. Never start onboarding over it or overwrite it.
   - Tests: Task 5.
2. **Missing invoice folder** (deleted, or a USB drive removed):
   - Saving recreates the default folder. If the configured folder is unwritable, show an error toast and the invoice stays unsaved, with the editor state intact.
   - Tests: Tasks 5 and 11.
3. **Foreign or malformed `.json` in the invoice folder:**
   - Ignore it in Historie, with no crash. A sibling PDF shows as "jen PDF".
   - Tests: Task 5.
4. **Very long names or invoice text:**
   - Text wraps inside its box on screen and in the PDF, and the PDF stays a single A4 page.
   - Tests: Task 7.
5. **Invoice number with characters invalid in Windows file names** (`2026/11`, `a:b`):
   - The file name is sanitised (`2026-11`, `a-b`), while the number on the invoice stays as typed.
   - Tests: Task 5.

---

## File Structure

```
package.json, vite.config.ts, tsconfig.json, index.html, .gitignore, README.md
src/
  main.tsx                     mounts <App/>
  app/App.tsx                  boot: load data → onboarding | shell
  app/TopBar.tsx               tabs Faktura/Historie/Uložené údaje, theme toggle, Nastavení
  app/theme.ts                 resolveTheme(), applyTheme()
  ui/theme.css                 tokens (light + dark), base styles
  ui/Button.tsx, IconButton.tsx, Toast.tsx, Dialog.tsx, Popover.tsx
  domain/types.ts              Party, Payment, InvoiceText, Settings, SavedData, Invoice, InvoiceRecord
  domain/ico.ts                isValidIco()
  domain/money.ts              formatCzk(), parseCzk()
  domain/dates.ts              defaultIssueDate(), dueDateFor(), addDays(), formatCzDate()
  domain/numbering.ts          suggestNumber(), isNumberTaken()
  domain/entities.ts           sectionState(), findDuplicate(), entityLabel(), entitySubtitle(), matchesQuery()
  domain/newInvoice.ts         newInvoiceFrom()
  storage/backend.ts           Backend interface
  storage/tauriBackend.ts      Backend via invoke()
  storage/memoryBackend.ts     Backend in memory (tests + browser dev)
  storage/dataStore.ts         loadSavedData(), saveSavedData(), emptySavedData()
  storage/invoiceStore.ts      listInvoices(), saveInvoice(), loadInvoice(), invoiceBaseName()
  sheet/layout.ts              A4 regions in mm, mmToPt()
  sheet/Sheet.tsx, sheet.css   paper render (editable | static)
  sheet/EntitySection.tsx      section wrapper: state outline, tag, action buttons
  sheet/EntityPicker.tsx       searchable picker popover
  sheet/DatePopover.tsx        Czech calendar popover
  pdf/wrap.ts                  wrapText()
  pdf/renderPdf.ts             renderInvoicePdf()
  pdf/fonts/Roboto-Regular.ttf, Roboto-Bold.ttf, OFL/LICENSE file
  editor/editorState.ts        signals: current invoice, saved flag, links
  editor/EditorPage.tsx        toolbar + sheet
  editor/actions.ts            saveCurrent(), printCurrent(), startNew()
  onboarding/Onboarding.tsx
  history/historyModel.ts      groupByYear(), filterByRange(), presetRange(), totals()
  history/HistoryPage.tsx, RangePicker.tsx
  saved/SavedPage.tsx
  settings/SettingsPage.tsx
  transfer/transfer.ts         planImport(), applyImport()
src-tauri/
  Cargo.toml, tauri.conf.json, capabilities/default.json, icons/
  src/main.rs, src/lib.rs      command registration
  src/files.rs                 atomic write, data file load/save, list/read, trash
  src/moves.rs                 move_invoices()
  src/zipio.rs                 export_zip(), zip_list(), zip_extract()
```

Tests sit next to their modules as `*.test.ts(x)`. Rust tests go in `#[cfg(test)]` modules.

---

### Task 1: Archive the old app, init git, scaffold Tauri + Vite + Preact

**Files:**
- Delete: `api/`, `client/`, `faktura.bat`, `.DS_Store`
- Create: the root scaffold listed above (`package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src-tauri/**`, `.gitignore`)
- Keep: `README.md` (rewritten in Task 18), `docs/`

**Interfaces:**
- Produces: `npm run dev` (Vite at `http://localhost:1420`), `npm run tauri dev`, `npm test` (Vitest, jsdom), `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 1: Ask the user before deleting.** The old app goes into `~/faktura-legacy-backup.zip`, outside the repo, and is not committed, because it contains personal data. Run `cd .. && zip -rq ~/faktura-legacy-backup.zip faktura -x 'faktura/*/node_modules/*' 'faktura/docs/*' 'faktura/.superpowers/*'`. Then delete `api/ client/ faktura.bat .DS_Store` **only after the user says yes**.
- [ ] **Step 2: Ask the user before installing Rust.** If `rustc` is missing, run `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`, then `source ~/.cargo/env`. Expected: `rustc --version` prints a stable version.
- [ ] **Step 3: Run `git init`.** Write `.gitignore`: `node_modules/`, `dist/`, `src-tauri/target/`, `src-tauri/gen/`, `.superpowers/`, `.DS_Store`, `.env*`, `*.log`.
- [ ] **Step 4: Scaffold.** Use `npm create tauri-app@latest` (template `preact-ts`, identifier `cz.faktura.app`, productName `Faktura`) into a temp dir, then move the files to the root.
  - Add the dev deps `vitest jsdom @testing-library/preact @testing-library/jest-dom` and the deps `@preact/signals lucide-preact pdf-lib @pdf-lib/fontkit @tauri-apps/plugin-dialog @tauri-apps/plugin-opener`.
  - Set the Vitest `environment: 'jsdom'`.
  - In `tauri.conf.json`: window title "Faktura", width 1280, height 900, minWidth 1000.
  - In `main.rs`: the `windows_subsystem` attribute from Global Constraints.
  - Add the Rust deps `tauri-plugin-dialog`, `tauri-plugin-opener`, `zip`, `trash`, `serde`, `serde_json`, and the dev-dep `tempfile`.
- [ ] **Step 5: Add a smoke test.** `src/app/smoke.test.ts` asserts `1 + 1 === 2`. Run `npm test`. Expected: 1 passed.
- [ ] **Step 6: Verify.** Run `npm run build` and `cargo check --manifest-path src-tauri/Cargo.toml`. Expected: both succeed.
- [ ] **Step 7: Commit.** Message: `Scaffold Tauri 2 + Vite + Preact app`

### Task 2: Domain basics (types, IČ, money, dates, numbering)

**Files:**
- Create: `src/domain/types.ts`, `ico.ts`, `money.ts`, `dates.ts`, `numbering.ts`
- Test: each with `*.test.ts`

**Interfaces:**
- Produces (in `types.ts`):
```ts
export type Party = { id: string; name: string; street: string; city: string; ico: string; dic: string; note: string } // note = optional extra supplier line ('' when unused)
export type Payment = { id: string; method: string; bank: string; account: string }
export type InvoiceText = { id: string; text: string }
export type ThemePref = 'system' | 'light' | 'dark'
export type DueRule = { kind: 'dayOfNextMonth'; day: number } | { kind: 'daysAfterIssue'; days: number }
export type Settings = { invoiceDir: string | null; theme: ThemePref; dueRule: DueRule; plusDays: number; showDicDefault: boolean }
export type SavedData = { schemaVersion: 1; suppliers: Party[]; customers: Party[]; payments: Payment[]; texts: InvoiceText[]; settings: Settings }
export type Snap<T> = Omit<T, 'id'> & { sourceId: string | null }
export type Invoice = { schemaVersion: 1; number: string; issueDate: string; dueDate: string; supplier: Snap<Party>; customer: Snap<Party>; payment: Snap<Payment>; text: Snap<InvoiceText>; amount: number | null; showDic: boolean; savedAt: string | null }
export type InvoiceRecord =
  | { kind: 'invoice'; invoice: Invoice; jsonPath: string; pdfPath: string | null; baseName: string }
  | { kind: 'pdfOnly'; pdfPath: string; fileName: string }
export const DEFAULT_SETTINGS: Settings = { invoiceDir: null, theme: 'system', dueRule: { kind: 'dayOfNextMonth', day: 15 }, plusDays: 30, showDicDefault: true }
```
- Produces the functions:
  - `isValidIco(ico: string): boolean`
  - `formatCzk(amount: number): string`
  - `parseCzk(input: string): number | null`
  - `defaultIssueDate(today: Date): string`
  - `dueDateFor(issueDate: string, rule: DueRule): string`
  - `addDays(iso: string, days: number): string`
  - `formatCzDate(iso: string): string`
  - `suggestNumber(issueDate: string, taken: Set<string>): string`
  - `isNumberTaken(n: string, taken: Set<string>): boolean`

- [ ] **Step 1: Write the failing tests.**
```ts
// ico.test.ts
expect(isValidIco('12345679')).toBe(true); expect(isValidIco('00000019')).toBe(true)
expect(isValidIco('12345678')).toBe(false); expect(isValidIco('1234567')).toBe(false); expect(isValidIco('1234567a')).toBe(false)
expect(isValidIco(' 1234 5679 ')).toBe(true) // whitespace ignored
// money.test.ts
expect(formatCzk(42000)).toBe('42 000,- Kč'); expect(formatCzk(8500)).toBe('8 500,- Kč'); expect(formatCzk(0)).toBe('0,- Kč')
expect(parseCzk('42 000')).toBe(42000); expect(parseCzk('42000 Kč')).toBe(42000); expect(parseCzk('42 000,-')).toBe(42000)
expect(parseCzk('')).toBeNull(); expect(parseCzk('abc')).toBeNull()
// dates.test.ts
expect(defaultIssueDate(new Date(2026, 10, 9))).toBe('2026-11-30'); expect(defaultIssueDate(new Date(2026, 1, 3))).toBe('2026-02-28')
expect(dueDateFor('2026-11-30', { kind: 'dayOfNextMonth', day: 15 })).toBe('2026-12-15')
expect(dueDateFor('2026-12-31', { kind: 'dayOfNextMonth', day: 15 })).toBe('2027-01-15') // year rollover
expect(dueDateFor('2026-11-30', { kind: 'daysAfterIssue', days: 14 })).toBe('2026-12-14')
expect(addDays('2026-12-15', 30)).toBe('2027-01-14'); expect(formatCzDate('2026-11-30')).toBe('30. 11. 2026')
// numbering.test.ts
expect(suggestNumber('2026-11-30', new Set())).toBe('202611')
expect(suggestNumber('2026-11-30', new Set(['202611']))).toBe('20261102')
expect(suggestNumber('2026-11-30', new Set(['202611', '20261102']))).toBe('20261103')
```
- [ ] **Step 2: Run the tests.** `npx vitest run src/domain`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - IČ: strip whitespace and require 8 digits. `a = Σ digit[i]·(8−i) for i=0..6 mod 11`. The check digit is `(11 − a) % 10`.
  - `parseCzk`: strip `Kč`, `,-`, spaces and NBSP. Accept digits only, otherwise return `null`.
  - Dates: do all date arithmetic on UTC `Date` objects so time zones can't shift the day.
- [ ] **Step 4: Run the tests again.** `npx vitest run src/domain`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `Add invoice domain basics`

### Task 3: Entity matching, duplicates and the new-invoice factory

**Files:**
- Create: `src/domain/entities.ts`, `src/domain/newInvoice.ts`
- Test: `entities.test.ts`, `newInvoice.test.ts`

**Interfaces:**
- Consumes: the types and functions from Task 2.
- Produces:
```ts
export type EntityKind = 'supplier' | 'customer' | 'payment' | 'text'
export type SectionState = 'matches' | 'edited' | 'new'
export function sectionState<T extends { id: string }>(current: Snap<T>, saved: T[]): SectionState
export function changedFields<T extends { id: string }>(current: Snap<T>, saved: T[]): (keyof Omit<T,'id'>)[]
export function findDuplicate(kind: EntityKind, candidate: object, list: { id: string }[]): { id: string } | null
export function entityLabel(kind: EntityKind, e: object): string     // tag text
export function entitySubtitle(kind: EntityKind, e: object): string  // picker 2nd line
export function matchesQuery(kind: EntityKind, e: object, q: string): boolean
export function newInvoiceFrom(last: Invoice | null, data: SavedData, today: Date, taken: Set<string>): Invoice
export function toSnap<T extends { id: string }>(e: T): Snap<T>
```

- [ ] **Step 1: Write the failing tests.**
  - **`sectionState`:**
    - `'matches'` when `sourceId` points to an entry whose fields are equal after trimming.
    - `'edited'` when the fields differ. In that case `changedFields` returns `['street']`.
    - `'new'` when `sourceId` is null or points to a deleted entry.
  - **`findDuplicate`:**
    - For parties, a match on `ico` with whitespace ignored. An empty `ico` never matches.
    - For payments, a match on method + bank + account.
    - For texts, a match on the trimmed text.
    - `note` is ignored.
  - **`entityLabel`:**
    - customer → `'Příklad s.r.o. · IČ 12345679'`
    - payment → `'123456789/0100 · Fio banka'`
    - text → the first 60 characters + `'…'` when longer
  - **`entitySubtitle`:** customer → `'IČ 12345679 · Krátká 5, 602 00 Brno'`
  - **`matchesQuery`:** case- and diacritics-insensitive. `'brno'` matches `'602 00 Brno'`, and `'prik'` matches `'Příklad'`.
  - **`newInvoiceFrom(last, …)`:** copies supplier, customer, payment, text, amount and showDic, and sets:
    - `number = suggestNumber(...)`
    - `issueDate = defaultIssueDate(today)`
    - `dueDate = dueDateFor(issueDate, settings.dueRule)`
    - `savedAt = null`
  - **`newInvoiceFrom(null, …)`:**
    - supplier from `data.suppliers[0]`
    - customer from `customers[0]`, or empty with `sourceId: null`
    - amount `null`
    - `showDic = settings.showDicDefault`
- [ ] **Step 2: Run the tests.** `npx vitest run src/domain`. Expected: FAIL.
- [ ] **Step 3: Implement** in `entities.ts` and `newInvoice.ts`. For diacritics, use `s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: `Add entity matching and new-invoice factory`

### Task 4: Rust file commands

**Files:**
- Create: `src-tauri/src/files.rs`
- Modify: `src-tauri/src/lib.rs` (register commands and plugins)
- Modify: `src-tauri/capabilities/default.json` (`dialog:default`, `opener:default`, plus opener permission to open/reveal paths)

**Interfaces:**
- Produces the Tauri commands. All errors are `String` with a Czech message.
```rust
#[tauri::command] fn data_load(app: AppHandle) -> Result<DataLoad, String>            // DataLoad { contents: Option<String>, recovered_from_backup: bool, error: Option<String> }
#[tauri::command] fn data_save(app: AppHandle, contents: String) -> Result<(), String> // atomic + .bak
#[tauri::command] fn default_invoice_dir(app: AppHandle) -> Result<String, String>      // <Documents>/Faktury (not created)
#[tauri::command] fn write_invoice(dir: String, base_name: String, pdf: Vec<u8>, json: String) -> Result<(), String> // creates dir, atomic per file
#[tauri::command] fn list_dir(dir: String) -> Result<Vec<DirEntry>, String>             // DirEntry { name, size, modified_ms }; missing dir → Ok(vec![])
#[tauri::command] fn read_text(path: String) -> Result<String, String>
#[tauri::command] fn read_bytes(path: String) -> Result<Vec<u8>, String>
#[tauri::command] fn trash_paths(paths: Vec<String>) -> Result<(), String>
#[tauri::command] fn delete_paths(paths: Vec<String>) -> Result<(), String>             // used only by overwrite-replace
```
- Internal helper, unit-tested: `pub fn write_atomic(path: &Path, bytes: &[u8], keep_bak: bool) -> io::Result<()>`. It writes `path.tmp`, fsyncs, renames the old file to `.bak` if `keep_bak`, then renames `tmp` to `path`.
- `data_load` behaviour:
  - main file parses as JSON → return it
  - main file unreadable or invalid but `.bak` is valid → return the `.bak` contents with `recovered_from_backup: true`
  - both bad → `contents: None, error: Some(...)`
  - neither exists → `contents: None, error: None`

- [ ] **Step 1: Write the failing Rust tests** in `files.rs` (using `tempfile`):
  - `write_atomic_creates_file`
  - `write_atomic_keeps_previous_as_bak`
  - `load_prefers_main`
  - `load_falls_back_to_bak_when_main_corrupt` (main = `"{not json"`)
  - `load_reports_error_when_both_corrupt`
  - `load_none_when_missing`
  - `list_dir_missing_returns_empty`

  Factor the load logic into `fn load_from(dir: &Path) -> DataLoad` so it's testable without `AppHandle`.
- [ ] **Step 2: Run the tests.** `cargo test --manifest-path src-tauri/Cargo.toml`. Expected: FAIL.
- [ ] **Step 3: Implement** `files.rs` and register the commands plus `tauri_plugin_dialog::init()` and `tauri_plugin_opener::init()` in `lib.rs`.
- [ ] **Step 4: Run the tests again.** Expected: 7 passed. `cargo check` is clean.
- [ ] **Step 5: Commit.** Message: `Add Rust file commands with atomic writes`

### Task 5: TS storage layer (backend, data store, invoice store)

**Files:**
- Create: `src/storage/backend.ts`, `tauriBackend.ts`, `memoryBackend.ts`, `dataStore.ts`, `invoiceStore.ts`
- Test: `dataStore.test.ts`, `invoiceStore.test.ts`

**Interfaces:**
- Consumes: Task 4's command names (snake_case args are camelCase via `invoke`). Uses `types.ts`.
- Produces:
```ts
export interface Backend {
  dataLoad(): Promise<{ contents: string | null; recoveredFromBackup: boolean; error: string | null }>
  dataSave(contents: string): Promise<void>
  defaultInvoiceDir(): Promise<string>
  writeInvoice(dir: string, baseName: string, pdf: Uint8Array, json: string): Promise<void>
  listDir(dir: string): Promise<{ name: string; size: number; modifiedMs: number }[]>
  readText(path: string): Promise<string>
  trash(paths: string[]): Promise<void>
  deletePaths(paths: string[]): Promise<void>
  join(dir: string, name: string): string
}
export function getBackend(): Backend // tauri if '__TAURI_INTERNALS__' in window, else a singleton MemoryBackend
export class MemoryBackend implements Backend { files: Map<string, Uint8Array | string>; dataFile: string | null; bakFile: string | null; failWritesUnder?: string }
export type LoadResult = { status: 'fresh' } | { status: 'ok'; data: SavedData; recovered: boolean } | { status: 'error'; message: string }
export async function loadSavedData(b: Backend): Promise<LoadResult>
export async function saveSavedData(b: Backend, d: SavedData): Promise<void>
export function emptySavedData(): SavedData
export function invoiceBaseName(inv: Invoice): string   // `${issueDate.slice(0,7)}_faktura-${sanitize(number)}`
export async function listInvoices(b: Backend, dir: string): Promise<InvoiceRecord[]> // newest issueDate first; pdfOnly last by name
export async function resolveInvoiceDir(b: Backend, d: SavedData): Promise<string> // settings.invoiceDir ?? defaultInvoiceDir()
export async function saveInvoice(b: Backend, dir: string, inv: Invoice, pdf: Uint8Array, existing: InvoiceRecord[]): Promise<{ replaced: boolean }>
export async function loadInvoice(b: Backend, path: string): Promise<Invoice>
export function parseInvoice(json: string): Invoice | null // null unless object with schemaVersion 1 and required fields
```
- `saveInvoice`:
  - Writes the pair.
  - If a record with the same `number` exists under a different base name, deletes that old pair afterwards.
  - The caller has already confirmed the overwrite.
  - Errors propagate.

- [ ] **Step 1: Write the failing tests** with `MemoryBackend`:
  - **`loadSavedData`:**
    - fresh → `{status:'fresh'}`
    - valid → `ok`
    - `recoveredFromBackup` → `ok` with `recovered: true`
    - both corrupt → `{status:'error'}`
    - **Review Focus 1:** after an `error`, nothing has called `dataSave`.
  - **`invoiceBaseName`:**
    - number `'202611'`, issue `'2026-11-30'` → `'2026-11_faktura-202611'`
    - number `'2026/11'` → `'2026-11_faktura-2026-11'`
    - `'a:b*c?'` → `'…faktura-a-b-c-'` (**Review Focus 5**: replace `<>:"/\|?*` and control characters with `-`)
  - **`listInvoices`:**
    - JSON+PDF pair → `invoice` with `pdfPath`
    - JSON alone → `pdfPath: null`
    - PDF alone → `pdfOnly`
    - `other.json` containing `{"foo":1}` plus `other.pdf` → `pdfOnly` (**Review Focus 3**)
    - an unparseable `.json` → ignored, no throw
    - missing dir → `[]`
  - **`saveInvoice`:**
    - writes both files
    - when re-saving the same number with a different issue month → old pair deleted, `replaced: true`
    - when `failWritesUnder` matches → rejects, and no partial record is listed (**Review Focus 2**)
- [ ] **Step 2: Run the tests.** `npx vitest run src/storage`. Expected: FAIL.
- [ ] **Step 3: Implement.** `MemoryBackend.join` uses `/`. `tauriBackend.join` uses `@tauri-apps/api/path` `join` is async, so precompute the separator once via `sep()` and implement `join` synchronously.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: `Add storage layer for saved data and invoices`

### Task 6: Spike: printing from the Tauri webview

Purpose: answer the spec's §7 risk 1 before the editor depends on it. The code is throwaway, except the decision.

- [ ] **Step 1: Test `window.print()`.** In `src/main.tsx`, temporarily render a single 210×297 mm white div with text "Tisk test ěščřžýáíéů" and a button calling `window.print()`. Add `@page { size: A4; margin: 0 }` and `@media print` rules that hide the button.
- [ ] **Step 2: Check on macOS.** Run `npm run tauri dev`, click the button, and check that the macOS print dialog opens and that the preview is A4 with no headers or footers. Record the result.
- [ ] **Step 3: Decide and record** in `docs/superpowers/plans/print-decision.md`:
  - **If it works:** "PRINT_MODE = webview". Note that Windows still needs confirming by the user (WebView2 supports `window.print()`).
  - **If it doesn't:** "PRINT_MODE = pdf-viewer". Printing opens the saved PDF with `@tauri-apps/plugin-opener` `openPath`, and a toast tells the user to print from the viewer.
- [ ] **Step 4: Revert the spike code** and commit only the decision file. Message: `Record print approach decision`

### Task 7: A4 layout, static sheet and PDF renderer

**Files:**
- Create: `src/sheet/layout.ts`, `src/sheet/Sheet.tsx`, `src/sheet/sheet.css`, `src/pdf/wrap.ts`, `src/pdf/renderPdf.ts`, `src/pdf/fonts/*`
- Test: `wrap.test.ts`, `renderPdf.test.ts`, `Sheet.test.tsx`

**Interfaces:**
- Consumes: `Invoice`, `formatCzk`, `formatCzDate`.
- Produces:
```ts
export const A4 = { w: 210, h: 297 }                       // mm
export type Box = { x: number; y: number; w: number; h: number } // mm, origin top-left
export const LAYOUT: { margin: number; header: Box; supplier: Box; customer: Box; payment: Box; dates: Box; text: Box; footer: Box; fontSize: { base: number; title: number; label: number }; lineHeight: number }
export const mmToPt = (mm: number) => mm * 72 / 25.4
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[]
export async function renderInvoicePdf(inv: Invoice): Promise<Uint8Array>
export function Sheet(props: { invoice: Invoice; mode: 'static' }): JSX.Element  // Task 9 adds mode 'edit'
```
- Visual layout follows the old sheet's structure (header with title + number, a two-column Dodavatel/Odběratel row, a Platební podmínky row with dates on the right, a text + amount row, a footer with "Nejsem plátce DPH", "Cena celkem:", and the Podpis/Razítko area). All of it fits inside 210×297 mm, with no extra header height, unlike the old bug.
- The supplier `note` prints under the supplier block only when non-empty. DIČ lines render only when `showDic`.
- The fonts are Roboto Regular and Bold static TTF from the `googlefonts/roboto` release (Apache-2.0). Commit the license next to them. The sheet CSS loads the same TTFs via `@font-face`.

- [ ] **Step 1: Write the failing tests.**
  - **`wrapText`:**
    - with `measure = s => s.length`: `wrapText('aa bb cc', 5, m)` → `['aa bb', 'cc']`
    - a single overlong word is split by character
    - `''` → `['']`
  - **`renderInvoicePdf`** on a fixture invoice with Czech diacritics in every field:
    - resolves
    - `PDFDocument.load(bytes)` has exactly 1 page
    - page size within 0.5 pt of 595.28 × 841.89
  - **Review Focus 4:** a 400-character text and a 120-character customer name still give 1 page and don't throw.
  - **`Sheet` static:**
    - renders "Faktura", `formatCzk(42000)`, "30. 11. 2026" and "Nejsem plátce DPH"
    - with `showDic: false` there's no "DIČ"
    - renders no element with class `controls`
- [ ] **Step 2: Run the tests.** `npx vitest run src/pdf src/sheet`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The PDF draws every text at `mmToPt(box.x)`, `pageHeight − mmToPt(box.y)` with pdf-lib + fontkit and embedded subset fonts.
  - Long text is wrapped with `wrapText` against `font.widthOfTextAtSize`. If the wrapped text exceeds its box height, reduce the font size by 0.5 pt steps, down to 7 pt minimum.
  - The sheet positions the same boxes with `position:absolute` in `mm` and uses CSS line clamping with the same shrink rule (a CSS custom property set from a JS measurement).
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Visual check.** Run `npm run dev`, render `<Sheet mode="static">` with the fixture, take a headless-Chrome screenshot, and write the PDF to the scratchpad. Open both and compare: same positions, same wrapping.
- [ ] **Step 6: Commit.** Message: `Add A4 layout, static sheet and PDF renderer`

### Task 8: App shell, theme and UI kit

**Files:**
- Create: `src/app/App.tsx`, `TopBar.tsx`, `theme.ts`, `src/ui/theme.css`, `Button.tsx`, `IconButton.tsx`, `Toast.tsx`, `Dialog.tsx`, `Popover.tsx`
- Test: `theme.test.ts`, `TopBar.test.tsx`

**Interfaces:**
- Consumes: `loadSavedData`, `getBackend`, `Settings`.
- Produces:
```ts
export type Tab = 'faktura' | 'historie' | 'udaje' | 'nastaveni'
export const currentTab: Signal<Tab>
export const savedData: Signal<SavedData | null>
export async function updateSavedData(fn: (d: SavedData) => SavedData): Promise<void> // persists via saveSavedData
export function resolveTheme(pref: ThemePref, systemDark: boolean): 'light' | 'dark'
export function applyTheme(pref: ThemePref): void // sets document.documentElement.dataset.theme; listens to matchMedia when 'system'
export function nextThemePref(p: ThemePref): ThemePref // system → light → dark → system
export function toast(msg: string, kind?: 'success' | 'warning' | 'error'): void
export function confirmDialog(opts: { title: string; body: string; confirm: string; cancel?: string; danger?: boolean }): Promise<boolean>
export function choiceDialog<T extends string>(opts: { title: string; body: string; choices: { value: T; label: string; primary?: boolean }[] }): Promise<T | null>
```
- **`App` boot:**
  - `loadSavedData` returns `fresh` → render `<Onboarding/>` (a placeholder until Task 12)
  - `ok` → shell; when `recovered`, show the warning toast "Data byla obnovena ze zálohy."
  - `error` → full-screen error with the message and the data-file path, and no app
- **`TopBar`:**
  - logo "Faktura"
  - tabs "Faktura", "Historie", "Uložené údaje"
  - on the right: a theme `IconButton` (lucide `Monitor`/`Sun`/`Moon`, title "Motiv: Systém|Světlý|Tmavý") and a "Nastavení" ghost button (`Settings` icon)
- **`theme.css`:**
  - tokens `--bg --surface --border --text --muted --accent --accent-weak --warn --warn-weak --new --new-weak --danger` for `[data-theme=light]` and `[data-theme=dark]`
  - controls are 32 px high
  - `.paper` hard-codes white/black and doesn't use tokens

- [ ] **Step 1: Write the failing tests.**
  - `resolveTheme('system', true) === 'dark'`
  - `resolveTheme('light', true) === 'light'`
  - `nextThemePref` cycles through all 3
  - the TopBar renders the 3 tab labels; clicking "Historie" sets `currentTab` to `'historie'`; clicking the theme button cycles `savedData.settings.theme` and persists it (MemoryBackend `dataFile` changes)
- [ ] **Step 2: Run the tests.** `npx vitest run src/app`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Visual check.** Run `npm run dev` and screenshot in both themes: the sheet stays white in dark mode.
- [ ] **Step 6: Commit.** Message: `Add app shell, theme toggle and UI kit`

### Task 9: Editor with inline editing

**Files:**
- Create: `src/editor/editorState.ts`, `src/editor/EditorPage.tsx`, `src/sheet/DatePopover.tsx`
- Modify: `src/sheet/Sheet.tsx` (add `mode: 'edit'`)
- Test: `editorState.test.ts`, `EditorPage.test.tsx`

**Interfaces:**
- Consumes: Tasks 2, 3, 5, 7, 8.
- Produces:
```ts
export const invoice: Signal<Invoice>
export const isSaved: Signal<boolean>          // false after any edit; true after save
export const takenNumbers: Signal<Set<string>> // from listInvoices, refreshed after save/delete
export function setField(path: string, value: string): void // e.g. 'customer.street', 'number', 'text.text'; marks unsaved
export function setAmountFromInput(s: string): void         // parseCzk; null allowed while typing
export function setIssueDate(iso: string): void; export function setDueDate(iso: string): void
export function pushDueDate(): void                         // addDays(dueDate, settings.plusDays)
export function toggleDic(): void
export function loadIntoEditor(inv: Invoice, saved: boolean): void
```
- **The sheet in `edit` mode:**
  - every text field is `contentEditable` (plain text only; paste strips formatting; Enter blurs)
  - hover outlines a field with a dashed accent underline
  - the amount is editable only at "Cena celkem", and the text row shows the formatted value read-only
  - dates open `DatePopover` (Czech month and day names, Monday first)
  - "+N dní" next to the due date calls `pushDueDate`
- **Number:** when `isNumberTaken` (and the invoice isn't the one loaded under that number), show the inline warning "Faktura s tímto číslem už existuje."
- **Toolbar** (above the sheet, right-aligned): `Nová` (Plus), `Skrýt DIČ`/`Zobrazit DIČ` (EyeOff/Eye), `Tisknout` (Printer), `Uložit PDF` (Download, primary). Tasks 10–11 wire the actions; here they're rendered.
- **Unsaved indicator:** a small "Neuloženo" muted label next to the toolbar when `!isSaved`.

- [ ] **Step 1: Write the failing tests.**
  - `setField('customer.street','Nová 8')` updates the invoice and sets `isSaved` to false
  - `setAmountFromInput('42 000')` → `amount 42000`; `'x'` → `null`
  - `pushDueDate` with `plusDays 30` from `'2026-12-15'` → `'2027-01-14'`
  - `toggleDic` flips `showDic`
  - EditorPage: typing into the number field a value present in `takenNumbers` shows the warning text
- [ ] **Step 2: Run the tests.** `npx vitest run src/editor`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Visual check.** Run `npm run dev` and screenshot hover/edit states.
- [ ] **Step 6: Commit.** Message: `Add inline invoice editor`

### Task 10: Entity sections: tag, picker, states, save actions

**Files:**
- Create: `src/sheet/EntitySection.tsx`, `src/sheet/EntityPicker.tsx`
- Modify: `src/sheet/Sheet.tsx` (wrap supplier, customer, payment and text in `EntitySection` in edit mode)
- Test: `EntitySection.test.tsx`

**Interfaces:**
- Consumes: `sectionState`, `changedFields`, `findDuplicate`, `entityLabel`, `entitySubtitle`, `matchesQuery`, `toSnap`, `updateSavedData`, `toast`, `choiceDialog`, the editor signals.
- Produces: `EntitySection(props: { kind: EntityKind; children })`. Its behaviour follows §5.4 and the mockups `entity-states-v2.html` and `picker.html`:
  - **matches:** no outline. The tag appears on hover/focus.
  - **edited:**
    - amber outline (`--warn`), changed fields highlighted (`--warn-weak` background)
    - tag `"<label> · upraveno"`
    - buttons `Uložit změny` (primary), `Uložit jako nový`, `Vrátit` (RotateCcw)
  - **new:**
    - blue/indigo outline (`--new`), tag `"＋ Nový <odběratel|dodavatel|platební údaj|text>"`
    - button `Uložit do údajů`
  - **Tag:** text only, no icon, with a chevron. Clicking it opens `EntityPicker`:
    - a search input (placeholder "Hledat podle názvu, IČ nebo města…"; for payment "…účtu nebo banky…"; for text "Hledat v textech…")
    - two-line rows (bold label name, muted subtitle), with a check on the linked entry
    - a footer `＋ Nový …` that clears the section to empty fields with `sourceId: null`
    - Esc or an outside click closes it; arrow keys and Enter work
  - **Actions:**
    - **Uložit změny:** replaces the saved entry fields (same id).
    - **Uložit jako nový / Uložit do údajů:**
      1. Run `findDuplicate`.
      2. If a duplicate is found, `choiceDialog` with title "Už existuje", body `"<entityLabel(dup)> už je uložen."`, choices `Použít ten` (relinks to the duplicate and loads its fields) and `Přesto uložit`.
      3. On save, create a new id (`crypto.randomUUID()`) and link it.
    - **Vrátit:** reloads the fields from the linked entry.
    - Every save shows `toast('Uloženo', 'success')`.
  - All controls carry class `controls` and are absent from print/PDF output.

- [ ] **Step 1: Write the failing tests** (MemoryBackend with one saved customer "Příklad s.r.o." `12345679`):
  - the initial render has no action buttons
  - editing the street shows "upraveno" and the 3 buttons
  - "Uložit změny" updates the saved customer, the buttons disappear and the toast "Uloženo" shows
  - "Vrátit" restores "Krátká 5"
  - "＋ Nový odběratel" from the picker gives empty fields and "Uložit do údajů"
  - saving a new customer with IČ `12345679` shows "Už existuje"; "Použít ten" relinks without adding; "Přesto uložit" adds a second entry
  - the picker search "brno" filters to matching rows
  - two entries named "Příklad s.r.o." show different subtitles
- [ ] **Step 2: Run the tests.** `npx vitest run src/sheet`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Visual check.** Screenshot all three states and the open picker in light and dark themes. Compare against the mockups.
- [ ] **Step 6: Commit.** Message: `Add entity tags, picker and save actions`

### Task 11: Save PDF, print, new invoice and close guard

**Files:**
- Create: `src/editor/actions.ts`
- Modify: `src/editor/EditorPage.tsx`, `src/app/App.tsx`
- Test: `actions.test.ts`

**Interfaces:**
- Consumes: `renderInvoicePdf`, `saveInvoice`, `listInvoices`, `resolveInvoiceDir`, `newInvoiceFrom`, the dialogs, `docs/superpowers/plans/print-decision.md`.
- Produces:
```ts
export async function saveCurrent(): Promise<boolean>  // true when saved
export async function printCurrent(): Promise<void>    // saveCurrent() first; abort if false
export async function startNew(): Promise<void>        // confirm if !isSaved; newInvoiceFrom(latest record, …)
export async function bootEditor(): Promise<void>      // on app start: startNew() without confirm
```
- **`saveCurrent`:**
  1. If `amount === null`, toast error "Zadejte částku." and return false.
  2. If the number is taken by a *different* saved record, `confirmDialog({title:'Přepsat fakturu?', body:'Faktura <n> už existuje. Chcete ji nahradit?', confirm:'Přepsat', danger:true})`.
  3. Render the PDF, set `savedAt = new Date().toISOString()`, and call `saveInvoice`.
  4. On success: `isSaved = true`, refresh `takenNumbers`, toast "Faktura uložena".
  5. On error: toast error `"Uložení se nezdařilo: <msg>"`. The editor stays unchanged and `isSaved` stays false.
- **`printCurrent`:** after saving, follow the print decision from Task 6. With webview mode, set `document.body.dataset.printing = '1'`, call `window.print()`, then remove it. Print CSS shows only `.paper` and hides `.controls`.
- **Close guard:** use `getCurrentWindow().onCloseRequested`. If `!isSaved`, `confirmDialog` "Zavřít bez uložení?"; on cancel, `event.preventDefault()`.

- [ ] **Step 1: Write the failing tests** (MemoryBackend, `renderInvoicePdf` mocked to return `new Uint8Array([1])`):
  - save with `amount null` → false, toast, no files
  - a normal save writes `2026-11_faktura-202611.pdf/.json` and `isSaved` becomes true
  - a second invoice with a taken number → the confirm is called; declining → no write
  - **Review Focus 2:** the backend `failWritesUnder` set to the dir → returns false, the error toast is shown, `isSaved` stays false, and the invoice is unchanged
  - `printCurrent` when the save is declined → `window.print` is not called
  - `startNew` when unsaved and the confirm is declined → the invoice is unchanged; otherwise the number is `suggestNumber` for the taken set
- [ ] **Step 2: Run the tests.** `npx vitest run src/editor`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Manual check.** Run `npm run tauri dev`. Save a PDF, then open it from `~/Documents/Faktury`: one A4 page, Czech characters correct, no controls. Print to the macOS "Save as PDF" printer. Close with unsaved changes and check that it prompts.
- [ ] **Step 6: Commit.** Message: `Add PDF save, print, new invoice and close guard`

### Task 12: Onboarding

**Files:**
- Create: `src/onboarding/Onboarding.tsx`
- Modify: `src/app/App.tsx`
- Test: `Onboarding.test.tsx`

**Interfaces:**
- Consumes: `emptySavedData`, `saveSavedData`, `isValidIco`, `bootEditor`. The import entry point comes from Task 17; until then the restore button is rendered disabled with title "Bude doplněno".
- Produces: `Onboarding(props: { onDone(): void })`. Behaviour follows §5.8 and `onboarding.html`:
  - **Welcome:**
    - "Vítejte", text "Jednoduché faktury pro OSVČ. Údaje se ukládají jen v tomto počítači."
    - buttons "Začít – zadat moje údaje" and "Obnovit ze zálohy (.zip)"
  - **Step 1 "Vaše údaje":**
    - fields Jméno a příjmení / název*, Ulice a číslo*, PSČ a město*, IČ*, DIČ (nepovinné), Doplňující údaj (nepovinné)
    - an IČ hint shows "✓ platné IČ" or a warning "IČ nemá platný kontrolní součet". The warning doesn't block.
  - **Step 2 "Bankovní účet":** Forma úhrady* (default "Bankovním převodem"), Banka*, Číslo účtu*
  - **Step 3 "První odběratel":** party fields, plus "Přeskočit"
  - **Navigation:**
    - a progress bar with 3 segments, "Zpět" / "Pokračovat"
    - "Pokračovat" is disabled until the required fields are non-empty
  - **Finish:** save `SavedData` with these entries and `DEFAULT_SETTINGS`, then `onDone()`, which leads to the shell and `bootEditor()`
  - Placeholders are the fake examples from Global Constraints, greyed.

- [ ] **Step 1: Write the failing tests.**
  - "Pokračovat" is disabled with empty required fields
  - IČ `12345678` shows the checksum warning but still lets you continue
  - after filling 3 steps (or skipping step 3), `dataFile` contains 1 supplier and 1 payment, plus 1 or 0 customers
  - `onDone` is called
- [ ] **Step 2: Run the tests.** `npx vitest run src/onboarding`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Visual check.** Screenshot the welcome screen and step 1 in light and dark themes.
- [ ] **Step 6: Commit.** Message: `Add first-run onboarding`

### Task 13: Historie list and row actions

**Files:**
- Create: `src/history/historyModel.ts`, `src/history/HistoryPage.tsx`
- Test: `historyModel.test.ts`, `HistoryPage.test.tsx`

**Interfaces:**
- Consumes: `listInvoices`, `loadIntoEditor`, `newInvoiceFrom`, `currentTab`, `confirmDialog`, `Backend.trash`, opener `openPath` / `revealItemInDir`, `formatCzk`, `formatCzDate`.
- Produces:
```ts
export type MonthRange = { from: string; to: string } | null // 'YYYY-MM', inclusive; null = all
export function filterByRange(recs: InvoiceRecord[], r: MonthRange): InvoiceRecord[] // pdfOnly always kept when r===null, dropped otherwise
export function groupByYear(recs: InvoiceRecord[]): { year: string; records: InvoiceRecord[]; count: number; total: number }[] // pdfOnly under 'Ostatní' last
export function totals(recs: InvoiceRecord[]): { count: number; total: number }
export function searchRecords(recs: InvoiceRecord[], q: string): InvoiceRecord[] // number, customer name, IČ; diacritics-insensitive
export const historyRange: Signal<MonthRange>
```
- Page behaviour follows §5.6 and `history-v3.html`:
  - **Toolbar:** search field, `RangePicker` (a placeholder button in this task), `Import` and `Export` (wired in Task 17). There's no "Nová faktura" button.
  - **Folder line:** the path plus "Otevřít složku".
  - **Range line:** `"<n> faktur · celkem <formatCzk>"` for the filtered list.
  - **Year groups:** collapsible, with count + total right-aligned.
  - **Grid columns:** Číslo | Vystaveno | Odběratel (name + "IČ …") | Částka (right) | Splatnost | actions.
  - **Actions column** (fixed width):
    - `Otevřít` appears on hover, uses `visibility` so the layout doesn't shift, and is absent for pdfOnly
    - PDF (`FileDown`) opens the PDF; it's disabled when there's no PDF
    - Tisknout (`Printer`) opens/prints the stored PDF (pdf-viewer mode), or loads it static and calls `window.print()` (webview mode)
    - `⋯` (`MoreHorizontal`) menu: "Nová faktura podle této", "Zobrazit ve složce", divider, "Smazat…" (red, `Trash2`)
  - **Otevřít:** if the editor is unsaved, confirm first; then `loadIntoEditor(inv, true)` and switch to tab `faktura`.
  - **Smazat:** `confirmDialog` "Smazat fakturu <n>? Soubory se přesunou do koše.", then `trash([json, pdf])`, then refresh.
  - **pdfOnly row:** file name + badge "jen PDF – nelze upravit".

- [ ] **Step 1: Write the failing tests.**
  - `filterByRange` with `{from:'2026-06',to:'2026-11'}` keeps issue months 06–11 inclusive across a fixture spanning 2025-10 to 2026-12
  - a range `{from:'2025-10',to:'2026-03'}` crosses years
  - `groupByYear` orders years descending and sums totals
  - `searchRecords('prik')` matches "Příklad"
  - the page renders a pdfOnly badge
  - clicking Smazat and confirming calls `trash` with both paths
  - "Otevřít" switches `currentTab` to `faktura` with the invoice loaded
- [ ] **Step 2: Run the tests.** `npx vitest run src/history`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Visual check.** Screenshot against `history-v3.html` in both themes: alignment, one icon style, 32 px controls.
- [ ] **Step 6: Commit.** Message: `Add invoice history`

### Task 14: Období range picker

**Files:**
- Create: `src/history/RangePicker.tsx`
- Modify: `src/history/historyModel.ts` (add presets), `HistoryPage.tsx`
- Test: `RangePicker.test.tsx`, additions to `historyModel.test.ts`

**Interfaces:**
- Produces:
```ts
export type Preset = 'all' | 'thisYear' | 'lastYear' | 'last6' | 'last12'
export function presetRange(p: Preset, today: Date): MonthRange
export function formatRange(r: MonthRange): string // null → 'Vše'; '2026-06'..'2026-11' → 'červen 2026 – listopad 2026'; whole years → '2025 – 2026'; single month → 'listopad 2026'
export function RangePicker(props: { value: MonthRange; monthsWithInvoices: Set<string>; onChange(r: MonthRange): void }): JSX.Element
```
- Behaviour follows `range-picker-v2.html`:
  - **Field:** "Období: …" with a calendar icon.
  - **Popover:**
    - presets on the left (Vše, Tento rok, Minulý rok, Posledních 6 měsíců, Posledních 12 měsíců)
    - a segmented control "Měsíce | Roky"
    - month mode: a 3×4 grid with year arrows and Czech short names (led, úno, bře, dub, kvě, čvn, čvc, srp, zář, říj, lis, pro), with a dot on months in `monthsWithInvoices`
    - year mode: a grid of the years present, ±1
  - **Selecting:**
    - first click = start, second = end (swapped if earlier), a click on the same cell twice = a single unit
    - years map to `{from:'YYYY-01', to:'YYYY-12'}`
  - **Footer:** `"<n> měsíců · <k> faktur"` + "Použít". Esc cancels.
  - **Default:** `null` (Vše).

- [ ] **Step 1: Write the failing tests.**
  - `presetRange('last6', new Date(2026,10,9))` → `{from:'2026-06',to:'2026-11'}`
  - `'lastYear'` → `{from:'2025-01',to:'2025-12'}`
  - `formatRange` cases as listed above
  - picker: clicking čvn then lis and "Použít" calls `onChange({from:'2026-06',to:'2026-11'})`
  - clicking lis then čvn gives the same result
  - Roky mode: 2025 then 2026 → `{from:'2025-01',to:'2026-12'}`
- [ ] **Step 2: Run the tests.** `npx vitest run src/history`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: `Add range picker to history`

### Task 15: Uložené údaje page

**Files:**
- Create: `src/saved/SavedPage.tsx`
- Test: `SavedPage.test.tsx`

**Interfaces:**
- Consumes: `savedData`, `updateSavedData`, `entityLabel`, `entitySubtitle`, `matchesQuery`, `findDuplicate`, `isValidIco`, `listInvoices` (for usage counts), `confirmDialog`, `toast`.
- Produces: `export function usageCounts(recs: InvoiceRecord[]): Map<string, number>`, which counts every snapshot `sourceId` (supplier, customer, payment, text). Page behaviour follows §5.7 and `saved-details-v2.html`:
  - **Segmented switcher:** Dodavatelé · Odběratelé · Platební údaje · Texty, each with a count.
  - **Toolbar:** search + "＋ Přidat <dodavatele|odběratele|platební údaj|text>".
  - **Rows:** name/label bold + subtitle, IČ/DIČ column (parties), usage "na N fakturách" / "na 1 faktuře" / "nepoužito", `⋯` menu.
  - **Side panel:**
    - labelled fields for the kind (parties include "Doplňující údaj" for suppliers only)
    - changed fields outlined amber; the IČ hint
    - the note "Změna se projeví jen na nových fakturách. Uložené faktury zůstanou beze změny."
    - buttons Uložit / Zrušit / Smazat (red)
  - **Add:** opens an empty panel. Saving runs the duplicate check, with the same dialog as Task 10.
  - **Smazat:** confirm "Smazat <label>? Uložené faktury se nezmění.", then remove the entry.
  - **Dodavatelé:** the last remaining supplier can't be deleted (button disabled, title "Musí zůstat alespoň jeden dodavatel").

- [ ] **Step 1: Write the failing tests.**
  - `usageCounts` over fixture records gives the expected map
  - the page lists customers with subtitles; search filters
  - editing and saving updates `dataFile`
  - deleting the only supplier is disabled
  - adding a customer with an existing IČ triggers "Už existuje"
- [ ] **Step 2: Run the tests.** `npx vitest run src/saved`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Visual check.** Screenshot against the mockup in both themes.
- [ ] **Step 6: Commit.** Message: `Add saved details page`

### Task 16: Nastavení and safe folder move

**Files:**
- Create: `src-tauri/src/moves.rs`, `src/settings/SettingsPage.tsx`
- Modify: `src-tauri/src/lib.rs`, `src/storage/backend.ts` (+ both implementations)
- Test: Rust tests in `moves.rs`, `SettingsPage.test.tsx`

**Interfaces:**
- Produces:
```rust
#[tauri::command] fn move_invoices(from: String, to: String, names: Vec<String>, overwrite: Vec<String>) -> Result<MoveReport, String>
// MoveReport { moved: usize }. Copies every name; verifies size + byte-equality; only then deletes sources.
// If any copy/verify fails: removes files it created in `to`, deletes nothing in `from`, returns Err.
// A name existing in `to` and not in `overwrite` → Err("Konflikt: <name>") before copying anything.
```
```ts
Backend.moveInvoices(from: string, to: string, names: string[], overwrite: string[]): Promise<{ moved: number }>
Backend.pickFolder(): Promise<string | null>   // dialog plugin open({directory:true})
```
- **Settings page:**
  - **Složka s fakturami:** the path + "Změnit…". After picking, `choiceDialog` "Přesunout faktury" / "Jen ukládat do nové složky".
  - **Move flow:**
    1. Compute the names from `listInvoices(from)`: the json+pdf of each record. pdfOnly files are included only if they end with `.pdf` *and* follow the `_faktura-` naming.
    2. Detect conflicts by invoice number against `listInvoices(to)`. For each conflict, `choiceDialog` "Faktura <n> už v cílové složce je." with the choices "Nahradit v cílové složce" (its names go into `overwrite`) / "Ponechat cílovou" (its names are dropped from `names`, and the source pair stays in the old folder).
    3. Run the move with a progress indicator (an indeterminate spinner is acceptable).
    4. On success, update `settings.invoiceDir` and show a toast. On error, show an error toast and leave the setting unchanged.
  - **Výchozí hodnoty:**
    - due rule as a radio: "15. den následujícího měsíce" (with a day number input) / "N dní od vystavení"
    - "+N dní" number
    - "Zobrazovat DIČ" switch
  - **Záloha:** "Exportovat…" / "Importovat…" (wired in Task 17).
  - **O aplikaci:** the version from `@tauri-apps/api/app` `getVersion()`.

- [ ] **Step 1: Write the failing Rust tests:**
  - `moves_and_deletes_sources`
  - `conflict_aborts_before_copy`
  - `overwrite_listed_name_replaces`
  - `failure_midway_keeps_sources_and_cleans_target`: make the second source unreadable, or simulate with a missing source name
- [ ] **Step 2: Write the failing TS tests.**
  - changing the due rule persists to `dataFile`
  - choosing "Jen ukládat do nové složky" updates `invoiceDir` without calling `moveInvoices`
  - a failed move leaves `invoiceDir` unchanged and shows the error toast
- [ ] **Step 3: Run the tests.** `cargo test --manifest-path src-tauri/Cargo.toml && npx vitest run src/settings`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run the tests again.** Expected: PASS.
- [ ] **Step 6: Commit.** Message: `Add settings page and safe invoice folder move`

### Task 17: Export and import

**Files:**
- Create: `src-tauri/src/zipio.rs`, `src/transfer/transfer.ts`
- Modify: `lib.rs`, `backend.ts` (+ implementations), `HistoryPage.tsx`, `SettingsPage.tsx`, `Onboarding.tsx` (enable restore)
- Test: Rust tests in `zipio.rs`, `transfer.test.ts`

**Interfaces:**
- Produces:
```rust
#[tauri::command] fn export_zip(invoice_dir: String, files: Vec<String>, data_json: String, dest: String) -> Result<(), String> // entries: faktury/<file>, faktura-data.json
#[tauri::command] fn zip_list(path: String) -> Result<ZipContents, String> // ZipContents { invoice_jsons: Vec<(String name, String contents)>, pdf_names: Vec<String>, data_json: Option<String> }
#[tauri::command] fn zip_extract(path: String, names: Vec<String>, dest_dir: String) -> Result<(), String> // only entries under faktury/, flattened; rejects '..' paths
```
```ts
Backend.exportZip(dir: string, files: string[], dataJson: string, dest: string): Promise<void>
Backend.zipList(path: string): Promise<{ invoiceJsons: [string, string][]; pdfNames: string[]; dataJson: string | null }>
Backend.zipExtract(path: string, names: string[], destDir: string): Promise<void>
Backend.pickSavePath(defaultName: string): Promise<string | null>; Backend.pickZip(): Promise<string | null>
export type ImportPlan = { invoices: { name: string; number: string; conflict: boolean }[]; pdfOnly: string[]; newEntries: { suppliers: Party[]; customers: Party[]; payments: Payment[]; texts: InvoiceText[] }; skippedDuplicates: number }
export function planImport(zip: Awaited<ReturnType<Backend['zipList']>>, current: SavedData, existing: InvoiceRecord[]): ImportPlan
export function applySavedMerge(current: SavedData, plan: ImportPlan): SavedData // settings untouched
export async function exportAll(): Promise<void>; export async function importFromZip(opts?: { onboarding?: boolean }): Promise<void>
```
- **Export:** default file name `faktury-export-YYYY-MM-DD.zip`; toast "Export hotov".
- **Import flow:**
  1. Pick a zip.
  2. `zipList`, then `planImport`.
  3. Preview dialog: "<n> faktur, <a> odběratelé, <b> dodavatelé, <c> účty, <d> texty", plus "<k> už existuje". For each invoice conflict, choose "Nahradit" / "Ponechat stávající".
  4. "Importovat": `zipExtract` the selected names into the invoice dir, then `updateSavedData(applySavedMerge)`.
  5. Toast "Import hotov".
- **In onboarding:** the import creates `SavedData` from `emptySavedData()` merged with the zip data. The import is valid only if the result has at least one supplier; otherwise show the error "Záloha neobsahuje údaje dodavatele."

- [ ] **Step 1: Write the failing Rust tests:**
  - `export_then_list_roundtrip`
  - `extract_rejects_path_traversal` (an entry `faktury/../evil.json` is skipped or rejected)
  - `list_ignores_non_faktury_entries`
- [ ] **Step 2: Write the failing TS tests.**
  - `planImport` dedups a customer by IČ (`skippedDuplicates` 1) and flags an invoice conflict by number
  - `applySavedMerge` keeps the existing settings
  - onboarding import with no suppliers → error
- [ ] **Step 3: Run the tests.** `cargo test --manifest-path src-tauri/Cargo.toml && npx vitest run src/transfer`. Expected: FAIL.
- [ ] **Step 4: Implement**, and wire the buttons in Historie, Nastavení and onboarding.
- [ ] **Step 5: Run the tests again.** Expected: PASS.
- [ ] **Step 6: Manual check.** In `npm run tauri dev`: export, delete the data file and the invoice folder, restart, restore from the zip in onboarding, and check that Historie shows all invoices again.
- [ ] **Step 7: Commit.** Message: `Add zip export and import`

### Task 18: README with Windows build guide, final verification

**Files:**
- Modify: `README.md` (full rewrite)
- Modify: `src-tauri/tauri.conf.json` if needed (`bundle.targets`: `["nsis", "app", "dmg"]`; `bundle.windows.webviewInstallMode`: `{ "type": "downloadBootstrapper" }`)

**Content:**
- **What it is.**
- **For users:**
  - which file to open
  - the SmartScreen "Další informace → Přesto spustit" step
  - the macOS right-click "Otevřít" step
  - where data and invoices live
  - how to back up (Export)
- **Build on macOS:** the commands.
- **"Build pro Windows (krok za krokem)"**, written for a first-timer:
  1. Install Node LTS: https://nodejs.org
  2. Install Rust: https://rustup.rs (`rustup-init.exe`, default options)
  3. Install the Microsoft C++ Build Tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/, with the workload "Desktop development with C++"
  4. WebView2: preinstalled on Windows 10/11. Otherwise install the Evergreen runtime from Microsoft.
  5. Copy the project folder to the PC **without** `node_modules` and `src-tauri/target`, or use a zip produced by `git archive -o faktura-src.zip HEAD` on the Mac.
  6. In PowerShell in the folder, run `npm ci`, then `npm run tauri build`.
  7. Result:
     - `src-tauri\target\release\faktura.exe` (named after the Cargo package `faktura`; assets are embedded) is the single file to send to friends
     - `src-tauri\target\release\bundle\nsis\Faktura_<ver>_x64-setup.exe` is an optional installer
  8. Common errors:
     - `link.exe not found` → the C++ workload is missing
     - `cargo not found` → open a new terminal after installing Rust
     - first build is slow (5–15 min); later builds are faster
  - Mark every step "neověřeno na Windows" (not verified on Windows) until the user confirms.
- **Development:** `npm run dev` (browser, in-memory data), `npm run tauri dev`, `npm test`, `cargo test`.
- **Project layout** in short.

- [ ] **Step 1: Write the README.** Use the fake example data only.
- [ ] **Step 2: Verify everything.**
  - Run `npm test && cargo test --manifest-path src-tauri/Cargo.toml && npm run build && npm run tauri build`. Expected: all pass, and the macOS `.app`/`.dmg` are produced under `src-tauri/target/release/bundle/`.
  - Note the binary size; the target is about 10 MB.
- [ ] **Step 3: Scan for personal data.** Grep for the old app's real names, IČO, DIČ, account number and street, taking the values from `~/faktura-legacy-backup.zip` at runtime without copying them into any file or commit message. Expected: no matches in the repo. Also check that `git ls-files` contains no `node_modules`, `target` or `.superpowers`.
- [ ] **Step 4: Smoke-test the built `.app`.**
  - Onboarding → invoice → save → print → Historie → Uložené údaje → theme toggle → export.
  - Take screenshots for the user, with fake data.
- [ ] **Step 5: Commit.** Message: `Add README with Windows build guide`
