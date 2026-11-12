//! Background update engine: Windows release builds download a newer signed release into the
//! cache dir and install it at the next start. Every failure means "no update".

use crate::files::write_atomic;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

const BIN_FILE: &str = "pending.bin";
const META_FILE: &str = "pending.json";
const SKIP_FILE: &str = "skip.json";
/// After this many launched installs of the same pending version, give up on that version.
const MAX_INSTALL_ATTEMPTS: u32 = 2;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Serialize, Deserialize)]
struct PendingMeta {
    version: String,
    /// Installs launched for this version; metas written before the field existed read as 0.
    #[serde(default)]
    attempts: u32,
}

#[derive(Serialize, Deserialize)]
struct SkipMeta {
    version: String,
}

fn write_meta(dir: &Path, meta: &PendingMeta) -> io::Result<()> {
    let bytes = serde_json::to_vec(meta).map_err(io::Error::other)?;
    write_atomic(&dir.join(META_FILE), &bytes, false)
}

fn read_meta(dir: &Path) -> Option<PendingMeta> {
    serde_json::from_slice(&fs::read(dir.join(META_FILE)).ok()?).ok()
}

pub(crate) fn updates_enabled() -> bool {
    cfg!(windows) && !cfg!(debug_assertions)
}

pub(crate) fn is_newer(candidate: &str, current: &str) -> bool {
    match (semver::Version::parse(candidate), semver::Version::parse(current)) {
        (Ok(c), Ok(cur)) => c > cur,
        _ => false,
    }
}

/// Writes the installer bytes first and the meta last, each atomically, so an interrupted
/// write never yields a meta that points at incomplete bytes.
pub(crate) fn write_pending(dir: &Path, version: &str, bytes: &[u8]) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    // drop any old meta first so the old version never pairs with the new bytes
    let _ = fs::remove_file(dir.join(META_FILE));
    write_atomic(&dir.join(BIN_FILE), bytes, false)?;
    write_meta(dir, &PendingMeta { version: version.to_string(), attempts: 0 })?;
    // a new pending update supersedes any version given up on earlier
    let _ = fs::remove_file(dir.join(SKIP_FILE));
    Ok(())
}

/// Counts one more launched install of the pending update, persisted before `install` runs
/// (on Windows `install` exits the process, so nothing can be recorded afterwards).
pub(crate) fn record_install_attempt(dir: &Path) -> io::Result<()> {
    let mut meta = read_meta(dir)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no pending update"))?;
    meta.attempts = meta.attempts.saturating_add(1);
    write_meta(dir, &meta)
}

pub(crate) fn read_skip(dir: &Path) -> Option<String> {
    let skip: SkipMeta = serde_json::from_slice(&fs::read(dir.join(SKIP_FILE)).ok()?).ok()?;
    Some(skip.version)
}

pub(crate) fn write_skip(dir: &Path, version: &str) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let bytes = serde_json::to_vec(&SkipMeta { version: version.to_string() })
        .map_err(io::Error::other)?;
    write_atomic(&dir.join(SKIP_FILE), &bytes, false)
}

pub(crate) fn read_pending(dir: &Path) -> Option<(String, PathBuf)> {
    let meta = read_meta(dir)?;
    let bin = dir.join(BIN_FILE);
    bin.is_file().then_some((meta.version, bin))
}

pub(crate) fn clear_pending(dir: &Path) {
    let _ = fs::remove_file(dir.join(META_FILE));
    let _ = fs::remove_file(dir.join(BIN_FILE));
}

/// The pending version when it is newer than `current`. A version that is not newer is cleared;
/// one whose install was already launched `MAX_INSTALL_ATTEMPTS` times without taking effect is
/// cleared and recorded in `skip.json`, so a broken installer does not run on every start.
pub(crate) fn pending_version(dir: &Path, current: &str) -> Option<String> {
    read_pending(dir)?;
    let meta = read_meta(dir)?;
    if !is_newer(&meta.version, current) {
        clear_pending(dir);
        return None;
    }
    if meta.attempts >= MAX_INSTALL_ATTEMPTS {
        clear_pending(dir);
        let _ = write_skip(dir, &meta.version);
        return None;
    }
    Some(meta.version)
}

/// What `update_download` does with the release `available` from the update server.
#[derive(Debug, PartialEq)]
pub(crate) enum DownloadDecision {
    /// The user's machine gave up on this version (see `pending_version`): do nothing.
    Skip,
    /// This version is already downloaded and pending.
    AlreadyPending,
    Download,
}

