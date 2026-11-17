import { Switch, Label, Header } from "@/components";
import { useApp } from "@/contexts";
import { useState, useEffect } from "react";
import { getResponseSettings, updateAutoScroll } from "@/lib";

export const AutoScrollToggle = () => {
  const { hasLocalFeatures } = useApp();
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  useEffect(() => {
    const settings = getResponseSettings();
    setAutoScroll(settings.autoScroll);
  }, []);

  const handleSwitchChange = (checked: boolean) => {
    if (!hasLocalFeatures) {
      return;
    }
    setAutoScroll(checked);
    updateAutoScroll(checked);
  };

  return (
    <div className="space-y-4">
      <Header
        title="自动滚动"
        description="设置回复生成时是否自动滚动到底部，显示最新内容。更改立即生效。"
        isMainTitle
      />

      <div className="flex items-center justify-between p-4 border rounded-xl">
        <div className="flex items-center space-x-3">
          <div>
            <Label className="text-sm font-medium">
              {autoScroll ? "已开启自动滚动" : "已关闭自动滚动"}
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              {autoScroll
                ? "回复生成时自动滚动到底部"
                : "回复将保持当前滚动位置"}
            </p>
          </div>
        </div>
        <Switch
          checked={autoScroll}
          onCheckedChange={handleSwitchChange}
          disabled={!hasLocalFeatures}
          title={`${autoScroll ? "关闭" : "开启"}自动滚动`}
          aria-label={`${autoScroll ? "关闭" : "开启"}自动滚动`}
        />
      </div>
    </div>
  );
};
