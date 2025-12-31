"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

type ChatMessageProps = {
  content: string;
};

export default function ChatMessage({ content }: ChatMessageProps) {
  return (
    <div
      className="
        prose max-w-none
        prose-p:leading-[1.5]
        prose-h2:text-xl
        prose-h2:font-semibold
        prose-h2:mt-6
        prose-h2:mb-3
      "
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
