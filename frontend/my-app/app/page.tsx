"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "react-pdf/dist/Page/TextLayer.css";

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

/* ---------------- Main Component ---------------- */

export default function Home() {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);

  const [context, setContext] = useState<Context | null>(null);

  // region selection
  const [regionMode, setRegionMode] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [dragRect, setDragRect] = useState<DragRect | null>(null);
  const [activePage, setActivePage] = useState<number | null>(null);

  // chat
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const popupRef = useRef<HTMLDivElement | null>(null);
  const pendingTextRef = useRef<TextContext | null>(null);

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
    setQuestion("");
    setAnswer(null);
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

    const canvas = pageContainer.querySelector("canvas");
    if (!canvas) return;

    const scaleX = canvas.width / pageContainer.clientWidth;
    const scaleY = canvas.height / pageContainer.clientHeight;

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
      cropCanvas.toBlob((b) => resolve(b!), "image/png")
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

    setContext({
      type: "image",
      region_id: data.region_id,
      document_id: documentId!,
      page_number: pageNumber,
    });
  }

  /* ---------------- Ask backend ---------------- */

  async function askQuestion() {
    if (!documentId || !context) return;

    setLoading(true);
    setAnswer(null);

    const res = await fetch("http://localhost:8000/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document_id: documentId,
        question: question || "Explain this in simple terms.",
        ...(context.type === "text"
          ? { context }
          : { region: context }),
      }),
    });

    const data = await res.json();
    setAnswer(data.answer);
    setLoading(false);
  }

  /* ---------------- UI ---------------- */

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* PDF Viewer */}
      <div style={{ flex: 2, padding: "1rem", overflow: "auto" }}>
        <input type="file" accept="application/pdf" onChange={handleUpload} />

        {pdfUrl && (
          <Document
            file={pdfUrl}
            onLoadSuccess={({ numPages }: { numPages: number }) =>
              setNumPages(numPages)
            }
          >
            {Array.from({ length: numPages }, (_, i) => (
              <div
                key={i}
                data-page-number={i + 1}
                onDoubleClick={() => {
                  setRegionMode(true);
                  setActivePage(i + 1);
                  setDragRect(null);
                }}
                style={{ position: "relative", marginBottom: "1.5rem" }}
              >
                <Page
                  pageNumber={i + 1}
                  renderTextLayer
                  renderAnnotationLayer={false}
                />

                {regionMode && activePage === i + 1 && (
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
                          i + 1,
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
            ))}
          </Document>
        )}

        {!regionMode && (
          <div
            ref={popupRef}
            onMouseDown={() => {
              if (pendingTextRef.current) {
                setContext(pendingTextRef.current);
                pendingTextRef.current = null;
                hidePopup();
              }
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
      <div style={{ flex: 1, padding: "1rem", borderLeft: "1px solid #ccc" }}>
        <h3>Your Question</h3>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          style={{ width: "100%", height: "80px" }}
        />

        <button
          onClick={askQuestion}
          disabled={!context || loading}
          style={{ marginTop: "1rem" }}
        >
          {loading ? "Thinking..." : "Ask"}
        </button>

        {answer && (
          <>
            <h3 style={{ marginTop: "1.5rem" }}>Answer</h3>
            <p>{answer}</p>
          </>
        )}
      </div>
    </div>
  );
}
