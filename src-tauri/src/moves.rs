use crate::files::sibling_with_suffix;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct MoveReport {
    pub moved: usize,
}

/// Names must be plain file names: no separators or `:` (a drive prefix would make `Path::join` leave the folder), not empty, not `.`/`..` (a name like `a..b` is harmless without separators).
pub(crate) fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0', ':']) {
        return Err(format!("Neplatný název souboru: {name}"));
    }
    Ok(())
}

fn exists_at_all(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok()
}

fn files_equal(a: &Path, b: &Path) -> io::Result<bool> {
    let mut fa = fs::File::open(a)?;
    let mut fb = fs::File::open(b)?;
    if fa.metadata()?.len() != fb.metadata()?.len() {
        return Ok(false);
    }
    let mut buf_a = vec![0u8; 64 * 1024];
    let mut buf_b = vec![0u8; 64 * 1024];
    loop {
        let n = fa.read(&mut buf_a)?;
        if n == 0 {
            // `a` is exhausted; `b` must be as well (the lengths matched, but the files may have changed since).
            return Ok(fb.read(&mut buf_b)? == 0);
        }
        fb.read_exact(&mut buf_b[..n])?;
        if buf_a[..n] != buf_b[..n] {
            return Ok(false);
        }
    }
}

/// Copies `src` to the new file `tmp` (refusing to touch an existing one), fsyncs it and checks size + bytes.
/// `created` gets `tmp` as soon as the file exists, so a failure afterwards can be cleaned up.
fn copy_verified(src: &Path, tmp: &Path, created: &mut Vec<PathBuf>) -> Result<(), String> {
    let meta = fs::metadata(src).map_err(|e| format!("Nelze načíst soubor {}: {e}", src.display()))?;
    if !meta.is_file() {
        return Err(format!("Není to soubor: {}", src.display()));
    }
    let mut input = fs::File::open(src).map_err(|e| format!("Nelze načíst soubor {}: {e}", src.display()))?;
    let mut out = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tmp)
        .map_err(|e| format!("Nelze zapsat soubor {}: {e}", tmp.display()))?;
    created.push(tmp.to_path_buf());
    io::copy(&mut input, &mut out).map_err(|e| format!("Nelze zkopírovat soubor {}: {e}", src.display()))?;
    out.flush().and_then(|_| out.sync_all()).map_err(|e| format!("Nelze zapsat soubor {}: {e}", tmp.display()))?;
    drop(out);

    let copied = fs::metadata(tmp).map_err(|e| e.to_string())?.len();
    if copied != meta.len() {
        return Err(format!("Kopie souboru {} nesouhlasí velikostí", src.display()));
    }
    match files_equal(src, tmp) {
        Ok(true) => Ok(()),
        Ok(false) => Err(format!("Kopie souboru {} se liší od originálu", src.display())),
        Err(e) => Err(format!("Nelze ověřit kopii souboru {}: {e}", src.display())),
    }
}

#[cfg(unix)]
fn sync_dir(dir: &Path) {
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
}
#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

/// Start of the error returned when the copies are in `to` but some originals could not be removed.
/// The UI recognises it (`PARTIAL_MOVE_MARKER` in src/settings/folderMove.ts), so keep both in sync.
const PARTIAL_MARKER: &str = "Faktury byly zkopírovány do nové složky";

/// Deletes each source whose target is a different file with identical bytes. A source that is the same file
/// as its target (alias, hard link) or that changed since it was copied (e.g. saved by another program) is left
/// in place. Returns a description of every source that was not deleted.
fn delete_sources(pairs: &[(PathBuf, PathBuf)]) -> Vec<String> {
    let mut left = Vec::new();
    for (source, target) in pairs {
        let reason = match same_file::is_same_file(source, target) {
            Ok(true) => Some("je to stejný soubor jako cíl".to_string()),
            Err(e) => Some(e.to_string()),
            Ok(false) => match files_equal(source, target) {
                Ok(true) => fs::remove_file(source).err().map(|e| e.to_string()),
                Ok(false) => Some("změněn po zkopírování".to_string()),
                Err(e) => Some(e.to_string()),
            },
        };
        if let Some(r) = reason {
            left.push(format!("{} ({r})", source.display()));
        }
    }
    left
}

