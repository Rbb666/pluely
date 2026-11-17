import { Loader2, XIcon, ShieldCheckIcon, ShieldAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  ScrollArea,
  Input as InputComponent,
  Markdown,
  Switch,
  CopyButton,
} from "@/components";
import { UseCompletionReturn } from "@/types";
import { MessageHistory } from "./MessageHistory";
import { ProtectedPinyinInput } from "@/components/ProtectedPinyinInput";
import { safeLocalStorage } from "@/lib/storage";
import { STORAGE_KEYS } from "@/config";

export const Input = ({
  isPopoverOpen,
  isLoading,
  enableVAD,
  reset,
  input,
  setInput,
  submit,
  handleKeyPress,
  handlePaste,
  currentConversationId,
  conversationHistory,
  startNewConversation,
  messageHistoryOpen,
  setMessageHistoryOpen,
  error,
  response,
  cancel,
  scrollAreaRef,
  inputRef,
  isHidden,
  keepEngaged,
  setKeepEngaged,
  resizeWindow,
  micOpen,
  isFilesPopoverOpen,
}: UseCompletionReturn & { isHidden: boolean }) => {
  const [protectedPinyin, setProtectedPinyin] = useState(() =>
    safeLocalStorage.getItem(STORAGE_KEYS.PROTECTED_PINYIN) !== "false"
  );
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  const [pinyinComposing, setPinyinComposing] = useState(false);
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [protectedPinyin, inputRef]);
  useEffect(() => {
    void resizeWindow(candidatesOpen || isPopoverOpen || micOpen || messageHistoryOpen || isFilesPopoverOpen);
  }, [candidatesOpen, isPopoverOpen, micOpen, messageHistoryOpen, isFilesPopoverOpen, resizeWindow]);

  const inputClass = currentConversationId && conversationHistory.length > 0 ? "pr-14" : "pr-2";
  const inputDisabled = isLoading || isHidden || enableVAD;

  return (
    <div className="relative flex-1">
      <Popover
        open={isPopoverOpen && !candidatesOpen}
        onOpenChange={(open) => {
          if (!open && !candidatesOpen && !isLoading && !keepEngaged) {
            reset();
          }
        }}
      >
        <PopoverTrigger asChild className="!border-none !bg-transparent">
          <div id="main-chat-input" className="relative flex items-center gap-1 select-none">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={`size-7 shrink-0 ${protectedPinyin ? "text-emerald-600" : "text-amber-600"}`}
              disabled={inputDisabled || pinyinComposing}
              aria-pressed={protectedPinyin}
              title={pinyinComposing ? "请先选字或按 Esc 清除拼音，再切换输入方式" : protectedPinyin
                ? "当前使用应用内拼音，候选显示在应用内；点击切换为系统输入法"
                : "当前使用系统输入法，候选窗可能被共享；点击启用应用内拼音"}
              aria-label={protectedPinyin ? "切换为系统输入法" : "启用应用内拼音"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                inputRef.current?.blur();
                setCandidatesOpen(false);
                const next = !protectedPinyin;
                setProtectedPinyin(next);
                safeLocalStorage.setItem(STORAGE_KEYS.PROTECTED_PINYIN, String(next));
              }}
            >
              {protectedPinyin ? <ShieldCheckIcon className="size-4" /> : <ShieldAlertIcon className="size-4" />}
            </Button>
            <div className="min-w-0 flex-1">
              {protectedPinyin ? (
                <ProtectedPinyinInput
                  inputRef={inputRef}
                  value={input}
                  onChange={setInput}
                  onSubmit={() => { void submit(); }}
                  onPaste={handlePaste}
                  disabled={inputDisabled}
                  placeholder="输入拼音，空格选字…"
                  className={inputClass}
                  onCandidatesOpenChange={setCandidatesOpen}
                  onCompositionActiveChange={setPinyinComposing}
                />
              ) : (
                <InputComponent
                  ref={inputRef}
                  placeholder="输入你的问题（系统候选窗可能被共享）…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  onPaste={handlePaste}
                  disabled={inputDisabled}
                  className={inputClass}
                />
              )}
            </div>

            {/* Conversation thread indicator */}
            {currentConversationId &&
              conversationHistory.length > 0 &&
              !isLoading && (
                <div className="absolute select-none right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <MessageHistory
                    conversationHistory={conversationHistory}
                    currentConversationId={currentConversationId}
                    onStartNewConversation={startNewConversation}
                    messageHistoryOpen={messageHistoryOpen}
                    setMessageHistoryOpen={setMessageHistoryOpen}
                  />
                </div>
              )}

            {/* Loading indicator */}
            {isLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 animate-pulse">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </PopoverTrigger>

        {/* Response Panel */}
        <PopoverContent
          align="end"
          side="bottom"
          className="w-screen p-0 border shadow-lg overflow-hidden"
          sideOffset={8}
        >
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
            <div className="flex flex-row gap-1 items-center">
              <h3 className="font-semibold text-xs select-none">
                {keepEngaged ? "连续对话" : "AI 回复"}
              </h3>
              <div className="text-[10px] text-muted-foreground/70">
                （使用方向键滚动）
              </div>
            </div>
            <div className="flex items-center gap-2 select-none">
              <div className="flex flex-row items-center gap-2 mr-2">
                <p className="text-[10px]">{`切换到${
                  keepEngaged ? "AI 回复" : "连续对话"
                }`}</p>
                <span className="text-[10px] text-muted-foreground/60 bg-muted/30 px-1 py-0 rounded border border-input/50">
                  {navigator.platform.toLowerCase().includes("mac")
                    ? "⌘"
                    : "Ctrl"}{" "}
                  + K
                </span>
                <Switch
                  checked={keepEngaged}
                  title={keepEngaged ? "关闭连续对话，单独显示本次回复" : "开启连续对话，保留上下文"}
                  aria-label="切换连续对话模式"
                  onCheckedChange={(checked) => {
                    setKeepEngaged(checked);
                    // Focus input after toggle
                    setTimeout(() => {
                      inputRef?.current?.focus();
                    }, 100);
                  }}
                />
              </div>
              <CopyButton content={response} />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (isLoading) {
                    cancel();
                  } else if (keepEngaged) {
                    // When keepEngaged is on, close everything and start new conversation
                    setKeepEngaged(false);
                    startNewConversation();
                  } else {
                    reset();
                  }
                }}
                className="cursor-pointer"
                title={
                  isLoading
                    ? "停止生成"
                    : keepEngaged
                    ? "关闭并开始新对话"
                    : "清空对话"
                }
              >
                <XIcon />
              </Button>
            </div>
          </div>

          <ScrollArea ref={scrollAreaRef} className="h-[calc(100vh-7rem)]">
            <div className="p-4">
              {error && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
                  <strong>错误：</strong> {error}
                </div>
              )}
              {isLoading && (
                <div className="flex items-center gap-2 my-4 text-muted-foreground animate-pulse select-none">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">正在生成回复…</span>
                </div>
              )}
              {response && <Markdown>{response}</Markdown>}

              {/* Conversation History - Separate scroll, no auto-scroll */}
              {keepEngaged && conversationHistory.length > 1 && (
                <div className="space-y-3 pt-3">
                  {conversationHistory
                    .sort((a, b) => b?.timestamp - a?.timestamp)
                    .map((message, index) => {
                      if (!isLoading && index === 0) {
                        return null;
                      }
                      return (
                        <div
                          key={message.id}
                          className={`p-3 rounded-lg text-sm ${
                            message.role === "user"
                              ? "bg-primary/10 border-l-4 border-primary"
                              : "bg-muted/50"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-medium text-muted-foreground uppercase">
                              {message.role === "user" ? "你" : "AI"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(message.timestamp).toLocaleTimeString(
                                "zh-CN",
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  hour12: false,
                                }
                              )}
                            </span>
                          </div>
                          <Markdown>{message.content}</Markdown>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
};
