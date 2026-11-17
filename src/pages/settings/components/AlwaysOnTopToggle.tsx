import { Switch, Label, Header } from "@/components";
import { useApp } from "@/contexts";

interface AlwaysOnTopToggleProps {
  className?: string;
}

export const AlwaysOnTopToggle = ({ className }: AlwaysOnTopToggleProps) => {
  const { customizable, toggleAlwaysOnTop } = useApp();

  const handleSwitchChange = async (checked: boolean) => {
    await toggleAlwaysOnTop(checked);
  };

  return (
    <div id="always-on-top" className={`space-y-2 ${className}`}>
      <Header
        title="窗口置顶"
        description="设置窗口是否始终显示在其他应用上方"
        isMainTitle
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div>
            <Label className="text-sm font-medium">
              {customizable.alwaysOnTop.isEnabled
                ? "关闭窗口置顶"
                : "开启窗口置顶"}
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              {customizable.alwaysOnTop.isEnabled
                ? "窗口始终显示在其他应用上方（默认）"
                : "窗口按普通应用方式显示"}
            </p>
          </div>
        </div>
        <Switch
          checked={customizable.alwaysOnTop.isEnabled}
          onCheckedChange={handleSwitchChange}
          title={`${customizable.alwaysOnTop.isEnabled ? "关闭" : "开启"}窗口置顶`}
          aria-label={`${customizable.alwaysOnTop.isEnabled ? "关闭" : "开启"}窗口置顶`}
        />
      </div>
    </div>
  );
};
