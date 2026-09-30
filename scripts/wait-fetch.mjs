// Blocks until the running fetch releases .fetch.lock (prints DONE), or
// prints STILL_RUNNING after 9.5 min so a single Bash tool call never times
// out — the daily scheduled run just calls it again until DONE.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCK = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".fetch.lock");
const t0 = Date.now();
// Grace period: called right after starting fetch in the background, the lock
// may not exist yet — don't report DONE before the fetch has even begun.
(function check() {
  if (!existsSync(LOCK) && Date.now() - t0 > 20000) {
    console.log("DONE");
    process.exit(0);
  }
  if (Date.now() - t0 > 570000) {
    console.log("STILL_RUNNING");
    process.exit(0);
  }
  setTimeout(check, 15000);
})();
