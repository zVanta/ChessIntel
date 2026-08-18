/**
 * In-memory job store for long-running analyses.
 *
 * The fetch → engine → LLM pipeline can take longer than Cloudflare's 100s
 * origin timeout, so the API returns a job id immediately and the work runs
 * in the background of the Node process (self-hosted `next start` keeps the
 * process alive). Clients poll GET /api/jobs/[id] until the job is done.
 */

import type { Report } from "@/lib/types";

export type JobStatus = "pending" | "done" | "error";

export interface JobResult {
  report: Report;
  followup: unknown;
  game_count: number;
}

export interface Job {
  id: string;
  status: JobStatus;
  createdAt: number;
  result?: JobResult | null;
  error?: string;
}

const jobs = new Map<string, Job>();

export function createJob(): Job {
  const job: Job = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    status: "pending",
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function completeJob(id: string, result: JobResult): void {
  const job = jobs.get(id);
  if (job) {
    job.status = "done";
    job.result = result;
  }
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (job) {
    job.status = "error";
    job.error = error;
  }
}

// Best-effort pruning so the map doesn't grow without bound.
setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60; // 1 hour
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}, 1000 * 60 * 15);