/// `pending_version` runs before `read_skip`: when it gives up on an exhausted version it writes
/// skip.json first, so that version is never downloaded again (which would reset its attempts).
pub(crate) fn download_decision(dir: &Path, current: &str, available: &str) -> DownloadDecision {
    let pending = pending_version(dir, current);
    if read_skip(dir).as_deref() == Some(available) {
        return DownloadDecision::Skip;
    }
    if pending.as_deref() == Some(available) {
        return DownloadDecision::AlreadyPending;
    }
    DownloadDecision::Download
}

fn update_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|d| d.join("update"))
        .map_err(|e| e.to_string())
}

fn current_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

/// The version of a downloaded update newer than the running app, if any.
#[tauri::command]
pub fn update_pending(app: AppHandle) -> Option<String> {
    if !updates_enabled() {
        return None;
    }
    pending_version(&update_dir(&app).ok()?, &current_version(&app))
}

/// Installs the pending update after confirming it is still the latest release. On success the
/// process exits (Windows) or restarts, so the caller's promise may never settle.
#[tauri::command]
pub async fn update_install_pending(app: AppHandle) -> Result<(), String> {
    if !updates_enabled() {
        return Err("disabled".into());
    }
    let dir = update_dir(&app)?;
    // through pending_version so an exhausted or outdated pending update is never installed
    let pending = pending_version(&dir, &current_version(&app)).ok_or("no pending update")?;
    let bin = dir.join(BIN_FILE);
    // network or any other check error: keep the pending files for a later start
    let found = app
        .updater_builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let update = match found {
        Some(u) if u.version == pending => u,
        _ => {
            clear_pending(&dir);
            return Err("stale".into());
        }
    };
    let bytes = fs::read(&bin).map_err(|e| e.to_string())?;
    // a cached package that does not match the release signature would never install, and
    // update_download would not replace it (same version), so drop it
    if let Err(e) = update.verify(&bytes) {
        clear_pending(&dir);
        return Err(e.to_string());
    }
    // counted before install: on Windows a launched installer ends this process
    record_install_attempt(&dir).map_err(|e| e.to_string())?;
    update.install(bytes).map_err(|e| e.to_string())?;
    // on Windows install already exited the process; the leftover files are cleaned up at the
    // next start by pending_version (version no longer newer, or attempts exhausted)
    clear_pending(&dir);
    app.restart()
}

