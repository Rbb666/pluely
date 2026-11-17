import { invoke } from "@tauri-apps/api/core";
import { STORAGE_KEYS } from "@/config/constants";

export const MAX_USER_DATA_IMPORT_BYTES = 160 * 1024 * 1024;
const APPLIED = "__pluely_user_data_import_applied";
const PENDING = "__pluely_user_data_import_pending";
const INTERNAL_PREFIX = "__pluely_";

export const USER_DATA_SETTING_KEYS: readonly string[] = [
  ...Object.values(STORAGE_KEYS),
  "auto-configs-enabled",
  "vad_config",
  "selected_pluely_model",
  "selected_pluely_prompt",
  "pluely-conversation-selected",
  "pluely-promote-card-dismissed",
  "chat_history",
  "chat_history_migrated_to_sqlite",
];

type ImportInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type ImportStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ExportStorage = Pick<Storage, "getItem" | "key" | "length">;

export interface UserDataImportPreview {
  createdAt: string;
  settingsCount: number;
}

interface PendingSettings {
  id: string;
  entries: Record<string, string>;
}

export interface StagedUserDataImport {
  id: string;
  settingsCount: number;
  requiresRestart: true;
}

export interface CompletedUserDataExport {
  cancelled: false;
  path: string;
  settingsCount: number;
  conversationsCount: number;
  messagesCount: number;
  promptsCount: number;
}

export type UserDataExportResult = { cancelled: true } | CompletedUserDataExport;

function stringEntries(value: unknown): [string, string][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("备份中的设置格式无效。");
  }
  const entries = Object.entries(value);
  if (entries.some(([key, entry]) => !key || typeof entry !== "string")) {
    throw new Error("备份中的设置必须是文字键值。");
  }
  return (entries as [string, string][]).filter(([key]) => !key.startsWith(INTERNAL_PREFIX));
}

/** Validate locally and return only metadata safe to show in the file preview. */
export function inspectUserDataBackup(backupJson: string): UserDataImportPreview {
  if (!backupJson.trim()) throw new Error("备份文件为空。");
  if (new TextEncoder().encode(backupJson).byteLength > MAX_USER_DATA_IMPORT_BYTES) {
    throw new Error("备份文件超过 160 MiB，无法导入。");
  }
  let backup: Record<string, unknown>;
  try {
    backup = JSON.parse(backupJson);
  } catch {
    throw new Error("备份文件不是有效的 JSON 文件。");
  }
  if (!backup || typeof backup !== "object" || Array.isArray(backup) ||
      backup.format !== "pluely-backup" || backup.version !== 1) {
    throw new Error("请选择版本 1 的 Pluely 用户数据备份文件。");
  }
  if (typeof backup.createdAt !== "string" || !Number.isFinite(Date.parse(backup.createdAt))) {
    throw new Error("备份文件的创建时间无效。");
  }
  const entries = stringEntries(backup.settings);
  if (typeof backup.databaseBase64 !== "string" || !backup.databaseBase64 ||
      backup.databaseBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(backup.databaseBase64)) {
    throw new Error("备份文件中的聊天数据库为空或编码无效。");
  }
  if (typeof backup.databaseSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(backup.databaseSha256)) {
    throw new Error("备份文件缺少有效的数据库校验值。");
  }
  if (backup.secureStorage != null &&
      (typeof backup.secureStorage !== "object" || Array.isArray(backup.secureStorage))) {
    throw new Error("备份文件中的许可配置格式无效。");
  }
  return { createdAt: backup.createdAt, settingsCount: entries.length };
}

/** Snapshot this origin's settings for the native automatic pre-import backup. */
export function serializeExistingUserSettings(storage: ExportStorage = localStorage): string {
  const entries: [string, string][] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null) continue;
    const value = storage.getItem(key);
    if (value !== null) entries.push([key, value]);
  }
  return JSON.stringify(Object.fromEntries(entries));
}

