"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { start } from "repl";

const ChatMessage = dynamic(
  () => import("../../components/ChatMessage"),
  { ssr: false }
);

/* ---------------- react-pdf (client only) ---------------- */

const Document = dynamic(
  async () => {
    const mod = await import("react-pdf");
    mod.pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return mod.Document;
  },
  { ssr: false }
);

const Page = dynamic(
  async () => {
    const mod = await import("react-pdf");
    return mod.Page;
  },
  { ssr: false }
);

/* ---------------- Types ---------------- */

type TextContext = {
  type: "text";
  text: string;
  page: number;
};

type ImageContext = {
  type: "image";
  region_id: string;
  page_number: number;
};

type Context = TextContext | ImageContext;

type DragRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ChatMsg = {
  id?: number;
  role: "user" | "assistant";
  content: string;
  annotation_id?: number;
  reference?: {
    page: number;
  };
};

type Highlight = {
  page: number;
  annotation_id: number;   // 👈 ADD THIS
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type ChatThread = {
  id: number;
  file_id: number | null;
  source_annotation_id: number | null;
  title: string | null;
};

type ChatHighlight = {
  annotation_id: number;
  message_id: number;
  start: number;
  end: number;
  };


/* ---------------- Main Component ---------------- */

export default function Home() {
  
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);

  const [context, setContext] = useState<Context | null>(null);

  // region selection
  const [regionMode, setRegionMode] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);
  const [activePage, setActivePage] = useState<number | null>(null);

  // chat
  const [question, setQuestion] = useState("");
  const [allMessages, setAllMessages] = useState<ChatMsg[]>([]);
  const [visibleMessages, setVisibleMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [secondaryQuestion, setSecondaryQuestion] = useState("");
  const [secondaryMessages, setSecondaryMessages] = useState<ChatMsg[]>([]);
  const [secondaryVisibleMessages, setSecondaryVisibleMessages] = useState<ChatMsg[]>([]);
  const [secondaryLoading, setSecondaryLoading] = useState(false);
  const [secondaryPanelOpen, setSecondaryPanelOpen] = useState(false);
  const [secondaryFileId, setSecondaryFileId] = useState<number | null>(null);
  const [secondaryFileTitle, setSecondaryFileTitle] = useState<string | null>(null);
  const [secondaryPendingTitle, setSecondaryPendingTitle] = useState<string | null>(null);

  const popupRef = useRef<HTMLDivElement | null>(null);
  const pendingTextRef = useRef<TextContext | null>(null);

  // 🟡 Text: store raw DOM rect
  const pendingTextRectRef = useRef<DOMRect | null>(null);

  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isClickingPopupRef = useRef(false);

  // Track the “current file version”
  const activeFileVersionRef = useRef(0);

  // Store chat selection in LLM response info immediately
  const pendingChatHighlightRef = useRef<{
    messageId: number;
    start: number;
    end: number;
    panelId: "primary" | "secondary";
  } | null>(null);


  // Stored highlights
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  // State for annotation
  const [activeAnnotationId, setActiveAnnotationId] = useState<number | null>(null);
  const [secondaryActiveAnnotationId, setSecondaryActiveAnnotationId] = useState<number | null>(null);

  // State of file
  const [activeFileId, setActiveFileId] = useState<number | null>(null);
  const [activeFileFolderId, setActiveFileFolderId] = useState<number | null>(null);

  // State of sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [folders, setFolders] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);

  // File title (stay on top of chat panel) state
  const [activeFileTitle, setActiveFileTitle] = useState<string | null>(null);

  // PDF scaler state
  const [pdfScale, setPdfScale] = useState(1.2);

  // Chat width state
  const [chatWidth, setChatWidth] = useState(32); // percent
  const [isResizing, setIsResizing] = useState(false);

  // Rename state
  const [renamingFileId, setRenamingFileId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Action state - tracks which file or folder row is in “action mode” to be able to remove
  const [fileActionsOpenId, setFileActionsOpenId] = useState<number | null>(null);
  const [folderActionsOpenId, setFolderActionsOpenId] = useState<number | null>(null);

  // Navigation state - allows creating new folders or upload new files
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [folderStack, setFolderStack] = useState<number[]>([]);

  // "Add menu" state
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // Current folder name on "Heading" of sidebar state
  const [currentFolderName, setCurrentFolderName] = useState<string | null>(null);

  // Rename and Delete folder state
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");

  // Adjust sidebar width state
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  const PDF_INSET = 0.95;

  const folderHoldTimeoutRef = useRef<number | null>(null);
  const didTriggerHoldRef = useRef(false);

  // Diviver of panels
  const DIVIDER_COLOR = "#000";
  const DIVIDER_WIDTH = "1px";

  // Corners of the chat box
  const UI_RADIUS = 12;

  const pdfContentRef = useRef<HTMLDivElement | null>(null);
  const [pdfContentWidth, setPdfContentWidth] = useState(0);

  // User select current or new chat in the selected text in the chat
  const pendingChatActionRef = useRef<"current" | "new">("current");

  const [popupMode, setPopupMode] = useState<"chat" | "pdf" | null>(null);

  // Active chat thread state
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [activeChatThreadId, setActiveChatThreadId] = useState<number | null>(null);
  const [secondaryChatThreadId, setSecondaryChatThreadId] = useState<number | null>(null);

  // LLM response highlight state
  const [chatHighlights, setChatHighlights] = useState<ChatHighlight[]>([]);

  // track “just showed popup”
  const justOpenedPopupRef = useRef(false);

  const messageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const lastFullChatScrollTopRef = useRef<number | null>(null);
  const secondaryMessagesContainerRef = useRef<HTMLDivElement | null>(null);
  const secondaryLastFullChatScrollTopRef = useRef<number | null>(null);



  // ---------- load folders (depends on current folder) ----------
  useEffect(() => {
    const url =
      currentFolderId === null
        ? "http://localhost:8000/folders"
        : `http://localhost:8000/folders?parent_id=${currentFolderId}`;

    fetch(url)
      .then(res => res.json())
      .then(data => setFolders(data.folders));
  }, [currentFolderId]);

  // ---------- load files (ONCE) ----------
  useEffect(() => {
    fetch("http://localhost:8000/files")
      .then(res => res.json())
      .then(data =>
        setFiles(Array.isArray(data) ? data : data.files ?? [])
      );
  }, []);

  // ---------- load file state ----------
  useEffect(() => {
    if (!activeFileId) return;
    loadFileState(activeFileId);
  }, [activeFileId]);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isResizing) return;

      const percent = (e.clientX / window.innerWidth) * 100;

      // Clamp so it never becomes unusable
      const clamped = Math.min(60, Math.max(20, 100 - percent));

      setChatWidth(clamped);
    }

    function handleMouseUp() {
      setIsResizing(false);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;

      // Don't close menus when clicking inside sidebar items
      if (target.closest(".file-row") || target.closest("[data-folder-row]")) {
        return;
      }

      setFileActionsOpenId(null);
      setFolderActionsOpenId(null);
    }


    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  // Mouse listener
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isResizingSidebar) return;

      const newWidth = e.clientX;

      // Clamp so it stays usable
      const clamped = Math.min(400, Math.max(160, newWidth));
      setSidebarWidth(clamped);
    }

    function handleMouseUp() {
      setIsResizingSidebar(false);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingSidebar]);

  // Adjusting pdf width to be the same as range
  useEffect(() => {
    if (pdfUrl === null) return;
    if (!pdfContentRef.current) return;

    const el = pdfContentRef.current;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      setPdfContentWidth(entry.contentRect.width);
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [pdfUrl]);


  useEffect(() => {
    if (!pdfUrl) {
      setPopupMode(null);
      hidePopup();
    }
  }, [pdfUrl]);



  /* ---------------- Helpers ---------------- */

  function scrollToPage(page: number) {
    const el = pageRefs.current[page];
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function getContextLabel(ctx: Context) {
    if (ctx.type === "text") return `Text added p.${ctx.page}`;
    return `Region added p.${ctx.page_number}`;
  }

  function cleanChatTitle(raw: string) {
    const cleaned = raw
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return "New Chat";
    return cleaned.length > 48 ? `${cleaned.slice(0, 48)}...` : cleaned;
  }

  async function createStandaloneChat(title: string) {
    const res = await fetch("http://localhost:8000/chat/standalone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder_id: activeFileFolderId,
        title,
      }),
    });

    if (!res.ok) {
      throw new Error("Failed to create standalone chat");
    }

    return res.json();
  }

  async function fetchAnnotation(annotationId: number) {
    const res = await fetch(
      `http://localhost:8000/annotations/${annotationId}`
    );

    if (!res.ok) {
      return null;
    }

    return res.json();
  }

  async function backToFullConversation(panelId: "primary" | "secondary") {
    const isSecondary = panelId === "secondary";
    if (isSecondary) {
      setSecondaryActiveAnnotationId(null);
    } else {
      setActiveAnnotationId(null);
    }

    const threadId = isSecondary ? secondaryChatThreadId : activeChatThreadId;
    if (!threadId) return;

    const messages = await loadChatThreadMessages(threadId, panelId);
    if (!messages) return;

    const scrollTop = isSecondary
      ? secondaryLastFullChatScrollTopRef.current
      : lastFullChatScrollTopRef.current;
    const containerRef = isSecondary
      ? secondaryMessagesContainerRef.current
      : messagesContainerRef.current;

    if (scrollTop !== null && containerRef) {
      setTimeout(() => {
        containerRef.scrollTo({
          top: scrollTop,
          behavior: "smooth",
        });
      }, 0);
    }
  }


  async function loadFileState(fileId: number) {
    const versionAtCall = activeFileVersionRef.current;

    const res = await fetch(`http://localhost:8000/files/${fileId}/state`);
    if (!res.ok) return;

    if (versionAtCall !== activeFileVersionRef.current) return;

    const data = await res.json();

    // ---------- COMMON ----------
    setActiveFileTitle(data.file.title);
    setActiveFileFolderId(data.file.folder_id ?? null);
    setChatThreads(data.threads || []);

    // ---------- CHAT FILE ----------
    if (data.type === "chat") {
      setPdfUrl(null);
      setNumPages(0);
      setHighlights([]);
      setChatHighlights(data.chat_highlights || []);
      setContext(null);
      setActiveAnnotationId(null);
      setSecondaryActiveAnnotationId(null);

      setActiveChatThreadId(data.active_thread_id);
      setAllMessages(data.messages || []);
      setVisibleMessages(data.messages || []);
      setSecondaryChatThreadId(null);
      setSecondaryFileId(null);
      setSecondaryFileTitle(null);
      setSecondaryPendingTitle(null);
      setSecondaryMessages([]);
      setSecondaryVisibleMessages([]);
      setSecondaryQuestion("");
      setSecondaryPanelOpen(false);
      return;
    }

    // ---------- PDF FILE ----------
    setPdfUrl(data.pdf_url);

    setActiveChatThreadId(data.active_thread_id);
    setAllMessages(data.messages || []);
    setVisibleMessages(data.messages || []);

    setHighlights(
      (data.annotations || [])
        .filter((a: any) => a.geometry)
        .map((a: any) => ({
          page: a.page_number,
          annotation_id: a.id,
          rect: a.geometry,
        }))
    );
    setChatHighlights(data.chat_highlights || []);
    setSecondaryChatThreadId(null);
    setSecondaryFileId(null);
    setSecondaryFileTitle(null);
    setSecondaryPendingTitle(null);
    setSecondaryMessages([]);
    setSecondaryVisibleMessages([]);
    setSecondaryQuestion("");
    setSecondaryActiveAnnotationId(null);
    setSecondaryPanelOpen(false);
  }


  /* ---------------- Upload PDF ---------------- */

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.[0]) return;

    const formData = new FormData();
      formData.append("file", event.target.files[0]);

      if (currentFolderId !== null) {
        formData.append("folder_id", String(currentFolderId));
      }

    const res = await fetch("http://localhost:8000/upload", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      console.error("Upload failed");
      return;
    }

    const data = await res.json();

    if (!data?.file_id) return;

    setFiles(prev => [
      {
        id: data.file_id,
        title: data.title,
        folder_id: currentFolderId,
      },
      ...prev,
    ]);


    activeFileVersionRef.current += 1;

    setActiveFileId(data.file_id);
    setContext(null);
    setActiveAnnotationId(null);
    setQuestion("");

  }

  // Folder Icon 
  function FolderIcon({ size = 16 }: { size?: number }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ marginRight: 6 }}
      >
        <path d="M3 7h5l2 2h11v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      </svg>
    );
  }

  // File Icon
  function FileIcon({ size = 14 }: { size?: number }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        xmlns="http://www.w3.org/2000/svg"
        style={{ marginRight: 6, opacity: 0.7 }}
      >
        <line x1="3" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1" />
        <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1" />
        <line x1="3" y1="11" x2="10" y2="11" stroke="currentColor" strokeWidth="1" />
      </svg>
    );
  }

  function ChatIcon({ size = 14 }: { size?: number }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ marginRight: 6, opacity: 0.7 }}
      >
        <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      </svg>
    );
  }



  /* ---------------- Delete Folder ---------------- */
  async function deleteFolder(folderId: number) {
    const ok = confirm("Delete this folder and all its contents?");
    if (!ok) return;

    const res = await fetch(`http://localhost:8000/folders/${folderId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      alert("Failed to delete folder");
      return;
    }

    // Remove folder
    setFolders(prev => prev.filter(f => f.id !== folderId));

    // Find files inside this folder
    const removedFiles = files.filter(f => f.folder_id === folderId);

    // Remove those files from sidebar
    setFiles(prev => prev.filter(f => f.folder_id !== folderId));

    // If active file was inside deleted folder → reset UI
    if (activeFileId && removedFiles.some(f => f.id === activeFileId)) {
      activeFileVersionRef.current += 1;

      setActiveFileId(null);
      setPdfUrl(null);
      setAllMessages([]);
      setVisibleMessages([]);
      setHighlights([]);
      setChatThreads([]);
      setContext(null);
      setActiveAnnotationId(null);
      setActiveChatThreadId(null);
      setActiveFileTitle(null);
      setActiveFileFolderId(null);
      setSecondaryChatThreadId(null);
      setSecondaryFileId(null);
      setSecondaryFileTitle(null);
      setSecondaryPendingTitle(null);
      setSecondaryMessages([]);
      setSecondaryVisibleMessages([]);
      setSecondaryQuestion("");
      setSecondaryActiveAnnotationId(null);
      setSecondaryPanelOpen(false);
    }

    // If user is currently inside the deleted folder → go up
    if (currentFolderId === folderId) {
      const prevId = folderStack.at(-1) ?? null;
      setCurrentFolderId(prevId);
      setFolderStack(prev => prev.slice(0, -1));
    }
  }


  async function activateAnnotation(
    annotationId: number,
    panelId: "primary" | "secondary"
  ) {
    const annotation = await fetchAnnotation(annotationId);
    if (!annotation) return;

    const isSecondary = panelId === "secondary";
    const containerRef = isSecondary
      ? secondaryMessagesContainerRef.current
      : messagesContainerRef.current;
    if (containerRef) {
      if (isSecondary) {
        secondaryLastFullChatScrollTopRef.current = containerRef.scrollTop;
      } else {
        lastFullChatScrollTopRef.current = containerRef.scrollTop;
      }
    }

    if (isSecondary) {
      setSecondaryActiveAnnotationId(annotationId);
    } else {
      setActiveAnnotationId(annotationId);
    }

    const threadId = isSecondary ? secondaryChatThreadId : activeChatThreadId;
    if (!threadId) return;

    let baseMessages = isSecondary ? secondaryMessages : allMessages;
    if ((isSecondary ? secondaryChatThreadId : activeChatThreadId) !== threadId) {
      const loaded = await loadChatThreadMessages(threadId, panelId);
      if (loaded) {
        baseMessages = loaded;
      }
    }

    const filtered = baseMessages.filter(
      m => m.annotation_id === annotationId
    );
    if (isSecondary) {
      setSecondaryVisibleMessages(filtered);
    } else {
      setVisibleMessages(filtered);
    }

    const firstUser = filtered.find(m => m.role === "user" && m.id);
    if (firstUser?.id) {
      setTimeout(() => {
        const el = messageRefs.current[firstUser.id];
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
    }

    // 4. Scroll PDF (optional)
    if (annotation.page_number > 0) {
      scrollToPage(annotation.page_number);
    }
  }




  /* ---------------- Rename PDF File ---------------- */
  async function renameFile(fileId: number, newTitle: string) {
    if (!newTitle.trim()) return;

    await fetch(`http://localhost:8000/files/${fileId}/rename`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });

    // Update sidebar state
    setFiles(prev =>
      prev.map(f =>
        f.id === fileId ? { ...f, title: newTitle } : f
      )
    );

    // Update header if this file is active
    if (activeFileId === fileId) {
      setActiveFileTitle(newTitle);
    }
  }

    /* ---------------- Delete PDF File ---------------- */
  async function deleteFile(fileId: number) {
    const ok = confirm("Delete this file permanently?");
    if (!ok) return;

    const res = await fetch(`http://localhost:8000/files/${fileId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      alert("Failed to delete file");
      return;
    }

    // Remove from sidebar
    setFiles(prev => prev.filter(f => f.id !== fileId));

    // If deleting the active file, clear UI state
    if (activeFileId === fileId) {
      activeFileVersionRef.current += 1;

      setActiveFileId(null);
      setPdfUrl(null);

      setAllMessages([]);
      setVisibleMessages([]);
      setHighlights([]);
      setChatThreads([]);

      setContext(null);
      setActiveAnnotationId(null);
      setActiveChatThreadId(null);
      setActiveFileTitle(null);
    }
  }

  /* ---------------- Create Folder ---------------- */
  async function createFolder() {
    const name = prompt("Folder name");
    if (!name) return;

    const res = await fetch("http://localhost:8000/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        parent_id: currentFolderId,
      }),
    });

    if (!res.ok) {
      alert("Failed to create folder");
      return;
    }

    const folder = await res.json();
    setFolders(prev => [...prev, folder]);
  }

  /* ---------------- Rename Folder ---------------- */
  async function renameFolder(folderId: number, newName: string) {
    if (!newName.trim()) return;

    await fetch(`http://localhost:8000/folders/${folderId}/rename`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newName }),
    });

    setFolders(prev =>
      prev.map(f =>
        f.id === folderId ? { ...f, name: newName } : f
      )
    );

    if (currentFolderId === folderId) {
      setCurrentFolderName(newName);
    }
  }

  /* ---------------- Centralize chat switching ---------------- */
  async function switchToThread(threadId: number) {
    setActiveChatThreadId(threadId);
    await loadChatThreadMessages(threadId, "primary");
  }

  function getSelectionOffsets(container: HTMLElement, range: Range) {
    if (!container.contains(range.startContainer)) return null;
    if (!container.contains(range.endContainer)) return null;

    const getOffsetAt = (node: Node, offset: number) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT
        );
        let current = walker.nextNode();
        let total = 0;

        while (current) {
          if (current === node) {
            return total + Math.min(offset, current.textContent?.length ?? 0);
          }
          total += current.textContent?.length ?? 0;
          current = walker.nextNode();
        }

        return null;
      }

      const boundary = document.createRange();
      boundary.setStart(node, offset);
      boundary.setEnd(node, offset);

      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT
      );
      let current = walker.nextNode();
      let total = 0;

      while (current) {
        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(current);

        if (boundary.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0) {
          total += current.textContent?.length ?? 0;
          current = walker.nextNode();
          continue;
        }

        return total;
      }

      return total;
    };

    const start = getOffsetAt(range.startContainer, range.startOffset);
    const end = getOffsetAt(range.endContainer, range.endOffset);

    if (start === null || end === null || end <= start) return null;
    return { start, end };
  }


  /* ---------------- Delete-annotation handler ---------------- */
  async function deleteAnnotation(
    annotationId: number,
    panelId: "primary" | "secondary"
  ) {
    const ok = confirm("Delete this highlight and its conversation?");
    if (!ok) return;

    const res = await fetch(
      `http://localhost:8000/annotations/${annotationId}`,
      { method: "DELETE" }
    );

    if (!res.ok) {
      alert("Failed to delete highlight");
      return;
    }

    // Remove highlight from PDF
    setHighlights(prev =>
      prev.filter(h => h.annotation_id !== annotationId)
    );
    setChatHighlights(prev =>
      prev.filter(h => h.annotation_id !== annotationId)
    );

    // Exit annotation mode
    if (panelId === "secondary") {
      setSecondaryActiveAnnotationId(null);
    } else {
      setActiveAnnotationId(null);
    }
    setContext(null);
    await backToFullConversation(panelId);

  }

  const visibleFolders = folders.filter(f =>
    currentFolderId === null
      ? f.parent_id === null
      : f.parent_id === currentFolderId
  );

  const visibleFiles = files.filter(f =>
    currentFolderId === null
      ? f.folder_id === null
      : f.folder_id === currentFolderId
  );

  const currentFolder = currentFolderId
    ? folders.find(f => f.id === currentFolderId)
    : null;


  /* ---------------- Text selection ---------------- */

  useEffect(() => {
    if (regionMode) return;

    function handleSelectionChange() {
      if (isClickingPopupRef.current) return;

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        // ignore collapse caused by mouseup right after selection
        if (justOpenedPopupRef.current) {
          return;
        }

        setPopupMode(null);
        hidePopup();
        return;
      }

      const text = sel.toString().trim();
      if (!text) return;

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const container = range.commonAncestorContainer as HTMLElement;

      const rangeNode = range.commonAncestorContainer;

      const messageEl =
        rangeNode instanceof HTMLElement
          ? rangeNode.closest("[data-chat-message]")
          : rangeNode.parentElement?.closest("[data-chat-message]") ?? null;


      const isChatSelection = Boolean(messageEl);


      // ---------------- CHAT TEXT ----------------
      if (isChatSelection) {
        setPopupMode("chat");

        pendingTextRef.current = {
          type: "text",
          text,
          page: -1,
        };

        const messageIndex = Number(
          messageEl?.getAttribute("data-message-index")
        );
        const panelIdAttr = messageEl?.getAttribute("data-chat-panel-id");
        const panelId: "primary" | "secondary" =
          panelIdAttr === "secondary" ? "secondary" : "primary";
        const rawMessageId = messageEl?.getAttribute("data-message-id");
        if (!rawMessageId) {
          return;
        }
        const messageId = Number(rawMessageId);

        const panelMessages =
          panelId === "secondary" ? secondaryVisibleMessages : visibleMessages;

        if (Number.isNaN(messageIndex) || !panelMessages[messageIndex]) {
          return;
        }

        if (Number.isNaN(messageId)) {
          return;
        }

        const offsets = getSelectionOffsets(messageEl, range);
        if (offsets) {
          pendingChatHighlightRef.current = {
            messageId,
            start: offsets.start,
            end: offsets.end,
            panelId,
          };
        }

        pendingTextRectRef.current = rect;
        showPopup(rect);

        // CRITICAL: stop processing permanently for this selection
        return;
      }



      // ---------------- PDF TEXT ----------------
      const pageEl = range.startContainer.parentElement?.closest(
        "[data-page-number]"
      );

      if (!pageEl && !isChatSelection) {
        // Not PDF, not chat → do nothing, but DO NOT override popup mode
        hidePopup();
        setPopupMode(null);

        return;
      }

      const pageNum = Number(pageEl.getAttribute("data-page-number"));

      pendingTextRef.current = {
        type: "text",
        text,
        page: pageNum,
      };

      pendingTextRectRef.current = rect;
      setPopupMode("pdf");

      showPopup(rect);
    }



    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, [regionMode, visibleMessages, secondaryVisibleMessages]);

  function showPopup(rect: DOMRect) {
    if (!popupRef.current) return;

    justOpenedPopupRef.current = true;

    popupRef.current.style.display = "block";
    popupRef.current.style.top = `${rect.top + window.scrollY - 40}px`;
    popupRef.current.style.left = `${rect.left + window.scrollX}px`;

    // allow collapse events AFTER this tick
    setTimeout(() => {
      justOpenedPopupRef.current = false;
    }, 0);
  }

  function hidePopup() {
    if (!popupRef.current) return;
    popupRef.current.style.display = "none";
  }

  async function handlePopupConfirm() {
    isClickingPopupRef.current = true;

    if (!pendingTextRef.current) {
      isClickingPopupRef.current = false;
      return;
    }

    const ctx = pendingTextRef.current;
    const action = pendingChatActionRef.current;

    async function createNewChatThread(
      fileId: number,
      annotationId?: number
    ) {
      const res = await fetch("http://localhost:8000/chat/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: fileId,
          source_annotation_id: annotationId ?? null,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to create chat thread");
      }

      return res.json(); // { id, file_id, annotation_id, ... }
    }

    try {
      // ===============================
      // CHAT TEXT (selection from chat)
      // ===============================
      if (ctx.page === -1) {
        const highlight = pendingChatHighlightRef.current;
        if (!highlight) {
          cleanupPopup();
          return;
        }
        const targetFileId =
          highlight.panelId === "secondary" ? secondaryFileId : activeFileId;
        if (!targetFileId) {
          cleanupPopup();
          return;
        }

        const res = await fetch("http://localhost:8000/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_id: targetFileId,
            page_number: -1,
            type: "chat_text",
            text: ctx.text,
            message_id: highlight.messageId,
            start: highlight.start,
            end: highlight.end,
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to create chat-text annotation");
        }

        const data = await res.json();

        setChatHighlights(prev => [
          ...prev,
          {
            annotation_id: data.annotation_id,
            message_id: highlight.messageId,
            start: highlight.start,
            end: highlight.end,
          },
        ]);


        if (action === "new") {
          const title = cleanChatTitle(ctx.text);
          setSecondaryPanelOpen(true);
          setSecondaryChatThreadId(null);
          setSecondaryFileId(null);
          setSecondaryFileTitle(null);
          setSecondaryPendingTitle(title);
          setSecondaryMessages([]);
          setSecondaryVisibleMessages([]);
          setSecondaryQuestion(`Explain "${ctx.text}"`);
          setSecondaryActiveAnnotationId(data.annotation_id);
        } else {
          if (highlight.panelId === "secondary") {
            setSecondaryQuestion(`Explain "${ctx.text}"`);
            setSecondaryActiveAnnotationId(data.annotation_id);
          } else {
            setQuestion(`Explain "${ctx.text}"`);
            setActiveAnnotationId(data.annotation_id);
          }
        }

        cleanupPopup();
        return;
      }

      // ===============================
      // PDF TEXT (selection from PDF)
      // ===============================
      const rect = pendingTextRectRef.current;
      const pageEl = pageRefs.current[ctx.page];

      if (!rect || !pageEl) {
        cleanupPopup();
        return;
      }

      const pageRect = pageEl.getBoundingClientRect();

      const geometry = {
        x: (rect.left - pageRect.left) / pageRect.width,
        y: (rect.top - pageRect.top) / pageRect.height,
        width: rect.width / pageRect.width,
        height: rect.height / pageRect.height,
      };

      const res = await fetch("http://localhost:8000/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: activeFileId,
          page_number: ctx.page,
          type: "text",
          geometry,
          text: ctx.text,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to create annotation");
      }

      const data = await res.json();

      // Always add highlight visually
      setHighlights(prev => [
        ...prev,
        {
          page: ctx.page,
          annotation_id: data.annotation_id,
          rect: geometry,
        },
      ]);

      setActiveAnnotationId(data.annotation_id);
      setContext({
        type: "text",
        text: ctx.text,
        page: ctx.page,
      });

      if (action === "new") {
        const thread = await createNewChatThread(
          activeFileId,
          data.annotation_id
        );

        await loadChatThreads(activeFileId);
        
        setActiveChatThreadId(thread.id);
        setActiveAnnotationId(data.annotation_id);
        setContext({
          type: "text",
          text: ctx.text,
          page: ctx.page,
        });

      } else {
        // Attach to document chat thread
        const docThread = chatThreads.find(
          t => t.source_annotation_id === null
        );

        if (docThread) {
          setActiveChatThreadId(docThread.id);
        }

        setActiveAnnotationId(data.annotation_id);
      }

      cleanupPopup();
    } catch (err) {
      console.error(err);
      cleanupPopup();
    }
  }



  function cleanupPopup() {
    pendingTextRef.current = null;
    pendingTextRectRef.current = null;
    pendingChatHighlightRef.current = null;
    setPopupMode(null);
    pendingChatActionRef.current = "current";
    hidePopup();
    window.getSelection()?.removeAllRanges();

    setTimeout(() => {
      isClickingPopupRef.current = false;
    }, 0);
  }


  /* ---------------- Region upload ---------------- */

  async function uploadRegion(
    pageNumber: number,
    rect: DragRect,
    pageContainer: HTMLElement
  ) {
    if (!activeFileId) return;

    const pageWidth = pageContainer.clientWidth;
    const pageHeight = pageContainer.clientHeight;

    const normalizedRect = {
      x: rect.x / pageWidth,
      y: rect.y / pageHeight,
      width: rect.width / pageWidth,
      height: rect.height / pageHeight,
    };

    // existing image upload (unchanged)
    const canvas = pageContainer.querySelector("canvas");
    if (!canvas) return;

    const scaleX = canvas.width / pageWidth;
    const scaleY = canvas.height / pageHeight;

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = rect.width * scaleX;
    cropCanvas.height = rect.height * scaleY;

    const ctx = cropCanvas.getContext("2d")!;
    ctx.drawImage(
      canvas,
      rect.x * scaleX,
      rect.y * scaleY,
      rect.width * scaleX,
      rect.height * scaleY,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
    );

    const blob = await new Promise<Blob>((resolve) =>
      cropCanvas.toBlob(b => resolve(b!), "image/png")
    );

    const formData = new FormData();
    formData.append("region", blob);
    formData.append("file_id", String(activeFileId));
    formData.append("page_number", String(pageNumber));
    formData.append("geometry", JSON.stringify(normalizedRect));

    const res = await fetch("http://localhost:8000/upload-region", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    setHighlights(prev => [
      ...prev,
      {
        page: pageNumber,
        annotation_id: data.annotation_id, 
        rect: normalizedRect,
      },
    ]);

    setActiveAnnotationId(data.annotation_id);

    setContext({
      type: "image",
      region_id: data.region_id,
      page_number: pageNumber,
    });
  }

  /* ---------------- Ask backend ---------------- */

  async function askQuestion(panelId: "primary" | "secondary" = "primary") {
    const isSecondary = panelId === "secondary";
    let threadId = isSecondary ? secondaryChatThreadId : activeChatThreadId;
    let createdFileId: number | null = null;

    if (!isSecondary && !threadId) {
      const docThread = chatThreads.find(t => t.source_annotation_id === null);
      if (!docThread) return;
      threadId = docThread.id;
      setActiveChatThreadId(threadId);
    }

    if (isSecondary && !threadId) {
      try {
        const title = secondaryPendingTitle ?? "New Chat";
        const data = await createStandaloneChat(title);
        threadId = data.thread_id;
        createdFileId = data.file_id;
        setSecondaryChatThreadId(threadId);
        setSecondaryFileId(data.file_id);
        setSecondaryFileTitle(data.title ?? title);
        setSecondaryPendingTitle(null);
        setSecondaryPanelOpen(true);
        setFiles(prev => [
          {
            id: data.file_id,
            title: data.title ?? title,
            folder_id: activeFileFolderId,
          },
          ...prev,
        ]);
      } catch (err) {
        console.error(err);
        return;
      }
    }

    const currentQuestion = isSecondary ? secondaryQuestion : question;
    const currentAnnotationId = isSecondary
      ? secondaryActiveAnnotationId
      : activeAnnotationId;

    const userMsg: ChatMsg = {
      role: "user",
      content: currentQuestion || "Explain this in simple terms.",
      annotation_id: currentAnnotationId ?? undefined,
    };

    const setMessages = isSecondary ? setSecondaryMessages : setAllMessages;
    const setVisible = isSecondary
      ? setSecondaryVisibleMessages
      : setVisibleMessages;
    const setQ = isSecondary ? setSecondaryQuestion : setQuestion;
    const setLoad = isSecondary ? setSecondaryLoading : setLoading;

    setMessages(prev => [...prev, userMsg]);
    setVisible(prev => [...prev, userMsg]);
    setQ("");
    setLoad(true);

    const fileIdForPanel = isSecondary
      ? secondaryFileId ?? createdFileId
      : activeFileId;
    if (!fileIdForPanel) {
      setLoad(false);
      return;
    }

    const body = fileIdForPanel
      ? {
          file_id: fileIdForPanel,
          chat_thread_id: threadId,
          annotation_id: currentAnnotationId,
          question: userMsg.content,
        }
      : {
          chat_thread_id: threadId,
          annotation_id: currentAnnotationId,
          question: userMsg.content,
        };

    const res = await fetch("http://localhost:8000/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    const assistantMsg: ChatMsg = {
      id: data.assistant_message_id,
      role: "assistant",
      content: data.answer,
      annotation_id: currentAnnotationId ?? undefined,
    };

    setMessages(prev => [...prev, assistantMsg]);

    setVisible(prev =>
      currentAnnotationId
        ? assistantMsg.annotation_id === currentAnnotationId
          ? [...prev, assistantMsg]
          : prev
        : [...prev, assistantMsg]
    );

    if (data.user_message_id) {
      setMessages(prev =>
        prev.map(msg =>
          msg.role === "user" &&
          msg.content === userMsg.content &&
          msg.annotation_id === userMsg.annotation_id &&
          msg.id === undefined
            ? { ...msg, id: data.user_message_id }
            : msg
        )
      );
      setVisible(prev =>
        prev.map(msg =>
          msg.role === "user" &&
          msg.content === userMsg.content &&
          msg.annotation_id === userMsg.annotation_id &&
          msg.id === undefined
            ? { ...msg, id: data.user_message_id }
            : msg
        )
      );
    }

    setLoad(false);
  }


  async function loadChatThreadMessages(
    threadId: number,
    panelId: "primary" | "secondary"
  ) {
    const versionAtCall = activeFileVersionRef.current;

    const res = await fetch(
      `http://localhost:8000/chat/thread/${threadId}`
    );
    if (!res.ok) return;

    if (versionAtCall !== activeFileVersionRef.current) return;

    const data = await res.json();
    const messages = data.messages || [];
    if (panelId === "secondary") {
      setSecondaryMessages(messages);
      setSecondaryVisibleMessages(messages);
    } else {
      setAllMessages(messages);
      setVisibleMessages(messages);
    }
    return messages;
  }



  async function loadChatThreads(fileId: number) {
    const versionAtCall = activeFileVersionRef.current;

    const res = await fetch(
      `http://localhost:8000/chat/threads?file_id=${fileId}`
    );
    if (!res.ok) return;

    if (versionAtCall !== activeFileVersionRef.current) return;

    const data = await res.json();
    const threads = data.threads || [];

    const docThread = threads.find(t => t.source_annotation_id === null);
    if (!docThread) return;

    setChatThreads(threads);
    setActiveChatThreadId(docThread.id);
  }

  const showSecondaryChat = secondaryPanelOpen;

  function renderChatPanel(panelId: "primary" | "secondary") {
    const isSecondary = panelId === "secondary";
    const panelTitle = isSecondary
      ? secondaryFileTitle ?? secondaryPendingTitle ?? "New Chat"
      : activeFileTitle ?? "Conversation";
    const panelMessages = isSecondary ? secondaryVisibleMessages : visibleMessages;
    const panelQuestion = isSecondary ? secondaryQuestion : question;
    const panelLoading = isSecondary ? secondaryLoading : loading;
    const panelActiveAnnotationId = isSecondary
      ? secondaryActiveAnnotationId
      : activeAnnotationId;
    const panelThreadId = isSecondary
      ? secondaryChatThreadId
      : activeChatThreadId;
    const setPanelQuestion = isSecondary ? setSecondaryQuestion : setQuestion;
    const panelContainerRef = isSecondary
      ? secondaryMessagesContainerRef
      : messagesContainerRef;

    return (
      <div
        key={panelId}
        data-chat-panel-id={panelId}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
          minWidth: 0,
          borderLeft: isSecondary ? "1px solid #eee" : "none",
          paddingLeft: isSecondary ? "1rem" : 0,
        }}
      >
        {/* Header wrapper */}
        <div
          style={{
            padding: "1rem",
            borderBottom: "1px solid #eee",
          }}
        >
          <h3
            style={{
              margin: 0,
              display: "flex",
              justifyContent: "space-between",
              fontSize: "1.4rem",
              alignItems: "center",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {pdfUrl === null && panelId === "primary" && (
                <button
                  onClick={() => setSidebarOpen(v => !v)}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    lineHeight: 0,
                    color: "#666",
                  }}
                  aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
                >
                  <svg
                    width="34"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {sidebarOpen ? (
                      <>
                        <path d="M15 6l-6 6 6 6" />
                        <path d="M19 6l-6 6 6 6" />
                      </>
                    ) : (
                      <>
                        <path d="M9 6l6 6-6 6" />
                        <path d="M5 6l6 6-6 6" />
                      </>
                    )}
                  </svg>
                </button>
              )}
              {panelTitle}
            </span>

            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              {panelActiveAnnotationId && (
                <button
                  onClick={() => backToFullConversation(panelId)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#555",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  &larr; Back to full conversation
                </button>
              )}

              {panelActiveAnnotationId && (
                <button
                  onClick={() =>
                    deleteAnnotation(panelActiveAnnotationId, panelId)
                  }
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#ff6b6b",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Delete highlight
                </button>
              )}
            </div>
          </h3>
        </div>

        {/* Messages */}
        <div
          ref={panelContainerRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "1rem",
          }}
        >
          {panelMessages.map((m, i) => (
            <div
              key={`${m.role}-${m.id ?? i}-${m.annotation_id ?? "doc"}`}
              ref={el => {
                if (!m.id) return;
                messageRefs.current[m.id] = el;
              }}
            >
              <ChatMessage
                role={m.role}
                content={m.content}
                messageId={m.id}
                messageIndex={i}
                panelId={panelId}
                activeAnnotationId={panelActiveAnnotationId}
                highlights={chatHighlights.filter(
                  h => h.message_id === m.id
                )}
                onClick={
                  m.role === "user" && m.annotation_id
                    ? () => activateAnnotation(m.annotation_id, panelId)
                    : undefined
                }
                onHighlightClick={(annotationId) => {
                  activateAnnotation(annotationId, panelId);
                }}
              />
            </div>
          ))}
        </div>

        {/* Input */}
        <div
          style={{
            padding: "1rem",
            background: "transparent",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <textarea
            value={panelQuestion}
            onChange={(e) => setPanelQuestion(e.target.value)}
            style={{
              width: "96%",
              height: "80px",
              borderRadius: UI_RADIUS,
              border: "1px solid #ddd",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              background: "#fff",
              padding: "10px",
              resize: "none",
              outline: "none",
            }}
          />

          <button
            onClick={() => askQuestion(panelId)}
            disabled={panelLoading || (!panelThreadId && !isSecondary)}
            style={{
              marginTop: "0.5rem",
              width: "96%",
              borderRadius: UI_RADIUS,
              padding: "10px 0",
              border: "1px solid #ddd",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {panelLoading ? (
              "Thinking..."
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 19V5" />
                <path d="M5 12l7-7 7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    );
  }


  /* ---------------- UI ---------------- */
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden", // ← critical
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: sidebarOpen ? Math.max(180, sidebarWidth - 16) : 0,
          height: sidebarOpen ? "calc(100% - 16px)" : "100%",
          margin: sidebarOpen ? "8px 0 8px 8px" : "0",
          overflowY: "auto",
          overflowX: "hidden",
          transition: "width 0.2s ease",
          border: sidebarOpen ? "1px solid #ddd" : "none",
          borderRadius: "12px",
          boxShadow: sidebarOpen ? "0 4px 12px rgba(0,0,0,0.08)" : "none",
          background: "#fff",
          boxSizing: "border-box",
        }}
      >
        
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={handleUpload}
          />

        {/* Sidebar header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px",
            borderBottom: "1px solid #333",
            fontWeight: 600,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {currentFolderId !== null && (
              <span
                style={{ cursor: "pointer" }}
                onClick={() => {
                  const prevId = folderStack.at(-1) ?? null;
                  setCurrentFolderId(prevId);
                  setFolderStack(prev => prev.slice(0, -1));

                  if (prevId === null) {
                    setCurrentFolderName(null); // back to Home
                  } else {
                    const prevFolder = folders.find(f => f.id === prevId);
                    setCurrentFolderName(prevFolder?.name ?? null);
                  }
                }}
              >
                ←
              </span>
            )}

            <span>{currentFolderName ?? "Home"}</span>
          </div>

          <span
            style={{ cursor: "pointer" }}
            onClick={() => setAddMenuOpen(v => !v)}
          >
            +
          </span>
        </div>

        {addMenuOpen && (
          <div
            style={{
              padding: "6px",
              borderBottom: "1px solid #c7dcff",
              background: "#e6f0ff",
              borderRadius: "6px",
              margin: "6px",
            }}
          >

            <div
              style={{ padding: "6px", cursor: "pointer" }}
              onClick={() => {
                setAddMenuOpen(false);
                fileInputRef.current?.click();
              }}
            >
              <FileIcon />
              <span>PDF</span>
            </div>

            <div
              style={{ padding: "6px", cursor: "pointer" }}
              onClick={() => {
                setAddMenuOpen(false);
                createFolder();
              }}
            >
              <FolderIcon />
              <span>Folder</span>
            </div>

            <div
              style={{ padding: "6px", cursor: "pointer" }}
              onClick={async () => {
                setAddMenuOpen(false);

                activeFileVersionRef.current += 1;

                const res = await fetch("http://localhost:8000/chat/standalone", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    folder_id: currentFolderId,
                  }),
                });

                if (!res.ok) return;

                const data = await res.json();

                // Add to sidebar
                setFiles(prev => [
                  {
                    id: data.file_id,
                    title: data.title,
                    folder_id: currentFolderId,
                  },
                  ...prev,
                ]);

                // Reset UI
                setPdfUrl(null);
                setNumPages(0);
                setHighlights([]);
                setContext(null);
                setActiveAnnotationId(null);

                // Activate chat file
                setActiveFileId(data.file_id);
              }}

            >
              <ChatIcon />
              <span>Chat</span>
            </div>

          </div>
        )}

        {/* Folders */}
          {visibleFolders.map(folder => (
            <div
              key={folder.id}
              data-folder-row
              style={{
                position: "relative",
                padding: "8px",
                cursor: "pointer",
                fontWeight: 500,
                color: "#000",
                userSelect: "none",
              }}
              onMouseDown={() => {
                // If menu already open, do nothing
                if (folderActionsOpenId === folder.id) return;

                didTriggerHoldRef.current = false;

                folderHoldTimeoutRef.current = window.setTimeout(() => {
                  didTriggerHoldRef.current = true;
                  setFolderActionsOpenId(folder.id);
                }, 500); 
              }}
              onMouseUp={() => {
                // Cancel hold timer
                if (folderHoldTimeoutRef.current) {
                  clearTimeout(folderHoldTimeoutRef.current);
                  folderHoldTimeoutRef.current = null;
                }

                // If long-press triggered → do NOT open folder
                if (didTriggerHoldRef.current) return;

                // Normal click → open folder
                if (renamingFolderId === folder.id) return;
                if (folderActionsOpenId === folder.id) return;

                setFolderStack(prev =>
                  currentFolderId !== null ? [...prev, currentFolderId] : prev
                );
                setCurrentFolderId(folder.id);
                setCurrentFolderName(folder.name);
              }}
              onMouseLeave={() => {
                if (folderHoldTimeoutRef.current) {
                  clearTimeout(folderHoldTimeoutRef.current);
                  folderHoldTimeoutRef.current = null;
                }
              }}
            >
              {renamingFolderId === folder.id ? (
                <input
                  autoFocus
                  value={renameFolderValue}
                  onChange={e => setRenameFolderValue(e.target.value)}
                  onBlur={async () => {
                    await renameFolder(folder.id, renameFolderValue);
                    setRenamingFolderId(null);
                  }}
                  onKeyDown={async e => {
                    if (e.key === "Enter") {
                      await renameFolder(folder.id, renameFolderValue);
                      setRenamingFolderId(null);
                    }
                    if (e.key === "Escape") {
                      setRenamingFolderId(null);
                    }
                  }}
                />
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ display: "flex", alignItems: "center" }}>
                    <FolderIcon />
                    {folder.name}
                  </span>

                  {folderActionsOpenId === folder.id && (
                    <div
                      onClick={e => e.stopPropagation()}
                      style={{
                        position: "absolute",
                        right: "8px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        display: "flex",
                        alignItems: "center",
                        background: "#fff",
                        borderRadius: "8px",
                        padding: "6px 8px",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                        fontSize: "0.85rem",
                        zIndex: 50,
                      }}
                    >
                      {/* Rename */}
                      <span
                        style={{
                          padding: "2px 6px",
                          cursor: "pointer",
                          borderRadius: "4px",
                        }}
                        onClick={() => {
                          setRenamingFolderId(folder.id);
                          setRenameValue(folder.title);
                          setFolderActionsOpenId(null);
                        }}
                        onMouseEnter={e =>
                          (e.currentTarget.style.background = "#f5f5f5")
                        }
                        onMouseLeave={e =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        Rename
                      </span>

                      {/* Divider */}
                      <div
                        style={{
                          width: "1px",
                          height: "90%",
                          background: "#ddd",
                          margin: "0 6px",
                        }}
                      />

                      {/* Delete */}
                      <span
                        style={{
                          padding: "2px 6px",
                          cursor: "pointer",
                          color: "#e53935",
                          borderRadius: "4px",
                        }}
                        onClick={() => {
                          deleteFolder(folder.id);
                          setFolderActionsOpenId(null);
                        }}
                        onMouseEnter={e =>
                          (e.currentTarget.style.background = "#fdecea")
                        }
                        onMouseLeave={e =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        Delete
                      </span>
                    </div>
                  )}

                </div>
              )}
            </div>
          ))}


          {/* Files */}
          {visibleFiles.map(file => (
            <div
              className="file-row"
              key={file.id}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setFileActionsOpenId(prev =>
                  prev === file.id ? null : file.id
                );
              }}
              onClick={() => {
                if (renamingFileId === file.id) return;
                if (fileActionsOpenId === file.id) return;

                // EXIT standalone chat mode
                activeFileVersionRef.current += 1;

                setPdfUrl(null);
                setNumPages(0);
                setHighlights([]);
                setActiveAnnotationId(null);
                setContext(null);

                setActiveFileId(file.id);
              }}

              style={{
                position: "relative",
                padding: "8px",
                cursor: "pointer",
                background: file.id === activeFileId ? "#e5f0ff" : "transparent",
              }}
            >
              {renamingFileId === file.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={async () => {
                    await renameFile(file.id, renameValue);
                    setRenamingFileId(null);
                  }}
                  onKeyDown={async e => {
                    if (e.key === "Enter") {
                      await renameFile(file.id, renameValue);
                      setRenamingFileId(null);
                    }
                    if (e.key === "Escape") {
                      setRenamingFileId(null);
                    }
                  }}
                />
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ display: "flex", alignItems: "center" }}>
                    <FileIcon />
                    {file.title}
                  </span>


                  {fileActionsOpenId === file.id && (
                    <div
                      onClick={e => e.stopPropagation()}
                      style={{
                        position: "absolute",
                        right: "8px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        display: "flex",
                        alignItems: "center",
                        background: "#fff",
                        borderRadius: "8px",
                        padding: "6px 8px",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                        fontSize: "0.85rem",
                        zIndex: 50,
                      }}
                    >
                      {/* Rename */}
                      <span
                        style={{
                          padding: "2px 6px",
                          cursor: "pointer",
                          borderRadius: "4px",
                        }}
                        onClick={() => {
                          setRenamingFileId(file.id);
                          setRenameValue(file.title);
                          setFileActionsOpenId(null);
                        }}
                        onMouseEnter={e =>
                          (e.currentTarget.style.background = "#f5f5f5")
                        }
                        onMouseLeave={e =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        Rename
                      </span>

                      {/* Divider */}
                      <div
                        style={{
                          width: "1px",
                          height: "90%",
                          background: "#ddd",
                          margin: "0 6px",
                        }}
                      />

                      {/* Delete */}
                      <span
                        style={{
                          padding: "2px 6px",
                          cursor: "pointer",
                          color: "#e53935",
                          borderRadius: "4px",
                        }}
                        onClick={() => {
                          deleteFile(file.id);
                          setFileActionsOpenId(null);
                        }}
                        onMouseEnter={e =>
                          (e.currentTarget.style.background = "#fdecea")
                        }
                        onMouseLeave={e =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        Delete
                      </span>
                    </div>
                  )}

                </div>
              )}
            </div>
          ))}

        </div>

      {sidebarOpen && (
        <div
          onMouseDown={() => setIsResizingSidebar(true)}
          style={{
            width: DIVIDER_WIDTH,
            cursor: "col-resize",
            background: "transparent",
            userSelect: "none",
          }}
        />
      )}

    {pdfUrl !== null && (
      <div
        style={{
          width: `${100 - chatWidth}%`,
          height: "100%",
          padding: "1rem",
          overflow: "auto",
          minHeight: 0,
        }}
      >
        {/* PDF Viewer */}
        <button
          onClick={() => setSidebarOpen(v => !v)}
          style={{
            marginBottom: "0.5rem",
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            lineHeight: 0,
            color: "#666",
          }}
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          <svg
            width="34"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {sidebarOpen ? (
              <>
                <path d="M15 6l-6 6 6 6" />
                <path d="M19 6l-6 6 6 6" />
              </>
            ) : (
              <>
                <path d="M9 6l6 6-6 6" />
                <path d="M5 6l6 6-6 6" />
              </>
            )}
          </svg>
        </button>
        <div
          ref={pdfContentRef}
          style={{ width: "100%" }}
        >
          <input
            type="range"
            min={0.6}
            max={2}
            step={0.05}
            value={pdfScale}
            onChange={(e) => setPdfScale(Number(e.target.value))}
            style={{
              width: "100%",
              marginBottom: "0.75rem",
              background: `linear-gradient(
                to right,
                #000 0%,
                #000 ${((pdfScale - 0.6) / (2 - 0.6)) * 100}%,
                #ccc ${((pdfScale - 0.6) / (2 - 0.6)) * 100}%,
                #ccc 100%
              )`,
            }}
          />
        </div>



        {pdfUrl && (
          <Document key={activeFileId} file={pdfUrl} onLoadSuccess={({ numPages }) => setNumPages(numPages)}>
            {Array.from({ length: numPages }, (_, i) => {
              const pageNumber = i + 1;
              const pageHighlights = highlights.filter(h => h.page === pageNumber);

              return (
                <div
                  key={pageNumber}
                  data-page-number={pageNumber}
                  ref={el => (pageRefs.current[pageNumber] = el)}
                  onDoubleClick={() => {
                    setRegionMode(true);
                    setActivePage(pageNumber);
                    setDragRect(null);
                  }}
                  style={{
                    position: "relative",
                    marginBottom: "1.5rem",
                    display: "inline-block",
                    boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
                    borderRadius: "8px",
                    background: "#fff",
                  }}
                >
                  {pdfContentWidth > 0 && (
                    <Page
                      pageNumber={pageNumber}
                      width={pdfContentWidth * PDF_INSET * pdfScale}
                      renderTextLayer
                      renderAnnotationLayer={false}
                    />
                  )}

                 {/* Visual highlight */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      pointerEvents: "none",
                      zIndex: 5,
                    }}
                  >
                    {pageHighlights.map(h => (
                      <div
                        key={`visual-${h.annotation_id}`}
                        style={{
                          position: "absolute",
                          left: `${h.rect.x * 100}%`,
                          top: `${h.rect.y * 100}%`,
                          width: `${h.rect.width * 100}%`,
                          height: `${h.rect.height * 100}%`,
                          background:
                            h.annotation_id === activeAnnotationId
                              ? "rgba(0,112,243,0.08)"
                              : "rgba(255, 235, 59, 0.18)",
                          borderRadius: "10px",
                        }}
                      />
                    ))}
                  </div>

                  {/* Click hitboxes */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      pointerEvents: "none",
                      zIndex: 20, // 👈 higher than everything else
                    }}
                  >
                    {pageHighlights.map(h => (
                      <div
                        key={`hit-${h.annotation_id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          activateAnnotation(h.annotation_id, "primary");
                        }}
                        style={{
                          position: "absolute",
                          left: `${h.rect.x * 100}%`,
                          top: `${h.rect.y * 100}%`,
                          width: `${h.rect.width * 100}%`,
                          height: `${h.rect.height * 100}%`,
                          pointerEvents: "auto",
                          cursor: "pointer",
                        }}
                      />
                    ))}
                  </div>


                  {regionMode && activePage === pageNumber && (
                    <div
                      onMouseDown={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setDragStart({
                          x: e.clientX - r.left,
                          y: e.clientY - r.top,
                        });
                      }}
                      onMouseMove={(e) => {
                        if (!dragStart) return;
                        const r = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX - r.left;
                        const y = e.clientY - r.top;

                        setDragRect({
                          x: Math.min(dragStart.x, x),
                          y: Math.min(dragStart.y, y),
                          width: Math.abs(x - dragStart.x),
                          height: Math.abs(y - dragStart.y),
                        });
                      }}
                      onMouseUp={async (e) => {
                        if (dragRect) {
                          await uploadRegion(pageNumber, dragRect, e.currentTarget.parentElement!);
                        }
                        setRegionMode(false);
                        setDragStart(null);
                        setDragRect(null);
                      }}
                      style={{
                        position: "absolute",
                        inset: 0,
                        cursor: "crosshair",
                        zIndex: 10,
                      }}
                    >
                      {dragRect && (
                        <div
                          style={{
                            position: "absolute",
                            left: dragRect.x,
                            top: dragRect.y,
                            width: dragRect.width,
                            height: dragRect.height,
                            border: "2px dashed #0070f3",
                            background: "rgba(0,112,243,0.15)",
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </Document>
        )}


      </div>
)}

      {/* Resize Handle */}
        <div
          onMouseDown={() => setIsResizing(true)}
          style={{
            width: "1.5px",
            cursor: "col-resize",
            background: "transparent",
            userSelect: "none",
          }}
        />

      {/* Chat Panels */}
      <div
        data-chat-panels
        style={{
          width: pdfUrl === null ? "100%" : `${chatWidth}%`,
          display: "flex",
          flexDirection: "row",
          height: "100%",
          overflow: "hidden",
          gap: showSecondaryChat ? "1rem" : 0,
        }}
      >
        {renderChatPanel("primary")}
        {showSecondaryChat && renderChatPanel("secondary")}
      </div>
      {!regionMode && (
          <div
            ref={popupRef}
            style={{
              position: "absolute",
              background: "#111",
              color: "#fff",
              padding: "6px",
              borderRadius: "6px",
              zIndex: 1000,
              fontSize: "0.85rem",
              display: "flex",
              gap: "6px",
            }}
          >
            {popupMode === "chat" && (
              <>
                <span
                  style={{ cursor: "pointer", padding: "4px 6px" }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pendingChatActionRef.current = "current";
                    handlePopupConfirm();
                  }}
                >
                  Current chat
                </span>

                <span style={{ opacity: 0.4 }}>|</span>

                <span
                  style={{ cursor: "pointer", padding: "4px 6px" }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pendingChatActionRef.current = "new";
                    handlePopupConfirm();
                  }}
                >
                  New chat
                </span>
              </>
            )}

            {popupMode === "pdf" && (
              <span
                style={{ cursor: "pointer", padding: "4px 6px" }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handlePopupConfirm();
                }}
              >
                Add to chat
              </span>
            )}
          </div>
        )}
    </div>
  );
}
