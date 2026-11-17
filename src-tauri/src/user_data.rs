//! Explicit, restart-based user-data import. Staging never edits live user data.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256, Sha384};
use sqlx::{sqlite::SqliteConnectOptions, ConnectOptions, Connection, Row, SqliteConnection};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{plugin::TauriPlugin, AppHandle, Manager, Runtime, State};

const STATE_FILE: &str = "user-data-import-state.json";
const MAX_JSON: usize = 160 * 1024 * 1024;
const MAX_DATABASE: usize = 96 * 1024 * 1024;
const MAX_SETTINGS_JSON: usize = 16 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Backup {
    format: String,
    version: u32,
    created_at: String,
    settings: HashMap<String, String>,
    database_base64: String,
    database_sha256: String,
    secure_storage: Option<serde_json::Value>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportMarker {
    id: String,
    database_sha256: String,
    backups_ready: bool,
    database_installed: bool,
    secure_installed: bool,
    complete: bool,
    has_secure_storage: bool,
}

#[derive(Clone, Serialize)]
pub struct PendingSettings { id: String, entries: HashMap<String, String> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageResult { id: String, settings_count: usize, requires_restart: bool }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    cancelled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    settings_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    conversations_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    messages_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompts_count: Option<i64>,
}

impl ExportResult {
    fn cancelled() -> Self {
        Self { cancelled: true, path: None, settings_count: None, conversations_count: None, messages_count: None, prompts_count: None }
    }
}

struct ExportSnapshot(PathBuf);
impl Drop for ExportSnapshot {
    fn drop(&mut self) {
        // Only remove files belonging to this newly generated snapshot, never live data.
        for path in [self.0.clone(), self.0.with_extension("sqlite-wal"), self.0.with_extension("sqlite-shm")] {
            let _ = fs::remove_file(path);
        }
    }
}

pub struct UserDataState {
    config_dir: PathBuf,
    operation: tokio::sync::Mutex<()>,
    pending: Mutex<Option<PendingSettings>>,
}

fn error(message: &str) -> String { message.to_string() }
fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn file_digest(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| error("无法读取导入文件。"))?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|_| error("无法核验导入文件。"))?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn validate_settings(settings: &HashMap<String, String>) -> Result<(), String> {
    if settings.len() > 512 || settings.keys().any(|key| key.is_empty() || key.len() > 256 || key.contains('\0')) {
        return Err(error("设置项数量或名称无效。"));
    }
    let utf16_bytes: usize = settings.iter().map(|(key, value)| (key.encode_utf16().count() + value.encode_utf16().count()) * 2).sum();
    if utf16_bytes > 4 * 1024 * 1024 { return Err(error("设置数据过大，超出应用本地存储容量。")); }
    Ok(())
}

fn decode_backup(json: &str) -> Result<(Backup, Vec<u8>), String> {
    if json.len() > MAX_JSON { return Err(error("导入文件过大，最大支持 160 MiB。")); }
    let backup: Backup = serde_json::from_str(json).map_err(|_| error("导入文件不是有效的 Pluely 备份。"))?;
    if backup.format != "pluely-backup" || backup.version != 1 || backup.created_at.is_empty() || backup.created_at.len() > 128 {
        return Err(error("备份格式或版本不受支持。"));
    }
    validate_settings(&backup.settings)?;
    if backup.database_base64.len() > MAX_DATABASE * 4 / 3 + 4 { return Err(error("聊天数据库超过 96 MiB 限制。")); }
    let database = STANDARD.decode(&backup.database_base64).map_err(|_| error("备份中的数据库编码无效。"))?;
    if database.len() > MAX_DATABASE || !database.starts_with(b"SQLite format 3\0") {
        return Err(error("备份中的聊天数据库无效。"));
    }
    if backup.database_sha256.len() != 64 || !backup.database_sha256.bytes().all(|b| b.is_ascii_hexdigit()) ||
        digest(&database) != backup.database_sha256.to_ascii_lowercase() {
        return Err(error("数据库校验失败，备份文件可能损坏。"));
    }
    if let Some(storage) = &backup.secure_storage {
        let object = storage.as_object().ok_or_else(|| error("许可配置格式无效。"))?;
        for (key, value) in object {
            if !["license_key", "instance_id", "selected_pluely_model"].contains(&key.as_str()) ||
                !(value.is_null() || value.as_str().is_some_and(|s| s.len() <= 65536)) {
                return Err(error("许可配置内容无效。"));
            }
        }
    }
    Ok((backup, database))
}

#[cfg(windows)]
fn publish_new(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" { fn MoveFileW(source: *const u16, target: *const u16) -> i32; }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileW(source.as_ptr(), target.as_ptr()) } == 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) }
}
#[cfg(not(windows))]
fn publish_new(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::hard_link(source, target)?;
    fs::remove_file(source)
}

fn write_file(path: &Path, bytes: &[u8], replace: bool) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| error("导入目录无效。"))?;
    let temporary = parent.join(format!(".import-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if replace { fs::rename(&temporary, path) } else { publish_new(&temporary, path) }
    })();
    if result.is_err() { let _ = fs::remove_file(temporary); }
    result.map_err(|_| error("无法保存导入数据，请检查目录权限或关闭其他 Pluely 实例。"))
}
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> { write_file(path, bytes, true) }
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> { write_file(path, bytes, false) }

fn import_lock(config: &Path) -> Result<File, String> {
    fs::create_dir_all(config).map_err(|_| error("无法创建应用数据目录。"))?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    options.open(config.join(".user-data-import.lock")).map_err(|_| error("其他 Pluely 实例正在处理导入，请关闭后重试。"))
}

