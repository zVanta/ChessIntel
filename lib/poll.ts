import type { JobResult } from "@/lib/jobs";

/**
 * Poll an analysis job until it completes. `onDone` receives the persisted
 * result; `onError` receives a human-readable message. Returns a cancel
 * function so callers can stop polling on unmount.
 */
export function pollJob(
  jobId: string,
  onDone: (result: JobResult) => void,
  onError: (message: string) => void,
  intervalMs = 2000
): () => void {
  const timer = setInterval(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        clearInterval(timer);
        onError(data.error || "Could not check analysis status.");
        return;
      }
      if (data.status === "done") {
        clearInterval(timer);
        onDone(data.result as JobResult);
      } else if (data.status === "error") {
        clearInterval(timer);
        onError(data.error || "Analysis failed.");
      }
    } catch {
      // Transient network error while polling — keep trying.
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
