// 把新的 public.event_reports 列轉發到 Discord 頻道，這樣有人回報 Max 會
// 直接收到通知，不用自己定期去 Supabase 後台的 Table Editor 看。
//
// 由 Database → Webhooks（Database Webhook）在 event_reports INSERT 時觸發
// ——設定方式見 supabase/schema.sql 最下面「Database Webhook」那段記錄。
//
// 部署：
//   npx supabase functions deploy notify-report --project-ref pfhxrbqburbehmotvtbc --no-verify-jwt
// （--no-verify-jwt 是因為 Database Webhook 打過來沒有使用者 JWT，預設的
// JWT 驗證會擋掉它；改用下面的 WEBHOOK_SECRET 自己驗證。）
//
// 需要的 secrets（部署後用 `npx supabase secrets set` 設定，見 HANDOFF）：
//   DISCORD_WEBHOOK_URL — Discord 頻道的 webhook URL
//   WEBHOOK_SECRET       — 隨機字串，跟 Database Webhook 設定的自訂 header 同一組，
//                          防止別人知道這個 function URL 就能亂打訊息進頻道

const DISCORD_WEBHOOK_URL = Deno.env.get("DISCORD_WEBHOOK_URL");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!DISCORD_WEBHOOK_URL) {
    return new Response("DISCORD_WEBHOOK_URL not configured", { status: 500 });
  }

  const payload = await req.json();
  const r = payload?.record ?? {};

  // Discord rejects content over 2000 chars (-> 400 -> this report would
  // never notify), so cap each user-supplied field; the full text is still
  // in the table.
  const clip = (s: unknown, max: number) => {
    const t = String(s);
    return t.length > max ? `${t.slice(0, max)}…` : t;
  };
  const lines = [
    `**新回報**：${clip(r.event_title ?? "(未知場次)", 200)}`,
    r.description ? `> ${clip(r.description, 1200).replace(/\n/g, "\n> ")}` : null,
    r.event_url ? clip(r.event_url, 250) : null,
    r.page_url ? `來自：${clip(r.page_url, 250)}` : null,
  ].filter(Boolean);

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // allowed_mentions: a report containing "@everyone" must not ping the channel.
    body: JSON.stringify({ content: lines.join("\n"), allowed_mentions: { parse: [] } }),
  });

  return new Response(res.ok ? "ok" : "discord post failed", { status: res.ok ? 200 : 502 });
});
