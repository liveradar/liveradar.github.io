# vendor/

Third-party browser code vendored into this repo instead of imported from a
CDN at runtime.

## supabase-js.min.mjs

`@supabase/supabase-js@2.116.0`, bundled into a single dependency-free ESM
file with esbuild. Previously this was imported directly from
`https://esm.sh/@supabase/supabase-js@2.116.0` — that URL is pinned to an
exact version but re-exports a tree of further esm.sh-hosted submodules
(`/@supabase/auth-js@...`, `/node/process.mjs`, etc.), so the app was still
trusting esm.sh's live infrastructure on every page load with no way to
pin or verify those sub-requests (ES module imports don't support
Subresource Integrity). Vendoring removes that runtime dependency: this file
is committed to the repo and served as a static asset, same as everything
else in the project (SPEC D14, no build step for the *app* — this bundle was
produced once, ahead of time, the same way any vendored third-party file is).

Regenerate after bumping the version:

```bash
npm install --no-save @supabase/supabase-js@<version> esbuild
cat > .vendor-entry.mjs <<'JS'
export { createClient } from "@supabase/supabase-js";
JS
npx esbuild .vendor-entry.mjs --bundle --format=esm --platform=browser \
  --minify --outfile=vendor/supabase-js.min.mjs
rm .vendor-entry.mjs
```

Then update the version number in this file and in `src/supabase.js`'s
top comment.
