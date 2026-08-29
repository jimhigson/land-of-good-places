# Deploy notes

A running log of the deployment setup, so anyone (human or agent) picking this
up mid-flight knows exactly where things stand. Append one line per meaningful
step. Newest at the bottom.

## Where things stand

**Fully automatic. Nothing is blocked, nothing needs a human.** Push to `main`
and the game is live in about 40 seconds.

- **Live:** <https://landofgoodplaces.blockstack.ing> (share this one) and
  <https://land-of-good-places.blockstack.workers.dev> (fallback).
- **Target:** Cloudflare Workers, assets-only (see `wrangler.jsonc`). Chosen
  over GitHub Pages because it serves from the **root** of a domain, which the
  PWA wants (Pages would give a `/land-of-good-places/` sub-path, needing a
  Vite `base` and a scoped service worker).
- **Repo:** <https://github.com/jimhigson/land-of-good-places> (private).
- **CI:** `.github/workflows/deploy.yml` — on push to `main`: `npm ci`,
  `npm run build`, `wrangler deploy`. Re-running it is safe (idempotent).
- **Secrets:** `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` both set.

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
- 2026-07-26 — `CLOUDFLARE_API_TOKEN` secret added. CI run `30202909951`
  deployed the real game (11 assets) to the real account end to end:
  <https://land-of-good-places.blockstack.workers.dev>. The throwaway preview
  account above is now irrelevant. **Autonomous deploys are active.**
- 2026-07-26 — added the `landofgoodplaces.blockstack.ing` custom domain to
  `wrangler.jsonc`. The token's zone permissions were sufficient; Cloudflare
  provisioned the DNS record and certificate on deploy, no dashboard clicks.
- 2026-07-26 — **gotcha:** adding `routes` made Wrangler disable workers.dev by
  default, 404-ing the fallback URL. Fixed by setting `workers_dev: true` and
  `preview_urls: true` explicitly. If you ever add another route, keep those.
  Verified afterwards: both hostnames return 200 for `/`,
  `/manifest.webmanifest`, `/sw.js`, and a deep link (SPA fallback).
- 2026-08-29 — **the site silently stopped moving, and we misdiagnosed it
  twice.** Live sat on `0a5f0380` while `main` was five commits ahead. Nothing
  was red. Found only because Jim said "Deployed still has the old cat bus",
  and unstuck by hand with `gh workflow run deploy.yml`.

  **The real cause was the job timeout, not concurrency.** `deploy.yml` had
  `timeout-minutes: 15`, and **GitHub reports a job timeout as `cancelled`** —
  identical, in the run list, to a concurrency cancellation. Job durations,
  start to end:

  | run | duration | conclusion | |
  |---|---|---|---|
  | 33261937341 | 15m02s | cancelled | timeout |
  | 33264088797 | 15m07s | cancelled | timeout |
  | 33267247275 | 15m15s | cancelled | timeout |
  | 33273801404 | 15m15s | cancelled | timeout |
  | 33269930221 | 14m59s | **success** | one second under the cap |
  | 33273766100 | 1m04s | cancelled | genuinely superseded by a merge |

  **Read the duration, not the conclusion.** A concurrency cancellation dies in
  ~1-2 minutes, when the next merge lands. A timeout dies at exactly the cap.
  Both were happening; only the timeout killed runs that had no successor to
  finish the job for them, so only the timeout could leave the site stale.

  The cap was below the work: the `Build` step runs the whole `npm run build`
  chain, and its sibling job — `procgen-invariants.yml`'s "Build and checks",
  the *identical* chain — measured 14m59s, 15m49s and 15m52s the same evening
  under a 30-minute budget. Deploy did that chain **plus** publishing on 15.
  Raised to 30 to match the sibling, plus headroom for the publish.

  Fixed three ways:
  1. `timeout-minutes: 15` → `30`. This is what restores deploys.
  2. `cancel-in-progress: false` — a deploy is a publish step, not a CI check,
     so the last one must always run. Real, but the secondary cause.
  3. `npm run check:live-version` + `.github/workflows/live-version.yml` ask
     the live site what commit it is serving, after every Deploy run *however
     it ended*, on a half-hourly cron, and on demand — opening a GitHub issue
     when it is behind. **This is the one that would have caught it**, because
     it is cause-agnostic: it never asks whether a run succeeded, only what is
     served. It is also what makes a generous timeout safe, since a timeout is
     no longer silent.

  **If you are ever wondering again whether live is current, that is one
  command:** `npm run check:live-version`.

- 2026-08-29 — **open question: should the deploy job run the check suite at
  all?** Measured, not assumed:

  - `npx vite build` alone, locally: **191 ms** (`✓ built in 191ms`, 36
    precache entries, `dist/sw.js` written). The artefact this job exists to
    publish takes a fifth of a second to produce.
  - `npm run build` — the 47-step chain in front of it: **~15 minutes** in CI.
  - `procgen-invariants.yml` triggers on `push: branches: [main]`, so that
    identical chain **already runs on every commit that deploys**, concurrently,
    in a job with its own 30-minute budget.

  So the publish step spends ~15 minutes re-running QA that is running anyway,
  on the same commit, to build something that takes 191 ms. That is what put
  the runtime against the ceiling, and raising the cap only buys time until the
  chain grows again.

  **But the naive fix is a coverage cut, so it was not made here.** Today, if
  `npm run build` fails, `wrangler deploy` is skipped — "a broken build never
  ships", recorded in this file on 2026-07-26. Swapping the step for
  `npx vite build` keeps compile errors blocking a publish but lets a failing
  *check* (`check:park`, `check:cat-bus`, …) ship. CLAUDE.md is explicit that a
  check which stops covering something must say so audibly; doing it quietly to
  save 15 minutes is exactly the trade this repo keeps regretting.

  **The version that loses nothing:** trigger `deploy.yml` from
  `workflow_run` of "Procgen invariants" **completed + success** on `main`
  instead of from `push`, and have it do `npx vite build` + `wrangler deploy`.
  The full gate still blocks publishing — it just does it once instead of
  twice — and a deploy becomes ~1-2 minutes, dominated by `npm ci`. The care
  needed: a `workflow_run` job checks out the default branch's HEAD by default,
  so it must check out the triggering run's own sha explicitly, or it will
  publish something other than the commit that passed. Not done tonight because
  getting it wrong means no deploys at all; worth its own PR and its own
  review.
