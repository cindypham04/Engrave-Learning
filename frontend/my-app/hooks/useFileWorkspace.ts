"use client";

import { useEffect, useRef, useState } from "react";

type Folder = {
  id: number;
  name: string;
  parent_id: number | null;
};

type FileItem = {
  id: number;
  title: string;
  folder_id: number | null;
};

export function useFileWorkspace() {
  /* ---------------- state ---------------- */

  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);

  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [activeFileId, setActiveFileId] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeFileTitle, setActiveFileTitle] = useState<string | null>(null);

  /* ---------------- load folders ---------------- */

  useEffect(() => {
    const url =
      currentFolderId === null
        ? "http://localhost:8000/folders"
        : `http://localhost:8000/folders?parent_id=${currentFolderId}`;

    fetch(url)
      .then(res => res.json())
      .then(data => setFolders(data.folders ?? []));
  }, [currentFolderId]);

  /* ---------------- load files (once) ---------------- */

  useEffect(() => {
    fetch("http://localhost:8000/files")
      .then(res => res.json())
      .then(data =>
        setFiles(Array.isArray(data) ? data : data.files ?? [])
      );
  }, []);

  /* ---------------- folder actions ---------------- */

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

  async function renameFolder(folderId: number, newName: string) {
    if (!newName.trim()) return;

    await fetch(`http://localhost:8000/folders/${folderId}/rename`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newName }),
    });

    setFolders(prev =>
      prev.map(f => (f.id === folderId ? { ...f, name: newName } : f))
    );
  }

  async function deleteFolder(folderId: number) {
    const ok = confirm("Delete this folder and all its contents?");
    if (!ok) return;

    await fetch(`http://localhost:8000/folders/${folderId}`, {
      method: "DELETE",
    });

    setFolders(prev => prev.filter(f => f.id !== folderId));
  }

  /* ---------------- file actions ---------------- */

  function triggerUpload() {
    fileInputRef.current?.click();
  }

  async function uploadPdf(file: File) {
    const formData = new FormData();
    formData.append("file", file);

    if (currentFolderId !== null) {
      formData.append("folder_id", String(currentFolderId));
    }

    const res = await fetch("http://localhost:8000/upload", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      alert("Upload failed");
      return;
    }

    const data = await res.json();

    if (!data?.file_id) return;

    const newFile = {
      id: data.file_id,
      title: data.title,
      folder_id: currentFolderId,
    };

    setFiles(prev => [newFile, ...prev]);
    setActiveFileId(data.file_id);
  }

  async function renameFile(fileId: number, newTitle: string) {
    if (!newTitle.trim()) return;

    await fetch(`http://localhost:8000/files/${fileId}/rename`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });

    setFiles(prev =>
      prev.map(f => (f.id === fileId ? { ...f, title: newTitle } : f))
    );
  }

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

    setFiles(prev => prev.filter(f => f.id !== fileId));

    if (activeFileId === fileId) {
      setActiveFileId(null);
    }
  }

  function selectFile(fileId: number) {
    const file = files.find(f => f.id === fileId);
    if (!file) return;

    setActiveFileId(fileId);
    setActiveFileTitle(file.title);
    }


  /* ---------------- helpers ---------------- */

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

  /* ---------------- public API ---------------- */

  return {
    // core data
    files,
    folders,
    visibleFiles,
    visibleFolders,

    // active state
    activeFileId,
    activeFileTitle,
    currentFolderId,

    // navigation
    selectFile,
    setCurrentFolderId,

    // folder actions
    createFolder,
    renameFolder,
    deleteFolder,

    // file actions
    uploadFile: uploadPdf,
    renameFile,
    deleteFile,

    // upload helpers
    triggerUpload,
    fileInputRef,
};
}
