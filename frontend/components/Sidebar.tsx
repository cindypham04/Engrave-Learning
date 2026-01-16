"use client";

import { useRef, useState } from "react";

/* ---------------- Types ---------------- */

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

type SidebarProps = {
  folders: Folder[];
  files: FileItem[];
  activeFileId: number | null;

  onSelectFile: (id: number) => void | Promise<void>;

  onUploadFile: (file: File) => void | Promise<void>;
  onCreateFolder: () => void | Promise<void>;

  onRenameFolder: (id: number, name: string) => void | Promise<void>;
  onRenameFile: (id: number, name: string) => void | Promise<void>;

  onDeleteFolder: (id: number) => void | Promise<void>;
  onDeleteFile: (id: number) => void | Promise<void>;
};

/* ---------------- Component ---------------- */

export default function Sidebar({
  folders,
  files,
  activeFileId,
  onSelectFile,
  onUploadFile,
  onCreateFolder,
  onRenameFolder,
  onRenameFile,
  onDeleteFolder,
  onDeleteFile,
}: SidebarProps) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [renamingFileId, setRenamingFileId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderHoldTimeoutRef = useRef<number | null>(null);
  const didTriggerHoldRef = useRef(false);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflowY: "auto",
        borderRight: "1px solid #000",
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) onUploadFile(file);
        }}
      />

      {/* Header */}
      <div
        style={{
          padding: "8px",
          borderBottom: "1px solid #333",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontWeight: 600,
        }}
      >
        <span>Workspace</span>
        <span
          style={{ cursor: "pointer" }}
          onClick={() => setAddMenuOpen(v => !v)}
        >
          +
        </span>
      </div>

      {/* Add menu */}
      {addMenuOpen && (
        <div
          style={{
            margin: "6px",
            padding: "6px",
            borderRadius: "6px",
            background: "#e6f0ff",
          }}
        >
          <div
            style={{ padding: "6px", cursor: "pointer" }}
            onClick={() => {
              setAddMenuOpen(false);
              fileInputRef.current?.click();
            }}
          >
            Upload PDF
          </div>

          <div
            style={{ padding: "6px", cursor: "pointer" }}
            onClick={() => {
              setAddMenuOpen(false);
              onCreateFolder();
            }}
          >
            New Folder
          </div>
        </div>
      )}

      {/* Folders */}
      {folders.map(folder => (
        <div
          key={folder.id}
          style={{
            padding: "8px",
            cursor: "pointer",
            fontWeight: 500,
          }}
          onMouseDown={() => {
            didTriggerHoldRef.current = false;

            folderHoldTimeoutRef.current = window.setTimeout(() => {
              didTriggerHoldRef.current = true;
              setRenamingFolderId(folder.id);
              setRenameValue(folder.name);
            }, 1200);
          }}
          onMouseUp={() => {
            if (folderHoldTimeoutRef.current) {
              clearTimeout(folderHoldTimeoutRef.current);
              folderHoldTimeoutRef.current = null;
            }
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
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={() => {
                onRenameFolder(folder.id, renameValue);
                setRenamingFolderId(null);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  onRenameFolder(folder.id, renameValue);
                  setRenamingFolderId(null);
                }
                if (e.key === "Escape") {
                  setRenamingFolderId(null);
                }
              }}
            />
          ) : (
            <div
              style={{ display: "flex", justifyContent: "space-between" }}
            >
              <span>{folder.name}</span>
              <span
                style={{ color: "#e53935", cursor: "pointer" }}
                onClick={e => {
                  e.stopPropagation();
                  onDeleteFolder(folder.id);
                }}
              >
                ✕
              </span>
            </div>
          )}
        </div>
      ))}

      {/* Files */}
      {files.map(file => (
        <div
          key={file.id}
          style={{
            padding: "8px",
            cursor: "pointer",
            background:
              file.id === activeFileId ? "#e5f0ff" : "transparent",
          }}
          onClick={() => onSelectFile(file.id)}
          onDoubleClick={e => {
            e.stopPropagation();
            setRenamingFileId(file.id);
            setRenameValue(file.title);
          }}
        >
          {renamingFileId === file.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={() => {
                onRenameFile(file.id, renameValue);
                setRenamingFileId(null);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  onRenameFile(file.id, renameValue);
                  setRenamingFileId(null);
                }
                if (e.key === "Escape") {
                  setRenamingFileId(null);
                }
              }}
            />
          ) : (
            <div
              style={{ display: "flex", justifyContent: "space-between" }}
            >
              <span>{file.title}</span>
              <span
                style={{ color: "#e53935", cursor: "pointer" }}
                onClick={e => {
                  e.stopPropagation();
                  onDeleteFile(file.id);
                }}
              >
                ✕
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
