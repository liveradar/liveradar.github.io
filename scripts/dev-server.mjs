/**
 * Local-only dev server (decision S5, 2026-09-17): replaces `python3 -m
 * http.server` so the frontend can have a real "重新抓取最新演出" button.
 * GitHub Pages can't run scripts/fetch.mjs — it's a static host — so that
 * button only works here, against this server, on your own machine. The
 * deployed site has no backend and never will (decision D14 stands for
 * everything except this one local dev convenience).
 *
 * No new dependency: plain node:http + node:child_process, matching the
 * project's "minimal deps" ethos (SPEC D14).
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

let fetchInProgress = false;

function runFetchScript() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", "fetch.mjs")], { cwd: ROOT });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ ok: code === 0, log: output }));
  });
}

async function handleApiFetch(res) {
  if (fetchInProgress) {
    res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "已經有一個抓取在進行中，請稍候。" }));
    return;
  }
  fetchInProgress = true;
  try {
    const result = await runFetchScript();
    res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(result));
  } finally {
    fetchInProgress = false;
  }
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const relativePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.join(ROOT, relativePath);

  // Don't let "../../etc/passwd"-style paths escape the project root.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const body = await readFile(filePath);
    const ext = path.extname(filePath);
    const headers = { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" };
    if (ext === ".json") headers["Cache-Control"] = "no-store"; // same reasoning as src/app.js's fetch(..., {cache: "no-store"})
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/fetch") {
    handleApiFetch(res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`LiveRadar dev server: http://localhost:${PORT}`);
});
