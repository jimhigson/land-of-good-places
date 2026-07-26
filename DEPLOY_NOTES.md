# Deploy notes

A running log of the deployment setup, so anyone (human or agent) picking this
up mid-flight knows exactly where things stand. Append one line per meaningful
step. Newest at the bottom.

## Where things stand

- **Target:** Cloudflare Workers, assets-only (see `wrangler.jsonc`). Chosen
  over GitHub Pages because it serves from the **root** of a `workers.dev`
  URL, which the planned PWA wants (Pages would give a `/land-of-good-places/`
  sub-path, needing a Vite `base` and a scoped service worker).
- **Repo:** <https://github.com/jimhigson/land-of-good-places> (private).
- **CI:** `.github/workflows/deploy.yml` — on push to `main`: `npm ci`,
  `npm run build`, `wrangler deploy`. Re-running it is safe (idempotent).
- **Blocked on:** `CLOUDFLARE_API_TOKEN` repo secret (see README). Everything
  else is in place.

## Log

- 2026-07-26 — `git init` (branch `main`), `.gitignore` written, initial WIP
  import committed.
- 2026-07-26 — private GitHub repo `jimhigson/land-of-good-places` created,
  `origin` set, `main` pushed.
- 2026-07-26 — `CLOUDFLARE_ACCOUNT_ID` secret set on the repo
  (`d3b7d07b806dc96e2d8127fae736a0fd`).
- 2026-07-26 — `wrangler.jsonc` + `.github/workflows/deploy.yml` + `README.md`
  committed and pushed.
- 2026-07-26 — first CI run failed at the **Build** step, as expected: the game
  is mid-construction (`src/main.ts` did not exist yet, and `tsc --noEmit`
  flagged an unused variable). The deploy step was correctly skipped — a
  broken build never ships.
- 2026-07-26 — local `wrangler` login is expired and cannot be renewed
  non-interactively; the Cloudflare MCP credentials are read-only for Workers
  (write calls return `10000 Authentication error`). So a real-account deploy
  needs the API token.
- 2026-07-26 — to get *something* online meanwhile, deployed a placeholder
  "under construction" page via `wrangler deploy --temporary` (unauthenticated
  throwaway preview account): <https://land-of-good-places.ionized-gem.workers.dev>
  — verified HTTP 200. This is **temporary** and not on the real account; it
  goes away, and it is replaced the moment CI can deploy for real.
