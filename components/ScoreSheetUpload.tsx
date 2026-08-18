"use client";

import { useRef, useState } from "react";
import { pollJob } from "@/lib/poll";

interface Props {
  kidId: number;
  kidName: string;
  onDone?: () => void;
}

export default function ScoreSheetUpload({ kidId, kidName, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a scoresheet photo first.");
      return;
    }
    setUploading(true);
    setError(null);
    setSuccess(false);
    try {
      const form = new FormData();
      form.append("image", file);
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
          if (fileRef.current) fileRef.current.value = "";
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
      <div className="mt-2 flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="block w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-xs file:font-medium"
        />
        <button
          onClick={handleUpload}
          disabled={uploading}
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
