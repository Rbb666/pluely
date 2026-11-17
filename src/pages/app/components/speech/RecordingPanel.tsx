import { Button } from "@/components";
import { MicIcon, StopCircleIcon, XIcon, Loader2 } from "lucide-react";

interface RecordingPanelProps {
  isVadMode: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  isAIProcessing: boolean;
  recordingProgress: number;
  maxDuration: number;
  disabled?: boolean;
  onStartRecording: () => void;
  onStopAndSend: () => void;
  onIgnore: () => void;
}

export const RecordingPanel = ({
  isVadMode,
  isRecording,
  isProcessing,
  isAIProcessing,
  recordingProgress,
  maxDuration,
  disabled = false,
  onStartRecording,
  onStopAndSend,
  onIgnore,
}: RecordingPanelProps) => {
  const isWorking = isProcessing || isAIProcessing;

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
      {isVadMode && (
        <p className="p-3 text-xs text-muted-foreground">
          自动检测电脑播放的语音：停顿后会自动转文字并交给 AI 回复。
          如需自己控制录音结束，请切换到“手动”。“结束会话”会丢弃尚未提交的音频。
        </p>
      )}
      {/* Manual Mode */}
      {!isVadMode && (
        <div className="p-3 space-y-2">
          {/* Status when working */}
          {isWorking && (
            <div className="flex items-center justify-end gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
              <span className="text-[9px] text-muted-foreground">
                {isProcessing ? "正在识别…" : "正在生成…"}
              </span>
            </div>
          )}

          {/* Buttons - Always at top when not working */}
          {!isWorking && (
            <>
              <div className="flex gap-2">
                {!isRecording ? (
                  <Button
                    onClick={onStartRecording}
                    disabled={disabled}
                    title="开始录制电脑播放的声音"
                    aria-label="开始录制电脑播放的声音"
                    className="flex-1 gap-1.5"
                    size="sm"
                  >
                    <MicIcon className="w-3.5 h-3.5" />
                    开始录音
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={onIgnore}
                      disabled={disabled}
                      title="丢弃这段录音，不进行语音识别"
                      aria-label="丢弃这段录音"
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1"
                    >
                      <XIcon className="w-3 h-3" />
                      丢弃
                    </Button>
                    <Button
                      onClick={onStopAndSend}
                      disabled={disabled}
                      title="停止本段录音，转成文字后发送给 AI"
                      aria-label="停止本段录音并发送给 AI"
                      size="sm"
                      className="flex-1 gap-1"
                    >
                      <StopCircleIcon className="w-3 h-3" />
                      停止并发送
                    </Button>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {isRecording
                  ? "播放声音结束后，点击“停止并发送”：录音 → 语音识别（ASR）→ AI 回复。"
                  : "当前未录音。点击“开始录音”，再播放需要识别的声音。"}
              </p>

              {/* Progress bar when recording */}
              {isRecording && (
                <div className="space-y-1">
                  <div className="w-full bg-muted rounded-full h-1">
                    <div
                      className="bg-red-500 h-1 rounded-full transition-all duration-500"
                      style={{
                        width: `${(recordingProgress / maxDuration) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      正在录音 {recordingProgress} 秒
                    </span>
                    <span>最长 {maxDuration} 秒</span>
                  </div>
                </div>
              )}

              {/* Keyboard hints - bottom right */}
              <div className="flex justify-end gap-3 text-[8px] text-muted-foreground/60">
                {!isRecording ? (
                  <span>
                    <kbd className="px-1 py-0.5 rounded bg-muted font-mono">
                      Space
                    </kbd>{" "}
                    /{" "}
                    <kbd className="px-1 py-0.5 rounded bg-muted font-mono">
                      Enter
                    </kbd>{" "}
                    开始
                  </span>
                ) : (
                  <>
                    <span>
                      <kbd className="px-1 py-0.5 rounded bg-muted font-mono">
                        Enter
                      </kbd>{" "}
                      发送
                    </span>
                    <span>
                      <kbd className="px-1 py-0.5 rounded bg-muted font-mono">
                        Esc
                      </kbd>{" "}
                      丢弃
                    </span>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