fn read_marker(config: &Path) -> Result<Option<ImportMarker>, String> {
    let path = config.join(STATE_FILE);
    if !path.exists() { return Ok(None); }
    let marker: ImportMarker = serde_json::from_slice(&fs::read(path).map_err(|_| error("无法读取导入进度。"))?)
        .map_err(|_| error("导入进度文件无效，已停止操作以保护原数据。"))?;
    if uuid::Uuid::parse_str(&marker.id).is_err() || marker.id.contains(['/', '\\']) {
        return Err(error("导入任务标识无效。"));
    }
    Ok(Some(marker))
}
fn save_marker(config: &Path, marker: &ImportMarker) -> Result<(), String> {
    write_atomic(&config.join(STATE_FILE), &serde_json::to_vec(marker).map_err(|_| error("无法保存导入进度。"))?)
}

async fn open_database(path: &Path, read_only: bool) -> Result<SqliteConnection, String> {
    let options = SqliteConnectOptions::new().filename(path).read_only(read_only).create_if_missing(false)
        .busy_timeout(Duration::from_secs(2)).disable_statement_logging();
    SqliteConnection::connect_with(&options).await.map_err(|_| error("无法打开聊天数据库；请关闭其他 Pluely 实例后重试。"))
}

async fn validate_database(path: &Path) -> Result<(), String> {
    let mut connection = open_database(path, true).await?;
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check").fetch_one(&mut connection).await
        .map_err(|_| error("聊天数据库完整性检查失败。"))?;
    if integrity != "ok" { return Err(error("聊天数据库已损坏，无法导入。")); }
    for table in ["conversations", "messages", "system_prompts"] {
        let sql = format!("PRAGMA table_info({table})");
        let rows = sqlx::query(&sql).fetch_all(&mut connection).await.map_err(|_| error("备份数据库结构无效。"))?;
        let columns: HashSet<String> = rows.iter().map(|row| row.get::<String, _>("name")).collect();
        let required: &[&str] = match table {
            "conversations" => &["id", "title", "created_at", "updated_at"],
            "messages" => &["id", "conversation_id", "role", "content", "timestamp", "attached_files"],
            _ => &["id", "name", "prompt", "created_at", "updated_at"],
        };
        if required.iter().any(|name| !columns.contains(*name)) { return Err(error("备份缺少必要的聊天或提示词表结构。")); }
    }
    let migrations = sqlx::query("SELECT version, success, checksum FROM _sqlx_migrations")
        .fetch_all(&mut connection).await.map_err(|_| error("备份缺少数据库版本信息。"))?;
    let expected = crate::db::migrations();
    if migrations.len() != expected.len() { return Err(error("备份数据库版本与当前程序不兼容。")); }
    for row in migrations {
        let version: i64 = row.try_get("version").map_err(|_| error("备份数据库版本信息无效。"))?;
        let success: bool = row.try_get("success").map_err(|_| error("备份数据库版本信息无效。"))?;
        let checksum: Vec<u8> = row.try_get("checksum").map_err(|_| error("备份数据库校验信息无效。"))?;
        let Some(migration) = expected.iter().find(|item| item.version == version) else { return Err(error("备份数据库版本与当前程序不兼容。")); };
        if !success || checksum != Sha384::digest(migration.sql.as_bytes()).as_slice() {
            return Err(error("备份数据库的迁移校验与当前程序不一致。"));
        }
    }
    connection.close().await.map_err(|_| error("无法关闭备份校验连接。"))
}

async fn stage(config: &Path, backup_json: &str, existing_settings_json: &str) -> Result<StageResult, String> {
    let _lock = import_lock(config)?;
    if read_marker(config)?.is_some_and(|marker| !marker.complete) { return Err(error("已有待完成的导入，请先重启程序完成该任务。")); }
    if existing_settings_json.len() > MAX_SETTINGS_JSON { return Err(error("当前设置备份过大。")); }
    let existing: HashMap<String, String> = serde_json::from_str(existing_settings_json).map_err(|_| error("当前设置备份格式无效。"))?;
    validate_settings(&existing)?;
    let (backup, database) = decode_backup(backup_json)?;
    let id = uuid::Uuid::new_v4().to_string();
    let staging = config.join("user-data-import").join(&id);
    fs::create_dir_all(&staging).map_err(|_| error("无法创建导入暂存目录。"))?;
    write_atomic(&staging.join("database.sqlite"), &database)?;
    validate_database(&staging.join("database.sqlite")).await?;
    write_atomic(&staging.join("settings.json"), &serde_json::to_vec(&backup.settings).map_err(|_| error("无法序列化备份设置。"))?)?;
    write_atomic(&staging.join("existing-settings.json"), existing_settings_json.as_bytes())?;
    if let Some(storage) = &backup.secure_storage {
        write_atomic(&staging.join("secure-storage.json"), &serde_json::to_vec(storage).map_err(|_| error("无法暂存许可配置。"))?)?;
    }
    let marker = ImportMarker {
        id: id.clone(), database_sha256: backup.database_sha256.to_ascii_lowercase(), backups_ready: false,
        database_installed: false, secure_installed: false, complete: false, has_secure_storage: backup.secure_storage.is_some(),
    };
    save_marker(config, &marker)?;
    Ok(StageResult { id, settings_count: backup.settings.len(), requires_restart: true })
}

