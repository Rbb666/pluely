import {
  ResponseLength,
  LanguageSelector,
  AutoScrollToggle,
} from "./components";
import { PageLayout } from "@/layouts";
import { useApp } from "@/contexts";

const Responses = () => {
  const { hasLocalFeatures } = useApp();

  return (
    <PageLayout
      title="回复设置"
      description="自定义 AI 回复的生成和显示方式"
    >
      {!hasLocalFeatures && (
        <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg">
          <p className="text-[10px] lg:text-sm text-foreground font-medium mb-2">
            🔒 高级功能
          </p>
          <p className="text-[10px] lg:text-sm text-muted-foreground">
            自定义回复长度、语言和自动滚动等功能需要有效授权。
          </p>
        </div>
      )}

      {/* Response Length */}
      <ResponseLength />

      {/* Language Selector */}
      <LanguageSelector />

      {/* Auto-Scroll Toggle */}
      <AutoScrollToggle />
    </PageLayout>
  );
};

export default Responses;
