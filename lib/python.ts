import { spawn } from "child_process";
import type { AnalysisResult } from "./types";

const SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://127.0.0.1:8000";

export class PythonServiceError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "PythonServiceError";
    this.status = status;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SERVICE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new PythonServiceError(
      `Python service ${path} failed (${res.status}): ${text.slice(0, 400)}`,
      res.status
    );
  }
  return (await res.json()) as T;
}

export interface AnalyzeRequestPayload {
  platform: string;
  username: string;
  kid_name: string;
  max_games: number;
  since_days: number;
  notes?: string;
  answers?: string[];
}

/** Run the full intake pipeline via the FastAPI service. */
export async function analyzeViaService(payload: AnalyzeRequestPayload): Promise<AnalysisResult> {
  return postJson<AnalysisResult>("/analyze", payload);
}

/** Analyze a single PGN (scoresheet / paste path) via the FastAPI service. */
export async function analyzePgnViaService(
  pgn: string,
  kidName: string,
  notes?: string,
  answers?: string[]
): Promise<AnalysisResult> {
  return postJson<AnalysisResult>("/analyze-pgn", {
    pgn,
    kid_name: kidName,
    notes,
    answers,
  });
}

/** Answer a free-form chess question (no game required). */
export async function askViaService(
  question: string,
  kidName?: string,
  notes?: string
): Promise<{ answer: string }> {
  return postJson<{ answer: string }>("/ask", {
    question,
    kid_name: kidName || "Player",
    notes,
  });
}

/** Convert a scoresheet photo (bytes) to PGN via the FastAPI service. */
export async function ocrScoresheet(imageBuffer: Buffer, kidName?: string): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([imageBuffer]), "scoresheet.jpg");
  form.append("kid_name", kidName || "");
  const res = await fetch(`${SERVICE_URL}/ocr`, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new PythonServiceError(
      `Python service /ocr failed (${res.status}): ${text.slice(0, 400)}`,
      res.status
    );
  }
  const data = (await res.json()) as { pgn: string };
  return data.pgn;
}

function spawnPython(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const python = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
    const child = spawn(python, args, { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      stderr += err.message;
      resolve({ code: -1, stdout, stderr });
    });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** CLI fallback: spawn `python chessintel_clone.py --json` and parse its output. */
export async function analyzeWithCli(
  platform: string,
  username: string,
  kidName: string,
  maxGames: number
): Promise<AnalysisResult> {
  const { code, stdout, stderr } = await spawnPython([
    "chessintel_clone.py",
    "--platform",
    platform,
    "--username",
    username,
    "--games",
    String(maxGames),
    "--kid",
    kidName,
    "--json",
  ]);
  if (code !== 0) {
    throw new Error(`chessintel_clone.py exited with ${code}: ${stderr.slice(0, 400)}`);
  }
  try {
    return JSON.parse(stdout) as AnalysisResult;
  } catch {
    throw new Error(`Could not parse chessintel_clone.py output: ${stdout.slice(0, 400)}`);
  }
}

/**
 * Run analysis, preferring the FastAPI service and falling back to the CLI.
 * (The OCR path always requires the service; this fallback only covers the
 * platform-fetch analysis path.)
 */
export async function runAnalysis(
  payload: AnalyzeRequestPayload
): Promise<AnalysisResult> {
  try {
    return await analyzeViaService(payload);
  } catch (err) {
    if (err instanceof PythonServiceError) {
      // Re-raise deliberate service errors (e.g. bad input) rather than falling back.
      throw err;
    }
    // The CLI fallback is for local development only, where Python and its
    // dependencies (python-chess, Stockfish) are installed on the host. The
    // Docker web image has no Python chess stack, so in production surface the
    // real error instead of a confusing "No module named 'chess'".
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `Python service is unreachable: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return analyzeWithCli(payload.platform, payload.username, payload.kid_name, payload.max_games);
  }
}
