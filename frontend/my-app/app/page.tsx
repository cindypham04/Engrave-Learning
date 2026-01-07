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
  document_id: string;
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
  const [documentId, setDocumentId] = useState<string | null>(null);
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

  // New state for annotation
  const [activeAnnotationId, setActiveAnnotationId] = useState<number | null>(null);

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



  /* ---------------- Load chat history ---------------- */

  useEffect(() => {
    if (!documentId) return;

    fetch(`http://localhost:8000/chat/${documentId}`)
      .then(res => res.json())
      .then(data => {
        setMessages(data.messages || []);
      });
  }, [documentId]);

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

    setPdfUrl(data.url);
    setDocumentId(data.document_id);
    setContext(null);
    setActiveAnnotationId(null);
    setQuestion("");
    setMessages([]);
    setHighlights([]);
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
    if (!documentId) return;

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
    formData.append("document_id", documentId);
    formData.append("page_number", String(pageNumber));

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
      document_id: documentId,
      page_number: pageNumber,
    });
  }

  /* ---------------- Ask backend ---------------- */

  async function askQuestion() {
    if (!documentId) return;

    const page =
      context?.type === "text"
        ? context.page
        : context?.type === "image"
        ? context.page_number
        : undefined;


    const userMsg: ChatMsg = {
      role: "user",
      content: question || "Explain this in simple terms.",
      ...(page ? { reference: { page } } : {}),
    };

    setMessages(prev => [...prev, userMsg]);
    setQuestion("");
    setLoading(true);

    // 🟡 Phase 2.3 (text): convert rect → highlight
    if (context?.type === "text" && pendingTextRectRef.current && page) {
      const pageEl = pageRefs.current[page];
      if (pageEl) {
        const r = pageEl.getBoundingClientRect();
        const rect = pendingTextRectRef.current;

        setHighlights(prev => [
          ...prev,
          {
            page,
            annotation_id: activeAnnotationId!, // 👈 ADD
            rect: {
              x: (rect.left - r.left) / r.width,
              y: (rect.top - r.top) / r.height,
              width: rect.width / r.width,
              height: rect.height / r.height,
            },
          },
        ]);
      }
      pendingTextRectRef.current = null;
    }

    const res = await fetch("http://localhost:8000/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document_id: documentId,
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
      {/* PDF Viewer */}
      <div style={{ flex: 2, padding: "1rem", overflow: "auto" }}>
        <input type="file" accept="application/pdf" onChange={handleUpload} />

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
                  style={{ position: "relative", marginBottom: "1.5rem" }}
                >
                  <Page pageNumber={pageNumber} renderTextLayer renderAnnotationLayer={false} />

                  {pageHighlights.map((h, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        setActiveAnnotationId(h.annotation_id);

                        setContext({
                          type: "text", // temporary, refined later
                          page: h.page,
                          text: "",
                        });

                        loadAnnotationChat(h.annotation_id);
                      }}
                      style={{
                        position: "absolute",
                        left: `${h.rect.x * 100}%`,
                        top: `${h.rect.y * 100}%`,
                        width: `${h.rect.width * 100}%`,
                        height: `${h.rect.height * 100}%`,
                        background: "rgba(255, 235, 59, 0.35)",
                        border: "2px solid rgba(255, 193, 7, 0.9)",
                        pointerEvents: "auto",
                        zIndex: 5,
                      }}
                    />
                  ))}

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
              if (!pendingTextRef.current || !documentId) return;

              const ctx = pendingTextRef.current;

              const rect = pendingTextRectRef.current;
              const pageEl = pageRefs.current[ctx.page];

              let geometry = null;

              if (rect && pageEl) {
                const pageRect = pageEl.getBoundingClientRect();
                geometry = {
                  x: (rect.left - pageRect.left) / pageRect.width,
                  y: (rect.top - pageRect.top) / pageRect.height,
                  width: rect.width / pageRect.width,
                  height: rect.height / pageRect.height,
                };
              }

              const res = await fetch("http://localhost:8000/annotations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  document_id: documentId,
                  page_number: ctx.page,
                  type: "text",
                  geometry,
                  text: ctx.text,
                }),
              });

              const data = await res.json();
              setActiveAnnotationId(data.annotation_id);
              setContext(ctx);

              pendingTextRef.current = null;
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

      {/* Chat Panel */}
      <div style={{ flex: 1, padding: "1rem", borderLeft: "1px solid #ccc", display: "flex", flexDirection: "column" }}>
        <h3>Conversation</h3>

        <div style={{ flex: 1, overflowY: "auto", marginBottom: "1rem" }}>
          {messages.map((m, i) => (
            <ChatMessage
              key={i}
              role={m.role}
              content={m.content}
              onClick={
                m.role === "user" && m.reference
                  ? () => scrollToPage(m.reference.page)
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
          disabled={loading}
          style={{ marginTop: "1rem" }}
        >
          {loading ? "Thinking..." : "Ask"}
        </button>
      </div>
    </div>
  );
}
