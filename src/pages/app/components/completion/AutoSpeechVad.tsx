import { useCallback, useEffect, useRef, useState } from "react";
import { AudioNodeVAD } from "@ricky0123/vad-web";
import { LoaderCircleIcon, MicIcon, MicOffIcon, XIcon } from "lucide-react";
import { Button } from "@/components";
import { useApp } from "@/contexts";
import { fetchSTT, shouldUsePluelyAPI } from "@/lib/functions";
import { openMicrophone, microphoneErrorMessage } from "@/lib/microphone";
import { floatArrayToWav } from "@/lib/utils";
import { AudioVisualizer } from "@/pages/app/components/speech/audio-visualizer";

export interface AutoSpeechVADProps {
  submit: (text?: string) => Promise<void>;
  cancel: () => void;
  onClose: () => void;
  onActiveChange?: (active: boolean) => void;
}

type Phase = "idle" | "starting" | "listening" | "speaking" | "pause" | "transcribing" | "responding" | "error";

export const AutoSpeechVAD = (props: AutoSpeechVADProps) => {
  const app = useApp();
  // Each utterance uses the latest submit closure, including conversation history.
  const latestRef = useRef({ props, app });
  latestRef.current = { props, app };
  const [phase, setPhase] = useState<Phase>("idle");
  const [pauseSeconds, setPauseSeconds] = useState(1);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [transcription, setTranscription] = useState("");
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const ownsReplyRef = useRef(false);
  const speechStartedRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const vadRef = useRef<AudioNodeVAD | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePhase = useCallback((value: Phase) => {
    phaseRef.current = value;
    if (mountedRef.current) setPhase(value);
  }, []);

  const stopSession = useCallback(() => {
    activeRef.current = false;
    generationRef.current += 1;
    busyRef.current = false;
    speechStartedRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    if (ownsReplyRef.current) latestRef.current.props.cancel();
    ownsReplyRef.current = false;
    // Invalidate callbacks first; pause must discard the partial utterance.
    const vad = vadRef.current;
    vadRef.current = null;
    try { vad?.pause(); } catch { /* Continue releasing the microphone. */ }
    try { vad?.destroy(); } catch { /* The context may already have closed. */ }
    try { sourceRef.current?.disconnect(); } catch { /* Already disconnected. */ }
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
    if (mountedRef.current) {
      setAudioStream(null);
      updatePhase("idle");
    }
    latestRef.current.props.onActiveChange?.(false);
  }, [updatePhase]);

  const startSession = async () => {
    if (activeRef.current) return;
    stopSession();
    const generation = generationRef.current;
    const current = () => mountedRef.current && activeRef.current && generationRef.current === generation;
    const controller = new AbortController();
    abortRef.current = controller;
    activeRef.current = true;
    setError("");
    setWarning("");
    setTranscription("");
    updatePhase("starting");
    latestRef.current.props.onActiveChange?.(true);

    const fail = (cause: unknown) => {
      if (!current()) return;
      stopSession();
      setError(microphoneErrorMessage(cause));
      updatePhase("error");
    };

    const handleSpeechEnd = async (audio: Float32Array) => {
      if (!current() || busyRef.current) return;
      busyRef.current = true;
      speechStartedRef.current = false;
      try {
        vadRef.current?.pause();
        streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = false; });
        updatePhase("transcribing");
        const { app: config } = latestRef.current;
        const hosted = await shouldUsePluelyAPI();
        if (!current()) return;
        const provider = config.allSttProviders.find((item) => item.id === config.selectedSttProvider.provider);
        const timeout = new Promise<never>((_, reject) => {
          timeoutRef.current = setTimeout(() => {
            reject(new Error("语音识别超时，请检查 ASR 服务后重新开始。"));
            controller.abort();
          }, 30000);
        });
        const text = await Promise.race([
          fetchSTT({
            provider: hosted ? undefined : provider,
            selectedProvider: config.selectedSttProvider,
            audio: floatArrayToWav(audio, 16000, "wav"),
            signal: controller.signal,
          }),
          timeout,
        ]);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        if (!current()) return;
        if (!text.trim()) throw new Error("未识别到文字，请确认麦克风有声音后重试。");
        setTranscription(text.trim());
        updatePhase("responding");
        ownsReplyRef.current = true;
        await latestRef.current.props.submit(text.trim());
        if (!current()) return;
        ownsReplyRef.current = false;
        // Reset any model frame that was already in flight when pause was called.
        vadRef.current?.pause();
        streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = true; });
        busyRef.current = false;
        updatePhase("listening");
        vadRef.current?.start();
      } catch (cause) {
        fail(cause);
      }
    };

    try {
      // Own the context so failed model initialization cannot leak it.
      const context = new AudioContext();
      contextRef.current = context;
      await context.resume();
      const hosted = await shouldUsePluelyAPI();
      if (!current()) return;
      const { app: config } = latestRef.current;
      if (!hosted && !config.selectedSttProvider.provider) throw new Error("请先在服务配置中选择语音识别服务。");
      if (!hosted && !config.selectedAIProvider.provider) throw new Error("请先在服务配置中选择 AI 服务。");
      const opened = await openMicrophone(config.selectedAudioDevices.input, controller.signal);
      if (!current()) { opened.stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = opened.stream;
      setAudioStream(opened.stream);
      setDeviceName(opened.deviceName);
      setWarning(opened.warning);
      opened.stream.getAudioTracks().forEach((track) => {
        track.addEventListener("ended", () => fail(new Error("麦克风已断开，请检查设备后重新开始。")), { once: true });
      });
      const vad = await AudioNodeVAD.new(context, {
        model: "v5",
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/vad/",
        ortConfig: (ort) => { ort.env.wasm.numThreads = 1; },
        frameSamples: 512,
        redemptionFrames: Math.ceil(pauseSeconds * 16000 / 512),
        minSpeechFrames: 9,
        preSpeechPadFrames: 10,
        submitUserSpeechOnPause: false,
        onSpeechStart: () => {
          if (!current() || busyRef.current) return;
          speechStartedRef.current = true;
          updatePhase("speaking");
        },
        onFrameProcessed: (probabilities) => {
          if (!current() || busyRef.current || !speechStartedRef.current) return;
          const next = probabilities.isSpeech < 0.35 ? "pause" : "speaking";
          if (phaseRef.current !== next) updatePhase(next);
        },
        onVADMisfire: () => {
          if (!current() || busyRef.current) return;
          speechStartedRef.current = false;
          updatePhase("listening");
        },
        onSpeechEnd: (audio) => { void handleSpeechEnd(audio); },
      });
      if (!current()) { vad.destroy(); return; }
      vadRef.current = vad;
      const source = context.createMediaStreamSource(opened.stream);
      sourceRef.current = source;
      vad.receive(source);
      updatePhase("listening");
      vad.start();
    } catch (cause) {
      fail(cause);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopSession();
    };
  }, [stopSession]);

  const active = !["idle", "error"].includes(phase);
  const status: Record<Phase, string> = {
    idle: "尚未开始录音",
    starting: "正在连接麦克风并加载语音检测…",
    listening: "正在聆听，请对麦克风说话",
    speaking: "检测到说话，正在录音…",
    pause: `正在等待停顿满 ${pauseSeconds} 秒…`,
    transcribing: "正在识别语音，麦克风暂时暂停…",
    responding: "正在生成 AI 回复，完成后继续聆听…",
    error: "自动聆听已停止，请检查提示后重试",
  };

  return (
    <div className="space-y-3 rounded-lg border bg-background p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">自动断句发送</p>
        <p className="text-xs text-muted-foreground">
          开始后，对着麦克风说话。停顿约 {pauseSeconds} 秒后自动识别并发送给 AI，回复完成后继续聆听下一句。
        </p>
      </div>
      <label className="flex items-center justify-between gap-2 text-xs">
        停顿时长
        <select className="rounded border bg-background px-2 py-1" value={pauseSeconds}
          onChange={(event) => setPauseSeconds(Number(event.target.value))} disabled={active}
          aria-label="自动发送前的停顿时长" title="说话停顿达到此时长后，自动提交 ASR 并发送给 AI">
          <option value={0.6}>0.6 秒（较快）</option>
          <option value={1}>1 秒（默认）</option>
          <option value={1.5}>1.5 秒（较从容）</option>
        </select>
      </label>
      {deviceName && <p className="text-xs break-words">麦克风：{deviceName}</p>}
      {warning && <p role="status" className="text-xs text-amber-600 break-words">{warning}</p>}
      {error && <p role="alert" className="text-xs text-destructive break-words">{error}</p>}
      {audioStream && ["listening", "speaking", "pause"].includes(phase) && <AudioVisualizer stream={audioStream} isRecording />}
      <p role="status" className="flex items-center gap-2 text-xs">
        {["starting", "transcribing", "responding"].includes(phase) && <LoaderCircleIcon className="size-4 animate-spin" />}
        {status[phase]}
      </p>
      {transcription && <p className="text-xs break-words">已识别：{transcription}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" title="关闭面板并停止自动聆听，未发送的录音将丢弃"
          onClick={() => { stopSession(); latestRef.current.props.onClose(); }}>
          <XIcon className="size-4" />关闭
        </Button>
        {active ? (
          <Button size="sm" variant="outline" title="停止自动聆听，丢弃尚未断句的录音并取消当前识别或回复" onClick={stopSession}>
            <MicOffIcon className="size-4" />停止自动聆听
          </Button>
        ) : (
          <Button size="sm" title="开始麦克风自动聆听，停顿后识别并发送给 AI" onClick={() => void startSession()}>
            <MicIcon className="size-4" />{phase === "error" ? "重新开始自动聆听" : "开始自动聆听"}
          </Button>
        )}
      </div>
    </div>
  );
};
