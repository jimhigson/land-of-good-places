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

## Status

See git log on this branch. Gates to run before PR: `npx tsc --noEmit`, full
unpiped `npm run build`, `npm run test:procgen`, plus a demonstrated **red** run
of `check:live-version`.
