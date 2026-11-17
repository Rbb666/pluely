import { getDatabase } from "./config";
import type {
  SystemPrompt,
  SystemPromptInput,
  UpdateSystemPromptInput,
} from "@/types";

/**
 * Create a new system prompt
 */
export async function createSystemPrompt(
  input: SystemPromptInput
): Promise<SystemPrompt> {
  const db = await getDatabase();

  // Validate and sanitize input
  const name = input.name.trim();
  const prompt = input.prompt.trim();

  if (!name) {
    throw new Error("系统提示词名称不能为空");
  }

  if (!prompt) {
    throw new Error("系统提示词内容不能为空");
  }

  const result = await db.execute(
    "INSERT INTO system_prompts (name, prompt) VALUES (?, ?)",
    [name, prompt]
  );

  // Get the last inserted row
  const inserted = await db.select<SystemPrompt[]>(
    "SELECT * FROM system_prompts WHERE id = ?",
    [result.lastInsertId]
  );

  if (!inserted[0]) {
    throw new Error("无法读取新建的系统提示词");
  }

  return inserted[0];
}

/**
 * Get all system prompts
 */
export async function getAllSystemPrompts(): Promise<SystemPrompt[]> {
  const db = await getDatabase();
  return await db.select<SystemPrompt[]>(
    "SELECT * FROM system_prompts ORDER BY created_at DESC"
  );
}

/**
 * Get a single system prompt by ID
 */
export async function getSystemPromptById(
  id: number
): Promise<SystemPrompt | null> {
  const db = await getDatabase();
  const result = await db.select<SystemPrompt[]>(
    "SELECT * FROM system_prompts WHERE id = ?",
    [id]
  );
  return result[0] || null;
}

/**
 * Update a system prompt
 */
export async function updateSystemPrompt(
  id: number,
  input: UpdateSystemPromptInput
): Promise<SystemPrompt> {
  const db = await getDatabase();

  // Build dynamic update query
  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) {
      throw new Error("系统提示词名称不能为空");
    }
    updates.push("name = ?");
    values.push(name);
  }

  if (input.prompt !== undefined) {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error("系统提示词内容不能为空");
    }
    updates.push("prompt = ?");
    values.push(prompt);
  }

  if (updates.length === 0) {
    throw new Error("没有需要更新的内容");
  }

  values.push(id);

  await db.execute(
    `UPDATE system_prompts SET ${updates.join(", ")} WHERE id = ?`,
    values
  );

  const result = await db.select<SystemPrompt[]>(
    "SELECT * FROM system_prompts WHERE id = ?",
    [id]
  );

  if (!result[0]) {
    throw new Error("更新后未找到系统提示词");
  }

  return result[0];
}

/**
 * Delete a system prompt
 */
export async function deleteSystemPrompt(id: number): Promise<void> {
  const db = await getDatabase();
  const result = await db.execute("DELETE FROM system_prompts WHERE id = ?", [
    id,
  ]);

  if (result.rowsAffected === 0) {
    throw new Error("未找到系统提示词");
  }
}
