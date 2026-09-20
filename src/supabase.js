/**
 * Supabase client singleton + thin auth helpers (replaces Gist sync, 2026-09-20).
 * No bundler here (SPEC D14) — supabase-js is a plain relative-path ES module
 * import, same as every other browser-side import in this project.
 *
 * Vendored locally (2026-09-20) rather than imported from esm.sh at runtime:
 * that CDN URL was pinned to an exact version, but esm.sh doesn't actually
 * serve a self-contained file at that URL — it re-exports a tree of further
 * esm.sh-hosted submodules (auth-js, postgrest-js, realtime-js, a node
 * shim...), none of which are pinned or checkable (ES module `import`
 * doesn't support Subresource Integrity), so the app was trusting esm.sh's
 * live infrastructure on every page load. See vendor/README.md for how
 * vendor/supabase-js.min.mjs was produced and how to regenerate it on a
 * version bump.
 *
 * Google-only (2026-09-20): email/password sign-up was cut — Supabase's
 * confirmation/reset emails come from its own shared domain with no custom
 * branding on the Free plan (editing the templates requires custom SMTP,
 * which needs its own domain to be trustworthy), so anyone who got one
 * risked reading it as spam and never signing in. Google's OAuth screen has
 * no such trust problem, and this app only ever needed "an account", not
 * specifically a password — so the simplest fix was dropping password auth
 * outright rather than trying to make the confirmation email look legitimate.
 */
import { createClient } from "../vendor/supabase-js.min.mjs";

const SUPABASE_URL = "https://pfhxrbqburbehmotvtbc.supabase.co";
// The anon/publishable key is designed to be public in frontend code — it's
// not a secret, access control is enforced by Postgres RLS policies on the
// user_prefs table, not by hiding this key.
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmaHhyYnFidXJiZWhtb3R2dGJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4Mjk0NDgsImV4cCI6MjEwNTQwNTQ0OH0.6V32WEjecDHMgQ1A_6uVKF_RsW79PpLHBqsGRTi2cpo";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signInWithGoogle(redirectTo) {
  const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}
