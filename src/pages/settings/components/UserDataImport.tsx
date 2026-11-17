import { useEffect, useRef, useState } from "react";
import { FolderOpenIcon, ImportIcon, DownloadIcon, Loader2 } from "lucide-react";
import {
  Button, Header, Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components";
import {
  inspectUserDataBackup, MAX_USER_DATA_IMPORT_BYTES, restartAfterUserDataImport,
  stageUserDataImport, type UserDataImportPreview,
  exportUserData, type CompletedUserDataExport,
} from "@/lib/user-data-import";

export const UserDataImport = () => {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const mounted = useRef(true);
  const selectionGeneration = useRef(0);
  const busyRef = useRef(false);
  const stagedRef = useRef(false);
  const readingRef = useRef(false);
  const [fileName, setFileName] = useState("");
  const [backupJson, setBackupJson] = useState("");
  const [preview, setPreview] = useState<UserDataImportPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<CompletedUserDataExport | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; selectionGeneration.current += 1; };
  }, []);

  const selectFile = async (file: File | undefined) => {
    if (!file || busyRef.current || stagedRef.current) return;
    const generation = ++selectionGeneration.current;
    readingRef.current = true;
    setReading(true);
    setError("");
    setPreview(null);
    setBackupJson("");
    setFileName(file.name);
    setExportResult(null);
    try {
      if (file.size === 0) throw new Error("备份文件为空。");
      if (file.size > MAX_USER_DATA_IMPORT_BYTES) throw new Error("备份文件超过 160 MiB，无法导入。");
      const text = await file.text();
      const metadata = inspectUserDataBackup(text);
      if (!mounted.current || generation !== selectionGeneration.current) return;
      setBackupJson(text);
      setPreview(metadata);
    } catch (cause) {
      if (!mounted.current || generation !== selectionGeneration.current) return;
      // Only local validation messages are shown; File read errors use a fixed message.
      setError(cause instanceof Error && !(cause instanceof DOMException)
        ? cause.message : "无法读取所选文件，请重新选择。");
    } finally {
      if (generation === selectionGeneration.current) {
        readingRef.current = false;
        if (mounted.current) setReading(false);
      }
    }
  };

  const confirmImport = async () => {
    if (!preview || !backupJson || busyRef.current || readingRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (!stagedRef.current) {
        await stageUserDataImport(backupJson);
        stagedRef.current = true;
        if (mounted.current) { setStaged(true); setConfirmOpen(false); }
      }
      await restartAfterUserDataImport();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "导入失败，请重试。");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const handleExport = async () => {
    if (busyRef.current || readingRef.current || stagedRef.current || confirmOpen) return;
    busyRef.current = true;
    setExporting(true);
    setError("");
    setExportResult(null);
    try {
      const result = await exportUserData();
      if (mounted.current && !result.cancelled) setExportResult(result);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "导出失败，请重试。");
    } finally {
      busyRef.current = false;
      if (mounted.current) setExporting(false);
    }
  };

  return (
    <section id="user-data-import" className="space-y-3 border-t pt-5 pb-5">
      <Header title="用户数据备份与迁移" description="备份或恢复提示词、应用偏好、AI/ASR 服务配置与 API 密钥、聊天记录及附件。文件仅在本机保存和读取。" isMainTitle />
      <div className="space-y-2 border-b pb-4">
        <Button
          variant="outline"
          onClick={() => void handleExport()}
          disabled={reading || busy || exporting || staged || confirmOpen}
          title="选择保存位置，导出当前用户数据备份"
        >
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
          {exporting ? "正在选择位置或导出…" : "导出用户数据"}
        </Button>
        <p className="text-xs text-muted-foreground">
          导出文件包含 API 密钥和聊天内容，请私下保管。更换电脑后请检查音频设备，系统麦克风权限需要重新授权。
        </p>
        {exportResult && (
          <div role="status" className="rounded-lg border p-3 text-sm space-y-1">
            <p className="font-medium">用户数据已导出</p>
            <p className="break-all">保存位置：{exportResult.path}</p>
            <p>配置项：{exportResult.settingsCount}，会话：{exportResult.conversationsCount}，消息：{exportResult.messagesCount}，系统提示词：{exportResult.promptsCount}</p>
          </div>
        )}
      </div>
      <p className="text-sm font-medium">导入用户数据</p>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="选择 Pluely 用户数据备份文件"
        disabled={reading || busy || exporting || staged}
        onChange={(event) => { void selectFile(event.target.files?.[0]); event.target.value = ""; }}
      />
      <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={reading || busy || exporting || staged} title="选择本地 Pluely 用户数据备份文件">
        {reading ? <Loader2 className="size-4 animate-spin" /> : <FolderOpenIcon className="size-4" />}
        {reading ? "正在检查文件…" : "选择备份文件"}
      </Button>
      {preview && (
        <div className="rounded-lg border p-3 text-sm space-y-1 break-words">
          <p>文件：{fileName}</p>
          <p>备份时间：{new Date(preview.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
          <p>配置项：{preview.settingsCount}</p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        导入将替换当前设置和聊天记录。应用重启后，会先备份现有数据，再完成恢复。
        备份可能包含 API 密钥，请仅导入可信文件。
      </p>
      {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
      {staged && !error && <p role="status" className="text-sm">导入文件已校验并暂存，重启后会先备份原有数据，再完成恢复…</p>}
      {preview && (
        <Button disabled={reading || busy || exporting} onClick={() => staged ? void confirmImport() : setConfirmOpen(true)} title={staged ? "重启应用并完成已准备的数据导入" : "确认后备份当前数据，并替换为所选备份"}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ImportIcon className="size-4" />}
          {busy ? "正在准备导入…" : staged ? "重试重启" : "导入用户数据"}
        </Button>
      )}
      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认替换当前用户数据</DialogTitle>
            <DialogDescription>
              将用“{fileName}”替换当前设置和聊天记录。应用将重启，在替换前自动备份现有数据。
              未发送的草稿和正在进行的录音可能中断，请先完成当前操作。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>取消</Button>
            <Button onClick={() => void confirmImport()} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? "正在备份和准备…" : "确认导入并重启"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
