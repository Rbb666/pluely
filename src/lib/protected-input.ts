export interface TextEdit {
  value: string;
  caret: number;
}

/** Readonly inputs use UTF-16 selection offsets; keep edits on code-point boundaries. */
export function textBoundary(value: string, offset: number): number {
  const bounded = Math.max(0, Math.min(value.length, offset));
  const code = value.charCodeAt(bounded);
  return bounded > 0 && code >= 0xdc00 && code <= 0xdfff ? bounded - 1 : bounded;
}

export function replaceSelection(value: string, start: number, end: number, text: string): TextEdit {
  const from = textBoundary(value, Math.min(start, end));
  const to = textBoundary(value, Math.max(start, end));
  const inserted = text.replace(/\r\n|\r|\n/g, " ");
  return { value: value.slice(0, from) + inserted + value.slice(to), caret: from + inserted.length };
}

export function deleteAtSelection(value: string, start: number, end: number, backwards: boolean): TextEdit {
  const from = textBoundary(value, Math.min(start, end));
  const to = textBoundary(value, Math.max(start, end));
  if (from !== to) return replaceSelection(value, from, to, "");
  if (backwards) {
    const previous = Array.from(value.slice(0, from)).pop() || "";
    return replaceSelection(value, from - previous.length, from, "");
  }
  const next = Array.from(value.slice(from))[0] || "";
  return replaceSelection(value, from, from + next.length, "");
}

export function chinesePunctuation(key: string): string {
  return ({ ",": "，", ".": "。", "?": "？", "!": "！", ";": "；", ":": "：", "(": "（", ")": "）", "[": "【", "]": "】", "\\": "、" } as Record<string, string>)[key] || key;
}