fn copy_preserving(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() { return Ok(()); }
    if destination.exists() {
        if file_digest(source)? != file_digest(destination)? { return Err(error("备份期间原数据发生变化，请关闭其他 Pluely 实例后重试。")); }
        return Ok(());
    }
    let bytes = fs::read(source).map_err(|_| error("无法读取待备份文件。"))?;
    write_new(destination, &bytes)
}

fn move_preserving(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() { return Ok(()); }
    if destination.exists() { return Err(error("检测到重复的原数据文件，已停止导入以避免覆盖备份。")); }
    publish_new(source, destination).map_err(|_| error("无法替换正在使用的数据库，请关闭其他 Pluely 实例后重新启动。"))
}

async fn apply_pending(config: &Path) -> Result<Option<PendingSettings>, String> {
    let Some(mut marker) = read_marker(config)? else { return Ok(None); };
    if marker.complete { return Ok(None); }
    let _lock = import_lock(config)?;
    // Re-read after obtaining the cross-process lock.
    marker = read_marker(config)?.ok_or_else(|| error("导入进度已变化，请重试。"))?;
    if marker.complete { return Ok(None); }
    let staging = config.join("user-data-import").join(&marker.id);
    let staged_database = staging.join("database.sqlite");
    if file_digest(&staged_database)? != marker.database_sha256 { return Err(error("暂存数据库校验失败，未继续导入。")); }
    let entries: HashMap<String, String> = serde_json::from_slice(&fs::read(staging.join("settings.json")).map_err(|_| error("无法读取暂存设置。"))?)
        .map_err(|_| error("暂存设置格式无效。"))?;
    validate_settings(&entries)?;
    let backup = config.join("import-backups").join(&marker.id);
    let originals = backup.join("original-files");
    fs::create_dir_all(&originals).map_err(|_| error("无法创建原数据备份目录。"))?;
    let current_database = config.join("pluely.db");
    if !marker.backups_ready {
        // VACUUM INTO produces a consistent standalone backup including any WAL.
        if current_database.exists() && !backup.join("pluely.db").exists() {
            let mut connection = open_database(&current_database, true).await?;
            let temporary = backup.join("database-snapshot.tmp");
            if temporary.exists() { fs::remove_file(&temporary).map_err(|_| error("无法恢复数据库备份进度。"))?; }
            sqlx::query("VACUUM INTO ?").bind(temporary.to_string_lossy().as_ref()).execute(&mut connection).await
                .map_err(|_| error("备份当前聊天数据库失败，原数据未被替换。"))?;
            connection.close().await.map_err(|_| error("无法关闭数据库备份连接。"))?;
            publish_new(&temporary, &backup.join("pluely.db")).map_err(|_| error("无法保存数据库备份。"))?;
        }
        copy_preserving(&staging.join("existing-settings.json"), &backup.join("settings.json"))?;
        copy_preserving(&config.join("secure_storage.json"), &backup.join("secure_storage.json"))?;
        marker.backups_ready = true;
        save_marker(config, &marker)?;
    }
    if !marker.database_installed {
        let already_published = originals.join("pluely.db").exists() && current_database.exists() &&
            file_digest(&current_database)? == marker.database_sha256;
        if !already_published {
            for name in ["pluely.db-wal", "pluely.db-shm", "pluely.db"] {
                move_preserving(&config.join(name), &originals.join(name))?;
            }
            write_new(&current_database, &fs::read(&staged_database).map_err(|_| error("无法读取暂存数据库。"))?)?;
        }
        marker.database_installed = true;
        save_marker(config, &marker)?;
    }
    if !marker.secure_installed {
        let current_secure = config.join("secure_storage.json");
        let incoming = staging.join("secure-storage.json");
        let already_published = marker.has_secure_storage && current_secure.exists() && file_digest(&current_secure)? == file_digest(&incoming)?;
        if !already_published {
            move_preserving(&current_secure, &originals.join("secure_storage.json"))?;
            if marker.has_secure_storage {
                write_new(&current_secure, &fs::read(incoming).map_err(|_| error("无法读取暂存许可配置。"))?)?;
            }
        }
        marker.secure_installed = true;
        save_marker(config, &marker)?;
    }
    Ok(Some(PendingSettings { id: marker.id, entries }))
}

fn export_settings(json: &str) -> Result<HashMap<String, String>, String> {
    if json.len() > MAX_SETTINGS_JSON { return Err(error("当前设置过大，无法导出。")); }
    let mut settings: HashMap<String, String> = serde_json::from_str(json)
        .map_err(|_| error("当前设置格式无效，无法导出。"))?;
    settings.retain(|key, _| !key.starts_with("__pluely_") && key != "autostart_initialized");
    validate_settings(&settings)?;
    Ok(settings)
}

fn validate_export_destination(config: &Path, local: Option<&Path>, destination: &Path) -> Result<(), String> {
    if !destination.is_absolute() || !destination.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("json")) {
        return Err(error("请选择以 .json 结尾的完整备份文件路径。"));
    }
    if destination.exists() && !destination.is_file() {
        return Err(error("请选择备份文件名，不能直接使用文件夹作为目标。"));
    }
    let parent = destination.parent().ok_or_else(|| error("保存位置无效。"))?.canonicalize()
        .map_err(|_| error("保存目录不存在或无法访问。"))?;
    let resolved = if destination.exists() {
        destination.canonicalize().map_err(|_| error("无法访问所选备份文件。"))?
    } else {
        parent.join(destination.file_name().ok_or_else(|| error("备份文件名无效。"))?)
    };
    for protected in [Some(config), local].into_iter().flatten() {
        if let Ok(protected) = protected.canonicalize() {
            if resolved.starts_with(protected) {
                return Err(error("请将备份保存到文档或其他目录，不要保存到应用正在使用的数据目录。"));
            }
        }
    }
    Ok(())
}

