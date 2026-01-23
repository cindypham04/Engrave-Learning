"use client";

// Main UI state and handlers for sidebar, chat panels, and PDF viewer.
import { Fragment, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

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
    mod.pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
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

type Rect = {
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
  annotation_id: number;
  type: "text" | "region" | "highlight";
  rects: Rect[];
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

  const mergeClientRectsByLine = (rawRects: DOMRect[], lineTolerance = 4) => {
    const rects = rawRects
      .filter(r => r.width > 0 && r.height > 0)
      .sort((a, b) => (a.top === b.top ? a.left - b.left : a.top - b.top));

    const lines: DOMRect[][] = [];

    for (const rect of rects) {
      const midY = (rect.top + rect.bottom) / 2;
      const line = lines.find(group => {
        const sample = group[0];
        const sampleMidY = (sample.top + sample.bottom) / 2;
        return Math.abs(sampleMidY - midY) <= lineTolerance;
      });

      if (line) {
        line.push(rect);
      } else {
        lines.push([rect]);
      }
    }

    return lines.map(group => {
      const left = Math.min(...group.map(r => r.left));
      const right = Math.max(...group.map(r => r.right));
      const top = Math.min(...group.map(r => r.top));
      const bottom = Math.max(...group.map(r => r.bottom));
      return new DOMRect(left, top, right - left, bottom - top);
    });
  };
  
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pdfReady, setPdfReady] = useState(false);
  const [pdfLoadedUrl, setPdfLoadedUrl] = useState<string | null>(null);

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
  const [hoveredPanelId, setHoveredPanelId] = useState<"primary" | "secondary" | null>(null);
  const [hoveredFileId, setHoveredFileId] = useState<number | null>(null);
  const [hoveredFolderId, setHoveredFolderId] = useState<number | null>(null);
  const [hoveredSendPanelId, setHoveredSendPanelId] = useState<"primary" | "secondary" | null>(null);
  const [hoveredChatDivider, setHoveredChatDivider] = useState(false);
  const [collapsedFileIds, setCollapsedFileIds] = useState<Set<number>>(new Set());
  const [pendingDeleteAnnotationId, setPendingDeleteAnnotationId] = useState<number | null>(null);
  const [pendingDeletePanelId, setPendingDeletePanelId] = useState<"primary" | "secondary" | null>(null);

  const popupRef = useRef<HTMLDivElement | null>(null);
  const pendingTextRef = useRef<TextContext | null>(null);

  // 🟡 Text: store raw DOM rect
  const pendingTextRectRef = useRef<DOMRect | null>(null);
  const pendingTextRectsRef = useRef<DOMRect[] | null>(null);

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
  const [pdfScale] = useState(1.0);

  // Chat width state
  const [chatWidth, setChatWidth] = useState(40); // percent
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
  const [hasUserResizedSidebar, setHasUserResizedSidebar] = useState(false);
  const MIN_SIDEBAR_WIDTH = 180;
  const MAX_SIDEBAR_WIDTH = 420;

  const PDF_INSET = 0.95;

  const folderHoldTimeoutRef = useRef<number | null>(null);
  const didTriggerHoldRef = useRef(false);
  const fileHoldTimeoutRef = useRef<number | null>(null);
  const didTriggerFileHoldRef = useRef(false);
  const pdfHighlightHoldTimerRef = useRef<number | null>(null);
  const pdfHighlightHoldFiredRef = useRef(false);
  const suppressPdfHighlightClickRef = useRef(false);

  // Diviver of panels
  const DIVIDER_COLOR = "#000";
  const DIVIDER_WIDTH = "1px";

  // Corners of the chat box
  const UI_RADIUS = 12;

  const pdfContentRef = useRef<HTMLDivElement | null>(null);
  const pdfScrollRef = useRef<HTMLDivElement | null>(null);
  const [pdfContentWidth, setPdfContentWidth] = useState(0);

  // User select current or new chat in the selected text in the chat
  const pendingChatActionRef = useRef<"current" | "new" | "highlight">("current");

  const [popupMode, setPopupMode] = useState<"chat" | "pdf" | null>(null);

  // Active chat thread state
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [activeChatThreadId, setActiveChatThreadId] = useState<number | null>(null);
  const [secondaryChatThreadId, setSecondaryChatThreadId] = useState<number | null>(null);

  // LLM response highlight state
  const [chatHighlights, setChatHighlights] = useState<ChatHighlight[]>([]);
  const [pendingDeleteAnchor, setPendingDeleteAnchor] = useState<{
    panelId: "primary" | "secondary";
    top: number;
    left: number;
  } | null>(null);

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

  useEffect(() => {
    function handleHoverClear(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest(".file-row") || target.closest("[data-folder-row]")) {
        return;
      }

      setHoveredFileId(null);
      setHoveredFolderId(null);
    }

    window.addEventListener("mousemove", handleHoverClear);
    return () => window.removeEventListener("mousemove", handleHoverClear);
  }, []);

  // Mouse listener
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isResizingSidebar) return;

      const newWidth = e.clientX;

      // Clamp so it stays usable
      const clamped = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, newWidth));
      setSidebarWidth(clamped);
    }

    function handleMouseUp() {
      if (isResizingSidebar) {
        setHasUserResizedSidebar(true);
      }
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
      setPdfReady(false);
      setPdfLoadedUrl(null);
    }
  }, [pdfUrl]);

  useEffect(() => {
    import("react-pdf").then(mod => {
      mod.pdfjs.GlobalWorkerOptions.workerSrc =
        "https://unpkg.com/pdfjs-dist@5.4.449/build/pdf.worker.min.js";
    });
  }, []);

  useEffect(() => {
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      if (
        typeof args[0] === "string" &&
        args[0].includes("AbortException: TextLayer task cancelled")
      ) {
        return;
      }
      originalWarn(...args);
    };

    return () => {
      console.warn = originalWarn;
    };
  }, []);

  useEffect(() => {
    if (!pdfUrl) {
      setPdfReady(false);
      setNumPages(0);
      setPdfLoadedUrl(null);
    }
  }, [pdfUrl]);



  /* ---------------- Helpers ---------------- */

  function scrollToPage(page: number) {
    // Scroll within the PDF panel without shifting the overall layout.
    const el = pageRefs.current[page];
    if (!el) return;

    const container = pdfScrollRef.current;
    if (!container) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const elementRect = el.getBoundingClientRect();
    const inView =
      elementRect.top >= containerRect.top + 8 &&
      elementRect.bottom <= containerRect.bottom - 8;

    if (inView) return;

    const offsetTop = el.offsetTop - 8;
    container.scrollTo({ top: offsetTop, behavior: "smooth" });
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

  function truncateSidebarTitle(title: string) {
    const words = title.trim().split(/\s+/).filter(Boolean);
    if (words.length <= 4) return title;
    return `${words.slice(0, 4).join(" ")}...`;
  }

  async function setTitleFromSelection() {
    if (!pendingTextRef.current) return;

    const rawText = pendingTextRef.current.text;
    const title = cleanChatTitle(rawText);

    let targetFileId: number | null = null;
    if (popupMode === "chat") {
      const highlight = pendingChatHighlightRef.current;
      if (!highlight) return;
      targetFileId =
        highlight.panelId === "secondary" ? secondaryFileId : activeFileId;
    } else if (popupMode === "pdf") {
      targetFileId = activeFileId;
    }

    if (!targetFileId) return;

    const res = await fetch(
      `http://localhost:8000/files/${targetFileId}/rename`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }
    );

    if (!res.ok) {
      alert("Failed to rename file");
      return;
    }

    setFiles(prev =>
      prev.map(f => (f.id === targetFileId ? { ...f, title } : f))
    );

    if (targetFileId === activeFileId) {
      setActiveFileTitle(title);
    }
    if (targetFileId === secondaryFileId) {
      setSecondaryFileTitle(title);
      setSecondaryPendingTitle(null);
    }

    cleanupPopup();
  }

  async function createStandaloneChat(title: string) {
    const res = await fetch("http://localhost:8000/chat/standalone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder_id: activeFileFolderId,
        title,
        source_annotation_id: secondaryActiveAnnotationId,
      }),
    });

    if (!res.ok) {
      throw new Error("Failed to create standalone chat");
    }

    return res.json();
  }

  async function fetchThreadByAnnotation(annotationId: number) {
    const res = await fetch(
      `http://localhost:8000/chat/thread/by-annotation/${annotationId}`
    );

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return data?.thread ?? null;
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
    setPendingDeleteAnnotationId(null);
    setPendingDeletePanelId(null);
    setPendingDeleteAnchor(null);

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

  useEffect(() => {
    function handleGlobalClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      if (
        target.closest("[data-annotation-id]") ||
        target.closest("[data-delete-annotation]")
      ) {
        return;
      }

      setPendingDeleteAnnotationId(null);
      setPendingDeletePanelId(null);
      setPendingDeleteAnchor(null);
    }

    document.addEventListener("click", handleGlobalClick);
    return () => document.removeEventListener("click", handleGlobalClick);
  }, []);


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
        .map((a: any) => {
          const geometry = a.geometry;
          let rects: Rect[] = [];

          if (Array.isArray(geometry)) {
            rects = geometry;
          } else if (geometry?.rects && Array.isArray(geometry.rects)) {
            rects = geometry.rects;
          } else if (geometry) {
            rects = [geometry];
          }

          return {
            page: a.page_number,
            annotation_id: a.id,
            type: a.type,
            rects,
          };
        })
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
        s3_key: "pdf",
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

  function ChatIcon({ size = 16 }: { size?: number }) {
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
        style={{ marginRight: 6, opacity: 0.7, position: "relative", top: "1px" }}
      >
        <rect x="3" y="4" width="18" height="12" rx="5" ry="5" />
        <path d="M9 16l-4 4v-4" />
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
    // Open the related chat thread and focus the PDF page if needed.
    setPendingDeleteAnnotationId(null);
    setPendingDeletePanelId(null);
    setPendingDeleteAnchor(null);
    const annotation = await fetchAnnotation(annotationId);
    if (!annotation) return;

    if (panelId === "primary") {
      const linked = await fetchThreadByAnnotation(annotationId);
      if (linked) {
        setSecondaryPanelOpen(true);
        setSecondaryChatThreadId(linked.id);
        setSecondaryFileId(linked.file_id);
        setSecondaryFileTitle(linked.file_title ?? linked.title ?? "New Chat");
        setSecondaryPendingTitle(null);
        setSecondaryActiveAnnotationId(annotationId);
        setSecondaryQuestion("");
        await loadChatThreadMessages(linked.id, "secondary");
        return;
      }
    }

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

  function closeSecondaryPanel() {
    setSecondaryPanelOpen(false);
    setSecondaryChatThreadId(null);
    setSecondaryFileId(null);
    setSecondaryFileTitle(null);
    setSecondaryPendingTitle(null);
    setSecondaryMessages([]);
    setSecondaryVisibleMessages([]);
    setSecondaryQuestion("");
    setSecondaryActiveAnnotationId(null);
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

    fetch("http://localhost:8000/files")
      .then(res => res.json())
      .then(data =>
        setFiles(Array.isArray(data) ? data : data.files ?? [])
      );

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
    setPendingDeleteAnnotationId(null);
    setPendingDeletePanelId(null);
    setPendingDeleteAnchor(null);
    setContext(null);
    await backToFullConversation(panelId);

  }

  function setDeleteAnchorFromRect(
    rect: DOMRect,
    panelId: "primary" | "secondary"
  ) {
    const container = panelId === "secondary"
      ? secondaryMessagesContainerRef.current
      : messagesContainerRef.current;
    if (!container) {
      setPendingDeleteAnchor(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const top = rect.top - containerRect.top + container.scrollTop;
    const left = rect.right - containerRect.left + container.scrollLeft;
    setPendingDeleteAnchor({ panelId, top, left });
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
  const visibleFileIds = new Set(visibleFiles.map(f => f.id));
  const fileChildrenMap = new Map<number, typeof visibleFiles>();
  visibleFiles.forEach(f => {
    if (f.parent_file_id && visibleFileIds.has(f.parent_file_id)) {
      const list = fileChildrenMap.get(f.parent_file_id) ?? [];
      list.push(f);
      fileChildrenMap.set(f.parent_file_id, list);
    }
  });
  const rootFiles = visibleFiles.filter(
    f => !f.parent_file_id || !visibleFileIds.has(f.parent_file_id)
  );

  useEffect(() => {
    if (hasUserResizedSidebar || !sidebarOpen) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bodyStyle = getComputedStyle(document.body);
    const font = `${bodyStyle.fontWeight} ${bodyStyle.fontSize} ${bodyStyle.fontFamily}`;
    ctx.font = font;

    const baseRowPadding = 64; // icon + padding
    let maxWidth = 0;

    const headerText = currentFolderName ?? "Home";
    maxWidth = Math.max(
      maxWidth,
      ctx.measureText(headerText).width + 80
    );

    visibleFolders.forEach(folder => {
      const width = ctx.measureText(folder.name).width + baseRowPadding;
      if (width > maxWidth) maxWidth = width;
    });

    const fileById = new Map(visibleFiles.map(f => [f.id, f]));
    const depthMemo = new Map<number, number>();
    const getDepth = (file: any): number => {
      if (depthMemo.has(file.id)) return depthMemo.get(file.id) as number;
      const parentId = file.parent_file_id;
      if (!parentId || !fileById.has(parentId)) {
        depthMemo.set(file.id, 0);
        return 0;
      }
      const depth = getDepth(fileById.get(parentId)) + 1;
      depthMemo.set(file.id, depth);
      return depth;
    };

    visibleFiles.forEach(file => {
      const depth = getDepth(file);
      const displayTitle = truncateSidebarTitle(file.title);
      const width =
        ctx.measureText(displayTitle).width +
        baseRowPadding +
        depth * 16 +
        (depth > 0 ? 12 : 0);
      if (width > maxWidth) maxWidth = width;
    });

    const nextWidth = Math.min(
      MAX_SIDEBAR_WIDTH,
      Math.max(MIN_SIDEBAR_WIDTH, Math.ceil(maxWidth + 8))
    );
    setSidebarWidth(nextWidth);
  }, [
    currentFolderName,
    visibleFiles,
    visibleFolders,
    sidebarOpen,
    hasUserResizedSidebar,
  ]);

  const currentFolder = currentFolderId
    ? folders.find(f => f.id === currentFolderId)
    : null;

  // Render a sidebar file row with optional child toggle.
  const renderFileRow = (file: any, depth: number) => (
    <div
      className="file-row"
      key={file.id}
      onMouseEnter={() => setHoveredFileId(file.id)}
      onMouseDown={() => {
        if (fileActionsOpenId === file.id) return;

        didTriggerFileHoldRef.current = false;

        fileHoldTimeoutRef.current = window.setTimeout(() => {
          didTriggerFileHoldRef.current = true;
          setFileActionsOpenId(prev =>
            prev === file.id ? null : file.id
          );
        }, 400);
      }}
      onMouseUp={() => {
        if (fileHoldTimeoutRef.current) {
          clearTimeout(fileHoldTimeoutRef.current);
          fileHoldTimeoutRef.current = null;
        }

        if (didTriggerFileHoldRef.current) return;

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
      onMouseLeave={() => {
        setHoveredFileId(prev => (prev === file.id ? null : prev));
        if (fileHoldTimeoutRef.current) {
          clearTimeout(fileHoldTimeoutRef.current);
          fileHoldTimeoutRef.current = null;
        }
      }}
      style={{
        position: "relative",
        padding: "8px",
        paddingLeft: `${8 + depth * 16}px`,
        cursor: "pointer",
        background:
          file.id === activeFileId
            ? "#CBB9A4"
            : hoveredFileId === file.id
              ? "#eee6ddff"
              : "transparent",
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
            {depth > 0 && (
              <span
                style={{
                  width: "12px",
                  height: "12px",
                  marginRight: "6px",
                  borderLeft: "2px solid #c4c4c4",
                  borderBottom: "2px solid #c4c4c4",
                  borderBottomLeftRadius: "6px",
                }}
              />
            )}
            {file.s3_key ? <FileIcon /> : <ChatIcon />}
            <span
              style={{
                color: "#442913",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {truncateSidebarTitle(file.title)}
            </span>
          </span>

          {fileChildrenMap.get(file.id)?.length ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCollapsedFileIds(prev => {
                  const next = new Set(prev);
                  if (next.has(file.id)) {
                    next.delete(file.id);
                  } else {
                    next.add(file.id);
                  }
                  return next;
                });
              }}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                marginLeft: "8px",
                cursor: "pointer",
                color: "#A48D78",
                lineHeight: 0,
              }}
              aria-label="Toggle child chats"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {collapsedFileIds.has(file.id) ? (
                  <path d="M4 6l4 4 4-4" />
                ) : (
                  <path d="M4 10l4-4 4 4" />
                )}
              </svg>
            </button>
          ) : (
            <span style={{ width: "14px" }} />
          )}
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
  );

  const renderFileTree = (file: any, depth: number) => (
    <Fragment key={`file-tree-${file.id}`}>
      {renderFileRow(file, depth)}
      {!collapsedFileIds.has(file.id) &&
        (fileChildrenMap.get(file.id) ?? []).map(child =>
          renderFileTree(child, depth + 1)
        )}
    </Fragment>
  );


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

      pendingChatActionRef.current = "current";

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
        pendingTextRectsRef.current = null;
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
      pendingTextRectsRef.current = Array.from(range.getClientRects());
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

      const rawRects = pendingTextRectsRef.current ?? (rect ? [rect] : []);
      const mergedRects = mergeClientRectsByLine(rawRects);
      const rects = mergedRects
        .map((clientRect) => ({
          x: (clientRect.left - pageRect.left) / pageRect.width,
          y: (clientRect.top - pageRect.top) / pageRect.height,
          width: clientRect.width / pageRect.width,
          height: clientRect.height / pageRect.height,
        }))
        .filter(
          r =>
            r.width > 0 &&
            r.height > 0 &&
            r.x < 1 &&
            r.y < 1 &&
            r.x + r.width > 0 &&
            r.y + r.height > 0
        );

      if (!rects.length) {
        cleanupPopup();
        return;
      }

      const isReadHighlight = action === "highlight";
      const res = await fetch("http://localhost:8000/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: activeFileId,
          page_number: ctx.page,
          type: isReadHighlight ? "highlight" : "text",
          geometry: rects,
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
          type: isReadHighlight ? "highlight" : "text",
          rects,
        },
      ]);

      if (isReadHighlight) {
        cleanupPopup();
        return;
      }

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
        setQuestion(`Explain "${ctx.text}"`);

      } else {
        // Attach to document chat thread
        const docThread = chatThreads.find(
          t => t.source_annotation_id === null
        );

        if (docThread) {
          setActiveChatThreadId(docThread.id);
        }

        setActiveAnnotationId(data.annotation_id);
        setQuestion(`Explain "${ctx.text}"`);
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
    pendingTextRectsRef.current = null;
    pendingChatHighlightRef.current = null;
    setPopupMode(null);
    pendingChatActionRef.current = "current";
    hidePopup();
    window.getSelection()?.removeAllRanges();

    if (popupMode === "pdf") {
      setContext(null);
    }

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
        type: "region",
        rects: [normalizedRect],
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
            parent_file_id: activeFileId ?? null,
            s3_key: null,
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
    if (panelId === "primary") {
      setContext(null);
    }
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
    // Shared chat panel renderer for primary and secondary views.
    const isSecondary = panelId === "secondary";
    const panelTitle = isSecondary
      ? secondaryFileTitle ?? secondaryPendingTitle ?? "New Chat"
      : activeFileTitle ?? "Engrave";
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
        onMouseEnter={() => setHoveredPanelId(panelId)}
        onMouseLeave={() => setHoveredPanelId(prev => (prev === panelId ? null : prev))}
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
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                color: "#442913",
              }}
            >
              {pdfUrl === null && panelId === "primary" && (
                <button
                  onClick={() => setSidebarOpen(v => !v)}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    lineHeight: 0,
                    color: "#A48D78",
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
                      <path d="M15 6l-6 6 6 6" />
                    ) : (
                      <path d="M9 6l6 6-6 6" />
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
              {hoveredPanelId === panelId && (
                <button
                  onClick={() => {
                    if (panelId === "secondary") {
                      closeSecondaryPanel();
                      return;
                    }

                    if (showSecondaryChat) {
                      closeSecondaryPanel();
                    }
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#A48D78",
                    cursor: "pointer",
                    padding: "4px",
                    lineHeight: 1,
                  }}
                  aria-label="Close chat panel"
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: "12px",
                      height: "2px",
                      background: "currentColor",
                      borderRadius: "999px",
                    }}
                  />
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
            position: "relative",
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
                  onHighlightHold={(annotationId, rect) => {
                    setPendingDeleteAnnotationId(annotationId);
                    setPendingDeletePanelId(panelId);
                    setDeleteAnchorFromRect(rect, panelId);
                  }}
                />
            </div>
          ))}

          {pendingDeleteAnnotationId &&
            pendingDeletePanelId === panelId &&
            pendingDeleteAnchor?.panelId === panelId && (
              <button
                onClick={() =>
                  deleteAnnotation(pendingDeleteAnnotationId, panelId)
                }
                data-delete-annotation
                style={{
                  position: "absolute",
                  top: Math.max(0, pendingDeleteAnchor.top - 12),
                  left: Math.max(0, pendingDeleteAnchor.left + 6),
                  background: "#fff",
                  border: "1px solid #ddd",
                  borderRadius: "999px",
                  color: "#ff6b6b",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  lineHeight: 1,
                  width: "20px",
                  height: "20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 10px rgba(0,0,0,0.08)",
                }}
                aria-label="Delete highlight"
              >
                x
              </button>
            )}
        </div>

        {/* Input */}
        <div
          style={{
            padding: "1rem",
            background: "transparent",
            display: "flex",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
            }}
          >
            {panelId === "primary" && context?.type === "image" && (
              <div
                style={{
                  marginBottom: "6px",
                  fontSize: "0.8rem",
                  color: "#A48D78",
                }}
              >
                {getContextLabel(context)}
              </div>
            )}
            <textarea
              value={panelQuestion}
              onChange={(e) => setPanelQuestion(e.target.value)}
              style={{
                width: "100%",
                height: "90px",
                borderRadius: UI_RADIUS,
                border: "1px solid #ddd",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                background: "#fff",
                padding: "8px 10px 20px 10px",
                boxSizing: "border-box",
                resize: "none",
                outline: "none",
              }}
            />

            <button
              onClick={() => askQuestion(panelId)}
              disabled={panelLoading || (!panelThreadId && !isSecondary)}
              onMouseEnter={() => setHoveredSendPanelId(panelId)}
              onMouseLeave={() =>
                setHoveredSendPanelId(prev => (prev === panelId ? null : prev))
              }
              style={{
                position: "absolute",
                left: "50%",
                bottom: "12px",
                transform: "translateX(-50%)",
                background: hoveredSendPanelId === panelId ? "#eee6ddff" : "transparent",
                border: "none",
                padding: "4px 6px",
                borderRadius: "999px",
                cursor: "pointer",
                color: "#111",
                opacity: panelLoading ? 0.6 : 1,
              }}
              aria-label="Send"
            >
              {panelLoading ? (
                "..."
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
      </div>
    );
  }


  /* ---------------- UI ---------------- */
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "#FAF9F6",
        overflow: "hidden", // ← critical
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: sidebarOpen ? Math.max(MIN_SIDEBAR_WIDTH, sidebarWidth - 16) : 0,
          height: sidebarOpen ? "calc(100% - 16px)" : "100%",
          margin: sidebarOpen ? "8px 0 8px 8px" : "0",
          overflowY: "auto",
          overflowX: "hidden",
          transition: "width 0.2s ease",
          // border: sidebarOpen ? "1px solid #ddd" : "none",
          // borderRadius: "12px",
          // boxShadow: sidebarOpen ? "0 4px 12px rgba(0,0,0,0.08)" : "none",
          // background: "#fff",
          background: "#FAF9F6",
          color: "#442913",
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
            padding: "12px 8px 8px",
            borderBottom: "1px solid #A48D78",
            fontWeight: 600,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {currentFolderId !== null && (
              <span
                style={{ cursor: "pointer", position: "relative", top: "2px" }}
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
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M19 12H6" />
                  <path d="M6 12l5-5" />
                  <path d="M6 12l5 5" />
                </svg>
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
              background: "#eee6ddff",
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
                    title: "New Chat",
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
                    parent_file_id: null,
                    s3_key: null,
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
                // color: "#000",
                color: "#442913",
                userSelect: "none",
                background:
                  hoveredFolderId === folder.id ? "#eee6ddff" : "transparent",
              }}
              onMouseEnter={() => setHoveredFolderId(folder.id)}
              onMouseLeave={() =>
                setHoveredFolderId(prev => (prev === folder.id ? null : prev))
              }
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
          {rootFiles.map(file => renderFileTree(file, 0))}

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

      <div
        style={{
          flex: 1,
          margin: "12px",
          height: "calc(100% - 24px)",
          border: "1px solid #ddd",
          borderRadius: "12px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          // background: "#fff",
          background: "#fff",
          boxSizing: "border-box",
          display: "flex",
          overflow: "hidden",
        }}
      >
        {pdfUrl !== null && (
          <div
            style={{
              width: `${100 - chatWidth}%`,
              height: "100%",
              padding: "0 1rem 1rem",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 20,
                background: "#fff",
                padding: "1rem 0 0.5rem",
              }}
            >
              {/* PDF Viewer */}
              <button
                onClick={() => setSidebarOpen(v => !v)}
                style={{
                  marginBottom: "0.25rem",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  lineHeight: 0,
                  color: "#A48D78",
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
                    <path d="M15 6l-6 6 6 6" />
                  ) : (
                    <path d="M9 6l6 6-6 6" />
                  )}
                </svg>
              </button>
              <div
                ref={pdfContentRef}
                style={{ width: "100%" }}
              >
                {/* Zoom slider removed; PDF auto-fits panel width */}
              </div>
            </div>

            <div
              ref={pdfScrollRef}
              style={{ overflow: "auto", flex: 1, minHeight: 0 }}
            >
              {pdfUrl && (
                <Document
                  key={pdfUrl}
                  file={pdfUrl}
                  onLoadSuccess={(doc) => {
                    setNumPages(doc.numPages);
                    setPdfLoadedUrl(pdfUrl);
                    setPdfReady(true);
                  }}
                  onLoadError={() => {
                    setPdfReady(false);
                    setNumPages(0);
                    setPdfLoadedUrl(null);
                  }}
                >
                  {pdfReady && pdfLoadedUrl === pdfUrl &&
                    Array.from({ length: numPages }, (_, i) => {
                    const pageNumber = i + 1;
                    const pageHighlights = highlights.filter(
                      h => h.page === pageNumber
                    );
                    const pageHighlightRects = pageHighlights.flatMap(h =>
                      h.rects.map((rect, rectIndex) => ({
                        h,
                        rect,
                        rectIndex,
                        key: `${h.annotation_id}-${rectIndex}`,
                      }))
                    );

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
                            zIndex: 2,
                          }}
                        >
                          {pageHighlightRects.map(({ h, rect, key }) => (
                            <div
                              key={`visual-${key}`}
                              style={{
                                position: "absolute",
                                left: `${rect.x * 100}%`,
                                top: `${rect.y * 100}%`,
                                width: `${rect.width * 100}%`,
                                height: `${rect.height * 100}%`,
                                background:
                                  h.type === "highlight"
                                    ? "rgba(180, 235, 190, 0.35)"
                                    : h.annotation_id === activeAnnotationId
                                      ? "rgba(203, 185, 164, 0.35)"
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
                            zIndex: 20,
                          }}
                        >
                          {pageHighlightRects.map(({ h, rect, rectIndex, key }) => (
                            <Fragment key={`hit-${key}`}>
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (suppressPdfHighlightClickRef.current) {
                                    suppressPdfHighlightClickRef.current = false;
                                    return;
                                  }
                                  if (h.type === "highlight") return;
                                  activateAnnotation(h.annotation_id, "primary");
                                }}
                                data-annotation-id={h.annotation_id}
                                onMouseDown={() => {
                                  pdfHighlightHoldFiredRef.current = false;
                                  if (pdfHighlightHoldTimerRef.current) {
                                    window.clearTimeout(
                                      pdfHighlightHoldTimerRef.current
                                    );
                                  }

                                  pdfHighlightHoldTimerRef.current =
                                    window.setTimeout(() => {
                                      pdfHighlightHoldFiredRef.current = true;
                                      suppressPdfHighlightClickRef.current = true;
                                      setPendingDeleteAnnotationId(h.annotation_id);
                                      setPendingDeletePanelId("primary");
                                    }, 400);
                                }}
                                onMouseUp={() => {
                                  if (pdfHighlightHoldTimerRef.current) {
                                    window.clearTimeout(
                                      pdfHighlightHoldTimerRef.current
                                    );
                                    pdfHighlightHoldTimerRef.current = null;
                                  }

                                  if (pdfHighlightHoldFiredRef.current) {
                                    suppressPdfHighlightClickRef.current = true;
                                  }
                                }}
                                onMouseLeave={() => {
                                  if (pdfHighlightHoldTimerRef.current) {
                                    window.clearTimeout(
                                      pdfHighlightHoldTimerRef.current
                                    );
                                    pdfHighlightHoldTimerRef.current = null;
                                  }
                                }}
                                style={{
                                  position: "absolute",
                                  left: `${rect.x * 100}%`,
                                  top: `${rect.y * 100}%`,
                                  width: `${rect.width * 100}%`,
                                  height: `${rect.height * 100}%`,
                                  pointerEvents: "auto",
                                  cursor: "pointer",
                                }}
                              />

                              {rectIndex === 0 &&
                                pendingDeleteAnnotationId === h.annotation_id &&
                                pendingDeletePanelId === "primary" && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteAnnotation(h.annotation_id, "primary");
                                    }}
                                    data-delete-annotation
                                    style={{
                                      position: "absolute",
                                      left: `${(rect.x + rect.width) * 100}%`,
                                      top: `${rect.y * 100}%`,
                                      transform: "translate(-8px, -8px)",
                                      width: "20px",
                                      height: "20px",
                                      borderRadius: "999px",
                                      border: "1px solid #ddd",
                                      background: "#fff",
                                      color: "#ff6b6b",
                                      fontSize: "0.8rem",
                                      fontWeight: 700,
                                      lineHeight: 1,
                                      cursor: "pointer",
                                      pointerEvents: "auto",
                                      boxShadow:
                                        "0 4px 10px rgba(0,0,0,0.08)",
                                    }}
                                    aria-label="Delete highlight"
                                  >
                                    x
                                  </button>
                                )}
                            </Fragment>
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
                                await uploadRegion(
                                  pageNumber,
                                  dragRect,
                                  e.currentTarget.parentElement!
                                );
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
          </div>
        )}

        {pdfUrl !== null && (
          <div
            onMouseDown={() => setIsResizing(true)}
            onMouseEnter={() => setHoveredChatDivider(true)}
            onMouseLeave={() => setHoveredChatDivider(false)}
            style={{
              width: "10px",
              cursor: "col-resize",
              background: "transparent",
              userSelect: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "4px",
                height: "80%",
                background: hoveredChatDivider ? "#eee6ddff" : "transparent",
                borderRadius: "999px",
                transition: "background 0.15s ease",
              }}
            />
          </div>
        )}

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

                <span style={{ opacity: 0.4 }}>|</span>

                <span
                  style={{ cursor: "pointer", padding: "4px 6px" }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setTitleFromSelection();
                  }}
                >
                  Set title
                </span>
              </>
            )}

            {popupMode === "pdf" && (
              <>
                <span
                  style={{ cursor: "pointer", padding: "4px 6px" }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pendingChatActionRef.current = "current";
                    handlePopupConfirm();
                  }}
                >
                  Add to chat
                </span>

                <span style={{ opacity: 0.4 }}>|</span>

                <span
                  style={{ cursor: "pointer", padding: "4px 6px" }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pendingChatActionRef.current = "highlight";
                    handlePopupConfirm();
                  }}
                >
                  Highlight
                </span>

                <span style={{ opacity: 0.4 }}>|</span>

                <span
                  style={{ cursor: "pointer", padding: "4px 6px" }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setTitleFromSelection();
                  }}
                >
                  Set title
                </span>
              </>
            )}
          </div>
        )}
    </div>
  );
}