/// Moves the named files from `from` to `to`, all or nothing as far as the originals are concerned:
///
/// 1. Every name is copied to a temporary name in `to`, fsynced and verified (size + bytes).
/// 2. Only when all copies are verified are they renamed into place. A name listed in `overwrite`
///    replaces an existing target atomically; any other existing target is a conflict.
/// 3. Only then are the originals deleted.
///
/// A failure in 1 or 2 removes every file this call created in `to` and leaves `from` untouched. (A target
/// replaced through `overwrite` cannot be restored, which is why all verification happens before step 2.)
/// A failure in 3 (see `delete_sources`) keeps the verified copies: the data is safe in `to`, the error tells which originals remain.
fn move_between(from: &Path, to: &Path, names: &[String], overwrite: &[String]) -> Result<MoveReport, String> {
    for n in names.iter().chain(overwrite) {
        validate_name(n)?;
    }
    let mut seen = HashSet::new();
    let names: Vec<&String> = names.iter().filter(|n| seen.insert(n.as_str())).collect();
    let overwrite: HashSet<&str> = overwrite.iter().map(String::as_str).collect();

    let from_real = fs::canonicalize(from).map_err(|e| format!("Zdrojová složka není dostupná: {e}"))?;
    if let Ok(to_real) = fs::canonicalize(to) {
        if to_real == from_real {
            return Err("Zdrojová a cílová složka je stejná".to_string());
        }
    }
    for n in &names {
        if !overwrite.contains(n.as_str()) && exists_at_all(&to.join(n)) {
            return Err(format!("Konflikt: {n}"));
        }
    }

    // Directories we create, outermost first, so a failed move can take them away again.
    let mut missing_dirs: Vec<PathBuf> = to.ancestors().take_while(|p| !p.as_os_str().is_empty() && !p.exists()).map(Path::to_path_buf).collect();
    missing_dirs.reverse();
    fs::create_dir_all(to).map_err(|e| format!("Nelze vytvořit složku: {e}"))?;
    if fs::canonicalize(to).map_err(|e| e.to_string())? == from_real {
        return Err("Zdrojová a cílová složka je stejná".to_string());
    }

    let mut temps: Vec<PathBuf> = Vec::new();
    let mut placed: Vec<PathBuf> = Vec::new();
    let rollback = |temps: &[PathBuf], placed: &[PathBuf]| {
        for p in temps.iter().chain(placed) {
            let _ = fs::remove_file(p);
        }
        for d in missing_dirs.iter().rev() {
            let _ = fs::remove_dir(d); // only succeeds while empty
        }
    };

    // Step 1: copy + verify everything.
    let mut plan: Vec<(PathBuf, PathBuf, PathBuf, bool)> = Vec::new(); // (source, temp, target, replaces)
    for n in &names {
        let target = to.join(n);
        let tmp = sibling_with_suffix(&target, ".moving");
        if let Err(e) = copy_verified(&from.join(n), &tmp, &mut temps) {
            rollback(&temps, &placed);
            return Err(e);
        }
        plan.push((from.join(n), tmp, target, overwrite.contains(n.as_str())));
    }

    // Step 2: rename into place. Targets that appeared since the first check are conflicts, not overwrites.
    for (_, _, target, replaces) in &plan {
        if !replaces && exists_at_all(target) {
            rollback(&temps, &placed);
            let name = target.file_name().unwrap_or_default().to_string_lossy().into_owned();
            return Err(format!("Konflikt: {name}"));
        }
    }
    for (_, tmp, target, replaces) in &plan {
        if let Err(e) = fs::rename(tmp, target) {
            rollback(&temps, &placed);
            return Err(format!("Nelze přesunout soubor {}: {e}", target.display()));
        }
        temps.retain(|t| t != tmp);
        if !replaces {
            placed.push(target.clone());
        }
    }
    sync_dir(to);

    // Step 3: everything is in place and verified, so the originals can go.
    let pairs: Vec<(PathBuf, PathBuf)> = plan.iter().map(|(source, _, target, _)| (source.clone(), target.clone())).collect();
    let left = delete_sources(&pairs);
    if !left.is_empty() {
        return Err(format!("{PARTIAL_MARKER}, ale původní soubory zůstaly na místě: {}", left.join(", ")));
    }
    Ok(MoveReport { moved: plan.len() })
}

