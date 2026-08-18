"use client";

import { useRef, useState } from "react";
import { pollJob } from "@/lib/poll";

interface Props {
  kidId: number;
  kidName: string;
  onDone?: () => void;
}

export default function ScoreSheetUpload({ kidId, kidName, onDone }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleUpload() {
    if (!selectedFile) {
      setError("Choose a scoresheet photo first.");
      return;
    }
    setUploading(true);
    setError(null);
    setSuccess(false);
    try {
      const form = new FormData();
      form.append("image", selectedFile);
      form.append("kidId", String(kidId));
      const res = await fetch("/api/upload-scoresheet", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      pollJob(
        data.jobId,
        () => {
          setSuccess(true);
          setSelectedFile(null);
          setUploading(false);
          onDone?.();
        },
        (msg) => {
          setError(msg);
          setUploading(false);
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setUploading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium text-slate-700">
        Upload a scoresheet photo for {kidName}
      </p>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setSelectedFile(f);
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setSelectedFile(f);
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
        >
          📷 Take photo
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          🖼 Upload picture
        </button>
        {selectedFile && (
          <span className="text-xs text-slate-500">✓ {selectedFile.name}</span>
        )}
        <button
          onClick={handleUpload}
          disabled={uploading || !selectedFile}
          className="shrink-0 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
        >
          {uploading ? "Reading…" : "Upload"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {success && <p className="mt-2 text-xs text-emerald-600">Report created!</p>}
    </div>
  );
}
