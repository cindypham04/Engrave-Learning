"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

type ChatMessageProps = {
  role: "user" | "assistant";
  content: string;
};

export default function ChatMessage({ role, content }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div
    style={{
        marginBottom: "0.75rem",
        padding: "8px 10px",
        borderRadius: "8px",
        background: isUser ? "#e5f0ff" : "#f3f4f6",
        color: "#000",        // 👈 this line
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