async fn export_to_path(
    config: &Path,
    local: Option<&Path>,
    settings_json: &str,
    destination: Option<&Path>,
) -> Result<ExportResult, String> {
    // Cancelling the native dialog must not even create a temporary snapshot.
    let Some(destination) = destination else { return Ok(ExportResult::cancelled()); };
    let settings = export_settings(settings_json)?;
    validate_export_destination(config, local, destination)?;
    let replace_existing = destination.exists(); // Native dialog already confirmed this overwrite.
    let _lock = import_lock(config)?;
    if read_marker(config)?.is_some_and(|marker| !marker.complete) {
        return Err(error("已有待完成的导入，请重启完成后再导出。"));
    }

    let snapshot = ExportSnapshot(config.join(format!(".pluely-export-{}.sqlite", uuid::Uuid::new_v4())));
    let mut connection = open_database(&config.join("pluely.db"), true).await?;
    let snapshot_result = sqlx::query("VACUUM INTO ?")
        .bind(snapshot.0.to_string_lossy().as_ref()).execute(&mut connection).await;
    let closed = connection.close().await;
    snapshot_result.map_err(|_| error("无法创建聊天数据库的一致性快照，请稍后重试。"))?;
    closed.map_err(|_| error("无法完成数据库快照。"))?;
    validate_database(&snapshot.0).await?;
    let mut snapshot_connection = open_database(&snapshot.0, true).await?;
    let metadata = async {
        let conversations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM conversations").fetch_one(&mut snapshot_connection).await?;
        let messages: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages").fetch_one(&mut snapshot_connection).await?;
        let prompts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM system_prompts").fetch_one(&mut snapshot_connection).await?;
        let created_at: String = sqlx::query_scalar("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')").fetch_one(&mut snapshot_connection).await?;
        Ok::<_, sqlx::Error>((conversations, messages, prompts, created_at))
    }.await;
    let closed = snapshot_connection.close().await;
    let (conversations, messages, prompts, created_at) = metadata.map_err(|_| error("无法读取备份统计信息。"))?;
    closed.map_err(|_| error("无法完成备份读取。"))?;
    let database = fs::read(&snapshot.0).map_err(|_| error("无法读取数据库快照。"))?;
    if database.len() > MAX_DATABASE { return Err(error("聊天数据库超过 96 MiB，无法导出为当前备份格式。")); }
    let secure_path = config.join("secure_storage.json");
    let secure_storage = if secure_path.exists() {
        let contents = fs::read(&secure_path).map_err(|_| error("无法读取许可配置，导出已停止。"))?;
        Some(serde_json::from_slice(&contents).map_err(|_| error("许可配置格式无效，导出已停止。"))?)
    } else { None };
    let settings_count = settings.len();
    let backup = Backup {
        format: "pluely-backup".into(), version: 1, created_at, settings,
        database_base64: STANDARD.encode(&database), database_sha256: digest(&database), secure_storage,
    };
    let json = serde_json::to_string(&backup).map_err(|_| error("无法生成备份文件。"))?;
    // Check the same format/size/credential contract used by the importer before publishing.
    decode_backup(&json)?;
    let saved = if replace_existing { write_atomic(destination, json.as_bytes()) } else { write_new(destination, json.as_bytes()) };
    saved.map_err(|_| error("保存备份失败。请检查所选目录的权限和剩余空间；原文件未被删除。"))?;
    Ok(ExportResult {
        cancelled: false, path: Some(destination.to_string_lossy().into_owned()), settings_count: Some(settings_count),
        conversations_count: Some(conversations), messages_count: Some(messages), prompts_count: Some(prompts),
    })
}

#[cfg(windows)]
fn show_export_dialog(owner: isize) -> Result<Option<PathBuf>, String> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::UI::Controls::Dialogs::{
        CommDlgExtendedError, GetSaveFileNameW, OPENFILENAMEW, OFN_DONTADDTORECENT,
        OFN_ENABLEHOOK, OFN_EXPLORER, OFN_NOCHANGEDIR, OFN_NOREADONLYRETURN,
        OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST,
    };
    use windows_sys::Win32::System::SystemInformation::GetLocalTime;
    use windows_sys::Win32::Foundation::SYSTEMTIME;
    let mut now: SYSTEMTIME = unsafe { std::mem::zeroed() };
    unsafe { GetLocalTime(&mut now); }
    let default_name = format!("Pluely-UserData-{:04}{:02}{:02}-{:02}{:02}{:02}.pluely-backup.json",
        now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond);
    let mut filename = vec![0u16; 32768];
    let default_name: Vec<u16> = default_name.encode_utf16().collect();
    filename[..default_name.len()].copy_from_slice(&default_name);
    let filter: Vec<u16> = "Pluely 用户数据备份 (*.pluely-backup.json)\0*.pluely-backup.json\0JSON 文件 (*.json)\0*.json\0\0".encode_utf16().collect();
    let title: Vec<u16> = "导出用户数据（包含 API 密钥和聊天记录）\0".encode_utf16().collect();
    let extension: Vec<u16> = "json\0".encode_utf16().collect();
    let mut options: OPENFILENAMEW = unsafe { std::mem::zeroed() };
    options.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    options.hwndOwner = owner as *mut std::ffi::c_void;
    options.lpstrFilter = filter.as_ptr();
    options.nFilterIndex = 1;
    options.lpstrFile = filename.as_mut_ptr();
    options.nMaxFile = filename.len() as u32;
    options.lpstrTitle = title.as_ptr();
    options.lpstrDefExt = extension.as_ptr();
    options.Flags = OFN_EXPLORER | OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST |
        OFN_NOCHANGEDIR | OFN_DONTADDTORECENT | OFN_NOREADONLYRETURN | OFN_ENABLEHOOK;
    options.lpfnHook = Some(protect_export_dialog);
    let selected = unsafe { GetSaveFileNameW(&mut options) };
    if selected == 0 {
        if unsafe { CommDlgExtendedError() } == 0 { return Ok(None); }
        return Err(error("无法打开保存文件对话框，请重试。"));
    }
    let length = filename.iter().position(|value| *value == 0).ok_or_else(|| error("保存路径过长。"))?;
    Ok(Some(PathBuf::from(std::ffi::OsString::from_wide(&filename[..length]))))
}

