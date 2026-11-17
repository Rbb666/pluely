import {
  Card,
  Button,
  Header,
  TextInput,
  Switch,
  Textarea,
  Selection,
} from "@/components";
import { PlusIcon, SaveIcon } from "lucide-react";
import { useCustomSttProviders } from "@/hooks";
import { useApp } from "@/contexts";
import { cn } from "@/lib/utils";

interface CreateEditProviderProps {
  customProviderHook?: ReturnType<typeof useCustomSttProviders>;
}

export const CreateEditProvider = ({
  customProviderHook,
}: CreateEditProviderProps) => {
  const { allSttProviders } = useApp();
  // Use the provided hook instance or create a new one
  const hookInstance = customProviderHook || useCustomSttProviders();

  const {
    showForm,
    setShowForm,
    editingProvider,
    formData,
    setFormData,
    errors,
    handleSave,
    setErrors,
    handleAutoFill,
  } = hookInstance;

  return (
    <>
      {!showForm ? (
        <Button
          onClick={() => {
            setShowForm(true);
            setErrors({});
          }}
          variant="outline"
          className="w-full h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          添加自定义语音识别服务
        </Button>
      ) : (
        <Card className="p-4 border border-input/50 bg-transparent">
          <div className="flex justify-between items-center">
            <Header
              title={
                editingProvider
                  ? "编辑语音识别服务"
                  : "添加自定义语音识别服务"
              }
              description="添加自定义语音识别服务，配置接口和响应格式。"
            />
            <div className="w-[120px]">
              <Selection
                options={allSttProviders
                  ?.filter((provider) => !provider?.isCustom)
                  .map((provider) => {
                    return {
                      label: provider?.id || "语音识别服务",
                      value: provider?.id || "STT Provider",
                    };
                  })}
                placeholder={"自动填写"}
                onChange={(value) => {
                  handleAutoFill(value);
                }}
              />
            </div>
          </div>

          <div className="">
            {/* Basic Configuration */}
            <div className="space-y-1">
              <Header
                title="cURL 命令 *"
                description="用于调用语音识别服务的 cURL 命令。"
              />
              <Textarea
                className={cn(
                  "h-74 font-mono text-sm",
                  errors.curl && "border-red-500"
                )}
                placeholder={`curl -X POST "https://api.openai.com/v1/audio/transcriptions" \\
      -H "Authorization: Bearer {{API_KEY}}" \\
      -F "file={{AUDIO}}" \\
      -F "model={{MODEL}}"`}
                value={formData.curl}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, curl: e.target.value }))
                }
              />
              {errors.curl && (
                <p className="text-xs text-red-500 mt-1">{errors.curl}</p>
              )}

              {/* Variable Instructions */}
              <div className="bg-muted/50 p-4 rounded-lg space-y-4">
                <div className="bg-card border p-3 rounded-lg">
                  <p className="text-sm font-medium text-primary mb-2">
                    💡 提示：可以使用自定义变量，也可以直接填写 API 密钥或参数值
                  </p>
                  <p className="text-xs text-muted-foreground">
                    可直接在 cURL 命令中填写参数，无需选择服务后再次输入。例如，将 YOUR_API_KEY 替换为真实密钥，或使用{" "}
                    <code className="bg-muted px-1 rounded text-xs">
                      {"{{MODEL}}"}
                    </code>{" "}
                    表示模型名称。
                  </p>
                </div>

                <h4 className="text-sm font-semibold text-foreground">
                  ⚠️ 语音识别服务使用的变量：
                </h4>
                <div className="grid grid-cols-1 gap-3 text-sm">
                  <div className="flex items-center gap-3 p-3 bg-card border rounded-lg">
                    <code className="bg-muted px-2 py-1 rounded font-mono text-xs">
                      {"{{AUDIO}}"}
                    </code>
                    <span className="text-foreground font-medium">
                      → 必填：Base64 编码音频数据；使用 multipart/form-data（-F 或 --form）时为 WAV 音频文件
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">快速配置：</strong>{" "}
                    将{" "}
                    <code className="bg-muted px-1 rounded text-xs">
                      YOUR_API_KEY
                    </code>{" "}
                    直接替换为真实 API 密钥。
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">
                      自定义变量：
                    </strong>{" "}
                    可以按照相同的{" "}
                    <code className="bg-muted px-1 rounded text-xs">
                      {"{{VARIABLE_NAME}}"}
                    </code>{" "}
                    格式添加变量，选择此服务后即可配置。
                  </p>
                  <p className="text-xs text-muted-foreground italic">
                    💡 提示：{" "}
                    <code className="bg-muted px-1 rounded text-xs">
                      {"{{AUDIO}}"}
                    </code>{" "}
                    变量是语音识别的必需参数，请确保 cURL 命令中已正确包含该变量。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-0">
            <div className="flex justify-between items-center space-x-2">
              <Header
                title="流式输出"
                description="逐步接收并显示 AI 服务生成的回复。"
              />
              <Switch
                checked={formData.streaming}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({
                    ...prev,
                    streaming: checked,
                  }))
                }
                disabled={true}
              />
            </div>
            <span className="text-xs italic text-red-500">
              目前语音识别服务暂不支持流式输出。
            </span>
          </div>
          {/* Response Configuration */}
          <div className="space-y-2">
            <Header
              title="响应内容路径 *"
              description="从 API 响应中提取正文内容的路径。"
            />

            <TextInput
              placeholder="text"
              value={formData.responseContentPath || ""}
              onChange={(value) =>
                setFormData((prev) => ({
                  ...prev,
                  responseContentPath: value,
                }))
              }
              error={errors.responseContentPath}
              notes="从 API 响应中提取文字的路径。例如：text、transcript、results[0].alternatives[0].transcript"
            />
          </div>

          <div className="flex justify-end gap-2 -mt-3">
            <Button
              variant="outline"
              onClick={() => setShowForm(!showForm)}
              className="h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
            >
              取消
            </Button>
            <Button
              onClick={handleSave}
              disabled={!formData.curl.trim()}
              className={cn(
                "h-11 border-1 border-input/50 focus:border-primary/50 transition-colors",
                errors.curl && "bg-red-500 hover:bg-red-600 text-white"
              )}
            >
              {errors.curl ? (
                "cURL 命令无效，请修改"
              ) : (
                <>
                  <SaveIcon className="h-4 w-4 mr-2" />
                  {editingProvider ? "更新" : "保存"} 服务
                </>
              )}
            </Button>
          </div>
        </Card>
      )}
    </>
  );
};
