import {
  deepVariableReplacer,
  getByPath,
  blobToBase64,
} from "./common.function";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";

import { TYPE_PROVIDER } from "@/types";
import curl2Json from "@bany/curl-to-json";
import { shouldUsePluelyAPI } from "./pluely.api";

// Pluely STT function
async function fetchPluelySTT(audio: File | Blob, signal?: AbortSignal): Promise<string> {
  try {
    signal?.throwIfAborted();
    // Convert audio to base64
    const audioBase64 = await blobToBase64(audio);
    signal?.throwIfAborted();

    // Call Tauri command
    const response = await invoke<{
      success: boolean;
      transcription?: string;
      error?: string;
    }>("transcribe_audio", {
      audioBase64,
    });

    signal?.throwIfAborted();
    if (!response.success) throw new Error(response.error || "语音识别失败");
    return requireTranscription(response.transcription);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Pluely 语音识别错误：${errorMessage}`);
  }
}

export interface STTParams {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  audio: File | Blob;
  signal?: AbortSignal;
}

function requireTranscription(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("ASR 未返回可用文字。请确认录音有声音，并检查语音识别服务的响应内容路径。");
  }
  return value.trim();
}

/**
 * Returns only recognized speech. Failures must never be submitted to the LLM as speech.
 */
export async function fetchSTT(params: STTParams): Promise<string> {
  try {
    const { provider, selectedProvider, audio, signal } = params;
    signal?.throwIfAborted();

    // Check if we should use Pluely API instead
    const usePluelyAPI = await shouldUsePluelyAPI();
    if (usePluelyAPI) {
      return await fetchPluelySTT(audio, signal);
    }

    if (!provider) throw new Error("尚未配置服务");
    if (!selectedProvider) throw new Error("尚未选择服务");
    if (!audio) throw new Error("请提供音频文件");

    let curlJson: any;
    try {
      curlJson = curl2Json(provider.curl);
    } catch (error) {
      throw new Error(
        `解析 cURL 失败：${
          error instanceof Error ? error.message : "未知错误"
        }`
      );
    }

    if (
      ["speechmatics-stt", "rev-ai-stt"].includes(provider.id || "") ||
      (["job.id", "id"].includes(provider.responseContentPath || "") &&
        /\/jobs(?:[/?]|$)/.test(curlJson.url || ""))
    ) {
      throw new Error("该 ASR 接口仅返回异步任务 ID，当前语音对话需要同步返回文字的接口。请更换语音识别服务或配置转写文字的响应路径。");
    }

    // Validate audio file
    const file = audio as File;
    if (file.size === 0) throw new Error("音频文件为空");

    // Build variable map
    const allVariables = {
      ...Object.fromEntries(
        Object.entries(selectedProvider.variables).map(([key, value]) => [
          key.toUpperCase(),
          value,
        ])
      ),
    };

    const requiredVariables = new Set(
      [...provider.curl.matchAll(/\{\{([A-Z_]+)\}\}/g)]
        .map((match) => match[1])
        .filter((key) => key !== "AUDIO")
    );
    for (const key of requiredVariables) {
      if (!allVariables[key]?.trim()) {
        throw new Error(`请先在“服务配置 → 语音识别”中填写 ${key}。`);
      }
    }

    // Prepare request
    let url = deepVariableReplacer(curlJson.url || "", allVariables);
    const headers = deepVariableReplacer(curlJson.header || {}, allVariables);
    const formData = deepVariableReplacer(curlJson.form || {}, allVariables);

    // To Check if API accepts Binary Data
    const isBinaryUpload = provider.curl.includes("--data-binary");
    // Fetch URL Params
    const rawParams = curlJson.params || {};
    // Decode Them
    const decodedParams = Object.fromEntries(
      Object.entries(rawParams).map(([key, value]) => [
        key,
        typeof value === "string" ? decodeURIComponent(value) : "",
      ])
    );
    // Get the Parameters from allVariables
    const replacedParams = deepVariableReplacer(decodedParams, allVariables);

    // Add query parameters to URL
    const queryString = new URLSearchParams(replacedParams).toString();
    if (queryString) {
      url += (url.includes("?") ? "&" : "?") + queryString;
    }

    let finalHeaders = { ...headers };
    let body: FormData | string | Blob;

    const isForm =
      provider.curl.includes("-F ") || provider.curl.includes("--form");
    if (isForm) {
      const form = new FormData();
      const freshBlob = new Blob([await audio.arrayBuffer()], {
        type: audio.type,
      });
      const extension = ({
        "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm",
        "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3",
      } as Record<string, string>)[audio.type.split(";")[0]] || "wav";
      let hasAudioField = false;
      for (const [key, val] of Object.entries(formData)) {
        // curl-to-json represents -F fields as either an array or an object.
        const field = /^\d+$/.test(key) && typeof val === "string"
          ? [val.slice(0, val.indexOf("=")), val.slice(val.indexOf("=") + 1)]
          : [key, val];
        const name = String(field[0]);
        const value = field[1];
        if (!name) continue;
        if (typeof value === "string" && value.includes("{{AUDIO}}")) {
          form.append(name, freshBlob, `audio.${extension}`);
          hasAudioField = true;
        } else if (value !== undefined && value !== null) {
          form.append(name, typeof value === "string" ? value : JSON.stringify(value));
        }
      }
      if (!hasAudioField) throw new Error("语音识别的 cURL 表单中缺少 {{AUDIO}} 音频变量。");
      // The browser must generate the multipart boundary, regardless of header case.
      for (const key of Object.keys(finalHeaders)) {
        if (key.toLowerCase() === "content-type") delete finalHeaders[key];
      }
      body = form;
    } else if (isBinaryUpload) {
      // Deepgram-style: raw binary body
      body = new Blob([await audio.arrayBuffer()], {
        type: audio.type,
      });
    } else {
      // Google-style: JSON payload with base64
      allVariables.AUDIO = await blobToBase64(audio);
      const dataObj = curlJson.data ? { ...curlJson.data } : {};
      body = JSON.stringify(deepVariableReplacer(dataObj, allVariables));
    }

    const fetchFunction = url?.includes("http") ? fetch : tauriFetch;

    // Send request
    let response: Response;
    try {
      // curl-to-json defaults to GET even for curl commands with -F/-d bodies.
      const explicitMethod = provider.curl.match(/(?:^|\s)(?:-X|--request)(?:\s+|=)?["']?([a-z]+)/i)?.[1];
      const method = explicitMethod?.toUpperCase() || "POST";
      response = await fetchFunction(url, {
        method,
        headers: finalHeaders,
        body: method === "GET" ? undefined : body,
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      throw new Error(`网络错误：${e instanceof Error ? e.message : e}`);
    }

    if (!response.ok) {
      let errText = "";
      try {
        errText = await response.text();
      } catch {}
      let errMsg: string;
      try {
        const errObj = JSON.parse(errText);
        errMsg = errObj.message || errText;
      } catch {
        errMsg = errText || response.statusText;
      }
      throw new Error(`HTTP ${response.status}: ${errMsg}`);
    }

    const responseText = await response.text();
    signal?.throwIfAborted();
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      return requireTranscription(responseText);
    }

    // Extract transcription
    const path = provider.responseContentPath || "text";
    return requireTranscription(typeof data === "string" ? data : getByPath(data, path));
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(String(err));
  }
}
