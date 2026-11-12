use crate::files::sibling_with_suffix;
use crate::moves::validate_name;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;

const INVOICE_PREFIX: &str = "faktury/";
const DATA_ENTRY: &str = "faktura-data.json";

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ZipContents {
    pub invoice_jsons: Vec<(String, String)>,
    pub pdf_names: Vec<String>,
    pub data_json: Option<String>,
}

/// Invoice JSONs larger than this are not read from a zip (a real invoice is a few KB).
const MAX_INVOICE_JSON: u64 = 5 * 1024 * 1024;
/// Upper bound for everything `zip_list` reads into memory, so a zip bomb cannot hang the app.
const MAX_TOTAL_JSON: u64 = 256 * 1024 * 1024;
const MAX_DATA_JSON: u64 = 20 * 1024 * 1024;
/// Largest single file `zip_extract` writes (an invoice PDF is far smaller).
const MAX_EXTRACT_FILE: u64 = 64 * 1024 * 1024;

fn has_ext(name: &str, ext: &str) -> bool {
    name.len() > ext.len() && name.to_lowercase().ends_with(ext)
}

/// Only invoice JSONs and PDFs are exchanged, so a zip cannot drop other kinds of files into the folder.
fn validate_invoice_file(name: &str) -> Result<(), String> {
    validate_name(name)?;
    if !has_ext(name, ".json") && !has_ext(name, ".pdf") {
        return Err(format!("Neplatný název souboru: {name}"));
    }
    Ok(())
}

/// The flattened file name of a `faktury/<name>` entry; None for anything else (other folders, sub-folders,
/// `..`, drive prefixes, other file types).
fn invoice_entry_name(entry: &str) -> Option<&str> {
    let name = entry.strip_prefix(INVOICE_PREFIX)?;
    validate_invoice_file(name).ok().map(|_| name)
}

