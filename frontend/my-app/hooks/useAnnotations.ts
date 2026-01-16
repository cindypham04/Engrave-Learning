"use client";

import { useEffect, useState } from "react";

/* ---------------- Types ---------------- */

export type Highlight = {
  page: number;
  annotation_id: number;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

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

/* ---------------- Hook ---------------- */

export function useAnnotations(activeFileId: number | null) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [activeAnnotationId, setActiveAnnotationId] = useState<number | null>(
    null
  );
  const [context, setContext] = useState<Context | null>(null);

  /* ---------------- Load file annotations ---------------- */

  useEffect(() => {
    if (!activeFileId) {
      setHighlights([]);
      setActiveAnnotationId(null);
      setContext(null);
      return;
    }

    loadFileAnnotations(activeFileId);
  }, [activeFileId]);

  async function loadFileAnnotations(fileId: number) {
    const res = await fetch(`http://localhost:8000/files/${fileId}/state`);
    if (!res.ok) return;

    const data = await res.json();

    const restored = (data.annotations || [])
      .filter((a: any) => a.geometry)
      .map((a: any) => ({
        page: a.page_number,
        annotation_id: a.id,
        rect: a.geometry,
      }));

    setHighlights(restored);
    setActiveAnnotationId(null);
    setContext(null);
  }

  /* ---------------- Fetch annotation metadata ---------------- */

  async function fetchAnnotation(annotationId: number) {
    const res = await fetch(
      `http://localhost:8000/annotations/${annotationId}`
    );

    if (!res.ok) return null;
    return res.json();
  }

  /* ---------------- Activate annotation ---------------- */

  async function activateAnnotation(annotationId: number) {
    if (!activeFileId) return;

    const annotation = await fetchAnnotation(annotationId);
    if (!annotation) {
      setActiveAnnotationId(null);
      setContext(null);
      return;
    }

    setActiveAnnotationId(annotationId);

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
  }

  /* ---------------- Create text annotation ---------------- */

  async function createTextAnnotation(payload: {
    page: number;
    text: string;
    geometry: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }) {
    if (!activeFileId) return;

    const res = await fetch("http://localhost:8000/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_id: activeFileId,
        page_number: payload.page,
        type: "text",
        geometry: payload.geometry,
        text: payload.text,
      }),
    });

    const data = await res.json();

    setHighlights(prev => [
      ...prev,
      {
        page: payload.page,
        annotation_id: data.annotation_id,
        rect: payload.geometry,
      },
    ]);

    setActiveAnnotationId(data.annotation_id);
    setContext({
      type: "text",
      page: payload.page,
      text: payload.text,
    });
  }

  /* ---------------- Create region annotation ---------------- */

  async function createRegionAnnotation(payload: {
    page: number;
    geometry: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    region_id: string;
  }) {
    setHighlights(prev => [
      ...prev,
      {
        page: payload.page,
        annotation_id: Number(payload.region_id),
        rect: payload.geometry,
      },
    ]);

    setActiveAnnotationId(Number(payload.region_id));
    setContext({
      type: "image",
      region_id: payload.region_id,
      page_number: payload.page,
    });
  }

  /* ---------------- Delete annotation ---------------- */

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

    setHighlights(prev =>
      prev.filter(h => h.annotation_id !== annotationId)
    );

    if (activeAnnotationId === annotationId) {
      setActiveAnnotationId(null);
      setContext(null);
    }
  }

  /* ---------------- Public API ---------------- */

  return {
    highlights,
    context,
    setContext,

    activeAnnotationId,
    activateAnnotation,
    deleteAnnotation,

    addTextAnnotation: createTextAnnotation,
    addRegionAnnotation: createRegionAnnotation,
    };
}
