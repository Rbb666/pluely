import { InfoIcon, MicIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, Button } from "@/components";
import { useApp } from "@/contexts";

interface ChatAudioProps {
  micOpen: boolean;
  setMicOpen: (open: boolean) => void;
  isRecording: boolean;
  setIsRecording: (recording: boolean) => void;
  disabled: boolean;
}

export const ChatAudio = ({
  micOpen,
  setMicOpen,
  isRecording,
  setIsRecording,
  disabled,
}: ChatAudioProps) => {
  const { selectedSttProvider, pluelyApiEnabled } = useApp();
  const isProviderConfigured = pluelyApiEnabled || selectedSttProvider.provider;

  const handleMicClick = () => {
    if (!isProviderConfigured) {
      setMicOpen(!micOpen);
      return;
    }

    setIsRecording(!isRecording);
  };

  return (
    <Popover open={micOpen} onOpenChange={setMicOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          onClick={handleMicClick}
          className="size-7 lg:size-9 rounded-lg lg:rounded-xl"
          title={isRecording ? "正在录音：使用停止并发送或取消按钮结束" : "麦克风语音输入：录下你说的话"}
          aria-label={isRecording ? "正在录音" : "麦克风语音输入：录下你说的话"}
          disabled={disabled}
        >
          <MicIcon
            className={`size-3 lg:size-4 ${
              isRecording ? "text-red-500 animate-pulse" : ""
            }`}
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="top"
        className={`w-80 p-3 ${isProviderConfigured ? "hidden" : ""}`}
        sideOffset={8}
      >
        <div className="text-sm">
          <div className="font-semibold text-orange-600 mb-1">
            请先配置语音识别服务
          </div>
          <p className="text-muted-foreground">
            <div className="mt-2 flex items-center gap-1 text-orange-600">
              <InfoIcon size={16} />
              <span>尚未配置服务</span>
            </div>
            <span className="block mt-2">
              请在服务配置页面设置语音识别服务，以使用语音输入。
            </span>
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
};
