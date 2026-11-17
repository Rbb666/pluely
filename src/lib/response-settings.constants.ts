export interface ResponseLengthOption {
  id: "short" | "medium" | "auto";
  title: string;
  description: string;
  prompt: string;
}

export interface LanguageOption {
  id: string;
  name: string;
  flag: string;
  prompt: string;
}

export const RESPONSE_LENGTHS: ResponseLengthOption[] = [
  {
    id: "short",
    title: "简短",
    description:
      "适合快速回答、摘要等需要节省时间的场景",
    prompt:
      "IMPORTANT: You must keep your response extremely brief and concise. Limit your answer to 2-4 sentences maximum. Provide only the most essential information. Do not include explanations, examples, or additional context unless explicitly requested. Get straight to the point. This is a strict requirement.",
  },
  {
    id: "medium",
    title: "适中",
    description: "兼顾篇幅与说明，适用于大多数任务",
    prompt:
      "IMPORTANT: Provide responses with moderate length - not too brief, not too lengthy. Keep your answer to 1-2 paragraphs (approximately 4-8 sentences). Include key explanations and relevant details, but avoid being overly verbose or adding unnecessary elaboration. Stay focused and well-organized. This is a strict requirement.",
  },
  {
    id: "auto",
    title: "自动",
    description:
      "由 AI 根据问题的复杂程度决定回复长度",
    prompt:
      "IMPORTANT: Carefully assess the complexity and scope of the question, then adjust your response length accordingly. For simple questions, be brief (2-4 sentences). For moderate questions, provide balanced detail (1-2 paragraphs). For complex questions, give comprehensive answers with appropriate depth. Always match the response length to what the question actually requires - no more, no less.",
  },
];

export const LANGUAGES: LanguageOption[] = [
  {
    id: "english",
    name: "英语",
    flag: "🇺🇸",
    prompt: "Respond in English.",
  },
  {
    id: "spanish",
    name: "西班牙语",
    flag: "🇪🇸",
    prompt: "Respond in Spanish (Español).",
  },
  {
    id: "french",
    name: "法语",
    flag: "🇫🇷",
    prompt: "Respond in French (Français).",
  },
  {
    id: "german",
    name: "德语",
    flag: "🇩🇪",
    prompt: "Respond in German (Deutsch).",
  },
  {
    id: "italian",
    name: "意大利语",
    flag: "🇮🇹",
    prompt: "Respond in Italian (Italiano).",
  },
  {
    id: "portuguese",
    name: "葡萄牙语",
    flag: "🇵🇹",
    prompt: "Respond in Portuguese (Português).",
  },
  {
    id: "dutch",
    name: "荷兰语",
    flag: "🇳🇱",
    prompt: "Respond in Dutch (Nederlands).",
  },
  {
    id: "russian",
    name: "俄语",
    flag: "🇷🇺",
    prompt: "Respond in Russian (Русский).",
  },
  {
    id: "chinese",
    name: "简体中文",
    flag: "🇨🇳",
    prompt: "Respond in Simplified Chinese (简体中文).",
  },
  {
    id: "japanese",
    name: "日语",
    flag: "🇯🇵",
    prompt: "Respond in Japanese (日本語).",
  },
  {
    id: "korean",
    name: "韩语",
    flag: "🇰🇷",
    prompt: "Respond in Korean (한국어).",
  },
  {
    id: "arabic",
    name: "阿拉伯语",
    flag: "🇸🇦",
    prompt: "Respond in Arabic (العربية).",
  },
  {
    id: "turkish",
    name: "土耳其语",
    flag: "🇹🇷",
    prompt: "Respond in Turkish (Türkçe).",
  },
  {
    id: "polish",
    name: "波兰语",
    flag: "🇵🇱",
    prompt: "Respond in Polish (Polski).",
  },
  {
    id: "swedish",
    name: "瑞典语",
    flag: "🇸🇪",
    prompt: "Respond in Swedish (Svenska).",
  },
  {
    id: "norwegian",
    name: "挪威语",
    flag: "🇳🇴",
    prompt: "Respond in Norwegian (Norsk).",
  },
  {
    id: "danish",
    name: "丹麦语",
    flag: "🇩🇰",
    prompt: "Respond in Danish (Dansk).",
  },
  {
    id: "finnish",
    name: "芬兰语",
    flag: "🇫🇮",
    prompt: "Respond in Finnish (Suomi).",
  },
  {
    id: "greek",
    name: "希腊语",
    flag: "🇬🇷",
    prompt: "Respond in Greek (Ελληνικά).",
  },
  {
    id: "czech",
    name: "捷克语",
    flag: "🇨🇿",
    prompt: "Respond in Czech (Čeština).",
  },
  {
    id: "hungarian",
    name: "匈牙利语",
    flag: "🇭🇺",
    prompt: "Respond in Hungarian (Magyar).",
  },
  {
    id: "romanian",
    name: "罗马尼亚语",
    flag: "🇷🇴",
    prompt: "Respond in Romanian (Română).",
  },
  {
    id: "ukrainian",
    name: "乌克兰语",
    flag: "🇺🇦",
    prompt: "Respond in Ukrainian (Українська).",
  },
  {
    id: "vietnamese",
    name: "越南语",
    flag: "🇻🇳",
    prompt: "Respond in Vietnamese (Tiếng Việt).",
  },
  {
    id: "thai",
    name: "泰语",
    flag: "🇹🇭",
    prompt: "Respond in Thai (ไทย).",
  },
  {
    id: "indonesian",
    name: "印尼语",
    flag: "🇮🇩",
    prompt: "Respond in Indonesian (Bahasa Indonesia).",
  },
  {
    id: "malay",
    name: "马来语",
    flag: "🇲🇾",
    prompt: "Respond in Malay (Bahasa Melayu).",
  },
  {
    id: "hebrew",
    name: "希伯来语",
    flag: "🇮🇱",
    prompt: "Respond in Hebrew (עברית).",
  },
  {
    id: "filipino",
    name: "菲律宾语",
    flag: "🇵🇭",
    prompt: "Respond in Filipino (Tagalog).",
  },
];

export const DEFAULT_RESPONSE_LENGTH = "auto";
export const DEFAULT_LANGUAGE = "english";
export const DEFAULT_AUTO_SCROLL = true;
