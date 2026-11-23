import { useState } from "react";
import { Input, Label } from "@/components";
import { GEMINI_WEB2API_AI_PROVIDER } from "@/config";
import { parseGeminiProxyEndpoint } from "@/lib/functions/gemini-proxy.function";

type GeminiProxySettingsProps = {
  variables: Record<string, string>;
  onChange: (key: "endpoint" | "model" | "api_key", value: string) => void;
};

export function GeminiProxySettings({
  variables,
  onChange,
}: GeminiProxySettingsProps) {
  const { defaultEndpoint, defaultModel } = GEMINI_WEB2API_AI_PROVIDER;
  const [endpointTouched, setEndpointTouched] = useState(false);
  const [keyTouched, setKeyTouched] = useState(false);
  const endpoint = variables.endpoint ?? defaultEndpoint;
  const apiKey = variables.api_key ?? "";
  const invalidEndpoint =
    endpointTouched &&
    !parseGeminiProxyEndpoint(endpoint.trim() || defaultEndpoint);
  const missingKey = keyTouched && !apiKey.trim();

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="gemini-proxy-endpoint">代理聊天接口地址</Label>
        <Input
          id="gemini-proxy-endpoint"
          type="url"
          aria-describedby="gemini-proxy-endpoint-hint"
          aria-invalid={invalidEndpoint}
          placeholder={defaultEndpoint}
          value={endpoint}
          onChange={(event) => onChange("endpoint", event.target.value)}
          onBlur={() => setEndpointTouched(true)}
          className="h-11"
        />
        <p
          id="gemini-proxy-endpoint-hint"
          className={`text-xs ${invalidEndpoint ? "text-destructive" : "text-muted-foreground"}`}
          aria-live="polite"
        >
          {invalidEndpoint
            ? "请输入完整的 HTTP 或 HTTPS 接口地址，登录凭据请填在 API 密钥栏。"
            : "填写完整的聊天接口地址，留空使用默认地址。"}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="gemini-proxy-model">Gemini 模型名称</Label>
          <Input
            id="gemini-proxy-model"
            aria-describedby="gemini-proxy-model-hint"
            placeholder={defaultModel}
            value={variables.model ?? defaultModel}
            onChange={(event) => onChange("model", event.target.value)}
            className="h-11"
          />
          <p id="gemini-proxy-model-hint" className="text-xs text-muted-foreground">
            填写代理 /v1/models 返回的模型 ID，留空使用默认模型。
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="gemini-proxy-key">代理 API 密钥</Label>
          <Input
            id="gemini-proxy-key"
            type="password"
            autoComplete="off"
            aria-describedby="gemini-proxy-key-hint"
            aria-invalid={missingKey}
            required
            value={apiKey}
            onChange={(event) => onChange("api_key", event.target.value)}
            onBlur={() => setKeyTouched(true)}
            className="h-11"
          />
          <p
            id="gemini-proxy-key-hint"
            className={`text-xs ${missingKey ? "text-destructive" : "text-muted-foreground"}`}
            aria-live="polite"
          >
            {missingKey
              ? "请填写代理 API 密钥。"
              : "从代理管理面板的「设置」复制 API Key。"}
          </p>
        </div>
      </div>
    </div>
  );
}
