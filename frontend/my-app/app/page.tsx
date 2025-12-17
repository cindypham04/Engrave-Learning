"use client";

import { useState } from "react";

export default function Home() {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    if (!event.target.files || event.target.files.length === 0) return;

    const file = event.target.files[0];
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("http://localhost:8000/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    setPdfUrl(data.url);
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={{ flex: 2, borderRight: "1px solid #ccc", padding: "1rem" }}>
        <input type="file" accept="application/pdf" onChange={handleUpload} />
        {pdfUrl && (
          <iframe
            src={pdfUrl}
            width="100%"
            height="90%"
            style={{ marginTop: "1rem" }}
          />
        )}
      </div>

      <div style={{ flex: 1, padding: "1rem" }}>
        CHAT PANEL PLACEHOLDER
      </div>
    </div>
  );
}