#[cfg(windows)]
unsafe extern "system" fn protect_export_dialog(window: windows_sys::Win32::Foundation::HWND, message: u32, _: usize, _: isize) -> usize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetAncestor, SetWindowDisplayAffinity, GA_ROOT, WDA_EXCLUDEFROMCAPTURE, WM_INITDIALOG};
    if message == WM_INITDIALOG {
        let dialog = GetAncestor(window, GA_ROOT);
        if !dialog.is_null() { let _ = SetWindowDisplayAffinity(dialog, WDA_EXCLUDEFROMCAPTURE); }
    }
    0
}

#[cfg(windows)]
async fn choose_export_destination(app: &AppHandle, window: &tauri::WebviewWindow) -> Result<Option<PathBuf>, String> {
    let owner = window.hwnd().map_err(|_| error("无法获取导出窗口。"))?.0 as isize;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || { let _ = sender.send(show_export_dialog(owner)); })
        .map_err(|_| error("无法打开保存文件对话框。"))?;
    receiver.await.map_err(|_| error("保存文件对话框已关闭。"))?
}

#[cfg(not(windows))]
async fn choose_export_destination(_: &AppHandle, _: &tauri::WebviewWindow) -> Result<Option<PathBuf>, String> {
    Err(error("当前版本的用户数据导出仅支持 Windows。"))
}

#[tauri::command]
pub async fn export_user_data(settings_json: String, app: AppHandle, window: tauri::WebviewWindow, state: State<'_, UserDataState>) -> Result<ExportResult, String> {
    let _guard = state.operation.lock().await;
    export_settings(&settings_json)?;
    if read_marker(&state.config_dir)?.is_some_and(|marker| !marker.complete) {
        return Err(error("已有待完成的导入，请重启完成后再导出。"));
    }
    let destination = choose_export_destination(&app, &window).await?;
    let local = app.path().app_local_data_dir().map_err(|_| error("无法读取应用数据目录。"))?;
    export_to_path(&state.config_dir, Some(&local), &settings_json, destination.as_deref()).await
}

#[tauri::command]
pub async fn stage_user_data_import(backup_json: String, existing_settings_json: String, state: State<'_, UserDataState>) -> Result<StageResult, String> {
    let _guard = state.operation.lock().await;
    stage(&state.config_dir, &backup_json, &existing_settings_json).await
}

#[tauri::command]
pub fn restart_after_user_data_import(app: AppHandle, state: State<'_, UserDataState>) -> Result<(), String> {
    if !read_marker(&state.config_dir)?.is_some_and(|marker| !marker.complete) { return Err(error("没有等待重启的导入任务。")); }
    app.restart();
}

#[tauri::command]
pub fn get_pending_user_data_settings(state: State<'_, UserDataState>) -> Result<Option<PendingSettings>, String> {
    state.pending.lock().map(|value| value.clone()).map_err(|_| error("无法读取待导入设置。"))
}

#[tauri::command]
pub async fn complete_user_data_import(id: String, state: State<'_, UserDataState>) -> Result<(), String> {
    let _guard = state.operation.lock().await;
    let _lock = import_lock(&state.config_dir)?;
    complete_import(&state.config_dir, &id)?;
    *state.pending.lock().map_err(|_| error("无法完成设置导入。"))? = None;
    Ok(())
}

fn complete_import(config: &Path, id: &str) -> Result<(), String> {
    let mut marker = read_marker(config)?.ok_or_else(|| error("没有待完成的导入任务。"))?;
    if marker.id != id { return Err(error("导入任务标识不匹配。")); }
    if !marker.database_installed || !marker.secure_installed { return Err(error("原生数据导入尚未完成，请重启后再试。")); }
    marker.complete = true;
    save_marker(config, &marker)?;
    Ok(())
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("user-data-import")
        .setup(|app, _| {
            let config_dir = app.path().app_config_dir()?;
            let pending = match tauri::async_runtime::block_on(apply_pending(&config_dir)) {
                Ok(pending) => pending,
                Err(message) => {
                    show_import_error(&message);
                    return Err(std::io::Error::other(message).into());
                }
            };
            app.manage(UserDataState { config_dir, operation: tokio::sync::Mutex::new(()), pending: Mutex::new(pending) });
            Ok(())
        }).build()
}

