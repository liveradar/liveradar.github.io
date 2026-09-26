import { createUtkAdapter } from "./utk.mjs";

// 寬宏售票系統 (kham.com.tw). Priority between ibon(7)/OPENTIX(8) and 年代(10)
// — see dedup.mjs's SOURCE_PRIORITY. See utk.mjs for the shared scrape logic.
export const { name, priority, fetch } = createUtkAdapter({ name: "寬宏", priority: 9, host: "kham.com.tw" });