/// Checks for a newer release and downloads it in the background. `Ok(Some(version))` when an
/// update is now pending.
#[tauri::command]
pub async fn update_download(app: AppHandle) -> Result<Option<String>, String> {
    if !updates_enabled() {
        return Ok(None);
    }
    let dir = update_dir(&app)?;
    let found = app
        .updater_builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let Some(mut update) = found else {
        return Ok(None);
    };
    match download_decision(&dir, &current_version(&app), &update.version) {
        DownloadDecision::Skip => return Ok(None),
        DownloadDecision::AlreadyPending => return Ok(Some(update.version)),
        DownloadDecision::Download => {}
    }
    // check() leaves the returned update without a timeout; bound the download as well
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    // download verifies the signature; an invalid one is an error and nothing is written
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    write_pending(&dir, &update.version, &bytes).map_err(|e| e.to_string())?;
    Ok(Some(update.version))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn is_newer_compares_semver() {
        assert!(is_newer("0.3.0", "0.2.0"));
        assert!(!is_newer("0.2.0", "0.2.0"));
        assert!(!is_newer("0.1.9", "0.2.0"));
        assert!(!is_newer("garbage", "0.2.0"));
    }

    #[test]
    fn write_pending_then_read_pending() {
        let dir = tempfile::tempdir().unwrap();
        write_pending(dir.path(), "0.3.0", b"installer").unwrap();
        let (v, p) = read_pending(dir.path()).unwrap();
        assert_eq!(v, "0.3.0");
        assert_eq!(p, dir.path().join(BIN_FILE));
        assert_eq!(fs::read(&p).unwrap(), b"installer");
    }

    #[test]
    fn read_pending_missing_bin_or_bad_meta_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_pending(dir.path()).is_none());

        fs::write(dir.path().join(META_FILE), r#"{"version":"0.3.0"}"#).unwrap();
        assert!(read_pending(dir.path()).is_none());

        fs::write(dir.path().join(BIN_FILE), b"x").unwrap();
        fs::write(dir.path().join(META_FILE), "{").unwrap();
        assert!(read_pending(dir.path()).is_none());
    }

    #[test]
    fn write_pending_is_all_or_nothing() {
        let dir = tempfile::tempdir().unwrap();
        write_pending(dir.path(), "0.3.0", b"installer").unwrap();
        let tmps: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(tmps.is_empty());

        // a crash before the meta is written leaves only the bin: no pending update
        let crashed = tempfile::tempdir().unwrap();
        fs::write(crashed.path().join(BIN_FILE), b"installer").unwrap();
        assert!(read_pending(crashed.path()).is_none());
    }

    #[test]
    fn pending_version_clears_when_not_newer() {
        let dir = tempfile::tempdir().unwrap();
        write_pending(dir.path(), "0.2.0", b"old").unwrap();
        assert_eq!(pending_version(dir.path(), "0.2.0"), None);
        assert!(!dir.path().join(BIN_FILE).exists());
        assert!(!dir.path().join(META_FILE).exists());

        write_pending(dir.path(), "0.3.0", b"new").unwrap();
        assert_eq!(pending_version(dir.path(), "0.2.0"), Some("0.3.0".to_string()));
    }

    #[test]
    fn clear_pending_on_empty_dir_is_harmless() {
        let dir = tempfile::tempdir().unwrap();
        clear_pending(dir.path());
        clear_pending(&dir.path().join("missing"));
    }

    #[test]
    fn attempts_default_to_zero_and_old_metas_stay_valid() {
        let dir = tempfile::tempdir().unwrap();
        write_pending(dir.path(), "0.3.0", b"x").unwrap();
        assert_eq!(read_meta(dir.path()).unwrap().attempts, 0);

        fs::write(dir.path().join(META_FILE), r#"{"version":"0.3.0"}"#).unwrap();
        assert_eq!(read_meta(dir.path()).unwrap().attempts, 0);
        assert_eq!(pending_version(dir.path(), "0.2.0"), Some("0.3.0".to_string()));

        record_install_attempt(dir.path()).unwrap();
        let meta = read_meta(dir.path()).unwrap();
        assert_eq!((meta.version.as_str(), meta.attempts), ("0.3.0", 1));
        assert!(read_pending(dir.path()).is_some());
    }

    #[test]
    fn record_install_attempt_without_pending_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(record_install_attempt(dir.path()).is_err());
    }

    #[test]
    fn two_failed_installs_give_up_and_skip_the_version() {
        let dir = tempfile::tempdir().unwrap();
        write_pending(dir.path(), "0.3.0", b"x").unwrap();
        record_install_attempt(dir.path()).unwrap();
        assert_eq!(pending_version(dir.path(), "0.2.0"), Some("0.3.0".to_string()));
        assert_eq!(read_skip(dir.path()), None);

        record_install_attempt(dir.path()).unwrap();
        assert_eq!(pending_version(dir.path(), "0.2.0"), None);
        assert!(!dir.path().join(BIN_FILE).exists());
        assert!(!dir.path().join(META_FILE).exists());
        assert_eq!(read_skip(dir.path()), Some("0.3.0".to_string()));
    }

    #[test]
    fn download_after_exhausted_installs_skips_the_version() {
        let dir = tempfile::tempdir().unwrap();
        write_pending(dir.path(), "0.3.0", b"x").unwrap();
        record_install_attempt(dir.path()).unwrap();
        record_install_attempt(dir.path()).unwrap();
        // the 2nd install failed before the process exited; the same session now checks for updates
        assert_eq!(download_decision(dir.path(), "0.2.0", "0.3.0"), DownloadDecision::Skip);
        assert_eq!(read_skip(dir.path()), Some("0.3.0".to_string()));
        assert!(!dir.path().join(BIN_FILE).exists());
        // a newer release than the skipped one is downloaded again
        assert_eq!(download_decision(dir.path(), "0.2.0", "0.3.1"), DownloadDecision::Download);
    }

    #[test]
    fn download_decision_pending_and_fresh() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(download_decision(dir.path(), "0.2.0", "0.3.0"), DownloadDecision::Download);
        write_pending(dir.path(), "0.3.0", b"x").unwrap();
        record_install_attempt(dir.path()).unwrap();
        assert_eq!(download_decision(dir.path(), "0.2.0", "0.3.0"), DownloadDecision::AlreadyPending);
        // an older pending version is replaced by the newer release
        assert_eq!(download_decision(dir.path(), "0.2.0", "0.4.0"), DownloadDecision::Download);
    }

    #[test]
    fn skip_roundtrip_and_a_new_pending_write_clears_it() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_skip(dir.path()), None);
        write_skip(dir.path(), "0.3.0").unwrap();
        assert_eq!(read_skip(dir.path()), Some("0.3.0".to_string()));

        write_pending(dir.path(), "0.3.1", b"y").unwrap();
        assert_eq!(read_skip(dir.path()), None);
        assert!(!dir.path().join(SKIP_FILE).exists());
    }
}
