"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/Button";

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

type FileResult = {
  filename: string;
  parsedCount?: number;
  matched?: number;
  newSubs?: number;
  trialVerify?: number;
  error?: string;
};

type UploadPhase = "staging" | "uploading" | "done";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * UploadModal — the outer shell owns only the AnimatePresence gate.
 * UploadModalBody is mounted fresh each time the modal opens (via `key`),
 * so state always starts clean without setState-in-effect lint violations.
 */
export function UploadModal({ open, onClose, onSuccess }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <UploadModalBody
          key="upload-body"
          onClose={onClose}
          onSuccess={onSuccess}
        />
      )}
    </AnimatePresence>
  );
}

type BodyProps = {
  onClose: () => void;
  onSuccess: () => void;
};

function UploadModalBody({ onClose, onSuccess }: BodyProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<UploadPhase>("staging");
  const [results, setResults] = useState<FileResult[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const accepted = Array.from(incoming).filter((f) => {
      const name = f.name.toLowerCase();
      return (
        name.endsWith(".csv") ||
        name.endsWith(".pdf") ||
        f.type === "text/csv" ||
        f.type === "application/pdf"
      );
    });
    if (accepted.length === 0) return;
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...accepted.filter((f) => !existing.has(f.name))];
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) addFiles(e.target.files);
      // reset so same file can be picked again
      e.target.value = "";
    },
    [addFiles],
  );

  const removeFile = useCallback((name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  const handleUpload = useCallback(async () => {
    if (files.length === 0 || phase !== "staging") return;
    setPhase("uploading");

    const body = new FormData();
    for (const f of files) {
      body.append("files", f);
    }

    let fileResults: FileResult[] = [];
    let anySuccess = false;

    try {
      const res = await fetch("/api/statements/upload", {
        method: "POST",
        body,
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok || !data) {
        fileResults = files.map((f) => ({
          filename: f.name,
          error: res.ok ? "Unexpected response from server." : `HTTP ${res.status}`,
        }));
      } else {
        const payload = data as { files?: FileResult[]; results?: FileResult[] };
        const returnedResults = payload.files ?? payload.results;
        if (Array.isArray(returnedResults)) {
          fileResults = returnedResults;
          anySuccess = fileResults.some((r) => !r.error);
        } else {
          fileResults = files.map((f) => ({
            filename: f.name,
            error: "Malformed response.",
          }));
        }
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Network error.";
      fileResults = files.map((f) => ({ filename: f.name, error: msg }));
    }

    setResults(fileResults);
    setPhase("done");
    if (anySuccess) onSuccess();
  }, [files, phase, onSuccess]);

  const isDone = phase === "done";
  const isUploading = phase === "uploading";
  const hasFiles = files.length > 0;

  return (
    <motion.div
      key="upload-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-headline"
      aria-busy={isUploading}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, scale: 0.98, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 10, scale: 0.98, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        className="relative w-full max-w-xl bg-[#0d0d0d] border border-[#262626] rounded-2xl p-8"
        onClick={(e) => e.stopPropagation()}
      >
            {/* Header */}
            <div className="mb-6">
              <div className="eyebrow text-[#F38B00] mb-3">
                STATEMENT UPLOAD
              </div>
              <h2
                id="upload-headline"
                className="display text-[28px] leading-tight"
              >
                Show us what you&apos;re paying.
              </h2>
              <p className="text-[14px] text-[#8a8a8a] mt-2 leading-snug">
                CSV parses instantly. PDF goes through Aria — adds ~20s per file.
              </p>
            </div>

            <div className="hairline mb-6" />

            {/* Drop zone — shown only when no files are staged yet */}
            <AnimatePresence initial={false}>
              {!hasFiles && !isDone && (
                <motion.div
                  key="dropzone"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                  className="overflow-hidden"
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Drop files here or click to browse"
                    className={[
                      "flex items-center justify-center rounded-xl border border-dashed px-6 py-10 cursor-pointer",
                      "transition-colors duration-200 outline-none",
                      "focus-visible:ring-2 focus-visible:ring-[#F38B00]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0d]",
                      dragOver
                        ? "border-[#F38B00] bg-[#F38B00]/5"
                        : "border-[#3a3a3a] hover:border-[#F38B00] bg-transparent",
                    ].join(" ")}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        inputRef.current?.click();
                      }
                    }}
                  >
                    <span className="mono text-[13px] text-[#555] select-none">
                      drop files here · or click to browse
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-[#555] mono">
                    .csv · .pdf · multi-file supported
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Staged file list */}
            <AnimatePresence initial={false}>
              {hasFiles && !isDone && (
                <motion.div
                  key="file-list"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                  className="overflow-hidden"
                >
                  <ul
                    className="divide-y divide-[#1a1a1a]"
                    aria-label="Staged files"
                  >
                    {files.map((f) => (
                      <li
                        key={f.name}
                        className="flex items-center justify-between gap-4 py-2.5"
                      >
                        <span className="mono text-[13px] text-[#ededed] truncate min-w-0">
                          {f.name}
                        </span>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="mono text-[12px] text-[#555]">
                            {formatBytes(f.size)}
                          </span>
                          {!isUploading && (
                            <button
                              type="button"
                              aria-label={`Remove ${f.name}`}
                              onClick={() => removeFile(f.name)}
                              className="text-[#555] hover:text-[#ff8a8a] transition-colors text-[13px] mono leading-none"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>

                  {/* Add more files drop target — compact version */}
                  {!isUploading && (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="Add more files"
                      className={[
                        "mt-3 flex items-center justify-center rounded-lg border border-dashed px-4 py-3 cursor-pointer",
                        "transition-colors duration-200 outline-none",
                        "focus-visible:ring-2 focus-visible:ring-[#F38B00]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0d]",
                        dragOver
                          ? "border-[#F38B00] bg-[#F38B00]/5"
                          : "border-[#3a3a3a] hover:border-[#F38B00]",
                      ].join(" ")}
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onClick={() => inputRef.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          inputRef.current?.click();
                        }
                      }}
                    >
                      <span className="mono text-[12px] text-[#555] select-none">
                        + add more files
                      </span>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Results */}
            <AnimatePresence initial={false}>
              {isDone && results.length > 0 && (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <ul
                    className="divide-y divide-[#1a1a1a]"
                    aria-label="Upload results"
                  >
                    {results.map((r) => (
                      <li
                        key={r.filename}
                        className="flex items-start justify-between gap-6 py-3"
                      >
                        <span className="mono text-[13px] text-[#ededed] truncate min-w-0 shrink">
                          {r.filename}
                        </span>
                        <span
                          className={[
                            "mono text-[12px] text-right shrink-0",
                            r.error ? "text-[#ff8a8a]" : "text-[#10b981]",
                          ].join(" ")}
                        >
                          {r.error
                            ? `error: ${r.error}`
                            : buildSuccessString(r)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="hairline mt-6 mb-6" />

            {/* Footer */}
            <div className="flex items-center justify-between gap-3">
              <Button variant="ghost" size="md" onClick={onClose}>
                {isDone ? "Done" : "Cancel"}
              </Button>

              {!isDone && (
                <Button
                  variant="primary"
                  size="md"
                  disabled={files.length === 0 || isUploading}
                  onClick={handleUpload}
                >
                  {isUploading ? "Uploading…" : "Upload"}
                </Button>
              )}
            </div>
          </motion.div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.pdf,text/csv,application/pdf"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFileInput}
      />
    </motion.div>
  );
}

function buildSuccessString(r: FileResult): string {
  const parts: string[] = [
    `${r.parsedCount ?? 0} charges · matched ${r.matched ?? 0} · new ${r.newSubs ?? 0}`,
  ];
  if (r.trialVerify && r.trialVerify > 0) {
    parts.push(`${r.trialVerify} trial verify`);
  }
  return parts.join(" · ");
}
