// Usage: npm run release -- 0.2.0
// Bumps the version in all five files, commits "release: v0.2.0" and tags v0.2.0.
// It never pushes; it prints the push command instead.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { FILE_PATHS, checkRelease, readVersions, setVersion } from "./version-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const files = Object.fromEntries(
  Object.entries(FILE_PATHS).map(([key, rel]) => [key, readFileSync(path.join(root, rel), "utf8")]),
);
const current = readVersions(files)["package.json"];

const check = checkRelease({
  current,
  version,
  gitStatus: git("status", "--porcelain"),
  tagExists: git("tag", "--list", `v${version}`).trim() !== "",
  branch: git("rev-parse", "--abbrev-ref", "HEAD").trim(),
});
if (!check.ok) fail(check.message);

const updated = setVersion(files, version);
for (const [key, rel] of Object.entries(FILE_PATHS)) {
  writeFileSync(path.join(root, rel), updated[key]);
}

git("add", "--", ...Object.values(FILE_PATHS));
git("commit", "-m", `release: v${version}`);
git("tag", `v${version}`);

console.log(`Released v${version} locally (was ${current}). Nothing has been pushed.`);
console.log("Push it with:");
console.log(`  git push origin main v${version}`);
