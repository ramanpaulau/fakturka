import { describe, expect, it } from "vitest";
import {
  checkRelease,
  checkVersions,
  isGreater,
  isValidVersion,
  readVersions,
  setVersion,
} from "./version-lib.mjs";

const packageJson = `{
  "name": "fakturka",
  "private": true,
  "version": "0.1.0",
  "dependencies": {
    "dep-a": "0.1.0"
  }
}
`;

const packageLock = `{
  "name": "fakturka",
  "version": "0.1.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "fakturka",
      "version": "0.1.0",
      "dependencies": {
        "dep-a": "0.1.0"
      }
    },
    "node_modules/dep-a": {
      "version": "0.1.0",
      "resolved": "https://example.invalid/dep-a-0.1.0.tgz"
    }
  }
}
`;

const tauriConf = `{
  "productName": "Fakturka",
  "version": "0.1.0",
  "identifier": "cz.fakturka.desktop",
  "plugins": {
    "updater": { "version": "0.1.0" }
  }
}
`;

const cargoToml = `[package]
name = "fakturka"
version = "0.1.0"
edition = "2024"

[dependencies]
dep-a = { version = "0.1.0" }

[dependencies.dep-b]
version = "0.1.0"
`;

const cargoLock = `version = 4

[[package]]
name = "dep-a"
version = "0.1.0"

[[package]]
name = "fakturka"
version = "0.1.0"
dependencies = [
 "dep-a",
]

[[package]]
name = "fakturka-helper"
version = "0.1.0"
`;

const base = { packageJson, packageLock, tauriConf, cargoToml, cargoLock };
const bumped = () => setVersion(base, "0.2.0");

describe("readVersions", () => {
  it("reads every app version entry", () => {
    const versions = readVersions(base);
    expect(Object.keys(versions).length).toBeGreaterThanOrEqual(5);
    expect(Object.values(versions).every((v) => v === "0.1.0")).toBe(true);
  });
});

describe("setVersion", () => {
  it("changes the five entries to the new version", () => {
    const versions = readVersions(bumped());
    expect(Object.values(versions).every((v) => v === "0.2.0")).toBe(true);
    expect(JSON.parse(bumped().packageJson).version).toBe("0.2.0");
    const lock = JSON.parse(bumped().packageLock);
    expect(lock.version).toBe("0.2.0");
    expect(lock.packages[""].version).toBe("0.2.0");
    expect(JSON.parse(bumped().tauriConf).version).toBe("0.2.0");
  });

  it("changes nothing else", () => {
    const out = bumped();
    const lock = JSON.parse(out.packageLock);
    expect(lock.packages["node_modules/dep-a"].version).toBe("0.1.0");
    expect(lock.packages[""].dependencies["dep-a"]).toBe("0.1.0");
    expect(JSON.parse(out.packageJson).dependencies["dep-a"]).toBe("0.1.0");
    expect(JSON.parse(out.tauriConf).plugins.updater.version).toBe("0.1.0");
    expect(out.cargoToml).toContain('dep-a = { version = "0.1.0" }');
    expect(out.cargoToml).toContain('[dependencies.dep-b]\nversion = "0.1.0"');
    expect(out.cargoLock).toContain('name = "dep-a"\nversion = "0.1.0"');
    expect(out.cargoLock).toContain('name = "fakturka-helper"\nversion = "0.1.0"');
    // reverting the new version gives back the originals byte for byte
    expect(setVersion(out, "0.1.0")).toEqual(base);
  });
});

describe("checkVersions", () => {
  it("accepts a matching tag", () => {
    expect(checkVersions(bumped(), "v0.2.0")).toEqual({ ok: true });
  });

  it("rejects a different tag and names the files", () => {
    const r = checkVersions(bumped(), "v0.2.1");
    expect(r.ok).toBe(false);
    for (const f of ["package.json", "package-lock.json", "tauri.conf.json", "Cargo.toml", "Cargo.lock"]) {
      expect(r.message).toContain(f);
    }
    expect(r.message).not.toContain("\n");
  });

  it("names the one file left behind", () => {
    const files = { ...bumped(), cargoToml };
    const r = checkVersions(files, "v0.2.0");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Cargo.toml");
    expect(r.message).not.toContain("package.json");
    expect(r.message).not.toContain("Cargo.lock");
  });

  it("rejects a tag without the v prefix", () => {
    const r = checkVersions(bumped(), "0.2.0");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("v");
  });

  it("reports an entry it cannot find", () => {
    const r = checkVersions({ ...bumped(), cargoLock: "" }, "v0.2.0");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Cargo.lock");
  });
});

describe("isValidVersion", () => {
  it("accepts only plain x.y.z", () => {
    expect(isValidVersion("0.2.0")).toBe(true);
    expect(isValidVersion("10.20.30")).toBe(true);
    for (const v of ["0.2", "v0.2.0", "0.2.0-beta", "0.2.0\n", "", "1.2.3.4"]) {
      expect(isValidVersion(v)).toBe(false);
    }
  });
});

describe("isGreater", () => {
  it("compares numerically", () => {
    expect(isGreater("0.2.0", "0.1.0")).toBe(true);
    expect(isGreater("0.10.0", "0.9.0")).toBe(true);
    expect(isGreater("1.0.0", "0.99.99")).toBe(true);
    expect(isGreater("0.1.0", "0.1.0")).toBe(false);
    expect(isGreater("0.1.0", "0.2.0")).toBe(false);
  });
});

describe("checkRelease", () => {
  const ok = { current: "0.1.0", version: "0.2.0", gitStatus: "", tagExists: false, branch: "main" };
  it("allows a greater version on a clean tree", () => {
    expect(checkRelease(ok)).toEqual({ ok: true });
  });
  it("refuses an invalid version", () => {
    expect(checkRelease({ ...ok, version: "v0.2.0" }).ok).toBe(false);
    expect(checkRelease({ ...ok, version: undefined }).ok).toBe(false);
  });
  it("refuses a version that is not greater", () => {
    expect(checkRelease({ ...ok, version: "0.1.0" }).ok).toBe(false);
    expect(checkRelease({ ...ok, version: "0.0.9" }).ok).toBe(false);
  });
  it("refuses a dirty tree", () => {
    const r = checkRelease({ ...ok, gitStatus: " M src/app.tsx\n" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/dirty|uncommitted/i);
  });
  it("refuses an existing tag", () => {
    expect(checkRelease({ ...ok, tagExists: true }).ok).toBe(false);
  });
  it("refuses any branch other than main and names it", () => {
    const r = checkRelease({ ...ok, branch: "modernize" });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("modernize");
    expect(r.message).toContain("main");
    expect(checkRelease({ ...ok, branch: "HEAD" }).ok).toBe(false);
    expect(checkRelease({ ...ok, branch: undefined }).ok).toBe(false);
  });
});
