/**
 * One-at-a-time guard for anything that writes data/*.json.
 *
 * 2026-09-23/24: two Claude sessions (and the daily schedule) ran against
 * the same checkout at the same time — overlapping full fetches, one
 * session's uncommitted edits swept away mid-rebase, and doubled request
 * volume against KKTIX while register_info was already being rate-limited.
 * fetch.mjs reads data/events.json at the start and overwrites it ~25
 * minutes later, so two overlapping runs silently lose whichever finished
 * first. This makes the second one refuse to start instead.
 *
 * The lock is a file (.fetch.lock, gitignored) holding the owner's pid and
 * start time. A lock whose pid is no longer running — e.g. a run killed with
 * `kill` — is treated as stale and taken over, so a crash never leaves the
 * pipeline stuck. MAX_AGE_MS covers the rare case of that pid being reused
 * by an unrelated process.
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCK_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".fetch.lock");
const MAX_AGE_MS = 3 * 60 * 60 * 1000; // no real run takes 3 hours

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists but owned by another user
  }
}

function readLock() {
  try {
    return JSON.parse(readFileSync(LOCK_PATH, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Takes the lock or exits the process (code 2) with a plain explanation.
 * Releases automatically on normal exit, uncaught errors, Ctrl-C and kill.
 */
export function acquireRunLock(label) {
  const held = readLock();
  if (held) {
    const age = Date.now() - Date.parse(held.started_at);
    if (isRunning(held.pid) && age < MAX_AGE_MS) {
      const minutes = Math.round(age / 60000);
      console.error(
        `另一個「${held.label}」正在跑（pid ${held.pid}，${minutes} 分鐘前開始），這次不執行，` +
          `避免兩邊同時改 data/*.json。確定沒有在跑的話，刪掉 ${path.basename(LOCK_PATH)} 再試。`,
      );
      process.exit(2);
    }
    console.error(`發現殘留的鎖定檔（pid ${held.pid} 已不在執行），接手繼續。`);
  }
  writeFileSync(
    LOCK_PATH,
    JSON.stringify({ label, pid: process.pid, host: os.hostname(), started_at: new Date().toISOString() }, null, 2),
  );

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (readLock()?.pid === process.pid) {
      try {
        unlinkSync(LOCK_PATH);
      } catch {
        // already gone — nothing to release
      }
    }
  };
  process.on("exit", release);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      release();
      process.exit(130);
    });
  }
  return release;
}
