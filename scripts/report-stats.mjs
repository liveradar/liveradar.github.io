// Prints the two numbers the daily-fetch report needs, so the routine never
// has to improvise `node -e` / grep|head pipelines (those trigger permission prompts).
import { readFileSync } from "node:fs";
const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));
const sources = read("sources.json");
const list = Array.isArray(sources) ? sources : sources.sources ?? Object.values(sources);
const kktix = list.find((s) => /kktix/i.test(s.name ?? s.id ?? ""));
console.log("excluded-cache entries:", Object.keys(read("excluded-cache.json").items).length);
console.log("KKTIX register_info:", JSON.stringify(kktix?.stats?.register_info ?? null));
