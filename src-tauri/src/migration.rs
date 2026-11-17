//! Optional, private first-run migration data. Normal builds embed no seed.
//! The plugin must be registered before SQL, which opens/migrates the database.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{plugin::TauriPlugin, Manager, Runtime, State};

struct EmbeddedSeed {
    manifest: &'static [u8],
    settings: &'static [u8],
    database: &'static [u8],
    secure_storage: Option<&'static [u8]>,
}

include!(concat!(env!("OUT_DIR"), "/migration_seed.rs"));

const MARKER_NAME: &str = "migration-seed-state.json";

#[derive(Deserialize)]
struct Manifest {
    #[serde(alias = "bundle_id", alias = "bundleId")]
    id: String,
}

#[derive(Clone, Serialize)]
pub struct MigrationSeed {
    id: String,
    entries: HashMap<String, String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct Marker {
    id: String,
    complete: bool,
    database_ready: bool,
    secure_ready: bool,
}

struct PendingSeed {
    payload: MigrationSeed,
    marker: Marker,
    marker_path: PathBuf,
}

#[derive(Default)]
struct MigrationInner {
    pending: Option<PendingSeed>,
    completed_id: Option<String>,
}

#[derive(Default)]
pub struct MigrationState(Mutex<MigrationInner>);

enum Preparation {
    Skipped,
    Complete(String),
    Pending(PendingSeed),
}

fn read_seed(seed: &EmbeddedSeed) -> Result<MigrationSeed, String> {
    let manifest: Manifest = serde_json::from_slice(seed.manifest)
        .map_err(|_| "迁移包信息损坏，未修改现有数据。".to_string())?;
    if manifest.id.is_empty() || manifest.id.len() > 128 {
        return Err("迁移包标识无效，未修改现有数据。".to_string());
    }
    let entries: HashMap<String, String> = serde_json::from_slice(seed.settings)
        .map_err(|_| "迁移包设置格式无效，未修改现有数据。".to_string())?;
    if !seed.database.starts_with(b"SQLite format 3\0") {
        return Err("迁移包数据库格式无效，未修改现有数据。".to_string());
    }
    if let Some(storage) = seed.secure_storage {
        let _: serde_json::Value = serde_json::from_slice(storage)
            .map_err(|_| "迁移包许可配置格式无效，未修改现有数据。".to_string())?;
    }
    Ok(MigrationSeed { id: manifest.id, entries })
}

// Publish without replacing an existing destination. MoveFileW, unlike a
// replace-capable rename, fails if another process created the target first.
#[cfg(target_os = "windows")]
fn publish_new(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileW(existing: *const u16, new: *const u16) -> i32;
    }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileW(source.as_ptr(), destination.as_ptr()) } == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn publish_new(source: &Path, destination: &Path) -> io::Result<()> {
    fs::hard_link(source, destination)?;
    fs::remove_file(source)
}

