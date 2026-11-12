use serde::Serialize;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

const DATA_FILE: &str = "faktura-data.json";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataLoad {
    pub contents: Option<String>,
    pub recovered_from_backup: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub size: u64,
    pub modified_ms: u64,
}

pub(crate) fn sibling_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

/// Writes `bytes` to `<path>.tmp`, fsyncs it, optionally moves the existing
/// file to `<path>.bak`, then renames the temp file over `path`.
pub fn write_atomic(path: &Path, bytes: &[u8], keep_bak: bool) -> io::Result<()> {
    let tmp = sibling_with_suffix(path, ".tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    let result = (|| {
        if keep_bak && path.exists() {
            fs::rename(path, sibling_with_suffix(path, ".bak"))?;
        }
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn is_valid_json(s: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(s).is_ok()
}

/// Writes the saved-details file. The current file becomes the `.bak` only when it is valid JSON,
/// so saving over a corrupt file never pushes out the last good backup; a corrupt file is kept
/// as `<path>.corrupt` instead (replacing any older one).
fn write_data_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let main_is_valid = match fs::read_to_string(path) {
        Ok(s) => is_valid_json(&s),
        Err(e) if e.kind() == io::ErrorKind::NotFound => return write_atomic(path, bytes, false),
        // unreadable (e.g. not UTF-8): treat like corrupt
        Err(_) => false,
    };
    if !main_is_valid {
        let corrupt = sibling_with_suffix(path, ".corrupt");
        if corrupt.exists() {
            fs::remove_file(&corrupt)?;
        }
        fs::rename(path, &corrupt)?;
    }
    write_atomic(path, bytes, main_is_valid)
}

fn read_valid_json(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(s) if is_valid_json(&s) => Ok(Some(s)),
        Ok(_) => Err("soubor není platný JSON".to_string()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn load_from(dir: &Path) -> DataLoad {
    let main_path = dir.join(DATA_FILE);
    let bak_path = sibling_with_suffix(&main_path, ".bak");

    let main_err = match read_valid_json(&main_path) {
        Ok(Some(contents)) => {
            return DataLoad { contents: Some(contents), recovered_from_backup: false, error: None };
        }
        Ok(None) => None,
        Err(e) => Some(e),
    };

    match read_valid_json(&bak_path) {
        Ok(Some(contents)) => DataLoad {
            contents: Some(contents),
            recovered_from_backup: true,
            error: None,
        },
        Ok(None) => match main_err {
            // main exists but is broken and there is no backup
            Some(e) => DataLoad {
                contents: None,
                recovered_from_backup: false,
                error: Some(format!("Nelze načíst soubor s daty: {e}")),
            },
            // nothing on disk yet
            None => DataLoad { contents: None, recovered_from_backup: false, error: None },
        },
        Err(bak_err) => DataLoad {
            contents: None,
            recovered_from_backup: false,
            error: Some(format!(
                "Nelze načíst soubor s daty ani zálohu: {}; záloha: {bak_err}",
                main_err.unwrap_or_else(|| "soubor neexistuje".to_string())
            )),
        },
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Nelze zjistit složku s daty: {e}"))
}

fn data_file_in(dir: &Path) -> PathBuf {
    dir.join(DATA_FILE)
}

#[tauri::command]
pub fn data_file_path(app: AppHandle) -> Result<String, String> {
    Ok(data_file_in(&data_dir(&app)?).to_string_lossy().into_owned())
}

#[tauri::command]
pub fn data_load(app: AppHandle) -> Result<DataLoad, String> {
    Ok(load_from(&data_dir(&app)?))
}

#[tauri::command]
pub fn data_save(app: AppHandle, contents: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Nelze vytvořit složku: {e}"))?;
    write_data_file(&data_file_in(&dir), contents.as_bytes())
        .map_err(|e| format!("Nelze zapsat soubor: {e}"))
}

#[tauri::command]
pub fn default_invoice_dir(app: AppHandle) -> Result<String, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("Nelze zjistit složku Dokumenty: {e}"))?;
    Ok(docs.join("Faktury").to_string_lossy().into_owned())
}

#[tauri::command]
pub fn write_invoice(dir: String, base_name: String, pdf: Vec<u8>, json: String) -> Result<(), String> {
    if base_name.is_empty()
        || base_name == "."
        || base_name == ".."
        || base_name.contains(['/', '\\'])
    {
        return Err(format!("Neplatný název souboru: {base_name}"));
    }
    let dir = PathBuf::from(dir);
    fs::create_dir_all(&dir).map_err(|e| format!("Nelze vytvořit složku: {e}"))?;
    write_pair(&dir, &base_name, &pdf, json.as_bytes())
        .map_err(|e| format!("Nelze zapsat soubor: {e}"))
}

fn stage(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut f = fs::File::create(path)?;
    f.write_all(bytes)?;
    f.sync_all()
}

/// Sub-folders of the invoice folder that new saves write to (0.1.0/0.2.0 wrote both files into the folder itself).
pub(crate) const PDF_DIR: &str = "pdf";
pub(crate) const JSON_DIR: &str = "json";

/// Writes `pdf/<base>.pdf` and `json/<base>.json` all-or-nothing, creating both sub-folders as needed: both files
/// are staged as `.tmp` files in their own folder first, so a failed write never leaves a lone PDF or JSON.
/// If the second rename fails, the first target is restored to its previous state.
fn write_pair(dir: &Path, base: &str, pdf: &[u8], json: &[u8]) -> io::Result<()> {
    let pdf_dir = dir.join(PDF_DIR);
    let json_dir = dir.join(JSON_DIR);
    fs::create_dir_all(&pdf_dir)?;
    fs::create_dir_all(&json_dir)?;
    let pdf_path = pdf_dir.join(format!("{base}.pdf"));
    let json_path = json_dir.join(format!("{base}.json"));
    let pdf_tmp = sibling_with_suffix(&pdf_path, ".tmp");
    let json_tmp = sibling_with_suffix(&json_path, ".tmp");
    let pdf_old = sibling_with_suffix(&pdf_path, ".old");

    let cleanup_tmp = || {
        let _ = fs::remove_file(&pdf_tmp);
        let _ = fs::remove_file(&json_tmp);
    };
    if let Err(e) = stage(&pdf_tmp, pdf).and_then(|_| stage(&json_tmp, json)) {
        cleanup_tmp();
        return Err(e);
    }

    // Move any existing PDF aside so it can be restored if the JSON rename fails.
    let had_old = pdf_path.is_file();
    if had_old {
        if let Err(e) = fs::rename(&pdf_path, &pdf_old) {
            cleanup_tmp();
            return Err(e);
        }
    }
    let result = fs::rename(&pdf_tmp, &pdf_path).and_then(|_| {
        fs::rename(&json_tmp, &json_path).map_err(|e| {
            let _ = fs::remove_file(&pdf_path);
            e
        })
    });
    match result {
        Ok(()) => {
            if had_old {
                let _ = fs::remove_file(&pdf_old);
            }
            Ok(())
        }
        Err(e) => {
            if had_old {
                let _ = fs::rename(&pdf_old, &pdf_path);
            }
            cleanup_tmp();
            Err(e)
        }
    }
}

#[tauri::command]
pub fn list_dir(dir: String) -> Result<Vec<DirEntry>, String> {
    let rd = match fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("Nelze načíst složku: {e}")),
    };
    let mut out = Vec::new();
    for entry in rd {
        let entry = entry.map_err(|e| format!("Nelze načíst složku: {e}"))?;
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            size: meta.len(),
            modified_ms,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Nelze načíst soubor: {e}"))
}

#[tauri::command]
pub fn trash_paths(paths: Vec<String>) -> Result<(), String> {
    trash::delete_all(paths).map_err(|e| format!("Nelze přesunout do koše: {e}"))
}

#[tauri::command]
pub fn delete_paths(paths: Vec<String>) -> Result<(), String> {
    for p in paths {
        match fs::remove_file(&p) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Nelze smazat soubor: {e}")),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn write_atomic_creates_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.json");
        write_atomic(&p, b"{\"a\":1}", true).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "{\"a\":1}");
        assert!(!dir.path().join("a.json.bak").exists());
        assert!(!dir.path().join("a.json.tmp").exists());
    }

    #[test]
    fn write_atomic_keeps_previous_as_bak() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.json");
        write_atomic(&p, b"one", true).unwrap();
        write_atomic(&p, b"two", true).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "two");
        assert_eq!(fs::read_to_string(dir.path().join("a.json.bak")).unwrap(), "one");
    }

    #[test]
    fn write_data_file_rotates_a_valid_main_to_bak() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(DATA_FILE);
        fs::write(&p, "{\"v\":1}").unwrap();
        write_data_file(&p, b"{\"v\":2}").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "{\"v\":2}");
        assert_eq!(fs::read_to_string(sibling_with_suffix(&p, ".bak")).unwrap(), "{\"v\":1}");
        assert!(!sibling_with_suffix(&p, ".corrupt").exists());
    }

    #[test]
    fn write_data_file_keeps_bak_and_sets_a_corrupt_main_aside() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(DATA_FILE);
        let bak = sibling_with_suffix(&p, ".bak");
        let corrupt = sibling_with_suffix(&p, ".corrupt");
        fs::write(&p, "{not json").unwrap();
        fs::write(&bak, "{\"v\":0}").unwrap();
        fs::write(&corrupt, "older junk").unwrap();
        write_data_file(&p, b"{\"v\":2}").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "{\"v\":2}");
        assert_eq!(fs::read_to_string(&bak).unwrap(), "{\"v\":0}");
        assert_eq!(fs::read_to_string(&corrupt).unwrap(), "{not json");
        assert_eq!(corrupt.file_name().unwrap(), "faktura-data.json.corrupt");
    }

    #[test]
    fn write_data_file_without_main_creates_it() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(DATA_FILE);
        write_data_file(&p, b"{}").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "{}");
        assert!(!sibling_with_suffix(&p, ".bak").exists());
        assert!(!sibling_with_suffix(&p, ".corrupt").exists());
    }

    #[test]
    fn data_file_in_joins_the_data_file_name() {
        let p = data_file_in(Path::new("/x/data"));
        assert_eq!(p, Path::new("/x/data").join("faktura-data.json"));
        assert_eq!(sibling_with_suffix(&p, ".bak").file_name().unwrap(), "faktura-data.json.bak");
    }

    #[test]
    fn load_prefers_main() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(DATA_FILE), "{\"v\":1}").unwrap();
        fs::write(dir.path().join(format!("{DATA_FILE}.bak")), "{\"v\":0}").unwrap();
        let r = load_from(dir.path());
        assert_eq!(r.contents.as_deref(), Some("{\"v\":1}"));
        assert!(!r.recovered_from_backup);
        assert!(r.error.is_none());
    }

    #[test]
    fn load_falls_back_to_bak_when_main_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(DATA_FILE), "{not json").unwrap();
        fs::write(dir.path().join(format!("{DATA_FILE}.bak")), "{\"v\":0}").unwrap();
        let r = load_from(dir.path());
        assert_eq!(r.contents.as_deref(), Some("{\"v\":0}"));
        assert!(r.recovered_from_backup);
        assert!(r.error.is_none());
    }

    #[test]
    fn load_reports_error_when_both_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(DATA_FILE), "{not json").unwrap();
        fs::write(dir.path().join(format!("{DATA_FILE}.bak")), "also bad").unwrap();
        let r = load_from(dir.path());
        assert!(r.contents.is_none());
        assert!(!r.recovered_from_backup);
        assert!(r.error.is_some());
    }

    #[test]
    fn load_none_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let r = load_from(dir.path());
        assert!(r.contents.is_none());
        assert!(!r.recovered_from_backup);
        assert!(r.error.is_none());
    }

    #[test]
    fn list_dir_missing_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope");
        let r = list_dir(missing.to_string_lossy().into_owned()).unwrap();
        assert!(r.is_empty());
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    #[test]
    fn write_pair_writes_into_pdf_and_json_subfolders_and_leaves_no_temps() {
        let dir = tempfile::tempdir().unwrap();
        write_pair(dir.path(), "x", b"pdf", b"{}").unwrap();
        assert_eq!(fs::read(dir.path().join("pdf").join("x.pdf")).unwrap(), b"pdf");
        assert_eq!(fs::read(dir.path().join("json").join("x.json")).unwrap(), b"{}");
        assert_eq!(names_in(dir.path()), ["json", "pdf"]);
        assert_eq!(names_in(&dir.path().join("pdf")), ["x.pdf"]);
        assert_eq!(names_in(&dir.path().join("json")), ["x.json"]);
    }

    #[test]
    fn write_pair_leaves_a_legacy_root_pair_alone() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("x.pdf"), b"legacy").unwrap();
        fs::write(dir.path().join("x.json"), b"{\"v\":0}").unwrap();
        write_pair(dir.path(), "x", b"new", b"{\"v\":1}").unwrap();
        assert_eq!(fs::read(dir.path().join("x.pdf")).unwrap(), b"legacy");
        assert_eq!(fs::read(dir.path().join("pdf").join("x.pdf")).unwrap(), b"new");
    }

    #[test]
    fn write_pair_leaves_no_orphan_pdf_when_json_target_is_unwritable() {
        let dir = tempfile::tempdir().unwrap();
        // a directory at the JSON target makes the rename fail
        fs::create_dir_all(dir.path().join("json").join("x.json")).unwrap();
        assert!(write_pair(dir.path(), "x", b"pdf", b"{}").is_err());
        assert!(!dir.path().join("pdf").join("x.pdf").exists());
        for sub in ["pdf", "json"] {
            let left: Vec<_> = names_in(&dir.path().join(sub))
                .into_iter()
                .filter(|n| n.ends_with(".tmp") || n.ends_with(".old"))
                .collect();
            assert!(left.is_empty(), "leftovers in {sub}: {left:?}");
        }
    }

    #[test]
    fn write_pair_restores_existing_pdf_when_json_target_is_unwritable() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("pdf")).unwrap();
        fs::write(dir.path().join("pdf").join("x.pdf"), b"old").unwrap();
        fs::create_dir_all(dir.path().join("json").join("x.json")).unwrap();
        assert!(write_pair(dir.path(), "x", b"new", b"{}").is_err());
        assert_eq!(fs::read(dir.path().join("pdf").join("x.pdf")).unwrap(), b"old");
        assert_eq!(names_in(&dir.path().join("pdf")), ["x.pdf"]);
        assert_eq!(names_in(&dir.path().join("json")), ["x.json"]);
    }

    #[test]
    fn write_pair_fails_cleanly_when_a_subfolder_cannot_be_created() {
        let dir = tempfile::tempdir().unwrap();
        // a file named `json` blocks the folder
        fs::write(dir.path().join("json"), b"in the way").unwrap();
        assert!(write_pair(dir.path(), "x", b"pdf", b"{}").is_err());
        assert!(!dir.path().join("pdf").join("x.pdf").exists());
        assert_eq!(fs::read(dir.path().join("json")).unwrap(), b"in the way");
    }

    #[test]
    fn write_pair_overwrites_existing_pair() {
        let dir = tempfile::tempdir().unwrap();
        write_pair(dir.path(), "x", b"old", b"{\"v\":1}").unwrap();
        write_pair(dir.path(), "x", b"new", b"{\"v\":2}").unwrap();
        assert_eq!(fs::read(dir.path().join("pdf").join("x.pdf")).unwrap(), b"new");
        assert_eq!(fs::read_to_string(dir.path().join("json").join("x.json")).unwrap(), "{\"v\":2}");
        assert_eq!(names_in(&dir.path().join("pdf")), ["x.pdf"]);
    }
}
