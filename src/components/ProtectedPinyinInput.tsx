import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent, RefObject } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { queryPinyin } from "@/lib/pinyin-engine";
import { chinesePunctuation, deleteAtSelection, replaceSelection, type TextEdit } from "@/lib/protected-input";

type Candidate = { text: string; consumed: number };
const PAGE_SIZE = 9;

export interface ProtectedPinyinInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onCandidatesOpenChange?: (open: boolean) => void;
  onCompositionActiveChange?: (active: boolean) => void;
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void | Promise<void>;
}

/**
 * This field is deliberately readonly: editing happens in this component, so
 * normal key input does not ask the system IME to create a candidate window.
 * Candidate text remains in this WebView; no portal or network query is used.
 */
export function ProtectedPinyinInput({
  value, onChange, onSubmit, disabled = false, placeholder = "输入拼音并选字…",
  className, inputRef, onCandidatesOpenChange, onCompositionActiveChange, onPaste,
}: ProtectedPinyinInputProps) {
  const nodeRef = useRef<HTMLInputElement | null>(null);
  const latestRef = useRef({ value, onChange, onSubmit });
  latestRef.current = { value, onChange, onSubmit };
  const [focused, setFocused] = useState(false);
  const [english, setEnglish] = useState(false);
  const [composition, setComposition] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [blocked, setBlocked] = useState(false);
  const queryGenerationRef = useRef(0);
  const compositionRangeRef = useRef<{ start: number; end: number; base: string } | null>(null);
  const pendingEditRef = useRef<TextEdit | null>(null);
  const mountedRef = useRef(true);
  const suppressNextFocusRef = useRef(false);
  const retryFocusRef = useRef(false);
  const shiftTapRef = useRef<string | null>(null);
  const panelOpen = (focused || blocked) && !disabled;
  const pageCount = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
  const pageCandidates = candidates.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; queryGenerationRef.current += 1; };
  }, []);

  useEffect(() => {
    onCandidatesOpenChange?.(panelOpen);
    return () => onCandidatesOpenChange?.(false);
  }, [panelOpen, onCandidatesOpenChange]);

  useEffect(() => {
    onCompositionActiveChange?.(!!composition);
    return () => onCompositionActiveChange?.(false);
  }, [composition, onCompositionActiveChange]);

  useLayoutEffect(() => {
    if (!blocked && retryFocusRef.current) {
      retryFocusRef.current = false;
      nodeRef.current?.focus({ preventScroll: true });
    }
  }, [blocked]);

  const clearComposition = () => {
    queryGenerationRef.current += 1;
    setComposition("");
    setCandidates([]);
    setLoading(false);
    setPage(0);
    compositionRangeRef.current = null;
  };

  const updateComposition = (next: string) => {
    queryGenerationRef.current += 1;
    setCandidates([]);
    setLoading(!!next);
    setPage(0);
    setComposition(next);
  };

  useEffect(() => {
    if (disabled) {
      shiftTapRef.current = null;
      setFocused(false);
      clearComposition();
    }
  }, [disabled]);

  useLayoutEffect(() => {
    const pending = pendingEditRef.current;
    if (pending && pending.value === value) {
      nodeRef.current?.setSelectionRange(pending.caret, pending.caret);
      pendingEditRef.current = null;
    }
    if (compositionRangeRef.current && compositionRangeRef.current.base !== value) clearComposition();
  }, [value]);

  useEffect(() => {
    const generation = ++queryGenerationRef.current;
    setCandidates([]);
    setPage(0);
    if (!composition) { setLoading(false); return; }
    setLoading(true);
    queryPinyin(composition).then((result) => {
      if (!mountedRef.current || generation !== queryGenerationRef.current) return;
      setCandidates(result.filter((item) => item.text && item.consumed > 0 && item.consumed <= composition.length));
      setLoading(false);
    }).catch(() => {
      if (!mountedRef.current || generation !== queryGenerationRef.current) return;
      setLoading(false);
      setNotice("本地拼音词库加载失败。可按 Esc 清除拼音，改用语音或切回系统输入。");
    });
  }, [composition]);

  const selection = () => {
    const node = nodeRef.current;
    return { start: node?.selectionStart ?? value.length, end: node?.selectionEnd ?? value.length };
  };

  const applyEdit = (edit: TextEdit) => {
    pendingEditRef.current = edit;
    latestRef.current.onChange(edit.value);
    nodeRef.current?.focus({ preventScroll: true });
    // Also handle unchanged text, for which React need not produce another render.
    if (nodeRef.current?.value === edit.value) nodeRef.current.setSelectionRange(edit.caret, edit.caret);
  };

  const insert = (text: string) => {
    const range = selection();
    clearComposition();
    applyEdit(replaceSelection(latestRef.current.value, range.start, range.end, text));
  };

  const chooseCandidate = (candidate: Candidate, suffix = "") => {
    const range = compositionRangeRef.current;
    if (!range || range.base !== latestRef.current.value) { clearComposition(); return; }
    const remaining = composition.slice(candidate.consumed).replace(/^'+/, "");
    const edit = replaceSelection(range.base, range.start, range.end, candidate.text + suffix);
    setNotice("");
    if (remaining) {
      compositionRangeRef.current = { start: edit.caret, end: edit.caret, base: edit.value };
      updateComposition(remaining);
    } else clearComposition();
    applyEdit(edit);
  };

  const insertRawComposition = () => {
    chooseCandidate({ text: composition, consumed: composition.length });
  };

  const reportSystemIME = () => {
    shiftTapRef.current = null;
    clearComposition();
    setBlocked(true);
    setFocused(false);
    nodeRef.current?.blur();
    setNotice("系统输入法仍在接管，请切换为英文输入状态后重试。此时不能保证外部候选窗不会显示。");
  };

  const pasteText = (text: string) => {
    if (disabled || blocked) return;
    setFocused(true);
    setNotice("");
    insert(text);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (disabled || blocked) { event.preventDefault(); return; }
    void onPaste?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    pasteText(event.clipboardData.getData("text/plain"));
  };

  const readClipboard = async () => {
    const initialValue = latestRef.current.value;
    try {
      const text = await navigator.clipboard.readText();
      if (mountedRef.current && latestRef.current.value === initialValue) pasteText(text);
    } catch {
      setNotice("无法读取剪贴板，请聚焦输入框后按 Ctrl+V 粘贴。");
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Shift") shiftTapRef.current = null;
    if (disabled || blocked) { event.preventDefault(); return; }
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.key === "Process") {
      event.preventDefault();
      event.stopPropagation();
      reportSystemIME();
      return;
    }
    if (event.key === "Shift") {
      if (!event.repeat) {
        const modified = event.ctrlKey || event.altKey || event.metaKey;
        shiftTapRef.current = !modified && shiftTapRef.current === null
          ? (event.code || event.key)
          : null;
      }
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      // Preserve browser selection/copy/paste and app shortcuts. readonly inputs
      // cannot cut on their own, so only cut needs a custom implementation.
      if (event.key.toLowerCase() === "x") {
        const range = selection();
        if (range.start === range.end) return;
        event.preventDefault();
        const original = latestRef.current.value;
        void navigator.clipboard.writeText(original.slice(range.start, range.end)).then(() => {
          if (mountedRef.current && latestRef.current.value === original) {
            clearComposition();
            applyEdit(replaceSelection(original, range.start, range.end, ""));
          }
        }).catch(() => setNotice("无法剪切，请使用 Ctrl+C 复制后再删除。"));
      }
      return;
    }
    if (event.altKey) return;
    const handled = () => { event.preventDefault(); event.stopPropagation(); };

    if (event.key === "Escape") {
      if (composition || notice) { handled(); clearComposition(); setNotice(""); }
      return;
    }
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      if (composition) clearComposition();
      return; // Native readonly selection movement retains Shift+arrow selection.
    }
    if (composition && ["PageUp", "PageDown", "ArrowUp", "ArrowDown"].includes(event.key)) {
      handled();
      setPage((previous) => Math.max(0, Math.min(pageCount - 1, previous + (["PageDown", "ArrowDown"].includes(event.key) ? 1 : -1))));
      return;
    }
    if (event.key === "Enter") {
      handled();
      if (event.repeat) return;
      if (composition) {
        if (pageCandidates[0]) chooseCandidate(pageCandidates[0]);
      } else if (!event.shiftKey) {
        suppressNextFocusRef.current = true;
        setFocused(false);
        nodeRef.current?.blur();
        latestRef.current.onSubmit();
      }
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      handled();
      if (composition) {
        if (event.key === "Backspace") updateComposition(composition.slice(0, -1));
        else clearComposition();
      } else {
        const range = selection();
        applyEdit(deleteAtSelection(value, range.start, range.end, event.key === "Backspace"));
      }
      return;
    }
    if (composition && /^[1-9]$/.test(event.key)) {
      handled();
      const candidate = pageCandidates[Number(event.key) - 1];
      if (candidate) chooseCandidate(candidate);
      return;
    }
    if (composition && event.key === " ") {
      handled();
      if (pageCandidates[0]) chooseCandidate(pageCandidates[0]);
      return;
    }
    if (!english && (/^[a-z]$/i.test(event.key) || (event.key === "'" && composition))) {
      handled();
      setNotice("");
      setFocused(true);
      if (!composition) compositionRangeRef.current = { ...selection(), base: value };
      if (composition.length < 80) updateComposition(composition + event.key.toLowerCase());
      else setNotice("拼音过长，请先选择一部分文字。 ");
      return;
    }
    if (event.key.length === 1) {
      handled();
      setFocused(true);
      const text = english ? event.key : chinesePunctuation(event.key);
      if (composition) {
        const first = pageCandidates[0];
        if (first?.consumed === composition.length) chooseCandidate(first, text);
        else setNotice("请先选字，再输入标点或数字；Esc 可清除拼音。");
      } else insert(text);
    }
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    const shiftTap = shiftTapRef.current;
    shiftTapRef.current = null;
    if (
      event.key !== "Shift" ||
      shiftTap !== (event.code || event.key) ||
      disabled || blocked ||
      event.ctrlKey || event.altKey || event.metaKey ||
      event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
    ) return;

    event.preventDefault();
    event.stopPropagation();
    if (composition) insertRawComposition();
    setEnglish((previous) => !previous);
    setNotice("");
    setFocused(true);
  };

  const keepInputFocus = (event: React.MouseEvent) => event.preventDefault();

  return (
    <div className="relative min-w-0 flex-1" onPointerDown={() => { shiftTapRef.current = null; }}>
      <Input
        ref={(node) => { nodeRef.current = node; if (inputRef) inputRef.current = node; }}
        value={value}
        readOnly
        inputMode="none"
        aria-label={english ? "应用内英文输入" : "应用内拼音输入"}
        aria-describedby={panelOpen ? "protected-pinyin-help" : undefined}
        placeholder={english ? "输入英文、数字或标点…" : placeholder}
        disabled={disabled || blocked}
        className={className}
        onFocus={() => {
          if (blocked) { nodeRef.current?.blur(); return; }
          if (suppressNextFocusRef.current) { suppressNextFocusRef.current = false; return; }
          setFocused(true);
        }}
        onClick={() => { if (!blocked) setFocused(true); }}
        onBlur={() => { shiftTapRef.current = null; setFocused(false); }}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onCompositionStart={reportSystemIME}
        onPaste={handlePaste}
        onContextMenu={(event) => { event.preventDefault(); setNotice("使用 Ctrl+C 复制、Ctrl+V 粘贴，避免打开系统菜单。"); }}
      />
      {panelOpen && (
        <div data-protected-pinyin-panel className="absolute top-full left-0 z-50 mt-2 w-[min(30rem,calc(100vw-7rem))] max-h-[28rem] overflow-y-auto rounded-xl border bg-background p-3 shadow-lg space-y-2 text-foreground"
          onClick={(event) => event.stopPropagation()} onMouseDown={keepInputFocus}
          onContextMenu={(event) => event.preventDefault()}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span role="status" className="text-xs font-medium">{english ? "应用内英文输入" : "应用内拼音选字"}</span>
            {!blocked && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" title="粘贴剪贴板文字" onClick={() => void readClipboard()}>粘贴</Button>
            )}
          </div>
          <p id="protected-pinyin-help" className="text-[11px] text-muted-foreground">
            {!blocked && "单按 Shift 切换中英文。"}
            {english ? "直接输入英文、数字和标点，按 Enter 发送。" : "输入全拼，用空格或 1–9 选字。有拼音时先按 Enter 选字，再按 Enter 发送。"}
          </p>
          {notice && <p role="alert" className="text-xs text-amber-600 break-words">{notice}</p>}
          {blocked && (
            <Button size="sm" variant="outline" title="确认已切换到英文输入状态，再恢复应用内拼音选字"
              onClick={() => {
                retryFocusRef.current = true;
                suppressNextFocusRef.current = false;
                setBlocked(false);
                setNotice("");
                setFocused(true);
              }}>已切换英文，重新尝试</Button>
          )}
          {composition && (
            <>
              <p className="font-mono text-sm break-all" aria-live="polite">{composition}</p>
              {loading ? <p role="status" className="text-xs text-muted-foreground">正在查询本地词库…</p> : pageCandidates.length ? (
                <div role="group" aria-label="应用内拼音候选词" className="flex flex-wrap gap-1">
                  {pageCandidates.map((candidate, index) => (
                    <Button key={`${page}-${index}-${candidate.text}`} variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal px-2 py-1 text-sm"
                      onClick={() => chooseCandidate(candidate)} aria-label={`候选 ${index + 1}：${candidate.text}`}>
                      <span className="text-xs text-muted-foreground">{index + 1}</span>{candidate.text}
                    </Button>
                  ))}
                </div>
              ) : <p role="status" className="text-xs text-muted-foreground">暂无候选，可用英文单引号分隔拼音，或按 Esc 重新输入。</p>}
              <div className="flex items-center justify-between gap-2 text-xs">
                <Button size="sm" variant="ghost" className="h-7 text-xs" title="将当前拼音字母作为原文插入"
                  onClick={insertRawComposition}>输入拼音原文</Button>
                {pageCount > 1 && <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-7 px-2" title="上一页候选词" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
                  <span>{page + 1}/{pageCount}</span>
                  <Button size="sm" variant="ghost" className="h-7 px-2" title="下一页候选词" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>下一页</Button>
                </div>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
