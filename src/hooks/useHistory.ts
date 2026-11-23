import { useState, useEffect, useCallback } from "react";
import { emit } from "@tauri-apps/api/event";
import {
  getAllConversations,
  deleteConversations,
  DOWNLOAD_SUCCESS_DISPLAY_MS,
} from "@/lib";
import { ChatConversation } from "@/types/completion";

export type UseHistoryType = ReturnType<typeof useHistory>;

export interface UseHistoryReturn {
  // State
  conversations: ChatConversation[];
  selectedConversationId: string | null;
  viewingConversation: ChatConversation | null;
  downloadedConversations: Set<string>;
  deleteConfirm: string | null;
  isDownloaded: boolean;
  isAttached: boolean;

  // Actions
  handleViewConversation: (conversation: ChatConversation) => void;
  handleDownloadConversation: (
    conversation: ChatConversation,
    e: React.MouseEvent
  ) => void;
  handleDeleteConfirm: (conversationId: string) => void;
  confirmDelete: () => Promise<boolean>;
  removeConversations: (ids: readonly string[]) => Promise<number>;
  cancelDelete: () => void;
  handleAttachToOverlay: (conversationId: string) => void;
  handleDownload: (
    conversation: ChatConversation | null,
    e: React.MouseEvent
  ) => void;
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  // Utilities
  refreshConversations: () => void;
  isLoading: boolean;
}

export function useHistory(): UseHistoryReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [search, setSearch] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [viewingConversation, setViewingConversation] =
    useState<ChatConversation | null>(null);

  const [downloadedConversations, setDownloadedConversations] = useState<
    Set<string>
  >(new Set());

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isAttached, setIsAttached] = useState(false);

  // Function to refresh conversations
  const refreshConversations = useCallback(async () => {
    try {
      setIsLoading(true);
      const loadedConversations = await getAllConversations();
      setConversations(loadedConversations);
    } catch (error) {
      console.error("Failed to load conversations:", error);
      setConversations([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load conversations when component mounts or popover opens
  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  const handleViewConversation = (conversation: ChatConversation) => {
    setViewingConversation(conversation);
  };

  const handleDownloadConversation = (
    conversation: ChatConversation,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();

    // Show download success state
    setDownloadedConversations((prev) => new Set(prev).add(conversation.id));

    try {
      // Convert conversation to markdown format
      const markdown = generateConversationMarkdown(conversation);

      // Create and download the file
      const blob = new Blob([markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = generateFilename(conversation.title);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download conversation:", error);
      // Remove from success state if download failed
      setDownloadedConversations((prev) => {
        const newSet = new Set(prev);
        newSet.delete(conversation.id);
        return newSet;
      });
      return;
    }

    // Clear success state after display timeout
    setTimeout(() => {
      setDownloadedConversations((prev) => {
        const newSet = new Set(prev);
        newSet.delete(conversation.id);
        return newSet;
      });
    }, DOWNLOAD_SUCCESS_DISPLAY_MS);
  };

  const handleDeleteConfirm = (conversationId: string) => {
    setDeleteConfirm(conversationId);
  };

  const removeConversations = async (ids: readonly string[]) => {
    const count = await deleteConversations(ids);
    const removed = new Set(ids);
    setConversations((prev) => prev.filter((conversation) => !removed.has(conversation.id)));
    setSelectedConversationId((previous) => previous && removed.has(previous) ? null : previous);
    setViewingConversation((previous) => previous && removed.has(previous.id) ? null : previous);
    void emit("conversations-deleted", ids).catch((error) => {
      console.error("Failed to notify Pluely windows of deleted conversations:", error);
    });
    return count;
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return false;
    try {
      await removeConversations([deleteConfirm]);
      setDeleteConfirm(null);
      return true;
    } catch (error) {
      console.error("Failed to delete conversation:", error);
      return false;
    }
  };

  const cancelDelete = () => {
    setDeleteConfirm(null);
  };

  const handleAttachToOverlay = (conversationId: string) => {
    // Use localStorage to communicate between windows
    localStorage.setItem(
      "pluely-conversation-selected",
      JSON.stringify({ id: conversationId, timestamp: Date.now() })
    );
    setIsAttached(true);
    setTimeout(() => {
      setIsAttached(false);
    }, DOWNLOAD_SUCCESS_DISPLAY_MS);
  };

  const handleDownload = (
    conversation: ChatConversation | null,
    e: React.MouseEvent
  ) => {
    if (conversation) {
      handleDownloadConversation(conversation, e);
      setIsDownloaded(true);
      setTimeout(() => {
        setIsDownloaded(false);
      }, DOWNLOAD_SUCCESS_DISPLAY_MS);
    }
  };

  // Helper functions
  const generateConversationMarkdown = (
    conversation: ChatConversation
  ): string => {
    let markdown = `# ${conversation.title}\n\n`;
    markdown += `**创建时间：** ${new Date(
      conversation.createdAt
    ).toLocaleString("zh-CN")}\n`;
    markdown += `**更新时间：** ${new Date(
      conversation.updatedAt
    ).toLocaleString("zh-CN")}\n`;
    markdown += `**消息数：** ${conversation.messages.length}\n\n---\n\n`;

    conversation.messages.forEach((message, index) => {
      const roleLabel = message.role === "user" ? "用户" : message.role === "system" ? "系统" : "AI 助手";
      markdown += `## ${roleLabel}: ${message.content}\n`;

      if (index < conversation.messages.length - 1) {
        markdown += "\n";
      }
    });

    return markdown;
  };

  const generateFilename = (title: string): string => {
    const sanitizedTitle = title.replace(/[^\p{L}\p{N}_-]/gu, "_");
    return `${sanitizedTitle.substring(0, 16)}.md`;
  };

  return {
    // State
    conversations,
    selectedConversationId,
    viewingConversation,
    downloadedConversations,
    deleteConfirm,
    isDownloaded,
    isAttached,

    // Actions
    handleViewConversation,
    handleDownloadConversation,
    handleDeleteConfirm,
    confirmDelete,
    removeConversations,
    cancelDelete,
    handleAttachToOverlay,
    handleDownload,
    // Utilities
    refreshConversations,
    search,
    setSearch,
    isLoading,
  };
}
