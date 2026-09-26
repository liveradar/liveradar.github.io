import { createUtkAdapter } from "./utk.mjs";

// 年代售票 (ticket.com.tw), the same underlying UTK ticketing platform as
// 寬宏 (kham.mjs) under a different HTML template — see utk.mjs.
export const { name, priority, fetch } = createUtkAdapter({ name: "年代", priority: 10, host: "ticket.com.tw" });