/** Save through the native dialog; only metadata comes back to the UI. */
export async function exportUserData(
  storage: ExportStorage = localStorage,
  call: ImportInvoke = invoke
): Promise<UserDataExportResult> {
  let result: unknown;
  try {
    const settings = Object.fromEntries(
      stringEntries(JSON.parse(serializeExistingUserSettings(storage)))
        .filter(([key]) => key !== STORAGE_KEYS.AUTOSTART_INITIALIZED)
    );
    result = await call("export_user_data", { settingsJson: JSON.stringify(settings) });
  } catch {
    throw new Error("导出失败，请确认保存目录可写，且没有正在等待重启的导入任务，然后重试。");
  }
  const exported = result as Partial<CompletedUserDataExport> | { cancelled?: unknown } | null;
  if (exported?.cancelled === true) return { cancelled: true };
  const completed = exported as Partial<CompletedUserDataExport> | null;
  if (!completed || completed.cancelled !== false || typeof completed.path !== "string" || !completed.path.trim() ||
      [completed.settingsCount, completed.conversationsCount, completed.messagesCount, completed.promptsCount]
        .some((count) => !Number.isSafeInteger(count) || (count ?? -1) < 0)) {
    throw new Error("无法确认导出结果，请检查所选目录中的备份文件。");
  }
  // Do not expose extra response fields if a native implementation adds any.
  return {
    cancelled: false,
    path: completed.path,
    settingsCount: completed.settingsCount!,
    conversationsCount: completed.conversationsCount!,
    messagesCount: completed.messagesCount!,
    promptsCount: completed.promptsCount!,
  };
}

/** Staging does not replace the running database. Native code validates it again. */
export async function stageUserDataImport(
  backupJson: string,
  storage: ExportStorage = localStorage,
  call: ImportInvoke = invoke
): Promise<StagedUserDataImport> {
  inspectUserDataBackup(backupJson);
  let result: unknown;
  try {
    result = await call("stage_user_data_import", {
      backupJson,
      existingSettingsJson: serializeExistingUserSettings(storage),
    });
  } catch {
    // Native/JSON error details may contain private file values; never echo them.
    throw new Error("无法准备导入。请检查备份文件是否完整，以及应用数据目录是否可写。");
  }
  const staged = result as Partial<StagedUserDataImport> | null;
  if (!staged || typeof staged.id !== "string" || !staged.id ||
      !Number.isSafeInteger(staged.settingsCount) || (staged.settingsCount ?? -1) < 0 ||
      staged.requiresRestart !== true) {
    throw new Error("导入准备状态异常，请关闭应用后重新打开，再检查导入结果。");
  }
  return staged as StagedUserDataImport;
}

export async function restartAfterUserDataImport(call: ImportInvoke = invoke): Promise<void> {
  try {
    await call("restart_after_user_data_import");
  } catch {
    throw new Error("数据已准备好，但未能自动重启。请退出 Pluely 后重新打开，以完成导入。");
  }
}

/** Apply an explicitly confirmed import before React reads any saved preferences. */
export async function initializeUserDataImport(
  storage: ImportStorage = localStorage,
  call: ImportInvoke = invoke
): Promise<void> {
  const apply = async () => {
    const pending = await call("get_pending_user_data_settings") as PendingSettings | null;
    if (!pending) return;
    if (typeof pending.id !== "string" || !pending.id || pending.id.length > 128) {
      throw new Error("待导入数据的标识无效。");
    }
    const entries = stringEntries(pending.entries);
    const complete = () => call("complete_user_data_import", { id: pending.id });
    if (storage.getItem(APPLIED) === pending.id) {
      await complete();
      return;
    }

    // This import was explicitly confirmed. Repeat the same replace operation on
    // interruption; React has not mounted yet, so partial settings are never used.
    storage.setItem(PENDING, pending.id);
    const incoming = new Set(entries.map(([key]) => key));
    for (const key of USER_DATA_SETTING_KEYS) {
      if (!incoming.has(key)) storage.removeItem(key);
    }
    for (const [key, value] of entries) storage.setItem(key, value);
    // This flag describes an OS action on the previous computer, not a preference.
    // Old backups may contain it; let AppProvider apply the restored autostart choice here.
    storage.removeItem(STORAGE_KEYS.AUTOSTART_INITIALIZED);
    storage.setItem(APPLIED, pending.id);
    storage.removeItem(PENDING);
    await complete();
  };

  // Chromium's origin-wide Web Lock serializes main/dashboard bootstraps.
  // The completion marker remains a fallback for runtimes without Web Locks.
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    await navigator.locks.request("pluely-user-data-import", apply);
  } else {
    await apply();
  }
}
