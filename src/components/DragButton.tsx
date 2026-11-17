import { useEffect, useState } from "react";
import { GripVerticalIcon } from "lucide-react";
import { useApp } from "@/contexts";
import {
  GetLicense,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components";
import { useWindowResize } from "@/hooks";

export const DragButton = () => {
  const { hasLocalFeatures } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const { resizeWindow } = useWindowResize();

  useEffect(() => {
    if (!hasLocalFeatures) {
      resizeWindow(isOpen);
    }
  }, [hasLocalFeatures, isOpen, resizeWindow]);

  if (!hasLocalFeatures) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild className="border-none hover:bg-transparent">
          <Button variant="ghost" size="icon" className={`-ml-[2px] w-fit`} title="拖动窗口">
            <GripVerticalIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="w-fit select-none p-4 border overflow-hidden border-input/50"
          sideOffset={8}
        >
          <div className="flex flex-col gap-2 w-116">
            <div className="flex flex-col gap-1 pb-2">
              <p className="text-md font-medium">
                使用此功能需要有效授权。
              </p>
              <p className="text-sm font-medium text-muted-foreground">
                购买后，你会通过电子邮件收到授权密钥。
                请在“控制面板”的 Pluely 授权区域粘贴密钥并激活。
              </p>
            </div>
            <GetLicense setState={setIsOpen} />
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`-ml-[2px] w-fit`}
      data-tauri-drag-region={hasLocalFeatures}
      title="按住拖动窗口"
      aria-label="拖动窗口"
    >
      <GripVerticalIcon className="h-4 w-4" />
    </Button>
  );
};
