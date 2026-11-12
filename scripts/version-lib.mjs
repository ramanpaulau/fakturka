// Pure helpers for reading and bumping the app version across the five files
// that carry it. They work on file contents (strings) only; no fs here.

/** Repo-relative paths of the five files, keyed like the `files` objects below. */
export const FILE_PATHS = {
  packageJson: "package.json",
  packageLock: "package-lock.json",
  tauriConf: "src-tauri/tauri.conf.json",
  cargoToml: "src-tauri/Cargo.toml",
  cargoLock: "src-tauri/Cargo.lock",
};

// Each entry edits one version string in place, so formatting and line endings
// survive. The first capture group is everything before the version, the second
// everything after it.
const ENTRIES = [
  {
    name: "package.json",
    file: "packageJson",
    re: /^( {2}"version"\s*:\s*")[^"]*(")/m,
  },
  {
    name: "package-lock.json",
    file: "packageLock",
    re: /^( {2}"version"\s*:\s*")[^"]*(")/m,
  },
  {
    name: 'package-lock.json (packages[""])',
    file: "packageLock",
    // `[^{}]*?` keeps the match inside the root package block, away from
    // `dependencies` and every other package entry.
    re: /("packages"\s*:\s*\{\s*""\s*:\s*\{[^{}]*?"version"\s*:\s*")[^"]*(")/,
  },
  {
    name: "tauri.conf.json",
    file: "tauriConf",
    re: /^( {2}"version"\s*:\s*")[^"]*(")/m,
  },
  {
    name: "Cargo.toml",
    file: "cargoToml",
    // `[^\[]*?` stays inside the [package] table (no `[` before `version`).
    re: /(^\[package\][^[]*?^version\s*=\s*")[^"]*(")/m,
  },
  {
    name: "Cargo.lock",
    file: "cargoLock",
    re: /(\[\[package\]\]\r?\nname = "fakturka"\r?\nversion = ")[^"]*(")/,
  },
];

const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** @param {string} v */
export function isValidVersion(v) {
  return typeof v === "string" && VERSION_RE.test(v);
}

/** True when `a` is strictly greater than `b` (both plain x.y.z). */
export function isGreater(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

/**
 * Version found in each entry, keyed by file name; `null` when an entry is missing.
 * @param {Record<string, string>} files
 */
export function readVersions(files) {
  const out = {};
  for (const { name, file, re } of ENTRIES) {
    const m = re.exec(files[file] ?? "");
    out[name] = m ? m[0].slice(m[1].length, m[0].length - m[2].length) : null;
  }
  return out;
}

/**
 * Returns new file contents with only the app's own version entries changed.
 * @param {Record<string, string>} files
 * @param {string} version
 */
export function setVersion(files, version) {
  const out = { ...files };
  for (const { file, re } of ENTRIES) {
    out[file] = out[file].replace(re, (_m, pre, post) => pre + version + post);
  }
  return out;
}

/**
 * @param {Record<string, string>} files
 * @param {string} tag e.g. "v0.2.0"
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function checkVersions(files, tag) {
  if (typeof tag !== "string" || !tag.startsWith("v") || !isValidVersion(tag.slice(1))) {
    return { ok: false, message: `Tag "${tag}" must look like v1.2.3 (a "v" followed by x.y.z).` };
  }
  const expected = tag.slice(1);
  const bad = Object.entries(readVersions(files)).filter(([, v]) => v !== expected);
  if (bad.length === 0) return { ok: true };
  const list = bad.map(([name, v]) => `${name} is ${v ?? "missing"}`).join(", ");
  return { ok: false, message: `Tag ${tag} expects version ${expected}, but ${list}.` };
}

/**
 * Pre-flight guards for `npm run release`.
 * @param {{ current: string, version: string | undefined, gitStatus: string, tagExists: boolean, branch: string | undefined }} input
 *   `gitStatus` is the output of `git status --porcelain` (ignored files do not appear);
 *   `branch` is `git rev-parse --abbrev-ref HEAD`. Releases happen on `main` only, so the
 *   pushed commit never drags another branch's history into the public repo.
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function checkRelease({ current, version, gitStatus, tagExists, branch }) {
  if (branch !== "main") {
    return { ok: false, message: `Releases are made from main only; the current branch is "${branch ?? ""}".` };
  }
  if (!isValidVersion(version)) {
    return { ok: false, message: `Invalid version "${version ?? ""}": use x.y.z, for example 0.2.0.` };
  }
  if (!isGreater(version, current)) {
    return { ok: false, message: `Version ${version} must be greater than the current ${current}.` };
  }
  if (gitStatus.trim() !== "") {
    return { ok: false, message: "Working tree is dirty: commit or stash your changes first." };
  }
  if (tagExists) {
    return { ok: false, message: `Tag v${version} already exists.` };
  }
  return { ok: true };
}
