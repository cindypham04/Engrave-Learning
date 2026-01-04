"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

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
      onClick={onClick}
      style={{
        marginBottom: "0.75rem",
        padding: "8px 10px",
        borderRadius: "8px",
        background: isUser ? "#e5f0ff" : "#f3f4f6",
        color: "#000",
        cursor: onClick ? "pointer" : "default",
        fontSize: "14px",
        lineHeight: "1.4",
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
