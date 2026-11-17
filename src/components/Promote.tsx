import { useCallback, useState } from "react";
import { X } from "lucide-react";

import { safeLocalStorage } from "@/lib/storage";

import { Button, Card, CardContent, CardDescription, CardTitle } from "./ui";
import { useApp } from "@/contexts";

const STORAGE_KEY = "pluely-promote-card-dismissed";

const Promote = () => {
  const { hasLocalFeatures } = useApp();

  if (hasLocalFeatures) return null;

  const [isDismissed, setIsDismissed] = useState(
    () => safeLocalStorage.getItem(STORAGE_KEY) === "true"
  );

  const handleDismiss = useCallback(() => {
    safeLocalStorage.setItem(STORAGE_KEY, "true");
    setIsDismissed(true);
  }, []);

  if (isDismissed) return null;

  return (
    <Card className="relative w-full">
      <CardContent className="flex flex-col gap-4 p-4 py-0 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2 md:max-w-[70%]">
          <CardTitle className="text-xs lg:text-sm">
            推广 Pluely，获得奖励
          </CardTitle>
          <CardDescription className="text-[10px] lg:text-xs">
            在社交平台分享 Pluely，浏览量达到 5,000 次，即可获得
            5 至 10 美元的月度套餐优惠券。请将帖子链接发送至{" "}
            <a
              className="text-primary underline underline-offset-4"
              href="mailto:support@pluely.com"
            >
              support@pluely.com
            </a>
            .
          </CardDescription>
        </div>
        <Button asChild className="w-full md:w-auto text-[10px] lg:text-xs">
          <a
            href="https://pluely.com/promote"
            rel="noopener noreferrer"
            target="_blank"
          >
            Pluely.com/promote
          </a>
        </Button>
      </CardContent>
      <button
        aria-label="关闭推广信息"
        title="关闭推广信息"
        className="absolute -right-1 -top-2 rounded-full border border-transparent bg-primary/10 p-1 transition hover:border-primary/20 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={handleDismiss}
        type="button"
      >
        <X className="size-3 lg:size-4 text-primary" />
      </button>
    </Card>
  );
};

export default Promote;
