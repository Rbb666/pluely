import { Badge, Button, Card, Empty, Input } from "@/components";
import { useHistory } from "@/hooks";
import { PageLayout } from "@/layouts";
import { ListChecks, MessageCircleIcon, Search, Trash2 } from "lucide-react";
import moment from "moment";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DeleteConfirmationDialog } from "./components";

const Chats = () => {
  const { conversations, isLoading, search, setSearch, removeConversations } = useHistory();
  const navigate = useNavigate();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [notice, setNotice] = useState("");

  const query = search.trim().toLowerCase();
  const visible = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(query)
  );
  const groups = new Map<string, typeof conversations>();
  for (const conversation of visible) {
    const day = moment(conversation.updatedAt).format("YYYY-MM-DD");
    const group = groups.get(day);
    if (group) group.push(conversation);
    else groups.set(day, [conversation]);
  }

  const selectedIds = conversations
    .filter(({ id }) => selected.has(id))
    .map(({ id }) => id);
  const visibleSelectedCount = visible.filter(({ id }) => selected.has(id)).length;
  const allVisibleSelected = visible.length > 0 && visibleSelectedCount === visible.length;

  const selectConversation = (id: string, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectVisible = (checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const { id } of visible) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const cancelDelete = () => {
    if (deleting) return;
    setPending(null);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (!pending || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const count = await removeConversations(pending);
      setNotice(`已删除 ${count} 条会话。`);
      setSelected(new Set());
      setPending(null);
      setSelecting(false);
    } catch (error) {
      console.error("Failed to delete selected conversations:", error);
      setDeleteError("删除会话失败，请重试。");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageLayout title="聊天记录" description="">
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {conversations.length === 0 ? (
        <Empty
          isLoading={isLoading}
          icon={MessageCircleIcon}
          title="暂无聊天记录"
          description="开始新对话后，将在这里显示记录"
        />
      ) : (
        <div className="flex flex-col gap-4 pb-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative w-full sm:max-w-xs">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="搜索聊天记录"
                placeholder="搜索聊天记录…"
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Button
              variant="outline"
              aria-pressed={selecting}
              onClick={() => {
                setSelecting(!selecting);
                setSelected(new Set());
                setNotice("");
              }}
            >
              <ListChecks aria-hidden="true" />
              {selecting ? "退出多选" : "多选"}
            </Button>
          </div>
          {selecting && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2">
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={allVisibleSelected}
                  disabled={visible.length === 0}
                  ref={(input) => {
                    if (input) input.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected;
                  }}
                  onChange={(event) => selectVisible(event.target.checked)}
                />
                {query ? "全选搜索结果" : "全选"}
              </label>
              <span role="status" className="text-sm text-muted-foreground">
                已选 {selectedIds.length} 条
              </span>
              <Button
                className="ml-auto"
                variant="destructive"
                disabled={selectedIds.length === 0}
                onClick={() => setPending(selectedIds)}
              >
                <Trash2 aria-hidden="true" />
                删除已选
              </Button>
            </div>
          )}
          {visible.length === 0 && (
            <Empty isLoading={false} icon={Search} title="未找到聊天记录" description="试试其他搜索词" />
          )}
          {[...groups].map(([day, group]) => (
            <section key={day} className="flex flex-col gap-2">
              <h2 className="text-xs font-medium text-muted-foreground">
                {moment(day).format("YYYY年M月D日 dddd")}
              </h2>
              {group.map((conversation) => {
                const checked = selected.has(conversation.id);
                const rowClass = "flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-2 text-left";
                const summary = (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm">{conversation.title}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Badge variant="outline" className="text-xs">{conversation.messages.length} 条消息</Badge>
                      <Badge variant="outline" className="text-xs">{moment(conversation.updatedAt).format("HH:mm")}</Badge>
                    </span>
                  </>
                );
                return (
                  <Card key={conversation.id} className={`gap-0 p-0 shadow-none hover:border-primary/50 ${selecting && checked ? "border-primary/50 bg-primary/5" : ""}`}>
                    {selecting ? (
                      <label className={`${rowClass} cursor-pointer`}>
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-primary"
                          aria-label={`选择会话 ${conversation.title}`}
                          checked={checked}
                          onChange={(event) => selectConversation(conversation.id, event.target.checked)}
                        />
                        {summary}
                      </label>
                    ) : (
                      <button
                        type="button"
                        className={`${rowClass} cursor-pointer focus-visible:outline-2 focus-visible:outline-ring`}
                        onClick={() => navigate(`/chats/view/${conversation.id}`)}
                      >
                        {summary}
                      </button>
                    )}
                  </Card>
                );
              })}
            </section>
          ))}
        </div>
      )}
      <DeleteConfirmationDialog
        count={pending?.length ?? 0}
        all={pending?.length === conversations.length}
        deleting={deleting}
        error={deleteError}
        cancelDelete={cancelDelete}
        confirmDelete={confirmDelete}
      />
    </PageLayout>
  );
};

export default Chats;