#[cfg(windows)]
fn show_import_error(message: &str) {
    #[link(name = "user32")]
    extern "system" { fn MessageBoxW(window: isize, text: *const u16, caption: *const u16, flags: u32) -> i32; }
    let text: Vec<u16> = format!("导入未完成，应用已停止启动以保护现有数据。\n请关闭其他 Pluely 窗口后重试。\n\n{message}")
        .encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = "Pluely 用户数据导入".encode_utf16().chain(Some(0)).collect();
    unsafe { MessageBoxW(0, text.as_ptr(), title.as_ptr(), 0x10); }
}
#[cfg(not(windows))]
fn show_import_error(_: &str) {}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqliteJournalMode;
    struct TestRoot(PathBuf);
    impl TestRoot {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("pluely-import-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap(); Self(path)
        }
        fn config(&self) -> PathBuf { self.0.join("config") }
    }
    impl Drop for TestRoot {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }
    async fn database(path: &Path, title: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let options = SqliteConnectOptions::new().filename(path).create_if_missing(true).journal_mode(SqliteJournalMode::Delete).disable_statement_logging();
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::raw_sql("CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL)").execute(&mut connection).await.unwrap();
        for migration in crate::db::migrations() {
            sqlx::raw_sql(migration.sql).execute(&mut connection).await.unwrap();
            sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(?,?,1,?,0)")
                .bind(migration.version).bind(migration.description).bind(Sha384::digest(migration.sql.as_bytes()).to_vec())
                .execute(&mut connection).await.unwrap();
        }
        sqlx::query("INSERT INTO conversations(id,title,created_at,updated_at) VALUES('synthetic',?,1,1)").bind(title).execute(&mut connection).await.unwrap();
        connection.close().await.unwrap();
    }
    fn backup_json(path: &Path) -> String {
        let bytes = fs::read(path).unwrap();
        serde_json::json!({
            "format":"pluely-backup","version":1,"createdAt":"2026-11-17T00:00:00+08:00",
            "settings":{"theme":"dark","synthetic":"test-only"},
            "databaseBase64":STANDARD.encode(&bytes),"databaseSha256":digest(&bytes),"secureStorage":null
        }).to_string()
    }
    async fn title(path: &Path) -> String {
        let mut connection = open_database(path,true).await.unwrap();
        let value: String = sqlx::query_scalar("SELECT title FROM conversations WHERE id='synthetic'").fetch_one(&mut connection).await.unwrap();
        connection.close().await.unwrap(); value
    }

    #[tokio::test]
    async fn stage_valid_backup_does_not_modify_live_database_or_settings() {
        let root=TestRoot::new(); let config=root.config();
        database(&config.join("pluely.db"),"old").await;
        let incoming=root.0.join("incoming.db"); database(&incoming,"new").await;
        let before=file_digest(&config.join("pluely.db")).unwrap();
        let result=stage(&config,&backup_json(&incoming),r#"{"theme":"light"}"#).await.unwrap();
        assert_eq!(result.settings_count,2); assert!(result.requires_restart);
        assert_eq!(before,file_digest(&config.join("pluely.db")).unwrap());
        assert!(!config.join("import-backups").exists());
    }

    #[tokio::test]
    async fn invalid_format_hash_and_database_are_rejected_before_live_changes() {
        let root=TestRoot::new(); let config=root.config(); database(&config.join("pluely.db"),"old").await;
        let before=file_digest(&config.join("pluely.db")).unwrap();
        assert!(stage(&config,"{}","{}").await.is_err());
        let mut backup: serde_json::Value=serde_json::from_str(&backup_json(&config.join("pluely.db"))).unwrap();
        backup["databaseSha256"]=serde_json::json!("0".repeat(64));
        assert!(stage(&config,&backup.to_string(),"{}").await.is_err());
        let fake=b"SQLite format 3\0not a database";
        backup["databaseBase64"]=serde_json::json!(STANDARD.encode(fake));backup["databaseSha256"]=serde_json::json!(digest(fake));
        assert!(stage(&config,&backup.to_string(),"{}").await.is_err());
        assert!(!config.join(STATE_FILE).exists()); assert_eq!(before,file_digest(&config.join("pluely.db")).unwrap());
    }

    #[tokio::test]
    async fn backup_is_preserved_and_incoming_data_is_applied_before_sql() {
        let root=TestRoot::new(); let config=root.config(); database(&config.join("pluely.db"),"old").await;
        fs::write(config.join("secure_storage.json"),b"{\"license_key\":\"synthetic-old\"}").unwrap();
        let incoming=root.0.join("incoming.db");database(&incoming,"new").await;
        let staged=stage(&config,&backup_json(&incoming),r#"{"theme":"light"}"#).await.unwrap();
        let pending=apply_pending(&config).await.unwrap().unwrap(); assert_eq!(pending.id,staged.id);
        assert_eq!(pending.entries.get("theme").unwrap(),"dark");
        assert_eq!(title(&config.join("pluely.db")).await,"new");
        let backup=config.join("import-backups").join(&staged.id);
        assert_eq!(title(&backup.join("pluely.db")).await,"old");
        assert_eq!(fs::read_to_string(backup.join("settings.json")).unwrap(),r#"{"theme":"light"}"#);
        assert!(backup.join("secure_storage.json").exists()); assert!(backup.join("original-files/pluely.db").exists());
        assert!(!config.join("secure_storage.json").exists());
    }

    #[tokio::test]
    async fn resumed_import_does_not_overwrite_original_backup() {
        let root=TestRoot::new();let config=root.config();database(&config.join("pluely.db"),"old").await;
        let incoming=root.0.join("incoming.db");database(&incoming,"new").await;
        let staged=stage(&config,&backup_json(&incoming),"{}").await.unwrap();apply_pending(&config).await.unwrap();
        let original=config.join("import-backups").join(&staged.id).join("original-files/pluely.db");
        let original_hash=file_digest(&original).unwrap();
        let mut marker=read_marker(&config).unwrap().unwrap();marker.database_installed=false;save_marker(&config,&marker).unwrap();
        apply_pending(&config).await.unwrap();assert_eq!(file_digest(&original).unwrap(),original_hash);
        assert_eq!(title(&config.join("pluely.db")).await,"new");
    }

    #[tokio::test]
    async fn resume_after_old_database_was_moved_but_new_one_not_published() {
        let root=TestRoot::new();let config=root.config();database(&config.join("pluely.db"),"old").await;
        let incoming=root.0.join("incoming.db");database(&incoming,"new").await;
        stage(&config,&backup_json(&incoming),"{}").await.unwrap();apply_pending(&config).await.unwrap();
        fs::remove_file(config.join("pluely.db")).unwrap();
        let mut marker=read_marker(&config).unwrap().unwrap();marker.database_installed=false;save_marker(&config,&marker).unwrap();
        apply_pending(&config).await.unwrap();assert_eq!(title(&config.join("pluely.db")).await,"new");
    }

    #[tokio::test]
    async fn completion_is_idempotent_and_does_not_restore_again() {
        let root=TestRoot::new();let config=root.config();let incoming=root.0.join("incoming.db");database(&incoming,"new").await;
        let staged=stage(&config,&backup_json(&incoming),"{}").await.unwrap();
        assert!(complete_import(&config,&staged.id).is_err());apply_pending(&config).await.unwrap();
        assert!(complete_import(&config,"wrong").is_err());complete_import(&config,&staged.id).unwrap();complete_import(&config,&staged.id).unwrap();
        let mut connection=open_database(&config.join("pluely.db"),false).await.unwrap();
        sqlx::query("UPDATE conversations SET title='after-import'").execute(&mut connection).await.unwrap();connection.close().await.unwrap();
        assert!(apply_pending(&config).await.unwrap().is_none());assert_eq!(title(&config.join("pluely.db")).await,"after-import");
    }

    #[tokio::test]
    async fn incompatible_migration_checksum_is_rejected() {
        let root=TestRoot::new();let incoming=root.0.join("incoming.db");database(&incoming,"new").await;
        let mut connection=open_database(&incoming,false).await.unwrap();
        sqlx::query("UPDATE _sqlx_migrations SET checksum=X'01' WHERE version=1").execute(&mut connection).await.unwrap();connection.close().await.unwrap();
        assert!(stage(&root.config(),&backup_json(&incoming),"{}").await.is_err());assert!(!root.config().join(STATE_FILE).exists());
    }

    #[tokio::test]
    async fn pending_task_blocks_restage_and_conflicting_backup_is_not_replaced() {
        let root=TestRoot::new();let config=root.config();database(&config.join("pluely.db"),"old").await;
        let incoming=root.0.join("incoming.db");database(&incoming,"new").await;
        let staged=stage(&config,&backup_json(&incoming),"{}").await.unwrap();assert!(stage(&config,&backup_json(&incoming),"{}").await.is_err());
        let backup=config.join("import-backups").join(&staged.id);fs::create_dir_all(&backup).unwrap();fs::write(backup.join("settings.json"),b"unrelated backup").unwrap();
        assert!(apply_pending(&config).await.is_err());assert_eq!(fs::read(backup.join("settings.json")).unwrap(),b"unrelated backup");assert_eq!(title(&config.join("pluely.db")).await,"old");
    }

    #[tokio::test]
    async fn optional_real_backup_is_validated_only_in_an_isolated_directory() {
        let Ok(path) = std::env::var("PLUELY_IMPORT_TEST_BACKUP") else { return; };
        let json = fs::read_to_string(path).expect("Unable to read selected test backup");
        let root = TestRoot::new();
        let staged = stage(&root.config(), &json, "{}").await.expect("Selected backup is incompatible");
        let pending = apply_pending(&root.config()).await.expect("Isolated restore failed").expect("No restored settings");
        assert_eq!(pending.id, staged.id);
        assert_eq!(pending.entries.len(), staged.settings_count);
        validate_database(&root.config().join("pluely.db")).await.expect("Restored database validation failed");
        complete_import(&root.config(), &staged.id).expect("Isolated completion failed");
        assert!(apply_pending(&root.config()).await.unwrap().is_none());
    }

    fn no_export_temporary_files(config: &Path) -> bool {
        !config.exists() || fs::read_dir(config).unwrap().all(|item| {
            !item.unwrap().file_name().to_string_lossy().starts_with(".pluely-export-")
        })
    }

    #[tokio::test]
    async fn export_round_trip_preserves_wal_messages_prompts_preferences_and_keys() {
        let root = TestRoot::new();
        let source = root.0.join("source");
        database(&source.join("pluely.db"), "synthetic source").await;
        let options = SqliteConnectOptions::new().filename(source.join("pluely.db"))
            .journal_mode(SqliteJournalMode::Wal).disable_statement_logging();
        let mut live = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::query("PRAGMA wal_autocheckpoint=0").execute(&mut live).await.unwrap();
        sqlx::query("INSERT INTO messages(id,conversation_id,role,content,timestamp) VALUES('synthetic-message','synthetic','user','合成测试消息',2)")
            .execute(&mut live).await.unwrap();
        sqlx::query("INSERT INTO system_prompts(name,prompt) VALUES('合成提示词','只用于备份测试的提示词')")
            .execute(&mut live).await.unwrap();
        assert!(source.join("pluely.db-wal").metadata().unwrap().len() > 0);
        fs::write(source.join("secure_storage.json"), br#"{"license_key":"synthetic-license","instance_id":"synthetic-instance"}"#).unwrap();
        let settings_json = serde_json::json!({
            "theme":"dark", "system_prompt":"synthetic system prompt",
            "customizable":"{\"autostart\":{\"isEnabled\":false}}",
            "curl_selected_ai_provider":"{\"provider\":\"synthetic-ai\",\"variables\":{\"api_key\":\"synthetic-ai-key\",\"model\":\"synthetic-model\"}}",
            "curl_selected_stt_provider":"{\"provider\":\"synthetic-stt\",\"variables\":{\"api_key\":\"synthetic-stt-key\"}}",
            "response_settings":"{\"language\":\"chinese\"}",
            "autostart_initialized":"true", "__pluely_migration_applied":"synthetic-device-marker"
        }).to_string();
        let before = file_digest(&source.join("pluely.db")).unwrap();
        let destination = root.0.join("export.pluely-backup.json");
        let result = export_to_path(&source, None, &settings_json, Some(&destination)).await.unwrap();
        assert!(!result.cancelled);
        assert_eq!(result.settings_count, Some(6));
        assert_eq!((result.conversations_count, result.messages_count, result.prompts_count), (Some(1),Some(1),Some(1)));
        assert_eq!(file_digest(&source.join("pluely.db")).unwrap(), before);
        assert!(no_export_temporary_files(&source));
        let json = fs::read_to_string(&destination).unwrap();
        let (backup, _) = decode_backup(&json).unwrap();
        assert_eq!(backup.settings, export_settings(&settings_json).unwrap());
        assert!(backup.created_at.ends_with('Z'));
        assert_eq!(backup.secure_storage.as_ref().unwrap()["license_key"], "synthetic-license");

        let target = root.0.join("target");
        let staged = stage(&target, &json, "{}").await.unwrap();
        let restored = apply_pending(&target).await.unwrap().unwrap();
        assert_eq!(restored.entries, backup.settings);
        complete_import(&target, &staged.id).unwrap();
        let mut restored_db = open_database(&target.join("pluely.db"), true).await.unwrap();
        let message: String = sqlx::query_scalar("SELECT content FROM messages WHERE id='synthetic-message'")
            .fetch_one(&mut restored_db).await.unwrap();
        let prompt: String = sqlx::query_scalar("SELECT prompt FROM system_prompts WHERE name='合成提示词'")
            .fetch_one(&mut restored_db).await.unwrap();
        assert_eq!(message, "合成测试消息"); assert_eq!(prompt, "只用于备份测试的提示词");
        restored_db.close().await.unwrap();
        live.close().await.unwrap();
    }

    #[tokio::test]
    async fn cancelled_export_creates_no_snapshot_or_destination() {
        let root = TestRoot::new();
        let result = export_to_path(&root.config(), None, "{}", None).await.unwrap();
        assert!(result.cancelled);
        assert_eq!(serde_json::to_value(result).unwrap(), serde_json::json!({"cancelled":true}));
        assert!(!root.config().exists());
    }

    #[tokio::test]
    async fn export_refuses_app_data_and_invalid_settings_without_changing_files() {
        let root = TestRoot::new(); let config = root.config();
        database(&config.join("pluely.db"), "unchanged").await;
        let secure = config.join("secure_storage.json"); fs::write(&secure, b"original secure").unwrap();
        assert!(export_to_path(&config, None, "{}", Some(&secure)).await.is_err());
        assert_eq!(fs::read(&secure).unwrap(), b"original secure");
        let destination = root.0.join("old-backup.json"); fs::write(&destination, b"original backup").unwrap();
        assert!(export_to_path(&config, None, "{not json", Some(&destination)).await.is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"original backup");
        assert!(no_export_temporary_files(&config));
    }

    #[tokio::test]
    async fn pending_import_blocks_export_and_invalid_secure_data_keeps_old_backup() {
        let root = TestRoot::new(); let config = root.config();
        database(&config.join("pluely.db"), "unchanged").await;
        let destination = root.0.join("old-backup.json"); fs::write(&destination, b"original backup").unwrap();
        fs::write(config.join("secure_storage.json"), b"broken JSON").unwrap();
        assert!(export_to_path(&config, None, "{}", Some(&destination)).await.is_err());
        assert!(no_export_temporary_files(&config));
        fs::remove_file(config.join("secure_storage.json")).unwrap();
        stage(&config, &backup_json(&config.join("pluely.db")), "{}").await.unwrap();
        assert!(export_to_path(&config, None, "{}", Some(&destination)).await.is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"original backup");
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn failed_export_publish_preserves_existing_backup() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = TestRoot::new(); let config = root.config();
        database(&config.join("pluely.db"), "unchanged").await;
        let destination = root.0.join("old-backup.json"); fs::write(&destination, b"original backup").unwrap();
        let locked = OpenOptions::new().read(true).share_mode(0).open(&destination).unwrap();
        assert!(export_to_path(&config, None, "{}", Some(&destination)).await.is_err());
        drop(locked);
        assert_eq!(fs::read(&destination).unwrap(), b"original backup");
        assert!(no_export_temporary_files(&config));
        assert!(fs::read_dir(&root.0).unwrap().all(|item| !item.unwrap().file_name().to_string_lossy().starts_with(".import-")));
    }
}
