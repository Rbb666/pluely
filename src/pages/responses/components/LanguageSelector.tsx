import { Header, Selection } from "@/components";
import { LANGUAGES } from "@/lib";
import { useApp } from "@/contexts";
import { updateLanguage } from "@/lib/storage/response-settings.storage";
import { useState, useEffect, useMemo } from "react";
import { getResponseSettings } from "@/lib";

export const LanguageSelector = () => {
  const { hasLocalFeatures } = useApp();
  const [selectedLanguage, setSelectedLanguage] = useState<string>("english");

  useEffect(() => {
    const settings = getResponseSettings();
    setSelectedLanguage(settings.language);
  }, []);

  const handleLanguageChange = (languageId: string) => {
    if (!hasLocalFeatures) {
      return;
    }
    setSelectedLanguage(languageId);
    updateLanguage(languageId);
  };

  const languageOptions = useMemo(() => {
    return LANGUAGES.map((lang) => ({
      label: `${lang.flag} ${lang.name}`,
      value: lang.id,
    }));
  }, []);

  return (
    <div className="space-y-4">
      <Header
        title="回复语言"
        description="选择 AI 回复语言，此设置适用于所有服务和对话。实际语言支持取决于所选模型。"
        isMainTitle
      />

      <div className="max-w-md">
        <Selection
          selected={selectedLanguage}
          onChange={handleLanguageChange}
          options={languageOptions}
          placeholder="选择语言"
          disabled={!hasLocalFeatures}
        />
      </div>
    </div>
  );
};
