import { invoke } from "@tauri-apps/api/core";

interface MigrationSeed {
  id: string;
  entries: Record<string, string>;
}

const APPLIED = "__pluely_migration_applied";
const PENDING = "__pluely_migration_pending";
type MigrationInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type MigrationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Runs before React reads preferences. Never replaces an existing setting. */
export async function initializeMigration(
  storage: MigrationStorage = localStorage,
  call: MigrationInvoke = invoke
): Promise<void> {
  const seed = await call("get_migration_seed") as MigrationSeed | null;
  if (!seed) return;
  if (!seed.id || !seed.entries || typeof seed.entries !== "object" || Array.isArray(seed.entries)) {
    throw new Error("迁移包的配置数据无效。");
  }
  const entries = Object.entries(seed.entries).filter(([key]) => key !== APPLIED && key !== PENDING);
  if (entries.some(([, value]) => typeof value !== "string")) {
    throw new Error("迁移包的配置格式不正确。");
  }
  const complete = () => call("complete_migration_seed", { id: seed.id });

  if (storage.getItem(APPLIED) === seed.id) {
    await complete();
    return;
  }

  // A pending marker allows recovery after an interrupted import. Multiple app
  // windows may reach this point; all write the same missing keys synchronously.
  const resuming = storage.getItem(PENDING) === seed.id;
  if (!resuming && entries.some(([key]) => storage.getItem(key) !== null)) {
    // Native restoration also checks for existing profiles. This extra guard
    // preserves settings created between that check and WebView initialization.
    await complete();
    return;
  }

  storage.setItem(PENDING, seed.id);
  for (const [key, value] of entries) {
    if (storage.getItem(key) === null) storage.setItem(key, value);
  }
  storage.setItem(APPLIED, seed.id);
  storage.removeItem(PENDING);
  await complete();
}
