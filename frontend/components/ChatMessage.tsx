"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { visit } from "unist-util-visit";

const UI_RADIUS = 12;


export type ChatMessageProps = {
  role: "user" | "assistant";
  content: string;
  onClick?: () => void;
  onHighlightClick?: (annotationId: number) => void;
  messageId?: number;
  messageIndex?: number;
  panelId?: string;
  activeAnnotationId?: number | null;
  highlights?: {
    annotation_id: number;
    start: number;
    end: number;
  }[];
};

export default function ChatMessage({
  role,
  content,
  onClick,
  onHighlightClick,
  messageId,
  messageIndex,
  panelId,
  activeAnnotationId,
  highlights = [],
}: ChatMessageProps) {
  const isUser = role === "user";
  const hasHighlights = highlights.length > 0;
  const highlightBg = (annotationId: number) =>
    annotationId === activeAnnotationId
      ? "rgba(0,112,243,0.15)" // active = blue
      : "rgba(255, 235, 59, 0.35)"; // inactive = yellow

  const rehypeHighlight = () => {
    const sorted = [...highlights].sort((a, b) => a.start - b.start);

    return (tree: any) => {
      const textNodes: Array<{
        node: any;
        parent: any;
        index: number;
        start: number;
        end: number;
      }> = [];

      let offset = 0;

      visit(tree, "text", (node: any, index: number | null, parent: any) => {
        if (!parent || index === null) return;

        const text = node.value as string;
        const nodeStart = offset;
        const nodeEnd = nodeStart + text.length;

        if (
          parent.tagName !== "code" &&
          parent.tagName !== "pre" &&
          text.trim().length > 0
        ) {
          textNodes.push({
            node,
            parent,
            index,
            start: nodeStart,
            end: nodeEnd,
          });
        }

        offset = nodeEnd;
      });

      for (let i = textNodes.length - 1; i >= 0; i -= 1) {
        const { node, parent, index, start, end } = textNodes[i];
        const text = node.value as string;

        const overlaps = sorted.filter(h => h.start < end && h.end > start);
        if (!overlaps.length) continue;

        const children: any[] = [];
        let localCursor = 0;

        for (const h of overlaps) {
          const sliceStart = Math.max(h.start, start) - start;
          const sliceEnd = Math.min(h.end, end) - start;

          if (sliceStart > localCursor) {
            children.push({
              type: "text",
              value: text.slice(localCursor, sliceStart),
            });
          }

          children.push({
            type: "element",
            tagName: "span",
            children: [{ type: "text", value: text.slice(sliceStart, sliceEnd) }],
            properties: {
              style: `background: ${highlightBg(h.annotation_id)}; border-radius: 4px; padding: 0 2px; cursor: pointer;`,
              "data-annotation-id": String(h.annotation_id),
            },
          });

          localCursor = sliceEnd;
        }

        if (localCursor < text.length) {
          children.push({ type: "text", value: text.slice(localCursor) });
        }

        parent.children.splice(index, 1, ...children);
      }
    };
  };

  return (
    <div
      data-chat-message
      data-message-id={messageId ?? undefined}
      data-message-index={messageIndex}
      data-chat-panel-id={panelId}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        const highlightEl = target.closest
          ? (target.closest("[data-annotation-id]") as HTMLElement | null)
          : null;

        if (highlightEl && onHighlightClick) {
          const annotationId = Number(
            highlightEl.getAttribute("data-annotation-id")
          );
          if (!Number.isNaN(annotationId)) {
            onHighlightClick(annotationId);
            return;
          }
        }

        onClick?.();
      }}
      style={{
        marginBottom: "1rem",
        padding: isUser ? "8px 10px" : "0",
        borderRadius: UI_RADIUS,
        background: isUser ? "#e5f0ff" : "transparent",
        boxShadow: isUser ? "0 4px 12px rgba(0,0,0,0.08)" : "none",
        cursor: onClick ? "pointer" : "default",
        fontSize: "16px",
        lineHeight: "1.6",
      }}
    >
        <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[
            rehypeKatex,
            ...(hasHighlights ? [rehypeHighlight] : []),
          ]}
        >
          {content}
        </ReactMarkdown>

    </div>

  );
}