#[tauri::command]
pub async fn move_invoices(from: String, to: String, names: Vec<String>, overwrite: Vec<String>) -> Result<MoveReport, String> {
    tauri::async_runtime::spawn_blocking(move || move_between(Path::new(&from), Path::new(&to), &names, &overwrite))
        .await
        .map_err(|e| format!("Přesun se nezdařil: {e}"))?
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

    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let from = root.path().join("old");
        let to = root.path().join("new");
        fs::create_dir(&from).unwrap();
        fs::create_dir(&to).unwrap();
        (root, from, to)
    }

    #[test]
    fn moves_and_deletes_sources() {
        let (_root, from, to) = setup();
        fs::write(from.join("a.pdf"), b"pdf-a").unwrap();
        fs::write(from.join("a.json"), b"{\"a\":1}").unwrap();
        fs::write(from.join("other.txt"), b"stays").unwrap();
        let r = move_between(&from, &to, &s(&["a.pdf", "a.json"]), &[]).unwrap();
        assert_eq!(r.moved, 2);
        assert_eq!(fs::read(to.join("a.pdf")).unwrap(), b"pdf-a");
        assert_eq!(fs::read(to.join("a.json")).unwrap(), b"{\"a\":1}");
        assert_eq!(listing(&from), ["other.txt"]);
        assert_eq!(listing(&to), ["a.json", "a.pdf"]);
    }

    #[test]
    fn creates_missing_target_folder() {
        let (root, from, _to) = setup();
        let to = root.path().join("deep").join("er");
        fs::write(from.join("a.pdf"), b"x").unwrap();
        move_between(&from, &to, &s(&["a.pdf"]), &[]).unwrap();
        assert_eq!(fs::read(to.join("a.pdf")).unwrap(), b"x");
        assert!(!from.join("a.pdf").exists());
    }

    #[test]
    fn conflict_aborts_before_copy() {
        let (_root, from, to) = setup();
        fs::write(from.join("a.pdf"), b"new-a").unwrap();
        fs::write(from.join("b.pdf"), b"new-b").unwrap();
        fs::write(to.join("b.pdf"), b"existing-b").unwrap();
        let e = move_between(&from, &to, &s(&["a.pdf", "b.pdf"]), &[]).unwrap_err();
        assert_eq!(e, "Konflikt: b.pdf");
        assert_eq!(listing(&from), ["a.pdf", "b.pdf"]);
        assert_eq!(listing(&to), ["b.pdf"]);
        assert_eq!(fs::read(to.join("b.pdf")).unwrap(), b"existing-b");
    }

    #[test]
    fn overwrite_listed_name_replaces() {
        let (_root, from, to) = setup();
        fs::write(from.join("a.pdf"), b"new-a").unwrap();
        fs::write(from.join("a.json"), b"new-j").unwrap();
        fs::write(to.join("a.pdf"), b"old-a").unwrap();
        fs::write(to.join("a.json"), b"old-j").unwrap();
        fs::write(to.join("keep.pdf"), b"keep").unwrap();
        let r = move_between(&from, &to, &s(&["a.pdf", "a.json"]), &s(&["a.pdf", "a.json"])).unwrap();
        assert_eq!(r.moved, 2);
        assert_eq!(fs::read(to.join("a.pdf")).unwrap(), b"new-a");
        assert_eq!(fs::read(to.join("a.json")).unwrap(), b"new-j");
        assert_eq!(fs::read(to.join("keep.pdf")).unwrap(), b"keep");
        assert!(listing(&from).is_empty());
        assert_eq!(listing(&to), ["a.json", "a.pdf", "keep.pdf"]);
    }

    #[test]
    fn overwrite_only_covers_listed_names() {
        let (_root, from, to) = setup();
        fs::write(from.join("a.pdf"), b"new-a").unwrap();
        fs::write(from.join("a.json"), b"new-j").unwrap();
        fs::write(to.join("a.pdf"), b"old-a").unwrap();
        fs::write(to.join("a.json"), b"old-j").unwrap();
        let e = move_between(&from, &to, &s(&["a.pdf", "a.json"]), &s(&["a.pdf"])).unwrap_err();
        assert_eq!(e, "Konflikt: a.json");
        assert_eq!(fs::read(to.join("a.pdf")).unwrap(), b"old-a");
        assert_eq!(listing(&from), ["a.json", "a.pdf"]);
    }

    #[test]
    fn failure_midway_keeps_sources_and_cleans_target() {
        let (_root, from, to) = setup();
        fs::write(from.join("a.pdf"), b"pdf-a").unwrap();
        // "gone.pdf" does not exist, so the second copy fails after the first one was staged.
        fs::write(to.join("existing.pdf"), b"existing").unwrap();
        fs::write(to.join("a2.pdf"), b"old-a2").unwrap();
        fs::write(from.join("a2.pdf"), b"new-a2").unwrap();
        let e = move_between(&from, &to, &s(&["a.pdf", "a2.pdf", "gone.pdf"]), &s(&["a2.pdf"])).unwrap_err();
        assert!(e.contains("gone.pdf"), "{e}");
        assert_eq!(listing(&from), ["a.pdf", "a2.pdf"]);
        assert_eq!(fs::read(from.join("a.pdf")).unwrap(), b"pdf-a");
        // nothing created in the target, nothing left over, and the overwrite target was not touched
        assert_eq!(listing(&to), ["a2.pdf", "existing.pdf"]);
        assert_eq!(fs::read(to.join("a2.pdf")).unwrap(), b"old-a2");
    }

    #[test]
    fn failure_removes_target_folder_it_created() {
        let (root, from, _to) = setup();
        let to = root.path().join("fresh");
        fs::write(from.join("a.pdf"), b"x").unwrap();
        assert!(move_between(&from, &to, &s(&["a.pdf", "gone.pdf"]), &[]).is_err());
        assert!(!to.exists());
        assert_eq!(listing(&from), ["a.pdf"]);
    }

    #[test]
    fn staging_name_collision_fails_and_touches_nothing_else() {
        let (_root, from, to) = setup();
        fs::write(from.join("a.pdf"), b"x").unwrap();
        fs::write(to.join("a.pdf.moving"), b"foreign").unwrap();
        assert!(move_between(&from, &to, &s(&["a.pdf"]), &[]).is_err());
        assert_eq!(fs::read(to.join("a.pdf.moving")).unwrap(), b"foreign");
        assert_eq!(listing(&from), ["a.pdf"]);
    }

    #[test]
    fn same_folder_is_rejected_without_changes() {
        let (_root, from, _to) = setup();
        fs::write(from.join("a.pdf"), b"x").unwrap();
        let alias = from.join(".").join("");
        let e = move_between(&from, &alias, &s(&["a.pdf"]), &[]).unwrap_err();
        assert!(e.contains("stejná"), "{e}");
        assert_eq!(fs::read(from.join("a.pdf")).unwrap(), b"x");
        assert_eq!(listing(&from), ["a.pdf"]);
    }

    #[test]
    fn rejects_names_that_are_not_plain_file_names() {
        let (_root, from, to) = setup();
        fs::write(from.join("a.pdf"), b"x").unwrap();
        for bad in ["../a.pdf", "sub/a.pdf", "sub\\a.pdf", "..", ".", ""] {
            assert!(move_between(&from, &to, &s(&[bad]), &[]).is_err(), "{bad:?}");
        }
        assert!(move_between(&from, &to, &s(&["a.pdf"]), &s(&["../x"])).is_err());
        assert_eq!(listing(&from), ["a.pdf"]);
        assert!(listing(&to).is_empty());
    }

    #[test]
    fn files_equal_detects_same_size_difference() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b, c) = (dir.path().join("a"), dir.path().join("b"), dir.path().join("c"));
        fs::write(&a, vec![1u8; 200_000]).unwrap();
        let mut other = vec![1u8; 200_000];
        other[199_999] = 2;
        fs::write(&b, &other).unwrap();
        fs::write(&c, vec![1u8; 200_000]).unwrap();
        assert!(!files_equal(&a, &b).unwrap());
        assert!(files_equal(&a, &c).unwrap());
    }

    #[test]
    fn rejects_names_with_a_colon() {
        // On Windows `C:x` would make Path::join escape the folder.
        let (_root, from, to) = setup();
        for bad in ["C:evil.pdf", "a:b.pdf", ":"] {
            assert!(move_between(&from, &to, &s(&[bad]), &[]).is_err(), "{bad:?}");
        }
        assert!(listing(&to).is_empty());
    }

    #[test]
    fn delete_sources_keeps_a_source_changed_since_the_copy() {
        let (_root, from, to) = setup();
        fs::write(from.join("a.pdf"), b"v1").unwrap();
        fs::write(from.join("b.pdf"), b"same").unwrap();
        fs::write(to.join("a.pdf"), b"v1").unwrap();
        fs::write(to.join("b.pdf"), b"same").unwrap();
        // a concurrent save rewrote the original after it was verified
        fs::write(from.join("a.pdf"), b"v2-edited").unwrap();
        let pairs = vec![(from.join("a.pdf"), to.join("a.pdf")), (from.join("b.pdf"), to.join("b.pdf"))];
        let left = delete_sources(&pairs);
        assert_eq!(left.len(), 1, "{left:?}");
        assert!(left[0].contains("a.pdf"), "{left:?}");
        assert_eq!(fs::read(from.join("a.pdf")).unwrap(), b"v2-edited");
        assert!(!from.join("b.pdf").exists());
    }

    #[test]
    fn delete_sources_keeps_a_source_that_is_the_same_file_as_its_target() {
        let (_root, from, to) = setup();
        fs::write(from.join("a.pdf"), b"x").unwrap();
        fs::hard_link(from.join("a.pdf"), to.join("a.pdf")).unwrap();
        let left = delete_sources(&[(from.join("a.pdf"), to.join("a.pdf"))]);
        assert_eq!(left.len(), 1, "{left:?}");
        assert_eq!(fs::read(from.join("a.pdf")).unwrap(), b"x");
        assert_eq!(fs::read(to.join("a.pdf")).unwrap(), b"x");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_target_folder_counts_as_the_same_folder() {
        let (root, from, _to) = setup();
        let alias = root.path().join("alias");
        std::os::unix::fs::symlink(&from, &alias).unwrap();
        fs::write(from.join("a.pdf"), b"x").unwrap();
        let e = move_between(&from, &alias, &s(&["a.pdf"]), &[]).unwrap_err();
        assert!(e.contains("stejná"), "{e}");
        assert_eq!(fs::read(from.join("a.pdf")).unwrap(), b"x");
    }

}
