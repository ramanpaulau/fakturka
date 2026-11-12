# Auto-update, rename to Fakturka and public release — design

Date: 2026-11-12. Builds on `2026-11-09-faktura-modernization-design.md` (the app itself).

## Intent

Faktura is used by Raman's dad and a few friends, none of them technical, all on Windows. Today a new version means
building on a Windows PC and sending a file around. The goal is that Raman tags a version on his Mac and, a little
later, every installed copy updates itself the next time it starts: nobody else does anything. "Everything just works"
is the requirement: an update must never get in the way of writing an invoice, and never touch anyone's data.

It must stay free, and nothing personal may leak when the code goes public.

## Decisions made with Raman

- **The app is renamed Fakturka** before the first release. What changes: product and window name, installer
  (`Fakturka_<version>_x64-setup.exe`), executable and Cargo package (`fakturka`), npm package name, repo
  (`github.com/ramanpaulau/fakturka`), README, O aplikaci, the onboarding welcome, and the app identifier
  `cz.faktura.desktop` → `cz.fakturka.desktop` (nobody has data yet, so the data folder can move for free; it can never
  change after the first release). What stays (my call): the document on the paper is still titled "Faktura", the
  invoice folder is still `Dokumenty\Faktury`, invoice files keep `<RRRR-MM>_faktura-<číslo>.pdf/.json`, and the data
  file keeps its name `faktura-data.json`; those name the invoices, not the app.
- **Public GitHub repo** on his account `ramanpaulau` (a private repo would need a token baked into every copy).
  Publishing is fine as long as no personal information leaks.
- **His name stays** in O aplikaci ("Autoři: Raman Paulau a Claude Opus") and the README.
- **The README is in English** (global practice). The app UI stays Czech only.
- **Clearly labelled**: README and O aplikaci say it is a vibecoded (AI-built) app for personal use, Czech only,
  no warranty, no support.
- **Updates install automatically**, no questions asked: downloaded in the background, installed at the next start
  behind a progress bar (Raman chose this over waiting for the download at startup; his dad is on a 1 Gbps line, but
  nobody should ever wait).
- **Nobody runs v0.1.0 yet** (neither the loose `faktura.exe` nor the Mac app), so there is no migration.
- **No Windows PC needed**: GitHub Actions builds on Windows runners. Friends therefore install
  once with the installer (`Fakturka_<version>_x64-setup.exe`); the single loose `.exe` is no longer what we hand out.
- **Windows only** for releases and updates. Raman's Mac builds stay local, for development; nobody uses Linux.

## Goals

1. One-time install per person: download the setup file, click through SmartScreen once, done. No admin password.
2. A newer published version is downloaded quietly in the background while the app is in use. At the next start a
   short Czech screen with a progress bar ("Instaluji novou verzi 0.3.0…") installs it, and the app restarts in the
   new version by itself. Nobody ever waits for a download.
3. No internet, GitHub down, a slow or failed download: the app works normally in the current version. Checking and
   downloading never delay startup at all.
4. Only updates signed with Raman's key are installed.
5. Raman's release flow: bump the version, push a tag, GitHub Actions builds the Windows installer and creates a
   **draft** release. Installed apps do not see drafts. He publishes it when he is happy; only then does it reach everyone.
