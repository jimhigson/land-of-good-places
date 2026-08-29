# Handoff — deploy concurrency / live-staleness check

Branch `fix/deploy-concurrency`, worktree `.claude/worktrees/deploy-concurrency`.

## The defect

`.github/workflows/deploy.yml` had `concurrency: {group: deploy-main,
cancel-in-progress: true}`. A second merge landing during a deploy **cancelled**
it. The workflow is also what publishes the site, so the net effect was the live
site stuck on `0a5f0380` while `main` was five commits ahead — surfaced nowhere,
because a cancelled run looks like an ordinary grey tick. Found only because Jim
said "Deployed still has the old cat bus".

## Survey of the other workflows (done)

- `pr-preview.yml` — `pr-preview-${{ pr number }}`, cancel true. Correct as is:
  per-PR, and only the newest push's preview matters.
- `procgen-invariants.yml` — `procgen-invariants-${{ github.ref }}`, cancel
  true. Correct: a CI check, superseded by the newer commit's run.
- `update-adoption.yml` — same shape, same reasoning.
- None of them share the `deploy-main` group, and `deploy.yml` has a **single
  job with no `needs:`**, so queuing has no dependency interaction to get wrong.

## What is being added

1. `cancel-in-progress: false` on `deploy-main`. Done.
2. `src/version-file.ts` — one owner for the `version.txt` name/URL path, which
   was previously written by `vite.config.ts` and fetched by
   `src/version-check.ts` as two hand-kept-in-step literals.
3. `scripts/check-live-version.mts` + `npm run check:live-version` — fetches
   `/version.txt` from the live host (read out of `wrangler.jsonc`'s
   `routes[].custom_domain` entry, never hand-copied) and compares it with the
   head of the remote's default branch (`git ls-remote origin HEAD`, so no
   branch name is hand-copied either). Polls, then fails non-zero.
4. `.github/workflows/live-version.yml` — runs it on a schedule, on
   `workflow_dispatch`, and on **`workflow_run` of Deploy completing**. That
   last trigger is why the check does not live inside `deploy.yml`: a *cancelled*
   deploy runs none of its own steps, so a post-deploy step is structurally
   unable to see the exact failure this PR is about. On failure it opens/updates
   a GitHub issue so a human sees it rather than a log nobody reads.

Deliberately **not** in the `build` chain: it makes a network call and asserts
something about production, so it would go red on every PR of a stale branch.

## Red proof (29 Aug 2026, live head `958321815761759823c4596bc47bc2cb716c2953`)

Both failure paths were watched going red, not assumed. **The transcript below
is only meaningful against that live sha** — once `main` moves and a deploy
lands, `--expect=0a5f0380…` is still wrong and still fails, but the "live says"
line will read differently.

1. Wrong expected commit —
   `LIVE_VERSION_TIMEOUT_MS=12000 LIVE_VERSION_INTERVAL_MS=5000 npm run check:live-version -- --expect=0a5f0380000000000000000000000000000000ff`
   → **exit 1**, printing `live … 958321815761759823c4596bc47bc2cb716c2953`
   against `wanted 0a5f0380…`, after 3 attempts / 10.2 s.
2. Unreachable host — `wrangler.jsonc`'s custom-domain pattern temporarily
   patched to `not-the-park.blockstack.ing` (reverted with `git checkout --`)
   → **exit 1**, `unreadable — request failed: fetch failed`. This also proves
   the hostname really is read from `wrangler.jsonc` and not hard-coded.

Green run for contrast: exit 0, "landofgoodplaces.blockstack.ing is serving
958321815761759823c4596bc47bc2cb716c2953 … 1 attempt(s), 0.1 s".

## Gates

- `npx tsc --noEmit` → **0**
- `npm run build` (unpiped, exit code read directly) → see final report
- `npm run test:procgen` → see final report
- Build chain parsed, not grepped: 46 steps on both this branch and
  `origin/main`, byte-identical; `check:live-version` deliberately absent from it.

## Status

**PR #386 open.** Workflow fix, check script and `live-version.yml` all pushed;
rebased onto `origin/main` after two PRs merged mid-session (clean, three-dot
diff shows only my 9 files, and the build chain parsed identical to main at 47
steps including main's new `check:deck-fallthrough`).

The Overseer reproduced the defect live while this was being written:
`gh run list --workflow=deploy.yml` showed **three of the last five deploys
cancelled**, none marked as a failure anywhere, including the player-movement
fix `20c54f86` killed by the merge a minute after it. This is why the check asks
what version is *served* rather than whether the last run succeeded — a
run-status check would have reported all-clear through the whole five-commit
stale period.

**Post-rebase gates all green**, run locally on the rebased tree, unpiped, exit
codes read from the markers rather than from the wrapper (the wrapper's own exit
code is the trailing `echo`'s, which is always 0 — do not trust it):

- `npx tsc --noEmit` → **0**
- `npm run build` → **0** (`BUILD2 EXIT: 0`, build2.log line 1244)
- `npm run test:procgen` → **0**, 14 files / 453 tests

CI on the rebased branch: Procgen invariants pass (3m23s), A reload gets the new
build pass (59s), Deploy PR preview pass (41s), Build and checks still running.

**Trap for whoever comes next:** the scratchpad at
`/tmp/claude-501/.../scratchpad/` is shared between agents and filenames are not
agent-unique. A stale `procgen2.log` from another agent, hours old, briefly
looked like 4 failing tests of mine. Check mtimes before believing a log you did
not just watch being written.
