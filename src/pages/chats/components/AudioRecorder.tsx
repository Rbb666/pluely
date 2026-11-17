import { useState, useRef, useEffect } from "react";
import { Button } from "@/components";
import { AudioVisualizer } from "@/pages/app/components/speech/audio-visualizer";
import { shouldUsePluelyAPI, fetchSTT } from "@/lib";
import {
  openMicrophone,
  finishMicrophoneRecording,
  microphoneRecordingToWav,
  microphoneErrorMessage,
} from "@/lib/microphone";
import { useApp } from "@/contexts";
import { MicIcon, Send, XIcon, LoaderCircleIcon } from "lucide-react";

interface AudioRecorderProps {
  onTranscriptionComplete: (text: string) => void;
  onCancel: () => void;
  autoStart?: boolean;
  onActiveChange?: (active: boolean) => void;
}

const MAX_DURATION = 3 * 60 * 1000;
type RecordingPhase = "idle" | "starting" | "recording" | "transcribing" | "error";

export const AudioRecorder = ({
  onTranscriptionComplete,
  onCancel,
  autoStart = true,
  onActiveChange,
}: AudioRecorderProps) => {
  const { selectedSttProvider, allSttProviders, selectedAudioDevices } = useApp();
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const phaseRef = useRef<RecordingPhase>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);

  const updatePhase = (next: RecordingPhase) => {
    phaseRef.current = next;
    if (mountedRef.current) setPhase(next);
  };
  const clearTimers = () => {
    if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    if (maxDurationTimeoutRef.current) clearTimeout(maxDurationTimeoutRef.current);
    durationIntervalRef.current = null;
    maxDurationTimeoutRef.current = null;
  };
  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (mountedRef.current) setAudioStream(null);
  };
  const cancelRecording = () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clearTimers();
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* Device may already have disconnected. */ }
    }
    releaseStream();
  };

  const startRecording = async () => {
    if (["starting", "recording", "transcribing"].includes(phaseRef.current)) return;
    cancelRecording();
    const generation = generationRef.current;
    const current = () => mountedRef.current && generationRef.current === generation;
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setWarning("");
    setDuration(0);
    updatePhase("starting");
    let openedStream: MediaStream | undefined;
    try {
      const opened = await openMicrophone(selectedAudioDevices.input, controller.signal);
      openedStream = opened.stream;
      if (!current()) { opened.stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = opened.stream;
      setAudioStream(opened.stream);
      setDeviceName(opened.deviceName);
      setWarning(opened.warning);

      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(opened.stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];
      audioChunksRef.current = chunks;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        if (!current()) return;
        cancelRecording();
        setError("录音设备发生错误，请检查麦克风后重试。");
        updatePhase("error");
      };
      const handleDeviceStopped = () => {
        // Explicit send has already changed the phase; cancellation invalidates
        // this session before releasing tracks. Only unexpected stops are errors.
        if (!current() || phaseRef.current !== "recording") return;
        cancelRecording();
        setError("麦克风录音已意外结束，请检查设备连接后重新录音。");
        updatePhase("error");
      };
      recorder.onstop = handleDeviceStopped;
      opened.stream.getAudioTracks().forEach((track) => {
        track.addEventListener("ended", handleDeviceStopped, { once: true });
      });
      recorder.start(100);
      const startedAt = Date.now();
      updatePhase("recording");
      durationIntervalRef.current = setInterval(() => {
        if (current()) setDuration(Date.now() - startedAt);
      }, 100);
      maxDurationTimeoutRef.current = setTimeout(() => {
        if (current() && phaseRef.current === "recording") void handleSend();
      }, MAX_DURATION);
    } catch (cause) {
      openedStream?.getTracks().forEach((track) => track.stop());
      if (!current()) return;
      releaseStream();
      setError(microphoneErrorMessage(cause));
      updatePhase("error");
    }
  };

  const handleSend = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || phaseRef.current !== "recording") return;
    const generation = generationRef.current;
    const current = () => mountedRef.current && generationRef.current === generation;
    const signal = abortRef.current?.signal;
    updatePhase("transcribing");
    clearTimers();
    try {
      // stop() asynchronously emits the last audio block. Do not copy chunks early.
      const recordedBlob = await finishMicrophoneRecording(recorder, audioChunksRef.current);
      if (!current()) return;
      mediaRecorderRef.current = null;
      releaseStream();
      const audio = await microphoneRecordingToWav(recordedBlob, signal);
      if (!current()) return;
      const usePluelyAPI = await shouldUsePluelyAPI();
      if (!current()) return;
      const provider = allSttProviders.find((item) => item.id === selectedSttProvider.provider);
      const text = await fetchSTT({
        provider: usePluelyAPI ? undefined : provider,
        selectedProvider: selectedSttProvider,
        audio,
        signal,
      });
      if (!current()) return;
      if (!text.trim()) throw new Error("未识别到文字，请确认麦克风有声音后重试。");
      updatePhase("idle");
      onTranscriptionComplete(text.trim());
    } catch (cause) {
      if (!current()) return;
      releaseStream();
      setError(microphoneErrorMessage(cause));
      updatePhase("error");
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    if (autoStart) void startRecording();
    return () => {
      mountedRef.current = false;
      cancelRecording();
      phaseRef.current = "idle";
    };
  }, []);

  const seconds = Math.floor(duration / 1000);
  useEffect(() => {
    onActiveChange?.(["starting", "recording", "transcribing"].includes(phase));
  }, [phase, onActiveChange]);

  useEffect(() => () => onActiveChange?.(false), [onActiveChange]);

  const durationLabel = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;

  return (
    <div className="border bg-background rounded-lg overflow-hidden">
      <div className="p-3 space-y-2">
        <p className="text-sm font-medium">麦克风语音输入</p>
        <p className="text-xs text-muted-foreground">
          对着麦克风说话，再点击“停止并发送”。语音识别完成后自动发送给 AI。
        </p>
        {deviceName && <p className="text-xs break-words">当前麦克风：{deviceName}</p>}
        {warning && <p role="status" className="text-xs text-amber-600 break-words">{warning}</p>}
        {error && <p role="alert" className="text-xs text-destructive break-words">{error}</p>}
        {phase === "recording" && <p className="text-xs text-muted-foreground">说话时波形应有起伏；若一直平直，请检查麦克风是否静音或选错设备。</p>}
      </div>
      {audioStream && phase === "recording" && (
        <div className="h-12 relative bg-muted/20 pt-3">
          <AudioVisualizer stream={audioStream} isRecording />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-t bg-muted/5">
        <span role="status" className="text-xs text-muted-foreground">
          {phase === "recording" ? `正在录音 ${durationLabel} / 3:00`
            : phase === "starting" ? "正在连接麦克风…"
            : phase === "transcribing" ? "正在识别语音，完成后发送给 AI…"
            : phase === "error" ? "录音未发送，请重试" : "点击开始录音"}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" title="取消本次录音，不发送" aria-label="取消本次录音，不发送" onClick={() => { cancelRecording(); onCancel(); }}>
            <XIcon className="size-4" />{phase === "recording" ? "取消并丢弃" : "取消"}
          </Button>
          {phase === "recording" ? (
            <Button size="sm" title="停止录音并发送给 AI" aria-label="停止录音并发送给 AI" onClick={() => void handleSend()}><Send className="size-4" />停止并发送</Button>
          ) : phase === "starting" || phase === "transcribing" ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <Button size="sm" title="开始麦克风录音：录下你说的话" aria-label="开始麦克风录音：录下你说的话" onClick={() => void startRecording()}><MicIcon className="size-4" />{phase === "error" ? "重新录音" : "开始录音"}</Button>
          )}
        </div>
      </div>
    </div>
  );
};
