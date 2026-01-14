"use client";

import { useEffect, useRef, useState } from "react";
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
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);

  const popupRef = useRef<HTMLDivElement | null>(null);
  const pendingTextRef = useRef<TextContext | null>(null);

  // 🟡 Text: store raw DOM rect
  const pendingTextRectRef = useRef<DOMRect | null>(null);

  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isClickingPopupRef = useRef(false);

  // Stored highlights
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  // State for annotation
  const [activeAnnotationId, setActiveAnnotationId] = useState<number | null>(null);

  // State of document chat or annotation chat
  const [chatMode, setChatMode] = useState<"document" | "annotation">("document");

  // State of file
  const [activeFileId, setActiveFileId] = useState<number | null>(null);

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
    if (!pdfContentRef.current) return;

    const el = pdfContentRef.current;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;

      setPdfContentWidth(entry.contentRect.width);
    });

    requestAnimationFrame(() => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);




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

  async function loadAnnotationChat(annotationId: number) {
    const res = await fetch(
      `http://localhost:8000/chat/annotation/${annotationId}`
    );
    const data = await res.json();
    setMessages(data.messages || []);
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


  async function loadFileState(fileId: number) {
    const res = await fetch(`http://localhost:8000/files/${fileId}/state`);
    if (!res.ok) throw new Error("Failed to load file state");
    const data = await res.json();

    setPdfUrl(data.pdf_url);
    setMessages(data.messages || []);

    setActiveFileTitle(data.file.title);

    const restoredHighlights = (data.annotations || [])
      .filter((a: any) => a.geometry)
      .map((a: any) => ({
        page: a.page_number,
        annotation_id: a.id,
        rect: a.geometry,
      }));

    setHighlights(restoredHighlights);
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


  /* ---------------- Delete Folder ---------------- */
  async function deleteFolder(folderId: number) {
    const ok = confirm("Delete this folder and all its contents?");
    if (!ok) return;

    await fetch(`http://localhost:8000/folders/${folderId}`, {
      method: "DELETE",
    });

    setFolders(prev => prev.filter(f => f.id !== folderId));
  }

  async function activateAnnotation(annotationId: number) {
    // Activate annotation
    setActiveAnnotationId(annotationId);
    setChatMode("annotation");

    // Fetch annotation metadata
    const annotation = await fetchAnnotation(annotationId);

    if (!annotation) {
      // Annotation no longer exists — recover gracefully
      setActiveAnnotationId(null);
      setContext(null);
      setChatMode("document");
      return;
    }


    // Restore context
    if (annotation.type === "region") {
      setContext({
        type: "image",
        region_id: annotation.region_id,
        page_number: annotation.page_number,
      });
    } else {
      setContext({
        type: "text",
        page: annotation.page_number,
        text: annotation.text ?? "",
      });
    }

    // Load annotation-specific chat
    await loadAnnotationChat(annotationId);

    // Scroll to page
    scrollToPage(annotation.page_number);
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
      setActiveFileId(null);
      setPdfUrl(null);
      setMessages([]);
      setHighlights([]);
      setContext(null);
      setActiveAnnotationId(null);
      setActiveFileTitle(null);
      setChatMode("document");
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


  /* ---------------- Delete-annotation handler ---------------- */
  async function deleteAnnotation(annotationId: number) {
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

    // Exit annotation mode
    setActiveAnnotationId(null);
    setContext(null);
    setChatMode("document");

    // Reload document-level chat
    if (activeFileId) {
      const res = await fetch(
        `http://localhost:8000/chat/file/${activeFileId}`
      );
      const data = await res.json();
      setMessages(data.messages || []);
    }
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
        hidePopup();
        return;
      }

      const text = sel.toString().trim();
      if (!text) return;

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      let node: any = range.startContainer;
      let pageNum: number | null = null;

      while (node) {
        if (node.dataset?.pageNumber) {
          pageNum = Number(node.dataset.pageNumber);
          break;
        }
        node = node.parentNode;
      }

      if (!pageNum) return;

      pendingTextRef.current = {
        type: "text",
        text,
        page: pageNum,
      };

      // Text: save rect
      pendingTextRectRef.current = rect;

      showPopup(rect);
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, [regionMode]);

  function showPopup(rect: DOMRect) {
    if (!popupRef.current) return;
    popupRef.current.style.display = "block";
    popupRef.current.style.top = `${rect.top + window.scrollY - 40}px`;
    popupRef.current.style.left = `${rect.left + window.scrollX}px`;
  }

  function hidePopup() {
    if (!popupRef.current) return;
    popupRef.current.style.display = "none";
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

  async function askQuestion() {
    if (!activeFileId) return;

    const page =
      context?.type === "text"
        ? context.page
        : context?.type === "image"
        ? context.page_number
        : undefined;


    const userMsg: ChatMsg = {
      role: "user",
      content: question || "Explain this in simple terms.",
      annotation_id: activeAnnotationId ?? undefined,
      ...(page ? { reference: { page } } : {}),
    };


    setMessages(prev => [...prev, userMsg]);
    setQuestion("");
    setLoading(true);


    const res = await fetch("http://localhost:8000/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_id: activeFileId,
        annotation_id: activeAnnotationId,
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
          width: sidebarOpen ? sidebarWidth : 0,
          height: "100%",
          overflowY: "auto",
          overflowX: "hidden",
          transition: "width 0.2s ease",
          borderRight: sidebarOpen ? `${DIVIDER_WIDTH} solid ${DIVIDER_COLOR}` : "none",
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
                }, 2000); // ⏱ 2 seconds
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

                setActiveFileId(file.id);
                setChatMode("document");
                setActiveAnnotationId(null);
                setContext(null);
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
            background: DIVIDER_COLOR,
            userSelect: "none",
          }}
        />
      )}

      {/* PDF Viewer */}
      <div
        style={{
          width: `${100 - chatWidth}%`,
          height: "100%",       
          padding: "1rem",
          overflow: "auto",      // scroll inside panel only
          minHeight: 0,       
        }}
      >
        <button
          onClick={() => setSidebarOpen(v => !v)}
          style={{
            marginBottom: "0.5rem",
            fontSize: "1.2rem",
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          {sidebarOpen ? "<<" : ">>"}
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
          <Document file={pdfUrl} onLoadSuccess={({ numPages }) => setNumPages(numPages)}>
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
                          activateAnnotation(h.annotation_id);
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

        {!regionMode && (
          <div
              ref={popupRef}
              onMouseDown={async (e) => {
                e.preventDefault(); // 👈 critical
                isClickingPopupRef.current = true;

                if (!pendingTextRef.current || !activeFileId) return;
                const ctx = pendingTextRef.current;
                if (ctx.type !== "text") return;

                const rect = pendingTextRectRef.current;
                const pageEl = pageRefs.current[ctx.page];
                if (!rect || !pageEl) return;

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

                const data = await res.json();

                setHighlights(prev => [
                  ...prev,
                  {
                    page: ctx.page,
                    annotation_id: data.annotation_id,
                    rect: geometry,
                  },
                ]);

                setActiveAnnotationId(data.annotation_id);
                setContext(ctx);

                pendingTextRef.current = null;
                pendingTextRectRef.current = null;
                hidePopup();

                // reset AFTER the click cycle
                setTimeout(() => {
                  isClickingPopupRef.current = false;
                }, 0);
              }}

            style={{
              position: "absolute",
              display: "none",
              background: "#111",
              color: "#fff",
              padding: "6px 10px",
              borderRadius: "6px",
              cursor: "pointer",
              zIndex: 1000,
            }}
          >
            Add to chat
          </div>
        )}
      </div>

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

      {/* Chat Panel */}
      <div
        style={{
          width: `${chatWidth}%`,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
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
            <span>{activeFileTitle ?? "Conversation"}</span>

            {activeAnnotationId && (
              <button
                onClick={() => deleteAnnotation(activeAnnotationId)}
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
          </h3>

          {chatMode === "annotation" && (
            <button
              onClick={async () => {
                setChatMode("document");
                setActiveAnnotationId(null);
                setContext(null);

                if (!activeFileId) return;

                const res = await fetch(
                  `http://localhost:8000/chat/file/${activeFileId}`
                );
                const data = await res.json();
                setMessages(data.messages || []);
              }}
              style={{
                marginTop: "0.5rem",
                alignSelf: "flex-start",
                fontSize: "0.85rem",
                background: "transparent",
                border: "none",
                color: "#1976d2",
                cursor: "pointer",
                padding: 0,
              }}
            >
              ← Back to full conversation
            </button>
          )}
        </div>

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "1rem",
          }}
        >
          {messages.map((m, i) => (
            <ChatMessage
              key={`${m.role}-${m.annotation_id ?? "doc"}-${i}`}
              role={m.role}
              content={m.content}
              onClick={
                m.annotation_id
                  ? () => activateAnnotation(m.annotation_id)
                  : undefined
              }
            />
          ))}
        </div>

        {/* Input */}
        <div
          style={{
            padding: "1rem",
            background: "transparent",
          }}
        >
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            style={{
              width: "95%",
              height: "80px",
              borderRadius: UI_RADIUS,
              border: "1px solid #ccc",
              padding: "10px",
              resize: "none",
              outline: "none",
            }}
          />

          <button
            onClick={askQuestion}
            disabled={loading || (chatMode === "annotation" && !activeAnnotationId)}
            style={{
              marginTop: "0.5rem",
              width: "100%",
              borderRadius: UI_RADIUS,
              padding: "10px 0",
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            {loading ? "Thinking..." : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
