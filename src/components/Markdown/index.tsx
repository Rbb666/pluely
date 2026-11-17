import React, { useEffect, useRef } from "react";
import { Streamdown, type MermaidErrorComponentProps } from "streamdown";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

// Streamdown 1.6 has no locale API for its built-in toolbar buttons.
// Limit this adapter to library-owned controls; response text is never modified.
const TOOLBAR_SELECTOR = [
  'button[data-streamdown="code-block-copy-button"]',
  'button[data-streamdown="code-block-download-button"]',
  '[data-streamdown="table-wrapper"] > div:first-child button[title]',
  '[data-streamdown="mermaid-block"] > div:first-child button[title]',
  '[data-streamdown="image-wrapper"] > button[title]',
].join(", ");

const TOOLBAR_LABELS: Record<string, string> = {
  "Copy Code": "复制代码",
  "Download file": "下载文件",
  "Download image": "下载图片",
  "Copy table": "复制表格",
  "Copy table as CSV": "复制为 CSV",
  "Copy table as TSV": "复制为 TSV",
  "Download table": "下载表格",
  "Download table as CSV": "下载为 CSV",
  "Download table as Markdown": "下载为 Markdown",
  "Download diagram": "下载图表",
  "Download diagram as SVG": "下载为 SVG",
  "Download diagram as PNG": "下载为 PNG",
  "Download diagram as MMD": "下载为 MMD",
  "View fullscreen": "全屏查看",
  "Exit fullscreen": "退出全屏",
  "Zoom in": "放大",
  "Zoom out": "缩小",
  "Reset zoom and pan": "重置缩放和位置",
};

const MermaidError = ({ error, chart, retry }: MermaidErrorComponentProps) => (
  <div className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm">
    <p className="font-medium text-destructive">图表渲染失败</p>
    <p className="break-words text-muted-foreground">{error}</p>
    <button className="text-primary underline" type="button" onClick={retry}>
      重试
    </button>
    <details>
      <summary className="cursor-pointer">查看图表代码</summary>
      <pre className="mt-2 overflow-x-auto text-xs">{chart}</pre>
    </details>
  </div>
);

export function Markdown({
  children,
  isStreaming = false,
}: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const translateToolbar = () => {
      container
        .querySelectorAll<HTMLButtonElement>(TOOLBAR_SELECTOR)
        .forEach((button) => {
          if (
            button.hasAttribute("data-pluely-content-button") ||
            button.closest("table, pre, code, svg")
          ) return;
          for (const attribute of ["title", "aria-label"]) {
            const label = TOOLBAR_LABELS[button.getAttribute(attribute) || ""];
            if (label) button.setAttribute(attribute, label);
          }
        });
    };

    translateToolbar();
    const observer = new MutationObserver(translateToolbar);
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title", "aria-label"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="contents">
      <Streamdown
        isAnimating={isStreaming}
        shikiTheme={["github-light", "github-dark"]}
        components={COMPONENTS as any}
        mermaid={{ errorComponent: MermaidError }}
        controls={{
          table: true,
          code: true,
          mermaid: {
            download: true,
            copy: true,
            fullscreen: false,
            panZoom: false,
          },
        }}
      >
        {children}
      </Streamdown>
    </div>
  );
}

const COMPONENTS = {
  // Raw HTML buttons in Markdown are content, not Streamdown toolbar controls.
  button: ({ children, node: _node, ...props }: any) => (
    <button {...props} data-pluely-content-button="true">
      {children}
    </button>
  ),
  a: ({ children, href, ...props }: any) => {
    const handleClick = async (e: React.MouseEvent) => {
      e.preventDefault();
      if (href) {
        try {
          await openUrl(href);
        } catch (error) {
          console.error("Failed to open URL:", error);
        }
      }
    };

    return (
      <a
        href={href}
        className="text-gray-600 underline underline-offset-2 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100 cursor-pointer"
        onClick={handleClick}
        {...props}
      >
        {children}
      </a>
    );
  },
};
