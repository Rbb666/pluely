import Database from "@tauri-apps/plugin-sql";

/**
 * Database configuration
 */
export const DB_NAME = "sqlite:pluely.db";

let dbInstance: Database | null = null;

/**
 * Get database instance
 */
export async function getDatabase(): Promise<Database> {
  if (!dbInstance) {
    try {
      dbInstance = await Database.load(DB_NAME);
    } catch (error) {
      throw new Error(
        `初始化数据库失败：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return dbInstance;
}
