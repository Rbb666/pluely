import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components";

interface DeleteConfirmationDialogProps {
  count: number;
  all?: boolean;
  deleting: boolean;
  error: string;
  cancelDelete: () => void;
  confirmDelete: () => void;
}

export const DeleteConfirmationDialog = ({
  count,
  all = false,
  deleting,
  error,
  cancelDelete,
  confirmDelete,
}: DeleteConfirmationDialogProps) => {
  return (
    <Dialog open={count > 0} onOpenChange={(open) => { if (!open && !deleting) cancelDelete(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{all ? "删除全部聊天记录" : "删除会话"}</DialogTitle>
          <DialogDescription>
            将永久删除所选的 {count} 条会话及其中的消息。
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={cancelDelete}>
            取消
          </Button>
          <Button variant="destructive" disabled={deleting} onClick={confirmDelete}>
            {deleting ? "正在删除…" : all ? "删除全部" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
