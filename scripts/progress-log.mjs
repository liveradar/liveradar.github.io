import { appendFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const LOG_PATH = path.join(ROOT, "fetch-progress.log");
const HISTORY_DIR = path.join(ROOT, "logs");
const KEEP_RUNS = 7;

// The previous run's log is moved into logs/ instead of overwritten — a slow
// run (2026-09-30: 83 min vs the usual ~16) couldn't be diagnosed afterwards
// because the next run had already wiped its log.
function rotate() {
  if (!existsSync(LOG_PATH)) return;
  mkdirSync(HISTORY_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  renameSync(LOG_PATH, path.join(HISTORY_DIR, `fetch-progress-${stamp}.log`));
  const old = readdirSync(HISTORY_DIR)
    .filter((f) => f.startsWith("fetch-progress-") && f.endsWith(".log"))
    .sort()
    .slice(0, -KEEP_RUNS);
  for (const f of old) unlinkSync(path.join(HISTORY_DIR, f));
}

// Synchronous, unbuffered file writes so progress is visible immediately even
// when stdout is fully-buffered (observed: Node buffers console.log entirely
// until process exit when stdout is a redirected-to-file pipe, which made a
// backgrounded run look hung for minutes with zero visible output).
export function resetProgressLog() {
  rotate();
  writeFileSync(LOG_PATH, `=== run started ${new Date().toISOString()} ===\n`);
}

export function logProgress(message) {
  appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
}
