import { floatArrayToWav } from "./utils";

type SelectedMicrophone = { id: string; name: string };

const normalizeDeviceName = (name: string) =>
  name.trim().toLowerCase().replace(/^(default|communications|默认|通信)\s*[-–：:]\s*/i, "");

/** Native WASAPI IDs cannot be passed as WebRTC deviceId constraints. */
export function findBrowserMicrophone(
  devices: Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[],
  selected: SelectedMicrophone
) {
  const inputs = devices.filter((device) => device.kind === "audioinput");
  const byId = inputs.find((device) => device.deviceId === selected.id);
  if (byId) return byId;
  if (!selected.name) return undefined;
  const matches = inputs.filter(
    (device) => normalizeDeviceName(device.label) === normalizeDeviceName(selected.name)
  );
  return matches.find((device) => !["default", "communications"].includes(device.deviceId)) || matches[0];
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("录音已取消", "AbortError");
}

export async function openMicrophone(selected: SelectedMicrophone, signal?: AbortSignal) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前环境不支持麦克风录音，请检查 WebView2 和系统麦克风设置。");
  }
  let stream: MediaStream | undefined;
  const releaseOnAbort = () => stream?.getTracks().forEach((track) => track.stop());
  signal?.addEventListener("abort", releaseOnAbort, { once: true });
  const requestStream = async (audio: boolean | MediaTrackConstraints) => {
    throwIfAborted(signal);
    const acquired = await navigator.mediaDevices.getUserMedia({ audio });
    if (signal?.aborted) {
      acquired.getTracks().forEach((track) => track.stop());
      throwIfAborted(signal);
    }
    return acquired;
  };
  try {
    throwIfAborted(signal);
    const isDefault = !selected.id || selected.id === "default";
    let match = isDefault ? undefined : findBrowserMicrophone(await navigator.mediaDevices.enumerateDevices(), selected);
    let warning = "";
    throwIfAborted(signal);

    if (match) {
      try {
        stream = await requestStream({ deviceId: { exact: match.deviceId } });
      } catch (error) {
        throwIfAborted(signal);
        if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) throw error;
        warning = "所选麦克风暂不可用，已改用系统默认麦克风。";
      }
    }
    if (!stream) {
      stream = await requestStream(true);
      throwIfAborted(signal);
      // Labels are usually unavailable until the user grants microphone access.
      if (!isDefault && !warning) {
        match = findBrowserMicrophone(await navigator.mediaDevices.enumerateDevices(), selected);
        throwIfAborted(signal);
        const activeId = stream.getAudioTracks()[0]?.getSettings().deviceId;
        if (match && activeId !== match.deviceId && match.deviceId !== "default") {
          stream.getTracks().forEach((track) => track.stop());
          stream = undefined;
          try {
            stream = await requestStream({ deviceId: { exact: match.deviceId } });
          } catch (error) {
            throwIfAborted(signal);
            if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) throw error;
            stream = await requestStream(true);
            warning = "所选麦克风暂不可用，已改用系统默认麦克风。";
          }
        } else if (!match) {
          warning = `无法匹配所选麦克风${selected.name ? `“${selected.name}”` : ""}，已使用系统默认麦克风。`;
        }
      }
    }
    throwIfAborted(signal);
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState !== "live") throw new Error("麦克风没有可用的音频轨道，请检查设备连接。");
    return { stream, warning, deviceName: track.label || "系统默认麦克风" };
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    throw error;
  } finally {
    signal?.removeEventListener("abort", releaseOnAbort);
  }
}

/** The final dataavailable event precedes stop; build the Blob only after both. */
export function finishMicrophoneRecording(recorder: MediaRecorder, chunks: Blob[]): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      cleanup();
      resolve(new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "audio/webm" }));
    };
    const fail = () => { cleanup(); reject(new Error("结束录音失败，请重试。")); };
    const cleanup = () => {
      recorder.removeEventListener("stop", finish);
      recorder.removeEventListener("error", fail);
    };
    if (recorder.state === "inactive") { finish(); return; }
    recorder.addEventListener("stop", finish, { once: true });
    recorder.addEventListener("error", fail, { once: true });
    try { recorder.stop(); } catch (error) { cleanup(); reject(error); }
  });
}

/** Normalize browser WebM/Ogg into the PCM WAV format accepted by the STT templates. */
export async function microphoneRecordingToWav(blob: Blob, signal?: AbortSignal): Promise<Blob> {
  throwIfAborted(signal);
  if (!blob.size) throw new Error("没有录到音频，请确认麦克风已连接并重试。");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    throwIfAborted(signal);
    const sampleCount = Math.ceil(decoded.duration * 16000);
    if (!sampleCount) throw new Error("录音内容为空，请重新录音。");
    const offline = new OfflineAudioContext(1, sampleCount, 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    throwIfAborted(signal);
    return floatArrayToWav(rendered.getChannelData(0), 16000, "wav");
  } finally {
    await context.close();
  }
}

export function microphoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (["NotAllowedError", "SecurityError"].includes(error.name)) return "麦克风访问被拒绝。请在 Windows 设置中允许桌面应用访问麦克风，然后重试。";
    if (error.name === "NotFoundError") return "未找到可用麦克风，请连接设备后重试。";
    if (error.name === "NotReadableError") return "无法读取麦克风，设备可能被其他程序占用。请关闭占用程序后重试。";
    if (error.name === "OverconstrainedError") return "所选麦克风不可用，请在音频设置中重新选择设备。";
  }
  return error instanceof Error ? error.message : String(error);
}
