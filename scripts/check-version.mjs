// Usage: node scripts/check-version.mjs v0.2.0
// Exits 0 when the tag is "v" + the version in all five files, otherwise 1.
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { FILE_PATHS, checkVersions } from "./version-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2];

if (!tag) {
  console.error("Usage: node scripts/check-version.mjs <tag>, for example v0.2.0");
  process.exit(1);
}

const files = Object.fromEntries(
  Object.entries(FILE_PATHS).map(([key, rel]) => [key, readFileSync(path.join(root, rel), "utf8")]),
);

const result = checkVersions(files, tag);
if (!result.ok) {
  console.error(result.message);
  process.exit(1);
}
console.log(`Version check passed: ${tag}`);
