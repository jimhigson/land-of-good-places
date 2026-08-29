# HANDOFF — deploy stops re-running the checks

Branch `fix/deploy-skips-duplicate-checks`, worktree `.claude/worktrees/deploy-gating`.
Spec: `DEPLOY_NOTES.md` on `main`, entry 2026-08-29, "the version that loses nothing".

## The change

`deploy.yml`: trigger `push` -> `workflow_run` of **"Procgen invariants"**,
`types: [completed]`, `branches: [main]`; publish job gated on
`conclusion == 'success'` **and** `workflow_run.event == 'push'`; `Checkout`
pins `github.event.workflow_run.head_sha || github.ref`; `Build` step becomes
`npx vite build`; `timeout-minutes` 30 -> 10. Plus a `blocked` job so a
non-success gate is not a grey tick.

## Measurement that is the whole argument

Run **33276145194** (`62318f05`), settled **success**, watched to completion —
not read off a `status` field:

| segment | window | duration |
|---|---|---|
| setup + checkout + node + `npm ci` | 21:28:07 -> 21:28:25 | 18 s |
| `Build` (`npm run build`, the duplicated QA) | 21:28:25 -> 21:44:13 | **15m48s** |
| `wrangler deploy` | 21:44:13 -> 21:44:28 | 15 s |
| whole job | 21:28:07 -> 21:44:30 | **16m23s** |

96% is the middle line, and it had already passed green on the same sha in
`procgen-invariants.yml`. New job = the other two lines + 191 ms = **~35 s**.

**Do not write "brushing the 30-minute cap" anywhere** — that was a bad reading
of a stale status field, corrected by the Overseer. 16m23s against the *15*
cap it had until an hour ago is the true and sufficient claim.

## Property that must not be lost

A failing check blocks the publish — and so must a **cancelled** one, because a
job timeout reports as `cancelled` and that is how the outage hid. `if` requires
`success` exactly, so every other conclusion falls to the `blocked` job.

## Status

- [x] worktree + `npm ci` (exit 0)
- [x] `deploy.yml` rewritten, committed
- [ ] proof: blocked-on-failure, blocked-on-cancelled, allowed-on-success-with-correct-sha
- [ ] gates: `tsc --noEmit`, full unpiped `npm run build`, `npm run test:procgen`
- [ ] PR

## Proof plan

`workflow_run` only fires from the **default branch's** copy of the file, so
this cannot be exercised from a PR branch in this repo. Proving it in a
throwaway private repo with the same two workflow names, driving real GitHub
runs for the success / failure / cancelled cases. Delete the repo afterwards.
