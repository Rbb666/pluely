import { useCallback, useState } from "react";
import { AudioWaveformIcon, MicIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, Button, Markdown } from "@/components";
import { UseCompletionReturn } from "@/types";
import { useApp } from "@/contexts";
import { AudioRecorder } from "@/pages/chats/components/AudioRecorder";
import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage";
import { AutoSpeechVAD } from "./AutoSpeechVad";

type RecordingMode = "auto" | "manual";

export const Audio = ({
  micOpen,
  setMicOpen,
  setEnableVAD,
  submit,
  cancel,
  isLoading,
  response,
  error,
}: UseCompletionReturn) => {
  const { selectedSttProvider, pluelyApiEnabled } = useApp();
  const configured = pluelyApiEnabled || !!selectedSttProvider.provider;
  const [mode, setMode] = useState<RecordingMode>(() =>
    safeLocalStorage.getItem(STORAGE_KEYS.MICROPHONE_MODE) === "manual" ? "manual" : "auto"
  );
  const [active, setActive] = useState(false);
  const close = useCallback(() => {
    setMicOpen(false);
    setEnableVAD(false);
  }, [setMicOpen, setEnableVAD]);
  const onActiveChange = useCallback((next: boolean) => {
    setActive(next);
    setEnableVAD(next && mode === "auto");
  }, [mode, setEnableVAD]);
  const changeMode = (next: RecordingMode) => {
    if (active) return;
    setMode(next);
    safeLocalStorage.setItem(STORAGE_KEYS.MICROPHONE_MODE, next);
  };

  return (
    <Popover open={micOpen} onOpenChange={(open) => { if (open) setMicOpen(true); else close(); }}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          className="cursor-pointer"
          title={active ? "打开或关闭麦克风面板；关闭会停止录音" : "麦克风语音输入：自动断句或手动发送"}
          aria-label="麦克风语音输入"
          disabled={isLoading && !micOpen}
        >
          <MicIcon className={active ? "text-red-500" : ""} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-[min(30rem,calc(100vw-1rem))] max-h-[calc(100vh-5rem)] overflow-y-auto p-3 space-y-3" sideOffset={8}
        onInteractOutside={(event) => event.preventDefault()}>
        {!configured ? (
          <div className="space-y-3 text-sm">
            <p className="font-medium">请先配置语音识别服务</p>
            <p className="text-muted-foreground">前往“服务配置 → 语音识别”填写 ASR 服务，再配置 AI 服务用于生成回复。</p>
            <Button size="sm" variant="outline" onClick={close}>关闭</Button>
          </div>
        ) : micOpen ? (
          <>
            <div className="flex gap-2" role="group" aria-label="麦克风录音模式">
              <Button
                size="sm"
                className="flex-1"
                variant={mode === "auto" ? "default" : "outline"}
                aria-pressed={mode === "auto"}
                title="检测到说话停顿后，自动识别并发送给 AI"
                disabled={active}
                onClick={() => changeMode("auto")}
              ><AudioWaveformIcon className="size-4" />自动断句发送</Button>
              <Button
                size="sm"
                className="flex-1"
                variant={mode === "manual" ? "default" : "outline"}
                aria-pressed={mode === "manual"}
                title="手动点击停止并发送，决定何时结束这一段录音"
                disabled={active}
                onClick={() => changeMode("manual")}
              ><MicIcon className="size-4" />手动停止发送</Button>
            </div>
            {mode === "auto" ? (
              <AutoSpeechVAD submit={submit} cancel={cancel} onClose={close} onActiveChange={onActiveChange} />
            ) : (
              <AudioRecorder
                autoStart={false}
                onActiveChange={onActiveChange}
                onCancel={close}
                onTranscriptionComplete={(text) => { close(); void submit(text); }}
              />
            )}
            {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
            {(response || isLoading) && (
              <section aria-label="语音对话的 AI 回复" className="border-t pt-3 space-y-2 text-sm">
                <p className="font-medium">{isLoading ? "AI 正在回复…" : "AI 回复"}</p>
                {response && <Markdown isStreaming={isLoading}>{response}</Markdown>}
              </section>
            )}
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
};