fn write_temporary(parent: &Path, bytes: &[u8]) -> io::Result<PathBuf> {
    let path = parent.join(format!(".migration-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new().create_new(true).write(true).open(&path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(path.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&path);
    }
    result
}

fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let temporary = write_temporary(path.parent().ok_or_else(|| io::Error::other("missing parent"))?, bytes)?;
    let result = publish_new(&temporary, path);
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

fn save_marker(path: &Path, marker: &Marker, new: bool) -> Result<(), String> {
    let bytes = serde_json::to_vec(marker).map_err(|_| "无法保存迁移进度。".to_string())?;
    let result = if new {
        write_new(path, &bytes)
    } else {
        let temporary = write_temporary(path.parent().ok_or("迁移目录无效。")?, &bytes)
            .map_err(|_| "无法保存迁移进度，请检查目录权限。".to_string())?;
        // This is our own progress marker, never an application data file.
        let result = fs::rename(&temporary, path);
        if result.is_err() { let _ = fs::remove_file(&temporary); }
        result
    };
    result.map_err(|_| "无法保存迁移进度，请检查目录权限。".to_string())
}

fn restore_file(path: &Path, bytes: &[u8], ready: bool) -> Result<(), String> {
    if path.exists() {
        if ready { return Ok(()); }
        // A previous run may have published the file just before it crashed.
        if fs::read(path).map_err(|_| "无法核验迁移文件。".to_string())? == bytes {
            return Ok(());
        }
        return Err("检测到已有数据，迁移已停止以避免覆盖。".to_string());
    }
    write_new(path, bytes).map_err(|_| "无法恢复迁移文件，未覆盖已有数据。".to_string())
}

fn prepare_seed(seed: &EmbeddedSeed, config_dir: &Path, local_dir: &Path) -> Result<Preparation, String> {
    let payload = read_seed(seed)?;
    let marker_path = config_dir.join(MARKER_NAME);
    let database_path = config_dir.join("pluely.db");
    let secure_path = config_dir.join("secure_storage.json");
    let mut marker = if marker_path.exists() {
        let marker: Marker = serde_json::from_slice(
            &fs::read(&marker_path).map_err(|_| "无法读取迁移进度。".to_string())?
        ).map_err(|_| "迁移进度文件无效，未覆盖已有数据。".to_string())?;
        if marker.id != payload.id { return Ok(Preparation::Skipped); }
        if marker.complete { return Ok(Preparation::Complete(marker.id)); }
        marker
    } else {
        // A profile alone may contain saved credentials even without a database.
        // Treat every existing WebView profile as user data and skip the whole seed.
        if database_path.exists() || secure_path.exists() || local_dir.join("EBWebView").exists() {
            return Ok(Preparation::Skipped);
        }
        fs::create_dir_all(config_dir).map_err(|_| "无法创建迁移数据目录。".to_string())?;
        let marker = Marker {
            id: payload.id.clone(), complete: false, database_ready: false, secure_ready: false,
        };
        save_marker(&marker_path, &marker, true)?;
        marker
    };

    restore_file(&database_path, seed.database, marker.database_ready)?;
    marker.database_ready = true;
    save_marker(&marker_path, &marker, false)?;
    if let Some(storage) = seed.secure_storage {
        restore_file(&secure_path, storage, marker.secure_ready)?;
    }
    marker.secure_ready = true;
    save_marker(&marker_path, &marker, false)?;
    Ok(Preparation::Pending(PendingSeed { payload, marker, marker_path }))
}

fn complete(inner: &mut MigrationInner, id: &str) -> Result<(), String> {
    if inner.completed_id.as_deref() == Some(id) { return Ok(()); }
    let pending = inner.pending.as_mut().ok_or("没有等待完成的迁移。")?;
    if pending.payload.id != id { return Err("迁移标识不匹配。".to_string()); }
    let mut marker = pending.marker.clone();
    marker.complete = true;
    save_marker(&pending.marker_path, &marker, false)?;
    inner.completed_id = Some(id.to_string());
    inner.pending = None;
    Ok(())
}

#[tauri::command]
pub fn get_migration_seed(state: State<'_, MigrationState>) -> Result<Option<MigrationSeed>, String> {
    let state = state.inner().0.lock().map_err(|_| "无法读取迁移状态。".to_string())?;
    Ok(state.pending.as_ref().map(|pending| pending.payload.clone()))
}

#[tauri::command]
pub fn complete_migration_seed(id: String, state: State<'_, MigrationState>) -> Result<(), String> {
    let mut state = state.inner().0.lock().map_err(|_| "无法更新迁移状态。".to_string())?;
    complete(&mut state, &id)
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("migration-seed")
        .setup(|app, _| {
            let mut inner = MigrationInner::default();
            if let Some(seed) = EMBEDDED_SEED.as_ref() {
                let config_dir = app.path().app_config_dir()?;
                let local_dir = app.path().app_local_data_dir()?;
                match prepare_seed(seed, &config_dir, &local_dir).map_err(io::Error::other)? {
                    Preparation::Skipped => {}
                    Preparation::Complete(id) => inner.completed_id = Some(id),
                    Preparation::Pending(pending) => inner.pending = Some(pending),
                }
            }
            app.manage(MigrationState(Mutex::new(inner)));
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DATABASE: &[u8] = b"SQLite format 3\0synthetic test database";
    fn seed() -> EmbeddedSeed {
        EmbeddedSeed {
            manifest: br#"{"id":"test-bundle-1"}"#,
            settings: br#"{"theme":"dark","example":"synthetic-only"}"#,
            database: DATABASE,
            secure_storage: Some(br#"{"selected_pluely_model":null}"#),
        }
    }
    struct TestDirectory(PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("pluely-migration-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn config(&self) -> PathBuf { self.0.join("config") }
        fn local(&self) -> PathBuf { self.0.join("local") }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn restores_an_empty_target_before_sql_opens_it() {
        let root = TestDirectory::new();
        let Preparation::Pending(pending) = prepare_seed(&seed(), &root.config(), &root.local()).unwrap() else { panic!("expected pending seed"); };
        assert_eq!(fs::read(root.config().join("pluely.db")).unwrap(), DATABASE);
        assert_eq!(pending.payload.entries.get("theme").unwrap(), "dark");
        assert!(pending.marker.database_ready && pending.marker.secure_ready);
        assert!(!pending.marker.complete);
    }

    #[test]
    fn existing_database_or_secure_storage_is_never_overwritten() {
        for filename in ["pluely.db", "secure_storage.json"] {
            let root = TestDirectory::new();
            fs::create_dir_all(root.config()).unwrap();
            fs::write(root.config().join(filename), b"existing user data").unwrap();
            assert!(matches!(prepare_seed(&seed(), &root.config(), &root.local()).unwrap(), Preparation::Skipped));
            assert_eq!(fs::read(root.config().join(filename)).unwrap(), b"existing user data");
            assert!(!root.config().join(MARKER_NAME).exists());
        }
    }

    #[test]
    fn existing_webview_profile_skips_all_migration() {
        let root = TestDirectory::new();
        fs::create_dir_all(root.local().join("EBWebView")).unwrap();
        assert!(matches!(prepare_seed(&seed(), &root.config(), &root.local()).unwrap(), Preparation::Skipped));
        assert!(!root.config().exists());
    }

    #[test]
    fn pending_copy_can_resume_after_publish_before_progress_update() {
        let root = TestDirectory::new();
        fs::create_dir_all(root.config()).unwrap();
        save_marker(&root.config().join(MARKER_NAME), &Marker {
            id: "test-bundle-1".into(), complete: false, database_ready: false, secure_ready: false,
        }, true).unwrap();
        fs::write(root.config().join("pluely.db"), DATABASE).unwrap();
        fs::create_dir_all(root.local().join("EBWebView")).unwrap();
        let Preparation::Pending(pending) = prepare_seed(&seed(), &root.config(), &root.local()).unwrap() else { panic!("expected resumable migration"); };
        assert!(pending.marker.database_ready && pending.marker.secure_ready);
    }

    #[test]
    fn pending_marker_does_not_authorize_overwriting_an_unrelated_file() {
        let root = TestDirectory::new();
        fs::create_dir_all(root.config()).unwrap();
        save_marker(&root.config().join(MARKER_NAME), &Marker {
            id: "test-bundle-1".into(), complete: false, database_ready: false, secure_ready: false,
        }, true).unwrap();
        fs::write(root.config().join("pluely.db"), b"different user data").unwrap();
        assert!(prepare_seed(&seed(), &root.config(), &root.local()).is_err());
        assert_eq!(fs::read(root.config().join("pluely.db")).unwrap(), b"different user data");
    }

    #[test]
    fn completion_is_idempotent_and_prevents_reimport() {
        let root = TestDirectory::new();
        let Preparation::Pending(pending) = prepare_seed(&seed(), &root.config(), &root.local()).unwrap() else { panic!("expected pending seed"); };
        let mut inner = MigrationInner { pending: Some(pending), completed_id: None };
        assert!(complete(&mut inner, "wrong-id").is_err());
        complete(&mut inner, "test-bundle-1").unwrap();
        complete(&mut inner, "test-bundle-1").unwrap();
        assert!(inner.pending.is_none());
        assert!(matches!(prepare_seed(&seed(), &root.config(), &root.local()).unwrap(), Preparation::Complete(_)));
    }

    #[test]
    fn atomic_publish_never_replaces_existing_target() {
        let root = TestDirectory::new();
        let target = root.0.join("existing.bin");
        fs::write(&target, b"original").unwrap();
        assert!(write_new(&target, b"replacement").is_err());
        assert_eq!(fs::read(target).unwrap(), b"original");
    }
}
