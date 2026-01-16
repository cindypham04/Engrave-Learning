"use client";

import { useEffect, useRef, useState } from "react";

type ChatSelectionPayload = {
  text: string;
  rect: DOMRect;
};

export function useChatSelection() {
  // ---- refs to store selected chat text + geometry ----
  const pendingChatTextRef = useRef<string | null>(null);
  const pendingChatRectRef = useRef<DOMRect | null>(null);

  // ---- popup state ----
  const chatPopupRef = useRef<HTMLDivElement | null>(null);
  const [chatPopupOpen, setChatPopupOpen] = useState(false);

  // ---- handle text selection inside chat messages ----
  function handleChatTextSelect(payload: ChatSelectionPayload) {
    pendingChatTextRef.current = payload.text;
    pendingChatRectRef.current = payload.rect;

    setChatPopupOpen(true);

    // Position popup AFTER DOM paint
    requestAnimationFrame(() => {
      if (!chatPopupRef.current) return;

      chatPopupRef.current.style.top =
        `${payload.rect.top + window.scrollY - 40}px`;

      chatPopupRef.current.style.left =
        `${payload.rect.left + window.scrollX}px`;
    });
  }

  // ---- close popup when clicking outside ----
  useEffect(() => {
    function handleWindowClick(e: MouseEvent) {
      const target = e.target as HTMLElement;

      // Click inside popup → ignore
      if (chatPopupRef.current?.contains(target)) return;

      // Otherwise close popup
      setChatPopupOpen(false);
      pendingChatTextRef.current = null;
      pendingChatRectRef.current = null;
    }

    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  // ---- explicit close (useful for buttons) ----
  function closeChatPopup() {
    setChatPopupOpen(false);
    pendingChatTextRef.current = null;
    pendingChatRectRef.current = null;
  }

  return {
    // state
    chatPopupOpen,
    chatPopupRef,

    // handlers
    handleChatTextSelect,
    closeChatPopup,

    // refs (kept in case you need them later)
    pendingChatTextRef,
    pendingChatRectRef,
  };
}
