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

    // ---------- load sidebar data (ONCE) ----------
  useEffect(() => {
    fetch("http://localhost:8000/folders")
      .then(res => res.json())
      .then(data => setFolders(data.folders));

    fetch("http://localhost:8000/files")
      .then(res => res.json())
      .then(data => setFiles(Array.isArray(data) ? data : data.files ?? []));
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
      throw new Error("Failed to fetch annotation");
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

    const res = await fetch("http://localhost:8000/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    setActiveFileId(data.file_id);
    setContext(null);
    setActiveAnnotationId(null);
    setQuestion("");

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


  /* ---------------- Text selection ---------------- */

  useEffect(() => {
    if (regionMode) return;

    function handleSelectionChange() {
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
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Sidebar */}
      <div
        style={{
          width: sidebarOpen ? 240 : 0,
          overflow: "hidden",
          transition: "width 0.2s ease",
        }}
      >
        {sidebarOpen &&
          Array.isArray(files) &&
          files.map(file => (
            <div
              key={file.id}
              onClick={() => {
                setActiveFileId(file.id);
                setChatMode("document");
                setActiveAnnotationId(null);
                setContext(null);
              }}
              style={{
                padding: "8px",
                cursor: "pointer",
                background: file.id === activeFileId ? "#222" : "transparent",
              }}
            >
              {file.title}
            </div>
          ))}
        </div>


      {/* PDF Viewer */}
      <div
        style={{
          width: `${100 - chatWidth}%`,
          padding: "1rem",
          overflow: "auto",
        }}
      >
        <input type="file" accept="application/pdf" onChange={handleUpload} />
        <button
          onClick={() => setSidebarOpen(v => !v)}
          style={{
            marginBottom: "0.5rem",
            fontSize: "0.85rem",
          }}
        >
          {sidebarOpen ? "Hide files" : "Show files"}
        </button>
        <div style={{ marginBottom: "0.5rem" }}>
          <label style={{ fontSize: "0.85rem" }}>
            Zoom: {Math.round(pdfScale * 100)}%
          </label>
          <input
            type="range"
            min={0.6}
            max={2}
            step={0.05}
            value={pdfScale}
            onChange={(e) => setPdfScale(Number(e.target.value))}
            style={{ width: "100%" }}
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
                  <Page
                    pageNumber={pageNumber}
                    scale={pdfScale}
                    renderTextLayer
                    renderAnnotationLayer={false}
                  />

                  {/* ✅ Highlight overlay that resizes with the page */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      pointerEvents: "none",
                      zIndex: 5,
                    }}
                  >
                    {pageHighlights.map(h => {
                      const isActive = h.annotation_id === activeAnnotationId;

                      return (
                        <div
                          key={h.annotation_id}
                          style={{
                            position: "absolute",
                            left: `${h.rect.x * 100}%`,
                            top: `${h.rect.y * 100}%`,
                            width: `${h.rect.width * 100}%`,
                            height: `${h.rect.height * 100}%`,
                            background: isActive
                              ? "rgba(0,112,243,0.15)"
                              : "rgba(255, 235, 59, 0.18)",
                            borderRadius: "2px",
                          }}
                        />
                      );
                    })}
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
            onMouseDown={async () => {
              if (!pendingTextRef.current || !activeFileId) return;

              // Type narrow ONCE, explicitly
              const ctx = pendingTextRef.current;
              if (ctx.type !== "text") return;

              const rect = pendingTextRectRef.current;
              const pageEl = pageRefs.current[ctx.page];

              if (!rect || !pageEl) return;

              const pageRect = pageEl.getBoundingClientRect();

              // Normalized geometry (page-relative)
              const geometry = {
                x: (rect.left - pageRect.left) / pageRect.width,
                y: (rect.top - pageRect.top) / pageRect.height,
                width: rect.width / pageRect.width,
                height: rect.height / pageRect.height,
              };

              // Create annotation (source of truth)
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

              // Create highlight at annotation creation time
              setHighlights(prev => [
                ...prev,
                {
                  page: ctx.page,
                  annotation_id: data.annotation_id,
                  rect: geometry,
                },
              ]);

              // Enter annotation chat context
              setActiveAnnotationId(data.annotation_id);
              setContext(ctx);

              // Cleanup transient state
              pendingTextRef.current = null;
              pendingTextRectRef.current = null;
              hidePopup();
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
            width: "6px",
            cursor: "col-resize",
            background: "#e0e0e0",
            userSelect: "none",
          }}
        />

      {/* Chat Panel */}
      <div
        style={{
          width: `${chatWidth}%`,
          padding: "1rem",
          borderLeft: "1px solid #ccc",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h3>{activeFileTitle ?? "Conversation"}</h3>
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
              marginBottom: "0.75rem",
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

        <div style={{ flex: 1, overflowY: "auto", marginBottom: "1rem" }}>
          {messages.map((m, i) => (
            <ChatMessage
              key={i}
              role={m.role}
              content={m.content}
              onClick={
                m.annotation_id
                  ? async () => {
                      // 1️⃣ Activate annotation
                      setActiveAnnotationId(m.annotation_id);
                      setChatMode("annotation");

                      // 2️⃣ Fetch annotation metadata
                      const annotation = await fetchAnnotation(m.annotation_id);

                      // 3️⃣ Restore correct context
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
                          text: "",
                        });
                      }

                      // 4️⃣ Load annotation-specific chat
                      loadAnnotationChat(m.annotation_id);

                      // 5️⃣ Scroll to the page
                      scrollToPage(annotation.page_number);
                    }
                  : undefined
              }
            />
          ))}
        </div>

        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          style={{ width: "100%", height: "80px" }}
        />

        <button
          onClick={askQuestion}
          disabled={loading || (chatMode === "annotation" && !activeAnnotationId)}
          style={{ marginTop: "1rem" }}
        >
          {loading ? "Thinking..." : "Ask"}
        </button>
      </div>
    </div>
  );
}
