import { Button, Header, Input, Selection, TextInput } from "@/components";
import { GEMINI_WEB2API_AI_PROVIDER } from "@/config";
import { UseSettingsReturn } from "@/types";
import { getProviderVariableLabel } from "@/lib";
import curl2Json from "@bany/curl-to-json";
import { KeyIcon, TrashIcon } from "lucide-react";
import { GeminiProxySettings } from "./GeminiProxySettings";

export const Providers = ({
  allAiProviders,
  selectedAIProvider,
  onSetSelectedAIProvider,
  variables,
}: UseSettingsReturn) => {
  const selectedProvider = allAiProviders.find(
    (provider) => provider.id === selectedAIProvider.provider
  );
  const isGeminiProxy = selectedAIProvider.provider === GEMINI_WEB2API_AI_PROVIDER.id;
  const localSelectedProvider = selectedProvider?.curl
    ? curl2Json(selectedProvider.curl)
    : null;

  const findKeyAndValue = (key: string) => {
    return variables?.find((v) => v?.key === key);
  };

  const getApiKeyValue = () => {
    const apiKeyVar = findKeyAndValue("api_key");
    if (!apiKeyVar || !selectedAIProvider?.variables) return "";
    return selectedAIProvider?.variables?.[apiKeyVar.key] || "";
  };

  const isApiKeyEmpty = () => {
    return !getApiKeyValue().trim();
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Header
          title="选择 AI 服务"
          description="选择预设或自定义 AI 服务以开始使用。"
        />
        <Selection
          selected={selectedAIProvider?.provider}
          options={allAiProviders?.map((provider) => {
            if (provider.id === GEMINI_WEB2API_AI_PROVIDER.id) {
              return { label: GEMINI_WEB2API_AI_PROVIDER.name, value: provider.id };
            }

            const json = provider.isCustom ? curl2Json(provider.curl) : null;
            return {
              label: provider?.isCustom
                ? json?.url || "自定义服务"
                : provider?.id || "自定义服务",
              value: provider?.id || "Custom Provider",
              isCustom: provider?.isCustom,
            };
          })}
          placeholder="选择 AI 服务"
          onChange={(value) => {
            onSetSelectedAIProvider({
              provider: value,
              variables: {},
            });
          }}
        />
      </div>

      {isGeminiProxy && (
        <GeminiProxySettings
          variables={selectedAIProvider.variables}
          onChange={(key, value) =>
            onSetSelectedAIProvider({
              provider: GEMINI_WEB2API_AI_PROVIDER.id,
              variables: { ...selectedAIProvider.variables, [key]: value },
            })
          }
        />
      )}

      {localSelectedProvider ? (
        <Header
          title={`请求方法： ${
            localSelectedProvider?.method || "无效"
          }，接口： ${localSelectedProvider?.url || "无效"}`}
          description={"如需使用其他地址或请求方法，可添加自定义服务。"}
        />
      ) : null}

      {!isGeminiProxy && findKeyAndValue("api_key") ? (
        <div className="space-y-2">
          <Header
            title="API 密钥"
            description={`输入 ${
              allAiProviders?.find(
                (p) => p?.id === selectedAIProvider?.provider
              )?.isCustom
                ? "自定义服务"
                : selectedAIProvider?.provider
            } 的 API 密钥以访问 AI 模型。密钥保存在本地，仅用于调用对应服务。`}
          />

          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="**********"
                value={getApiKeyValue()}
                onChange={(value) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selectedAIProvider) return;

                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [apiKeyVar.key]:
                        typeof value === "string" ? value : value.target.value,
                    },
                  });
                }}
                onKeyDown={(e) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selectedAIProvider) return;

                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [apiKeyVar.key]: (e.target as HTMLInputElement).value,
                    },
                  });
                }}
                disabled={false}
                className="flex-1 h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
              />
              {isApiKeyEmpty() ? (
                <Button
                  onClick={() => {
                    const apiKeyVar = findKeyAndValue("api_key");
                    if (!apiKeyVar || !selectedAIProvider || isApiKeyEmpty())
                      return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [apiKeyVar.key]: getApiKeyValue(),
                      },
                    });
                  }}
                  disabled={isApiKeyEmpty()}
                  size="icon"
                  className="shrink-0 h-11 w-11"
                  title="保存 API 密钥"
                >
                  <KeyIcon className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    const apiKeyVar = findKeyAndValue("api_key");
                    if (!apiKeyVar || !selectedAIProvider) return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [apiKeyVar.key]: "",
                      },
                    });
                  }}
                  size="icon"
                  variant="destructive"
                  className="shrink-0 h-11 w-11"
                  title="移除 API 密钥"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-4 mt-2">
        {(isGeminiProxy ? [] : variables)
          .filter(
            (variable) => variable.key !== findKeyAndValue("api_key")?.key
          )
          .map((variable) => {
            const variableLabel = getProviderVariableLabel(
              variable?.key || variable?.value || "参数"
            );
            const getVariableValue = () => {
              if (!variable?.key || !selectedAIProvider?.variables) return "";
              return selectedAIProvider.variables[variable.key] || "";
            };

            return (
              <div className="space-y-1" key={variable?.key}>
                <Header
                  title={variableLabel}
                  description={`填写${variableLabel}，服务：${
                    allAiProviders?.find(
                      (p) => p?.id === selectedAIProvider?.provider
                    )?.isCustom
                      ? "自定义服务"
                      : selectedAIProvider?.provider
                  }`}
                />
                <TextInput
                  placeholder={`输入 ${
                    allAiProviders?.find(
                      (p) => p?.id === selectedAIProvider?.provider
                    )?.isCustom
                      ? "自定义服务"
                      : selectedAIProvider?.provider
                  } 的${variableLabel}`}
                  value={getVariableValue()}
                  onChange={(value) => {
                    if (!variable?.key || !selectedAIProvider) return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [variable.key]: value,
                      },
                    });
                  }}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
};
