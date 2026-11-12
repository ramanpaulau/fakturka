# Fakturka

A small offline desktop app for issuing simple Czech invoices, made for sole traders (OSVČ) who are **not VAT payers**. You fill in the invoice directly on a page that looks like a printed A4 sheet, then save it as a PDF or print it. The interface and the invoices are in Czech only.

> **Please read first.** Fakturka is vibecoded with AI (Claude). It was made for personal use by family and friends and then published as it is. It is Czech-only, provided as-is, with no warranty and no support. Check every invoice before you send it, and keep your own backups.

- Works fully offline, no accounts. The app itself uses no cloud (but see the OneDrive note below).
- An invoice is one line of text plus one amount, always with the note "Nejsem plátce DPH" (Czech for "I am not a VAT payer").
- Saved details (supplier, customer, payment terms, texts), invoice history, light/dark theme, backup export and import.
- Built with Tauri 2 (Rust), Vite, Preact and TypeScript.

## Install on Windows

1. Open the [latest release](https://github.com/ramanpaulau/fakturka/releases/latest) and download `Fakturka_<version>_x64-setup.exe`.
2. Run it. It installs for the current user only, so no administrator rights are needed.
3. Windows SmartScreen may warn that the app is from an unknown publisher. Click **More info**, then **Run anyway**. This is needed once.

On first start the app walks you through the initial setup (your supplier details, bank account and so on). If you are moving from another computer, choose **Obnovit ze zálohy (.zip)** ("Restore from backup (.zip)") on the first screen.

Only Windows is supported. The macOS builds described below are for local development only.

## Updates

Updates are automatic. The app quietly downloads a newer release in the background. At the next start it shows a short screen, "Instaluji novou verzi …" ("Installing the new version …"), installs the update and restarts. There is nothing to do.

If you are offline or something goes wrong, the app simply keeps working as before. An update that fails to install twice is skipped until a newer version is released. Updates never touch your data.

## Where your data lives

| What | Where |
|---|---|
| Saved details | `faktura-data.json` in the app folder, plus `faktura-data.json.bak` (the previous version). A corrupt file is set aside as `faktura-data.json.corrupt` when the data is next saved. |
| Finished invoices | `Documents\Faktury`, each invoice as a pair `<YYYY-MM>_faktura-<number>.pdf` and `.json` |

The app folder (identifier `cz.fakturka.desktop`) is:

- Windows: `%APPDATA%\cz.fakturka.desktop\`
- macOS: `~/Library/Application Support/cz.fakturka.desktop/`
- Linux: `~/.local/share/cz.fakturka.desktop/`

**OneDrive (Windows):** the Documents folder is often synced with OneDrive, so `Documents\Faktury` may end up in the cloud. The app itself sends nothing anywhere. If you do not want it synced, pick a different folder outside OneDrive in **Nastavení** ("Settings").

You can change the invoice folder in **Nastavení** with the **Změnit…** ("Change…") button; existing invoices are moved to the new folder safely. Characters that are not allowed in Windows file names (for example `/` or `:` in an invoice number) are replaced with a dash in the file name. The number on the invoice stays exactly as you typed it.

### Backup and moving to another computer

**Nastavení** has **Exportovat…** ("Export…"), which creates a single zip with all saved details and invoices, and **Importovat…** ("Import…"), which loads such a zip back. Items that already exist are not duplicated, and for invoice collisions the app asks what to do. To move to a new computer, install the app, choose **Obnovit ze zálohy (.zip)** on the first screen and select the exported zip. Make a backup regularly, for example to a USB drive.

## Development

Prerequisites:

- Node.js 22 or newer
- Rust, installed with [rustup](https://rustup.rs)
- Platform tools: Xcode Command Line Tools on macOS (`xcode-select --install`); MSVC Build Tools (the "Desktop development with C++" workload) and WebView2 on Windows

```sh
npm ci
npm run dev          # web UI only, in a browser (http://localhost:1420); data is kept in memory
npm run tauri dev    # the full app in a window; writes to the real Documents\Faktury and app folder
npm test             # UI and logic tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests (files, folder move, zip, updater)
npm run build        # type check + production web build into dist/
```

Note: `npm run tauri dev` and any built app use your **real** data folders (see the table above). Use made-up data when trying things out, for example "Příklad s.r.o." (a Czech placeholder company name), IČO `12345679`, account `123456789/0100`.

### Building on macOS locally

```sh
npm ci
npm run tauri build
```

The result is in `src-tauri/target/release/bundle/` (`macos/Fakturka.app` and `dmg/Fakturka_<version>_<architecture>.dmg`). If building the `.dmg` fails with "Finder got an error: AppleEvent timed out", run `CI=true npm run tauri build` instead; it skips the cosmetic Finder step that styles the disk image window.

Windows builds are not made by hand. They come from CI (see below).

## Releasing (for the maintainer)

1. Make sure everything is committed on `main`, then run `npm run release -- 0.3.0`. It bumps the version in all the files that carry it, commits and tags `v0.3.0`. It never pushes.
2. Push the commit and the tag: `git push origin main v0.3.0`.
3. The GitHub Actions workflow `.github/workflows/release.yml` runs the tests, checks that the tag matches the app version, then builds the signed NSIS installer and `latest.json` into a **draft** release.
4. Download the installer from the draft and test it.
5. Click **Publish** on the release. Only published releases reach users.

`.github/workflows/ci.yml` runs on Windows for every push to `main` and every pull request: the tests and the web build.

**Signing key.** Updates are signed. The private key is `~/.tauri/fakturka.key` and its password is in `~/.tauri/fakturka.key.password`. Both are stored as the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **Back up both files** somewhere safe, for example a password manager. If they are lost, installed copies can never be updated again.

## Project structure

```
src/            frontend (Preact + TypeScript)
  app/          app shell, top bar, theme, state
  domain/       pure logic: amounts, dates, company IDs (IČO), bank codes, numbering, entities
  editor/       invoice editor, PDF saving and printing
  sheet/        the A4 sheet (on screen, and for PDF and print)
  pdf/          PDF generation (pdf-lib) and embedded fonts
  storage/      storage for saved details and invoices (Tauri / in-memory)
  history/      invoice history ("Historie")
  saved/        saved details ("Uložené údaje")
  settings/     settings and moving the invoice folder ("Nastavení")
  transfer/     zip export and import
  onboarding/   first-run setup
  ui/           shared components and styles
src-tauri/      Rust: file operations, folder move, zip, updater, packaging config
scripts/        release helper scripts (version bump and tag check)
docs/           design notes and plans
```

## License

No license has been chosen yet.

## Authors

Raman Paulau and Claude Opus.
