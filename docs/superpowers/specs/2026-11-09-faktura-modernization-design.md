# Faktura modernisation: design

Date: 2026-11-09
Status: approved by the user on 2026-11-09

## 1. Intent

Faktura is a small app the author wrote at university so their dad could make Czech invoices. Friends have now asked to use it. The current version can't be shared as it is:

- **Personal data.** Real names, addresses, IČO/DIČ and a bank account number are hard-coded in `api/index.js`, in the client components (`Supplier.js`, `Subscriber.js`, `PaymentInfo.js`) and in `api/database/*.txt`.
- **Node required.** It runs as an Express server plus a Create React App dev server, started by `.bat` files. Users need Node.js installed, and two console windows stay open.
- **Hard to copy.** Two `node_modules` folders make the project slow to copy unless it's zipped.
- **Outdated stack.** React 16, react-scripts 3.4.1 (needs `--openssl-legacy-provider` on current Node), dependencies used but not declared, and Windows-only path separators.

The goal is a modern, self-contained desktop app that someone receives as one file over a messenger or on a USB stick. They open it and it works. It keeps the existing core idea: **you edit the invoice directly on a page that looks like the printed A4 sheet.**

### Who uses it

Czech self-employed people (OSVČ) who are **not VAT payers**. The typical case is one invoice a month to the company they work for, though any number of invoices per month must be possible. Most details repeat from month to month.

### Priority (user's words)

**The invoice editor is the main focus of the app.** Ideally a user can do everything from the editor alone: pick, edit and save details through the inline tags/pickers, save and print. Historie and Uložené údaje are nice to have. They must not be required for any core task, and the editor gets the most design and polish effort. When time or scope is tight, build and polish in this order:
1. editor + PDF/print + storage
2. onboarding
3. Historie
4. Uložené údaje
5. folder move and export/import

## 2. Goals

1. **Easy to share.** A single small file per OS. No Node, no install step beyond what the OS normally asks, nothing downloaded on first start, no console window, no background process after the window is closed.
2. **Platforms.** Windows is required. macOS and Linux builds are nice to have, from the same codebase.
3. **No personal data shipped.** Empty start, with a one-time onboarding where the user enters their own details.
4. **Feature parity** with the current app: in-place editing of every invoice field, saved suppliers/customers/payment details/texts, invoice number, issue and due dates with a "+N days" helper, a "Skrýt/Zobrazit DIČ" toggle, the "Nejsem plátce DPH" note, and the signature/stamp area.
5. **Real PDF output** instead of PNG, plus printing.
6. **Invoice history** stored in a folder the user can see, and reopenable in the app.
7. **Better management of saved details**, with no silent saves and no duplicates.
8. **Export/import** of everything as one zip.
9. **A modern, intuitive and good-looking UI** that keeps the "looks like the paper" principle, with light and dark modes.

## 3. Non-goals

