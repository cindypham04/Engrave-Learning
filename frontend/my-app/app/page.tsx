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

type SelectionContext = {
  text: string;
  page: number;
};

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

  // Text selection (Day 4)
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [pendingSelection, setPendingSelection] =
    useState<SelectionContext | null>(null);

  // Region selection (Day 5 - Step 1)
  const [regionMode, setRegionMode] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [dragRect, setDragRect] = useState<DragRect | null>(null);

  // Chat
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const popupRef = useRef<HTMLDivElement | null>(null);

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
    setSelection(null);
    setPendingSelection(null);
    setQuestion("");
    setAnswer(null);
  }

  /* ---------------- Text selection logic (unchanged) ---------------- */

  useEffect(() => {
    if (regionMode) return;

    function handleSelectionChange() {
      if (selection) {
        hidePopup();
        return;
      }

      const domSelection = window.getSelection();
      if (!domSelection || domSelection.isCollapsed) {
        hidePopup();
        return;
      }

      const text = domSelection.toString().trim();
      if (!text) {
        hidePopup();
        return;
      }

      const range = domSelection.getRangeAt(0);
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

      setPendingSelection({ text, page: pageNum });
      showPopup(rect);
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, [selection, regionMode]);

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

  /* ---------------- Ask backend ---------------- */

  async function askQuestion() {
    if (!documentId || !selection) return;

    setLoading(true);
    setAnswer(null);

    const res = await fetch("http://localhost:8000/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document_id: documentId,
        question: question || "Explain this in simple terms.",
        context: selection,
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

        {/* Region mode toggle */}
        <button
          onClick={() => {
            setRegionMode((prev) => !prev);
            setDragRect(null);
            setDragStart(null);
          }}
          style={{
            marginLeft: "1rem",
            padding: "6px 10px",
            background: regionMode ? "#333" : "#eee",
            color: regionMode ? "#fff" : "#000",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          {regionMode ? "Exit Region Select" : "Select Region"}
        </button>

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
                style={{
                  position: "relative",
                  marginBottom: "1.5rem",
                }}
              >
                <Page
                  pageNumber={i + 1}
                  renderTextLayer
                  renderAnnotationLayer={false}
                />

                {/* Region selection overlay */}
                {regionMode && (
                  <div
                    onMouseDown={(e) => {
                      const rect =
                        e.currentTarget.getBoundingClientRect();
                      setDragStart({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                      });
                      setDragRect(null);
                    }}
                    onMouseMove={(e) => {
                      if (!dragStart) return;

                      const rect =
                        e.currentTarget.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      const y = e.clientY - rect.top;

                      setDragRect({
                        x: Math.min(dragStart.x, x),
                        y: Math.min(dragStart.y, y),
                        width: Math.abs(x - dragStart.x),
                        height: Math.abs(y - dragStart.y),
                      });
                    }}
                    onMouseUp={() => {
                      if (dragRect) {
                        console.log(
                          "Selected region on page",
                          i + 1,
                          dragRect
                        );
                      }
                      setDragStart(null);
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
                          background: "rgba(0, 112, 243, 0.1)",
                          pointerEvents: "none",
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </Document>
        )}

        {/* Add-to-chat popup (text mode only) */}
        {!regionMode && (
          <div
            ref={popupRef}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();

              if (!pendingSelection) return;

              setSelection(pendingSelection);
              setPendingSelection(null);
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
              fontSize: "14px",
            }}
          >
            Add to chat
          </div>
        )}
      </div>

      {/* Chat Panel */}
      <div style={{ flex: 1, padding: "1rem", borderLeft: "1px solid #ccc" }}>
        {selection ? (
          <div
            style={{
              background: "#333",
              color: "#fff",
              padding: "0.75rem",
              borderRadius: "6px",
              marginBottom: "1rem",
              fontSize: "14px",
            }}
          >
            <strong>Context added (page {selection.page})</strong>
            <p style={{ marginTop: "0.5rem" }}>{selection.text}</p>
          </div>
        ) : (
          <p style={{ fontSize: "14px", color: "#777", marginBottom: "1rem" }}>
            Select text or use region mode to add context.
          </p>
        )}

        <h3>Your Question</h3>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          style={{ width: "100%", height: "80px" }}
        />

        <button
          onClick={askQuestion}
          disabled={!selection || loading}
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
