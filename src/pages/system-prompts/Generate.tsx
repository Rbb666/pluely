import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  GetLicense,
  Textarea,
} from "@/components";
import { SparklesIcon } from "lucide-react";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "@/contexts";
import { fetchAIResponse } from "@/lib/functions";

interface GenerateSystemPromptProps {
  onGenerate: (prompt: string, promptName: string) => void;
}

interface SystemPromptResponse {
  prompt_name: string;
  system_prompt: string;
}

export const GenerateSystemPrompt = ({
  onGenerate,
}: GenerateSystemPromptProps) => {
  const {
    hasActiveLicense,
    hasLocalFeatures,
    pluelyApiEnabled,
    allAiProviders,
    selectedAIProvider,
  } = useApp();
  const canGenerate = pluelyApiEnabled ? hasActiveLicense : hasLocalFeatures;
  const [userPrompt, setUserPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleGenerate = async () => {
    if (!userPrompt.trim()) {
      setError("请描述你需要的 AI 行为");
      return;
    }
    if (!canGenerate) {
      setError("使用 Pluely API 生成提示词需要有效授权。");
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);

      let response: SystemPromptResponse;
      if (pluelyApiEnabled) {
        response = await invoke<SystemPromptResponse>("create_system_prompt", {
          userPrompt: userPrompt.trim(),
        });
      } else {
        const provider = allAiProviders.find(
          (item) => item.id === selectedAIProvider.provider
        );
        if (!provider) {
          throw new Error(
            "请先在服务配置中选择并配置 AI 服务。"
          );
        }

        let generated = "";
        for await (const chunk of fetchAIResponse({
          provider,
          selectedProvider: selectedAIProvider,
          applyResponseSettings: false,
          systemPrompt:
            "You write clear, reusable system prompts for AI assistants. Return only a JSON object with two string fields: prompt_name (a short title) and system_prompt (the complete prompt). Do not include commentary or markdown fences.",
          userMessage: `Create a system prompt for this request: ${userPrompt.trim()}\nReturn only valid JSON with prompt_name and system_prompt.`,
        })) {
          generated += chunk;
        }

        // Some providers wrap JSON in a code fence despite the instructions.
        const json = generated
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "");
        try {
          response = JSON.parse(json);
        } catch {
          throw new Error(
            "AI 服务未返回有效的提示词，请检查配置后重试。"
          );
        }
      }

      if (
        response &&
        typeof response.system_prompt === "string" &&
        response.system_prompt.trim() &&
        typeof response.prompt_name === "string" &&
        response.prompt_name.trim()
      ) {
        onGenerate(response.system_prompt, response.prompt_name);
        setIsOpen(false);
        setUserPrompt("");
      } else {
        throw new Error(
          "AI 服务返回的提示词为空或不完整，请重试。"
        );
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : typeof err === "string"
          ? err
          : "生成提示词失败";
      setError(errorMessage);
      console.error("生成系统提示词失败：", err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-label="AI 生成"
          size="sm"
          variant="outline"
          className="w-fit"
        >
          <SparklesIcon className="h-4 w-4" /> AI 生成
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-96 p-4 border shadow-lg"
      >
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium mb-1">生成系统提示词</p>
            <p className="text-xs text-muted-foreground">
              描述你需要的 AI 行为。生成时使用{" "}
              {pluelyApiEnabled ? "Pluely API" : "你选择的 AI 服务"}。
            </p>
          </div>

          <Textarea
            placeholder="例如：我需要一个帮助审查代码、关注最佳实践的 AI 助手…"
            className="min-h-[100px] resize-none border-1 border-input/50 focus:border-primary/50 transition-colors"
            value={userPrompt}
            onChange={(e) => {
              setUserPrompt(e.target.value);
              setError(null);
            }}
            disabled={isGenerating}
          />

          {error && <p className="text-xs text-destructive">{error}</p>}

          {canGenerate ? (
            <Button
              className="w-full"
              onClick={handleGenerate}
              disabled={!userPrompt.trim() || isGenerating}
            >
              {isGenerating ? (
                <>
                  <SparklesIcon className="h-4 w-4 animate-pulse" />
                  正在生成…
                </>
              ) : (
                <>
                  <SparklesIcon className="h-4 w-4" />
                  生成
                </>
              )}
            </Button>
          ) : (
            <div className="w-full flex flex-col gap-3">
              <p className="text-sm font-medium text-muted-foreground">
                使用 Pluely API 生成需要有效授权。也可以关闭 Pluely API，改用自己的 AI 服务。
              </p>
              <GetLicense
                buttonText="获取授权"
                buttonClassName="w-full"
                setState={setIsOpen}
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