- Hosting, accounts, cloud sync, or any network access.
- Invoices for VAT payers (VAT rates, VAT breakdown). The invoice always says "Nejsem plátce DPH".
- Multiple line items or quantity × price tables. One text line + one amount, as today.
- UI languages other than Czech. **The whole UI and the invoice are Czech only.**
- Auto-update.
- A demo/sample-data mode (considered and rejected).
- **Any migration from the old app** (user's decision). This is a completely new iteration: no importer for the old `api/database/*.txt` files, and old PNG invoices are not shown in Historie. Existing users start fresh through onboarding.

## 4. Anti-goals: failures even if it technically works

- The user has to install Node, a runtime, or anything else by hand, or sees a console window.
- Data stored somewhere that gets cleaned up (temp folders), or a crash that corrupts saved data.
- Saving a saved entry silently or ambiguously, producing duplicate entries in pickers (today's "+" problem).
- A printed invoice that wasn't saved to history. Every printed invoice must be on record, for accounting.
- A PDF or printout that doesn't match the A4 sheet on screen, or that shows editing controls.
- Editing a saved customer and having old invoices change.
- Personal data in the repo, the build, or screenshots/docs.

## 5. Decisions

### 5.1 Platform and stack (author's call, approved by the user in conversation)

- **Tauri 2** desktop app. It uses the system webview: WebView2 on Windows 10/11, WKWebView on macOS, WebKitGTK on Linux. The result is a single small executable (target: around 10 MB).
- **Front end: plain web tech built with Vite.** Whether to use a light UI library or vanilla TS is the builder's choice (see §8). React is not required.
- **Windows:** the binary must run as a GUI app with no console (`windows_subsystem = "windows"`).
- **Distribution artefacts:** Windows is the priority. The builder decides between a portable `.exe` and an NSIS/MSI installer (see §8), but the user experience must stay "receive one file, open it". A macOS (`.app`/`.dmg`) build comes from the same code; the code should stay Linux-compatible, but a Linux build is out of scope for now. Unsigned builds are acceptable. The README must explain the macOS Gatekeeper "open anyway" step and the Windows SmartScreen warning.
- **Builds and distribution (user's decision): local builds, no CI for now.**
  - The **macOS** build is made on the developer's Mac.
  - The **Windows** build is made on the developer's Windows PC. Node, Rust and the C++ build tools are needed there only for building; end users need nothing.
  - **Required deliverable: a clear, step-by-step "Build for Windows" section in the README**, written for someone doing it for the first time:
    - one-time setup: what to install (Rust via rustup, Node LTS, Microsoft C++ Build Tools with the "Desktop development with C++" workload, WebView2 if missing), with links
    - how to get the code onto the PC
    - the exact build command
    - where the finished file appears, and which file to send to friends
    - common errors and their fixes
    The builder should keep this section in step with the actual toolchain and verify each step as far as possible from macOS. Steps that can only be confirmed on Windows must be marked as such.
  - Linux builds and a GitHub Actions workflow are an optional later step and not part of this scope.
  - Friends get the file from the author directly (messenger/USB). There's no public download page.
- **The old `api/` and `client/` code is replaced, not kept alongside.**

### 5.2 Data storage

**Saved details** (suppliers, customers, payment details, invoice texts, settings, onboarding-complete flag):
- One JSON file in the OS app-data directory, e.g. `%APPDATA%\Faktura\` on Windows, `~/Library/Application Support/Faktura/` on macOS, `~/.local/share/Faktura/` on Linux. Use Tauri's app-data path API.
- **Atomic writes:** write to a temp file in the same directory, flush, then rename over the original. Keep the previous version as `.bak`. On load, if the main file is unreadable, fall back to `.bak` and tell the user.
- The file must carry a schema version so later versions can migrate it.

**Invoices:**
- Stored in a user-visible folder, default `Documents/Faktury/` (OS documents directory), changeable in Nastavení.
- Each saved invoice is **two files side by side** with the same base name:
  - `<…>.pdf`: the rendered invoice
  - `<…>.json`: the full editable invoice data, as a snapshot (see §5.4)
- File naming is the builder's call, but it must contain the invoice number and sort sensibly. Example: `2026-11_faktura-202611.pdf/.json`.
- The JSON carries a schema version.

### 5.3 App structure

A light top bar, with tabs on the left and Nastavení on the right:

**Faktura · Historie · Uložené údaje** … **⚙ Nastavení**

- The app opens on **Faktura** (the editor) with a fresh invoice ready.
- Visual style, agreed via mockups in `.superpowers/brainstorm/` (`history-v3.html` is the reference for polish):
  - light neutral background, white surfaces, one blue accent
  - **one consistent line-icon set** (Lucide-style), no emoji
  - **one control height** (32 px) for buttons, inputs and icon buttons
  - aligned grids, tabular numerals for amounts and dates, right-aligned amounts

**Dark mode** (requested by the user):
- A toggle in the top bar (sun/moon icon) cycles **Systém → Světlý → Tmavý**. Default is **Systém**, which follows the OS setting. The choice is remembered in settings.
- Dark mode recolours the app chrome: top bar, backgrounds, pickers, panels, dialogs, toasts.
- **The A4 sheet stays white paper with black text in both modes (author's call)**, because it previews what gets printed. The PDF and printout are always light.
- Editing affordances on the sheet (amber/blue outlines, tags) must stay readable on the white sheet inside a dark frame.
- All colours are defined as theme tokens, so every screen supports both modes.

### 5.4 Editor (Faktura tab)

**Layout.** The A4 sheet sits centred on a neutral background and looks like the printed result. The toolbar holds **＋ Nová**, **🖨 Tisknout** and **⤓ Uložit PDF** (primary).

**Inline editing.** Every text field on the sheet is edited in place, as today. Editing affordances (hover highlight, tags, buttons, pickers) are visible on screen but **never appear in the PDF or printout**.

**Sections bound to saved entries.** Dodavatel, Odběratel, Platební údaje (payment method, bank, account number) and the invoice text are each linked to a saved entry of their kind.
- A small **tag** on the section shows which entry is linked. It's visible on hover/focus, and always visible in states 2 and 3 below. The tag has **no icon** and shows identifying info:
  - Dodavatel/Odběratel: `Název · IČ 12345678 ▾`
  - Platební údaje: `číslo účtu · banka`
  - Text: first ~60 characters
- Clicking the tag opens a **searchable picker**:
  - Each row has two lines: name in bold; below it the IČ, street and city (for payment details: account and bank; for texts: the text).
  - Search matches any shown field.
  - At the bottom: "＋ Nový …", which clears the section for a new entry.
  - Entries with identical names are told apart by the second line.
- **Section states.** These are derived by comparing the section's current values with its linked saved entry. Nothing extra needs storing.
  1. **Matches.** Clean look, tag on hover.
  2. **Edited.** Amber outline, changed text highlighted, tag reads "… · upraveno". Buttons:
     - **Uložit změny** updates the linked entry.
     - **Uložit jako nový** creates a new entry and links to it.
     - **↺ Vrátit** restores the saved values.
     If ignored, the edit applies to this invoice only.
  3. **New / unlinked.** Blue outline, tag "＋ Nový …". Button **Uložit do údajů**.
- **Duplicate check** on "Uložit jako nový" / "Uložit do údajů":
  - Supplier/customer: an entry with the same IČ exists.
  - Payment details and texts: all fields identical.
  - The app warns, naming the existing entry, and offers **Použít ten** (link to it) or **Přesto uložit**. Saving anyway is allowed, e.g. a company with a new address.
- Every save shows a brief **"✓ Uloženo"** confirmation (toast).

**Amount.**
- One value, edited in one place. It appears both in the text line and as "Cena celkem", and both update together.
- Formatted Czech style: `42 000,- Kč`.
- It is not a saved entry.
- Whole crowns only vs. allowing haléře is the builder's call (§8).

**Invoice number.**
- Default `YYYYMM` of the issue month.
- If that number is already used in history, suggest the next free one by appending a two-digit sequence, e.g. `20261102`.
- Warn if the user types a number that already exists.
- The number is also the variabilní symbol.

**Dates.** Same defaults as today:
- issue date: last day of the current month
- due date: 15th of the next month
- "+N days" helper (default N = 30) that pushes the due date

Use a Czech-locale date picker. The old app used Russian; that's no longer wanted.

**DIČ toggle.** "Skrýt/Zobrazit DIČ" hides the DIČ lines on the sheet. Stored per invoice.

**Fixed wording (author's call; the user should verify with an accountant):**
- The sheet title is **"Faktura"**, not "Faktura – daňový doklad". My understanding, not checked against current law, is that a non-VAT payer doesn't issue a daňový doklad, and the old title contradicted the "Nejsem plátce DPH" note.
- Dodavatel gets one **optional free-text extra line** (e.g. "Fyzická osoba zapsaná v živnostenském rejstříku …"):
  - It's printed under the supplier block only when filled.
  - It's part of the supplier entity, the onboarding step 1 form (optional) and the invoice snapshot.
  - It isn't used for duplicate detection.
- Otherwise the field list is exactly the current app's: no DUZP or other new fields.

**New invoice (＋ Nová, and on app start).**
- A new invoice is a copy of the most recent invoice in history: same supplier, customer, payment details, text, amount and DIČ visibility, with a new number and fresh dates.
- With no history, it's built from the onboarding data, with an empty amount.
- If the current invoice has unsaved changes, confirm before discarding.

**Uložit PDF.**
- Writes the PDF + JSON pair into the invoice folder.
- If an invoice with the same number already exists, ask before overwriting. That's how a mistake gets fixed.
- After saving, the invoice counts as saved: there's an indicator, and closing the window or starting a new invoice doesn't prompt.

**Tisknout.**
- **Always saves first**, exactly like Uložit PDF, including the overwrite question.
- Then opens the system print dialog with the A4 page: true A4, no browser headers/footers or margins.
- Cancelling the print dialog keeps the saved invoice.

**Unsaved-invoice guard.** Closing the window with an unsaved invoice asks for confirmation.

### 5.5 PDF requirements

- Real PDF: vector, A4 (210 × 297 mm), selectable text, correct Czech diacritics (embedded font), single page.
- Must look the same as the on-screen sheet, minus editing controls.
- **Known old bug to avoid:** the old layout stacked a 50 px header on top of a 794×1123 px body, so the total was taller than A4. The new sheet must be designed in A4 units from the start.
- The generation method is the builder's call (§8). The result must be identical across Windows/macOS/Linux.

### 5.6 Historie tab

Reference mockups: `history-v3.html` and `range-picker-v2.html`.

**Source and scope**
- Lists the invoice folder: every PDF/JSON pair. Invoices copied into the folder by hand also appear.
- A PDF without a matching JSON shows by file name with a "jen PDF – nelze upravit" badge. It can be viewed and printed but not opened in the editor.

**Toolbar**
- Search (number, customer, IČ).
- **Období range picker**:
  - toggle between Měsíce and Roky granularity
  - click start, then end; ranges may cross years
  - arrows switch years in month mode
  - dots mark months that have invoices
  - presets: Vše, Tento rok, Minulý rok, Posledních 6 měsíců, Posledních 12 měsíců
  - default **Vše**
- **Import** and **Export** buttons.
- There is **no "Nová faktura" button here**.

**Folder path** shown, with an "Otevřít složku" link.

**List**
- Newest first, **grouped by year**, with collapsible year headers.
- Each year shows its invoice count and total.
- A line above the list shows the count and total **for the selected range**.

**Rows**
- Columns: number, issue date, customer (name + IČ), amount (right-aligned), due date.
- Fixed actions column:
  - **Otevřít** appears on hover without shifting layout, and loads the invoice into the editor.
  - PDF opens it in the system viewer.
  - Tisknout prints the saved PDF as it is.
  - **⋯** menu: "Nová faktura podle této" (copy into the editor with a new number and dates), "Zobrazit ve složce", and **Smazat…** (red).

**Delete**
- Confirms first, then moves both files to the **OS Recycle Bin/Trash**, not a permanent delete.

**Reopening a saved invoice**
- Shows it exactly as saved, using the snapshot data.
- Saving again with the same number triggers the overwrite question.

### 5.7 Uložené údaje tab

Reference mockup: `saved-details-v2.html`.

**Layout**
- A segmented switcher with counts: **Dodavatelé · Odběratelé · Platební údaje · Texty**.
- Search, plus a "＋ Přidat …" button whose label follows the selected kind.

**List rows**
- Same identification as the picker.
- Each row shows **how many saved invoices use the entry** ("na 9 fakturách" / "nepoužito"). How the count is computed (matching by entry ID stored in the invoice snapshot, or by IČ) is the builder's call.

**Side panel** (opens when an entry is clicked)
- Labelled fields, with changed fields outlined in amber, and the IČ check.
- A note: "Změna se projeví jen na nových fakturách. Uložené faktury zůstanou beze změny."
- **Uložit / Zrušit / Smazat**. Delete confirms, and only removes the entry from the pickers.

**Snapshots.** Invoices keep their own copy of all data, so editing or deleting a saved entry never changes saved invoices.

### 5.8 Onboarding (first start only)

Shown when no saved-details file exists. The welcome text has no "(neplátce DPH)" wording.

- **Welcome** with two choices: **Začít – zadat moje údaje** or **Obnovit ze zálohy (.zip)** (runs Import, §5.10).
- **Wizard** with a progress bar and Zpět / Pokračovat:
  1. **Vaše údaje** (the supplier): name, street, PSČ + city, IČ, DIČ (optional).
  2. **Bankovní účet**: payment method, bank, account number.
  3. **První odběratel**: can be skipped.
- Greyed placeholder examples (e.g. "Jan Novák") are the only fake data.
- **IČ validation** uses the official Czech 8-digit mod-11 checksum. It shows a hint and allows overriding (warn, don't block).
- The invoice folder isn't asked about. It defaults to `Documents/Faktury`.

### 5.9 Nastavení (author's call; no mockup)

**Invoice folder**
- Shows the current path, with **Změnit…**.
- When changing, offer **move existing invoices** or **just start saving to the new folder**, e.g. pointing at a folder that already contains invoices.
- The move is **safe**:
  1. Copy all invoice pairs.
  2. Verify them (size, or a hash).
  3. Only then delete the originals.
  4. On any failure, delete nothing, keep the old folder, and show an error.
- It moves only invoice files (PDF/JSON pairs the app recognises). Other files stay.
- If the target already has invoices, merge them. On a number clash, ask which to keep. Never overwrite silently.
- Show a progress bar for large moves.

**Defaults**
- due-date rule
- "+N days" value
- DIČ shown by default

**Other**
- Export/Import shortcuts.
- App version.

### 5.10 Export / Import

**Export**
- Produces one zip, default name `faktury-export-YYYY-MM-DD.zip`, saved where the user chooses.
- Contains every invoice PDF + JSON in the folder plus the saved-details file.

**Import**
- Choose a zip.
- **Preview** its contents, e.g. "14 faktur, 3 odběratelé, 1 účet", before applying.
- **Merge** into the existing data:
  - saved entries are deduplicated with the same rules as §5.4
  - invoices with clashing numbers ask which to keep
- Also used by onboarding's "Obnovit ze zálohy".

## 6. Constraints

- No network access is needed at runtime.
- Must work fully offline.
- No personal data anywhere in the repo, builds, docs or screenshots. Use fake data such as "Jan Novák", "Příklad s.r.o.", IČ 12345678 for examples and tests. The existing hard-coded personal data must be gone from the new code. Whether to scrub git history is out of scope (the folder isn't a git repo yet).
- Saved data must survive app updates (it lives outside the app binary).
- Czech-only UI strings.

## 7. Risks to check early

1. **Printing from the Tauri webview.** `window.print()` behaviour differs between WebView2, WKWebView and WebKitGTK, and has had gaps on macOS. Spike this first. **Fallback:** print the saved PDF through the OS (open it in the default viewer's print flow).
2. **PDF fidelity.** If the PDF is drawn separately from the HTML sheet, the two can drift apart. Pick an approach where they share one source of layout truth, or test them side by side.
3. **WebView2 availability.** It's preinstalled on Windows 11 and current Windows 10. Decide whether to embed the bootstrapper in the installer or document the requirement.

## 8. Left to the builder

- Front-end framework (vanilla TS, Preact, Svelte, Solid, etc.), as long as the result is small and maintainable.
- PDF generation method, e.g.:
  - native webview print-to-PDF per platform
  - a JS PDF library drawing from the invoice data
  - a Rust-side PDF crate
- Windows distribution form (portable exe vs. installer), within the "one file, open it" experience.
- File naming scheme for invoices, JSON schema details and IDs.
- Whole crowns vs. haléře in the amount.
- How "used on N invoices" is computed.
- Exact visual details beyond the mockups, keeping their style rules (§5.3).
- Tests (no CI in scope).
