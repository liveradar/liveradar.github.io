/**
 * Sends one message to a Discord channel. Used by the daily-fetch scheduled
 * task (2026-10-05) to say "I aborted" — PushNotification is skipped whenever
 * Max is looking at the app, and a silent abort cost two days of data
 * (10/03, 10/04), so the alert has to reach his phone regardless.
 *
 * Usage: node scripts/notify-discord.mjs "message"
 * Prints SENT, or NOT_SENT: <reason> (always exits 0 — a failed alert must
 * never fail the run it is reporting on).
 *
 * The webhook URL is a secret, so it is NOT in the repo: it is read from
 * $LIVERADAR_DISCORD_WEBHOOK, else ~/.config/liveradar/discord-webhook.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function webhookUrl() {
  if (process.env.LIVERADAR_DISCORD_WEBHOOK) return process.env.LIVERADAR_DISCORD_WEBHOOK.trim();
  try {
    return readFileSync(path.join(homedir(), ".config", "liveradar", "discord-webhook"), "utf8").trim();
  } catch {
    return "";
  }
}

const message = process.argv.slice(2).join(" ").trim();
const url = webhookUrl();

if (!message) {
  console.log("NOT_SENT: no message given");
} else if (!url.startsWith("https://discord.com/api/webhooks/") && !url.startsWith("https://discordapp.com/api/webhooks/")) {
  console.log("NOT_SENT: webhook URL missing or not a Discord webhook (see header of scripts/notify-discord.mjs)");
} else {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message.slice(0, 1900) }), // Discord's limit is 2000 chars
    });
    console.log(res.ok ? "SENT" : `NOT_SENT: Discord answered HTTP ${res.status}`);
  } catch (err) {
    console.log(`NOT_SENT: ${err.message}`);
  }
}
