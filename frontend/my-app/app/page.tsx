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

/* ---------------- Main Component ---------------- */

export default function Home() {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);

  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [pendingSelection, setPendingSelection] =
    useState<SelectionContext | null>(null);

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

  /* ---------------- Selection logic ---------------- */

  useEffect(() => {
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
  }, [selection]);

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
                style={{ marginBottom: "1.5rem" }}
              >
                <Page
                  pageNumber={i + 1}
                  renderTextLayer
                  renderAnnotationLayer={false}
                />
              </div>
            ))}
          </Document>
        )}

        {/* Add to chat popup */}
        <div
          ref={popupRef}
          onMouseDown={(e) => {
            e.preventDefault(); // CRITICAL
            e.stopPropagation();

            if (!pendingSelection) return;

            console.log("Context added:", pendingSelection);

            setSelection(pendingSelection);
            setPendingSelection(null);
            hidePopup();
          }}
          style={{
            position: "absolute",
            display: "none",
            background: "#111",
            color: "#ffffffff",
            padding: "6px 10px",
            borderRadius: "6px",
            cursor: "pointer",
            zIndex: 1000,
            fontSize: "14px",
          }}
        >
          Add to chat
        </div>

      </div>

      {/* Chat Panel */}
      <div style={{ flex: 1, padding: "1rem", borderLeft: "1px solid #ccc" }}>
        {selection ? (
          <div
            style={{
              background: "#333333ff",
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
            Select text from the PDF and click “Add to chat”.
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
