"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

const UI_RADIUS = 12;

export type ChatMessageProps = {
  role: "user" | "assistant";
  content: string;
  onClick?: () => void;
};

export default function ChatMessage({
  role,
  content,
  onClick,
}: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div
      data-chat-message
      onClick={onClick}
      style={{
        marginBottom: "1rem",
        padding: isUser ? "8px 10px" : "0",
        borderRadius: UI_RADIUS,
        background: isUser ? "#e5f0ff" : "transparent",
        color: "var(--text-main)",
        cursor: onClick ? "pointer" : "default",
        fontSize: "16px",
        lineHeight: "1.6",
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
