import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { GEMINI_WEB2API_AI_PROVIDER } from "@/config/ai-providers.constants";
import type { Message } from "@/types";
import { getByPath, getStreamingContent } from "./common.function";

export function parseGeminiProxyEndpoint(value: string): URL | undefined {
  const endpoint = value.trim();
  if (!/^https?:\/\//i.test(endpoint)) return;

  try {
    const url = new URL(endpoint);
    if (!url.username && !url.password) return url;
  } catch {
    return;
  }
}

// Older versions saved transport errors in place of assistant replies.
const legacyReplyError =
  /^(?:API 请求失败：\d{3}(?:\s|$)|API 请求发生网络错误：|解析非流式回复失败：|读取回复数据流失败：|服务不支持流式回复，或响应内容为空$|Pluely API 错误：)/;

function filterHistory(history: Message[]): Message[] {
  const messages: Message[] = [];
  for (const [index, message] of history.entries()) {
    if (
      message.role === "assistant" &&
      typeof message.content === "string" &&
      legacyReplyError.test(message.content.trimStart())
    ) {
      if (
        history[index - 1]?.role === "user" &&
        messages[messages.length - 1] === history[index - 1]
      ) messages.pop();
      continue;
    }
    messages.push(message);
  }
  return messages;
}

function isAborted(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted || (error instanceof Error && error.name === "AbortError"));
}

export async function* fetchGeminiProxyResponse({
  variables,
  systemPrompt,
  history,
  userMessage,
  signal,
}: {
  variables: Record<string, string>;
  systemPrompt?: string;
  history: Message[];
  userMessage: string;
  signal?: AbortSignal;
}): AsyncIterable<string> {
  if (signal?.aborted) return;
  const { defaultEndpoint, defaultModel, responseContentPath } =
    GEMINI_WEB2API_AI_PROVIDER;
  const endpoint = parseGeminiProxyEndpoint(variables.endpoint?.trim() || defaultEndpoint);
  if (!endpoint) throw new Error("请在服务配置中填写完整的 HTTP 或 HTTPS 接口地址。");
  const apiKey = variables.api_key?.trim();
  if (!apiKey) throw new Error("请在服务配置中填写 Gemini 代理管理面板的 API 密钥。");

  const messages: Message[] = systemPrompt ? [{ role: "system", content: systemPrompt }] : [];
  messages.push(...filterHistory(history), { role: "user", content: userMessage });
  const fetchFunction = isTauri() ? tauriFetch : fetch;
  let response: Response;
  try {
    response = await fetchFunction(endpoint.href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: variables.model?.trim() || defaultModel,
        messages,
        stream: true,
      }),
      signal,
    });
  } catch (error) {
    if (isAborted(error, signal)) return;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`API 请求发生网络错误：${message}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (signal?.aborted) return;
    throw new Error(`API 请求失败：${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`);
  }
  if (!response.body) throw new Error("Gemini 代理未返回回复正文。");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedAnswer = false;
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (signal?.aborted) return;
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (signal?.aborted) return;
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") {
          if (!receivedAnswer) throw new Error("Gemini 代理未返回回复正文。");
          return;
        }

        let chunk: unknown;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        const error = getByPath(chunk, "error");
        if (error) {
          const message = typeof error === "string" ? error : error.message;
          throw new Error(`Gemini 代理流式回复失败：${message || "未知错误"}`);
        }
        const delta = getStreamingContent(chunk, responseContentPath);
        if (delta) {
          receivedAnswer ||= Boolean(delta.trim());
          yield delta;
        }
      }
      if (done) throw new Error("Gemini 代理的回复流提前结束。");
    }
  } catch (error) {
    if (isAborted(error, signal)) return;
    throw error;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
