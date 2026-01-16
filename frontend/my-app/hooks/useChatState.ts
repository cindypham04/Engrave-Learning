"use client";

import { useState } from "react";

export type ChatMode = "document" | "annotation";

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  annotation_id?: number;
  reference?: {
    page: number;
  };
};

type AskPayload = {
  fileId: number;
  annotationId: number | null;
  question: string;
  page?: number;
};

export function useChatState() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);

  const [chatMode, setChatMode] = useState<ChatMode>("document");
  const [activeAnnotationId, setActiveAnnotationId] =
    useState<number | null>(null);

  /* ---------------- Load chats ---------------- */

  async function loadDocumentChat(fileId: number) {
    const res = await fetch(
      `http://localhost:8000/chat/file/${fileId}`
    );
    const data = await res.json();

    setMessages(data.messages || []);
    setChatMode("document");
    setActiveAnnotationId(null);
  }

  async function loadAnnotationChat(annotationId: number) {
    const res = await fetch(
      `http://localhost:8000/chat/annotation/${annotationId}`
    );
    const data = await res.json();

    setMessages(data.messages || []);
    setChatMode("annotation");
    setActiveAnnotationId(annotationId);
  }

  /* ---------------- Ask question ---------------- */

  async function askQuestion({
    fileId,
    annotationId,
    question,
    page,
  }: AskPayload) {
    if (!fileId) return;

    const userMsg: ChatMsg = {
      role: "user",
      content: question || "Explain this in simple terms.",
      annotation_id: annotationId ?? undefined,
      ...(page ? { reference: { page } } : {}),
    };

    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const res = await fetch("http://localhost:8000/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_id: fileId,
        annotation_id: annotationId,
        question: userMsg.content,
      }),
    });

    const data = await res.json();

    setMessages(prev => [
      ...prev,
      { role: "assistant", content: data.answer },
    ]);

    setLoading(false);
  }

  /* ---------------- Helpers ---------------- */

  function resetChat() {
    setMessages([]);
    setChatMode("document");
    setActiveAnnotationId(null);
    setLoading(false);
  }

  return {
    // state
    messages,
    loading,
    chatMode,
    activeAnnotationId,

    // actions
    setMessages,
    loadDocumentChat,
    loadAnnotationChat,
    askQuestion,
    resetChat,
    setChatMode,
    setActiveAnnotationId,
  };
}