6. Updates never touch user data (saved details in `%APPDATA%\cz.fakturka.desktop\`, invoices in `Dokumenty\Faktury`),
   and every new version reads data written by any earlier version.
7. The public repo contains nothing personal: no real invoice data, no work email, no local paths or usernames.

## Non-goals

- macOS or Linux releases and updates.
- A paid code-signing certificate. SmartScreen will warn once at first install; accepted.
- Beta channels, staged rollouts, "skip this version", postponing, release notes inside the app.
- Downgrades/rollback inside the app. A bad release is fixed by publishing a newer one.
- Keeping the old git history public.

## Anti-goals (failure even if it technically works)

- Someone cannot write an invoice because an update is checking, downloading or broken.
- An update loses or rewrites saved details or invoices.
- Any step requires a non-technical user to decide something, read an error code or reinstall by hand.
- Raman's work email, real customer data or anything from the old app's data appears anywhere in the public repo.
- A signing key, token or password lands in the repo, a log, or the chat.

## How it works

### Publishing the repo

- Repo `github.com/ramanpaulau/fakturka`, public.
- **Fresh history.** All local commits carry Raman's work email. The public repo starts from a
  new root commit of the current tree, authored with his GitHub noreply address
  (`<id>+ramanpaulau@users.noreply.github.com`, id from the GitHub API), and that address is set as this repo's local
  `user.email` so later commits use it too. No commit carrying the work email is ever pushed. (My call: the old history
  stays only locally, on its current branch.)
- **Branches** (my call): nothing is deleted. Local `main` (one commit) is renamed `archive/main-initial`, local
  `modernize` stays as the archive of the full history, and a new orphan `main` holds the fresh root commit. The public
  default branch is `main`.
- **Before the first push**: run the PII scan against the tree. It exists from the 2026-11-09 session as a scratch
  script outside the repo: it reads the real values from `~/faktura-legacy-backup.zip` (names, addresses, IČO, bank
  accounts of the old app's data) and greps the tree for them, printing only counts, never the values. It also has to
  check for the work email domain. If the script is gone, rebuild it the same way; the values never go into the repo,
  a log or the chat; make sure `.superpowers/`,
  `.idea/`, `faktura-src.zip`, `node_modules/`, `dist/` and `src-tauri/target/` are ignored (add `.idea/` and `*.zip`
  to `.gitignore`); confirm `docs/superpowers/` contains no personal data (checked 2026-11-12: none; it stays public).
- Creating the repo and every push are outward-facing: the builder stops and asks Raman before each one.
- Access goes through the GitHub CLI: Raman installs it (`brew install gh`) and signs in himself with
  `! gh auth login` in the browser. No token is pasted anywhere.

### README (English) and O aplikaci

README sections: what it is (with the disclaimer near the top: vibecoded personal-use app, Czech-only UI, provided
as-is, no warranty, no support); installing on Windows for friends (download the setup file from the latest release,
SmartScreen "More info → Run anyway", where data lives, OneDrive note); how updates work; developing; releasing; the
existing project-structure overview. The Czech README content is translated, not dropped. The Windows "build it
yourself" guide shrinks to a short note, since CI builds releases.

O aplikaci adds one Czech line: "Aplikace vytvořená s pomocí AI (vibecoding) pro osobní použití. Bez záruky a bez
podpory." Optionally a link to the repo (builder's call).

### Release pipeline (GitHub Actions, free for public repos)

- Trigger: a pushed tag `v*`. Runner: `windows-latest`.
- Steps: install Node (22+) and Rust; `npm ci`; run the tests (`npm test`, `cargo test`) and the type check; fail
  if the tag does not equal the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`;
  build only the NSIS installer with updater artifacts; create a **draft** release with the installer, its `.sig`
  and `latest.json` (the official `tauri-apps/tauri-action` does this).
- Bundle settings: NSIS `installMode: "currentUser"` (no admin); `createUpdaterArtifacts: true`. Local Mac builds keep
  working as today.
- A small helper to bump the version in all three files at once (e.g. `npm run release -- 0.2.0`: bump, commit,
  tag; pushing stays a separate step Raman runs or approves). Builder's call on the exact shape.

### Signing

- Key pair generated on Raman's Mac with the Tauri signer, password-protected. The private key file and password live
  outside the repo (e.g. `~/.tauri/fakturka.key`) and go into the repo secrets
  `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` via `gh secret set` (read from the file, never
  echoed). The public key goes into `tauri.conf.json` (`plugins.updater.pubkey`).
- The README tells Raman to back up the key and password (e.g. in a password manager): without them no installed
  copy can ever be updated again; everyone would have to reinstall by hand.

### In the app

- Tauri updater plugin plus the process plugin (for the restart); capabilities get exactly the updater and restart
  permissions needed.
- Endpoint: `https://github.com/ramanpaulau/fakturka/releases/latest/download/latest.json`. GitHub's "latest" never
  points at a draft or a pre-release, which is what keeps drafts away from users.
- Only on Windows release builds (not on macOS, not in the browser build, not under `tauri dev`).
- **At start**, before onboarding or the editor appears: if an update was fully downloaded in an earlier session,
  show the update screen (centered, Czech, app styling, both themes: "Instaluji novou verzi 0.3.0…" with a progress
  bar, indeterminate where no progress is known) and install it. On Windows the installer runs in its passive mode
  (its own small progress window, no questions); the app closes and restarts itself in the new version. If that
  install cannot start (e.g. the cached download is missing, damaged or no longer the newest), discard it and start
  the app normally. Everything else at start: the app starts at once.
- **In the background**, after the app is up: check with a timeout of about 5 s; if a newer version exists, download
  it (signature verified) and keep it for the next start. Errors are silent (no dialog, no toast); the next start tries
  again. The plugin's JS `download()` keeps bytes only in memory, so the builder persists the verified download (e.g.
  the Rust updater API writing it to the app's cache directory together with its version) or uses another mechanism
  that gives the same user-visible behaviour.
- Installing happens only at start, never while the app is in use, so it can never interrupt an unsaved invoice.

### Data compatibility

- Saved data and invoice JSON already carry `schemaVersion: 1`. Rule for every release: read everything earlier
  releases wrote; never rewrite old invoice files just because the format moved on.
- Tests pin this: fixture files as written by v0.1.0 (data file with the now-removed `plusDays`, and an invoice JSON;
  recreated from the git history, since nobody has real ones yet) must load in the current version.

## Left to the builder

The exact update-screen layout and wording beyond the lines above; the helper script's shape; the workflow's file name
and caching; whether O aplikaci links to the repo; the version for the first public release (suggested `0.2.0`);
splitting the work into tasks.

## Known risks

- Nothing has been run on Windows yet (the whole Windows path is "neověřeno"). The first release is the first real
  Windows test; until someone has run it on a Windows PC, "everything just works" is unproven.
- Whether SmartScreen also warns when the app installs an update (as opposed to the first manual install) is not
  verified; the updater runs the installer itself, which usually avoids it.
- Antivirus software can be suspicious of unsigned installers; nothing free fixes that.