fn export_to(invoice_dir: &Path, files: &[String], data_json: &str, dest: &Path) -> Result<(), String> {
    let mut seen = HashSet::new();
    let files: Vec<&String> = files.iter().filter(|f| seen.insert(f.as_str())).collect();
    for f in &files {
        validate_invoice_file(f)?;
    }
    let tmp = sibling_with_suffix(dest, ".tmp");
    let result = write_zip(invoice_dir, &files, data_json, &tmp).and_then(|_| {
        fs::rename(&tmp, dest).map_err(|e| format!("Nelze zapsat soubor {}: {e}", dest.display()))
    });
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn write_zip(invoice_dir: &Path, files: &[&String], data_json: &str, tmp: &Path) -> Result<(), String> {
    let werr = |e: &dyn std::fmt::Display| format!("Nelze zapsat soubor {}: {e}", tmp.display());
    let file = fs::File::create(tmp).map_err(|e| werr(&e))?;
    let mut w = zip::ZipWriter::new(file);
    let opts = SimpleFileOptions::default();
    for f in files {
        let src = invoice_dir.join(f);
        let bytes = fs::read(&src).map_err(|e| format!("Nelze načíst soubor {}: {e}", src.display()))?;
        w.start_file(format!("{INVOICE_PREFIX}{f}"), opts).map_err(|e| werr(&e))?;
        w.write_all(&bytes).map_err(|e| werr(&e))?;
    }
    w.start_file(DATA_ENTRY, opts).map_err(|e| werr(&e))?;
    w.write_all(data_json.as_bytes()).map_err(|e| werr(&e))?;
    let file = w.finish().map_err(|e| werr(&e))?;
    file.sync_all().map_err(|e| werr(&e))
}

fn open_archive(path: &Path) -> Result<zip::ZipArchive<fs::File>, String> {
    let file = fs::File::open(path).map_err(|e| format!("Nelze načíst soubor: {e}"))?;
    zip::ZipArchive::new(file).map_err(|e| format!("Soubor není platný ZIP: {e}"))
}

/// Reads at most `limit` bytes; None when the entry is longer (so a header that understates the size cannot
/// make us read an unbounded amount).
fn read_limited(r: impl Read, limit: u64) -> io::Result<Option<Vec<u8>>> {
    let mut buf = Vec::new();
    r.take(limit + 1).read_to_end(&mut buf)?;
    Ok(if buf.len() as u64 > limit { None } else { Some(buf) })
}

/// A zip with two entries under `faktury/` that flatten to the same name (compared case-insensitively) is refused
/// outright: listing and extraction could otherwise resolve the name to different entries.
fn reject_duplicates(archive: &zip::ZipArchive<fs::File>) -> Result<(), String> {
    let mut seen = HashSet::new();
    for entry in archive.file_names() {
        if let Some(name) = invoice_entry_name(entry) {
            if !seen.insert(name.to_lowercase()) {
                return Err("Záloha obsahuje duplicitní soubory.".to_string());
            }
        }
    }
    Ok(())
}

fn list_from(path: &Path) -> Result<ZipContents, String> {
    let mut archive = open_archive(path)?;
    reject_duplicates(&archive)?;
    let mut out = ZipContents::default();
    let mut seen = HashSet::new();
    let mut budget = MAX_TOTAL_JSON;
    for i in 0..archive.len() {
        let Ok(mut entry) = archive.by_index(i) else { continue };
        if entry.is_dir() {
            continue;
        }
        let entry_name = entry.name().to_string();
        if entry_name == DATA_ENTRY {
            let bytes = read_limited(&mut entry, MAX_DATA_JSON)
                .map_err(|e| format!("Soubor s daty v záloze nelze přečíst: {e}"))?
                .ok_or_else(|| "Soubor s daty v záloze je příliš velký".to_string())?;
            let text = String::from_utf8(bytes).map_err(|_| "Soubor s daty v záloze není text UTF-8".to_string())?;
            out.data_json.get_or_insert(text);
            continue;
        }
        let Some(name) = invoice_entry_name(&entry_name) else { continue };
        if !seen.insert(name.to_string()) {
            continue;
        }
        if has_ext(name, ".pdf") {
            out.pdf_names.push(name.to_string());
        } else if entry.size() <= MAX_INVOICE_JSON && entry.size() <= budget {
            // Unreadable, oversized or non-UTF-8 JSON is not an invoice we could use: skip it.
            let Ok(Some(bytes)) = read_limited(&mut entry, MAX_INVOICE_JSON) else { continue };
            let Ok(text) = String::from_utf8(bytes) else { continue };
            budget = budget.saturating_sub(text.len() as u64);
            out.invoice_jsons.push((name.to_string(), text));
        }
    }
    Ok(out)
}

fn exists_at_all(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok()
}

/// Extracts `faktury/<name>` for every name into `dest_dir` (flattened), all or nothing. Like `move_invoices`, an
/// existing target (looked up on the file system, so case-insensitive ones count) that is not listed in `overwrite`
/// is a conflict ("Konflikt: <name>") and nothing is written. Every file is staged as
/// a temporary file first, and only when all of them are complete are they renamed into place. A replaced file
/// is kept aside until the last rename succeeded, so a failure puts every previous file back.
fn extract_to(path: &Path, names: &[String], dest_dir: &Path, overwrite: &[String]) -> Result<(), String> {
    let mut seen = HashSet::new();
    let names: Vec<&String> = names.iter().filter(|n| seen.insert(n.as_str())).collect();
    for n in names.iter().copied().chain(overwrite) {
        validate_invoice_file(n)?;
    }
    let overwrite: HashSet<&str> = overwrite.iter().map(String::as_str).collect();
    let mut archive = open_archive(path)?;
    reject_duplicates(&archive)?;
    for n in &names {
        if archive.index_for_name(&format!("{INVOICE_PREFIX}{n}")).is_none() {
            return Err(format!("V záloze chybí soubor {n}"));
        }
        let target = dest_dir.join(n);
        if exists_at_all(&target) {
            if !overwrite.contains(n.as_str()) {
                return Err(format!("Konflikt: {n}"));
            }
            if !target.is_file() {
                return Err(format!("Cíl není soubor: {}", target.display()));
            }
        }
    }
    fs::create_dir_all(dest_dir).map_err(|e| format!("Nelze vytvořit složku: {e}"))?;

    // Stage everything.
    let mut staged: Vec<(PathBuf, PathBuf)> = Vec::new(); // (temp, target)
    let cleanup = |staged: &[(PathBuf, PathBuf)]| {
        for (tmp, _) in staged {
            let _ = fs::remove_file(tmp);
        }
    };
    for n in &names {
        let target = dest_dir.join(n);
        let tmp = sibling_with_suffix(&target, ".importing");
        let staged_ok = (|| -> Result<(), String> {
            let entry = archive.by_name(&format!("{INVOICE_PREFIX}{n}")).map_err(|e| format!("Nelze přečíst soubor {n}: {e}"))?;
            let mut out = fs::File::create(&tmp).map_err(|e| format!("Nelze zapsat soubor {}: {e}", tmp.display()))?;
            staged.push((tmp.clone(), target.clone()));
            let copied = io::copy(&mut entry.take(MAX_EXTRACT_FILE + 1), &mut out)
                .map_err(|e| format!("Nelze rozbalit soubor {n}: {e}"))?;
            if copied > MAX_EXTRACT_FILE {
                return Err(format!("Soubor {n} je příliš velký"));
            }
            out.flush().and_then(|_| out.sync_all()).map_err(|e| format!("Nelze zapsat soubor {}: {e}", tmp.display()))
        })();
        if let Err(e) = staged_ok {
            cleanup(&staged);
            return Err(e);
        }
    }

    // Move into place, keeping what is replaced.
    let mut placed: Vec<(PathBuf, Option<PathBuf>)> = Vec::new(); // (target, aside)
    for (tmp, target) in &staged {
        let aside = sibling_with_suffix(target, ".importold");
        let had_old = target.is_file();
        // A file that appeared since the first check is a conflict, not something to overwrite.
        let name = target.file_name().unwrap_or_default().to_string_lossy().into_owned();
        if exists_at_all(target) && !overwrite.contains(name.as_str()) {
            for (t, a) in placed.iter().rev() {
                let _ = fs::remove_file(t);
                if let Some(a) = a {
                    let _ = fs::rename(a, t);
                }
            }
            cleanup(&staged);
            return Err(format!("Konflikt: {name}"));
        }
        let step = (|| -> io::Result<()> {
            if had_old {
                fs::rename(target, &aside)?;
            }
            placed.push((target.clone(), had_old.then(|| aside.clone())));
            fs::rename(tmp, target)
        })();
        if let Err(e) = step {
            for (t, a) in placed.iter().rev() {
                let _ = fs::remove_file(t);
                if let Some(a) = a {
                    let _ = fs::rename(a, t);
                }
            }
            cleanup(&staged);
            return Err(format!("Nelze zapsat soubor {}: {e}", target.display()));
        }
    }
    for (_, aside) in &placed {
        if let Some(a) = aside {
            let _ = fs::remove_file(a);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn export_zip(invoice_dir: String, files: Vec<String>, data_json: String, dest: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || export_to(Path::new(&invoice_dir), &files, &data_json, Path::new(&dest)))
        .await
        .map_err(|e| format!("Export se nezdařil: {e}"))?
}

#[tauri::command]
pub async fn zip_list(path: String) -> Result<ZipContents, String> {
    tauri::async_runtime::spawn_blocking(move || list_from(Path::new(&path)))
        .await
        .map_err(|e| format!("Záložní soubor se nepodařilo přečíst: {e}"))?
}

#[tauri::command]
pub async fn zip_extract(path: String, names: Vec<String>, dest_dir: String, overwrite: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || extract_to(Path::new(&path), &names, Path::new(&dest_dir), &overwrite))
        .await
        .map_err(|e| format!("Import se nezdařil: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    fn listing(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    /// Builds a zip with the given (entry name, bytes) pairs, taking the names literally.
    fn make_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut w = zip::ZipWriter::new(fs::File::create(path).unwrap());
        for (name, bytes) in entries {
            w.start_file(*name, SimpleFileOptions::default()).unwrap();
            w.write_all(bytes).unwrap();
        }
        w.finish().unwrap();
    }

    fn invoice_dir(root: &Path) -> PathBuf {
        let dir = root.join("Faktury");
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("2026-11_faktura-1.json"), "{\"n\":1}").unwrap();
        fs::write(dir.join("2026-11_faktura-1.pdf"), b"pdf-1").unwrap();
        fs::write(dir.join("lone.pdf"), b"pdf-lone").unwrap();
        dir
    }

    #[test]
    fn export_then_list_roundtrip() {
        let root = tempfile::tempdir().unwrap();
        let dir = invoice_dir(root.path());
        let dest = root.path().join("out.zip");
        export_to(&dir, &s(&["2026-11_faktura-1.json", "2026-11_faktura-1.pdf", "lone.pdf"]), "{\"data\":true}", &dest).unwrap();
        assert!(!sibling_with_suffix(&dest, ".tmp").exists());

        let c = list_from(&dest).unwrap();
        assert_eq!(c.invoice_jsons, vec![("2026-11_faktura-1.json".to_string(), "{\"n\":1}".to_string())]);
        let mut pdfs = c.pdf_names.clone();
        pdfs.sort();
        assert_eq!(pdfs, s(&["2026-11_faktura-1.pdf", "lone.pdf"]));
        assert_eq!(c.data_json.as_deref(), Some("{\"data\":true}"));
    }

    #[test]
    fn export_replaces_existing_dest_and_fails_cleanly_on_a_missing_file() {
        let root = tempfile::tempdir().unwrap();
        let dir = invoice_dir(root.path());
        let dest = root.path().join("out.zip");
        fs::write(&dest, b"previous").unwrap();
        assert!(export_to(&dir, &s(&["gone.json"]), "{}", &dest).is_err());
        assert_eq!(fs::read(&dest).unwrap(), b"previous");
        assert!(!sibling_with_suffix(&dest, ".tmp").exists());
        assert!(export_to(&dir, &s(&["../x.json"]), "{}", &dest).is_err());
    }

    #[test]
    fn list_ignores_non_faktury_entries() {
        let root = tempfile::tempdir().unwrap();
        let zip = root.path().join("in.zip");
        make_zip(&zip, &[
            ("faktury/a.json", b"{}"),
            ("faktury/a.pdf", b"pdf"),
            ("faktury/readme.txt", b"x"),
            ("faktury/sub/b.json", b"{}"),
            ("faktury/../evil.json", b"{}"),
            ("faktury/c:d.json", b"{}"),
            ("other/x.json", b"{}"),
            ("x.pdf", b"pdf"),
            ("faktura-data.json", b"{\"d\":1}"),
            ("sub/faktura-data.json", b"{\"d\":2}"),
        ]);
        let c = list_from(&zip).unwrap();
        assert_eq!(c.invoice_jsons, vec![("a.json".to_string(), "{}".to_string())]);
        assert_eq!(c.pdf_names, s(&["a.pdf"]));
        assert_eq!(c.data_json.as_deref(), Some("{\"d\":1}"));
    }

    #[test]
    fn list_skips_oversized_invoice_json() {
        let root = tempfile::tempdir().unwrap();
        let zip = root.path().join("in.zip");
        let big = vec![b' '; MAX_INVOICE_JSON as usize + 1];
        make_zip(&zip, &[("faktury/big.json", &big), ("faktury/ok.json", b"{}")]);
        let c = list_from(&zip).unwrap();
        assert_eq!(c.invoice_jsons, vec![("ok.json".to_string(), "{}".to_string())]);
    }

    #[test]
    fn extract_writes_flattened_files() {
        let root = tempfile::tempdir().unwrap();
        let zip = root.path().join("in.zip");
        make_zip(&zip, &[("faktury/a.json", b"{\"a\":1}"), ("faktury/a.pdf", b"pdf-a"), ("faktury/b.pdf", b"pdf-b")]);
        let dest = root.path().join("new").join("Faktury");
        extract_to(&zip, &s(&["a.json", "a.pdf"]), &dest, &[]).unwrap();
        assert_eq!(listing(&dest), ["a.json", "a.pdf"]);
        assert_eq!(fs::read(dest.join("a.json")).unwrap(), b"{\"a\":1}");
    }

    #[test]
    fn extract_overwrites_existing_files() {
        let root = tempfile::tempdir().unwrap();
        let zip = root.path().join("in.zip");
        make_zip(&zip, &[("faktury/a.json", b"new")]);
        let dest = root.path().join("d");
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("a.json"), b"old").unwrap();
        extract_to(&zip, &s(&["a.json"]), &dest, &s(&["a.json"])).unwrap();
        assert_eq!(fs::read(dest.join("a.json")).unwrap(), b"new");
        assert_eq!(listing(&dest), ["a.json"]);
    }

    #[test]
    fn extract_rejects_path_traversal() {
        let root = tempfile::tempdir().unwrap();
        let zip = root.path().join("in.zip");
        make_zip(&zip, &[("faktury/../evil.json", b"{}"), ("faktury/a.json", b"{}"), ("evil2.json", b"{}")]);
        let dest = root.path().join("d");
        fs::create_dir(&dest).unwrap();
        for bad in ["../evil.json", "..", "sub/a.json", "..\\evil.json", "/etc/x.json", "C:evil.json", "evil.json", "evil2.json"] {
            assert!(extract_to(&zip, &s(&["a.json", bad]), &dest, &s(&["a.json", bad])).is_err(), "accepted {bad}");
        }
        // nothing was written, not even the valid name requested alongside a bad one
        assert_eq!(listing(&dest), Vec::<String>::new());
        assert!(!root.path().join("evil.json").exists());
    }

    #[test]
    fn extract_rejects_other_extensions() {
        let root = tempfile::tempdir().unwrap();
        let zip = root.path().join("in.zip");
        make_zip(&zip, &[("faktury/run.exe", b"x")]);
        let dest = root.path().join("d");
        assert!(extract_to(&zip, &s(&["run.exe"]), &dest, &[]).is_err());
        assert!(!dest.exists());
    }

    #[test]
    fn extract_failure_writes_nothing_and_keeps_existing_files() {
        let root = tempfile::tempdir().unwrap();
        let zip = root.path().join("in.zip");
        make_zip(&zip, &[("faktury/a.json", b"new-a"), ("faktury/b.json", b"new-b")]);
        let dest = root.path().join("d");
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("a.json"), b"old-a").unwrap();
        // an entry that is missing from the zip
        assert!(extract_to(&zip, &s(&["a.json", "b.json", "missing.json"]), &dest, &s(&["a.json"])).is_err());
        assert_eq!(fs::read(dest.join("a.json")).unwrap(), b"old-a");
        assert_eq!(listing(&dest), ["a.json"]);
        // a directory at a target is refused up front, so the first file is not replaced either
        fs::create_dir(dest.join("b.json")).unwrap();
        assert!(extract_to(&zip, &s(&["a.json", "b.json"]), &dest, &s(&["a.json", "b.json"])).is_err());
        assert_eq!(fs::read(dest.join("a.json")).unwrap(), b"old-a");
        assert_eq!(listing(&dest), ["a.json", "b.json"]);
    }

    #[test]
    fn extract_refuses_to_overwrite_a_file_not_listed_in_overwrite() {
        let root = tempfile::tempdir().unwrap();
        let zip = root.path().join("in.zip");
        make_zip(&zip, &[("faktury/a.json", b"new-a"), ("faktury/b.json", b"new-b")]);
        let dest = root.path().join("d");
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("b.json"), b"unknown-old-b").unwrap();
        let e = extract_to(&zip, &s(&["a.json", "b.json"]), &dest, &[]).unwrap_err();
        assert_eq!(e, "Konflikt: b.json");
        assert_eq!(fs::read(dest.join("b.json")).unwrap(), b"unknown-old-b");
        assert_eq!(listing(&dest), ["b.json"]);
        // overwrite only covers the listed names
        let e = extract_to(&zip, &s(&["a.json", "b.json"]), &dest, &s(&["a.json"])).unwrap_err();
        assert_eq!(e, "Konflikt: b.json");
        extract_to(&zip, &s(&["a.json", "b.json"]), &dest, &s(&["b.json"])).unwrap();
        assert_eq!(fs::read(dest.join("b.json")).unwrap(), b"new-b");
    }

    #[test]
    fn extract_writes_a_listed_overwrite_name_that_does_not_exist_yet() {
        // a name in overwrite that does not exist is simply written
        let root = tempfile::tempdir().unwrap();
        let zip = root.path().join("in.zip");
        make_zip(&zip, &[("faktury/a.json", b"new-a")]);
        let dest = root.path().join("d");
        extract_to(&zip, &s(&["a.json"]), &dest, &s(&["a.json"])).unwrap();
        assert_eq!(fs::read(dest.join("a.json")).unwrap(), b"new-a");
    }

    #[test]
    fn list_and_extract_reject_duplicate_names_compared_case_insensitively() {
        let root = tempfile::tempdir().unwrap();
        let zip = root.path().join("in.zip");
        make_zip(&zip, &[("faktury/A.json", b"{\"first\":1}"), ("faktury/a.json", b"{\"second\":1}")]);
        assert_eq!(list_from(&zip).unwrap_err(), "Záloha obsahuje duplicitní soubory.");
        let dest = root.path().join("d");
        assert_eq!(extract_to(&zip, &s(&["a.json"]), &dest, &[]).unwrap_err(), "Záloha obsahuje duplicitní soubory.");
        assert!(!dest.exists());
        // the same name outside faktury/ is not a duplicate
        let ok = root.path().join("ok.zip");
        make_zip(&ok, &[("faktury/a.json", b"{}"), ("other/a.json", b"{}"), ("faktury/a.pdf", b"p")]);
        assert!(list_from(&ok).is_ok());
    }
}
