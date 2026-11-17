import { AudioSelection } from "./components";
import { PageLayout } from "@/layouts";
import { getPlatform } from "@/lib";

const getOsInstructions = () => {
  const platform = getPlatform();

  switch (platform) {
    case "macos":
      return {
        mic: "系统设置 → 声音 → 输入",
        audio: "系统设置 → 声音 → 输出",
      };
    case "windows":
      return {
        mic: "设置 → 系统 → 声音 → 输入",
        audio: "设置 → 系统 → 声音 → 输出",
      };
    case "linux":
      return {
        mic: "声音设置 → 输入设备",
        audio: "声音设置 → 输出设备",
      };
    default:
      return {
        mic: "系统声音设置",
        audio: "系统声音设置",
      };
  }
};

const Audio = () => {
  const osInstructions = getOsInstructions();

  return (
    <PageLayout
      title="音频设置"
      description="配置语音交互和系统音频采集所用的输入、输出设备。"
    >
      <AudioSelection />

      <div className="text-xs text-amber-600 bg-amber-500/10 p-3 rounded-md mb-4 space-y-2">
        <p>
          <strong>⚠️ 所选设备无法使用时：</strong> 请检查系统默认音频设置。麦克风设置位于{" "}
          <strong>{osInstructions.mic}</strong> ，扬声器或耳机设置位于{" "}
          <strong>{osInstructions.audio}</strong> 。请确保系统默认设备设置正确。
        </p>
        <p className="text-amber-600/80">
          <strong>说明：</strong> 若所选设备故障或不可用，Pluely 会自动使用系统默认音频设备。
        </p>
      </div>
    </PageLayout>
  );
};

export default Audio;
