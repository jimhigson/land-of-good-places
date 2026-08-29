# HANDOFF — deploy stops re-running the checks

Branch `fix/deploy-skips-duplicate-checks`, worktree `.claude/worktrees/deploy-gating-2`.
Spec: `DEPLOY_NOTES.md` on `main`, entry 2026-08-29, "the version that loses nothing".

Second engineer on this branch (the first hung and was stopped). Its worktree
`.claude/worktrees/deploy-gating` was clean, fully pushed at `617c9267`, and has
been removed. Nothing was lost. Rebased onto `origin/main` (`d3bdbacc`) — clean,
diff is still only `deploy.yml` + this file.

## The change (unchanged from the first engineer — it is sound)

`deploy.yml`: trigger `push` -> `workflow_run` of **"Procgen invariants"**,
`types: [completed]`, `branches: [main]`; publish job gated on
`conclusion == 'success'` **and** `workflow_run.event == 'push'`; `Checkout`
pins `github.event.workflow_run.head_sha || github.ref`; `Build` step becomes
`npx vite build`; `timeout-minutes` 30 -> 10. Plus a `blocked` job so a
non-success gate is not a grey tick.

## Measurement that is the whole argument

Run **33276145194** (`62318f05`), settled **success**, watched to completion:

| segment | window | duration |
|---|---|---|
| setup + checkout + node + `npm ci` | 21:28:07 -> 21:28:25 | 18 s |
| `Build` (`npm run build`, the duplicated QA) | 21:28:25 -> 21:44:13 | **15m48s** |
| `wrangler deploy` | 21:44:13 -> 21:44:28 | 15 s |
| whole job | 21:28:07 -> 21:44:30 | **16m23s** |

96% is the middle line, and it had already passed green on the same sha in
`procgen-invariants.yml`. New job = the other two lines + 191 ms = **~35 s**.

Corroborated on a second run since: **33278187055** (`d3bdbacc`), 22:17:37 ->
22:33:47 = **16m10s**, against its sibling `33278187056` "Build and checks"
22:17:10 -> 22:33:09 = **15m59s** on the same sha. The two are the same work.

**Do not write "brushing the 30-minute cap" anywhere** — that was a bad reading
of a stale status field, corrected by the Overseer. 16m23s against the *15*
cap it had is the true and sufficient claim.

## Property that must not be lost

A failing check blocks the publish — and so must a **cancelled** one, because a
job timeout reports as `cancelled` and that is how the outage hid. `if` requires
`success` exactly, so every other conclusion falls to the `blocked` job.

## STOP — two account-level findings for the Overseer / Jim

Found while trying to verify. Neither is mine to act on; both are reported up.

### 1. `jimhigson/land-of-good-places` is PUBLIC right now

`gh api /repos/jimhigson/land-of-good-places` returns `"private": false`,
`"visibility": "public"`. `DEPLOY_NOTES.md` line 18 says the repo is private.
I have **not** changed it and will not — visibility is Jim's call alone.
Somebody needs to confirm which state is intended.

### 2. GitHub Actions billing has failed for this account — private repos cannot run ANY job

Every job in the private fixture repo `jimhigson/lgp-deploy-gating-proof` is
refused before it starts, with the annotation:

> The job was not started because recent account payments have failed or your
> spending limit needs to be increased.

The public `land-of-good-places` is unaffected (public repos get free minutes),
which is why its 16-minute builds keep running. **The corollary is the
dangerous part: the moment `land-of-good-places` were made private, all CI on
this project would stop dead.** That is a live, unrelated infrastructure
problem, and it is what actually blocks the last verification below.

## What the first engineer's cited proof does and does not show

Run **33277085176** in `lgp-deploy-gating-proof` (gated on check run
`33277080310`, which concluded `failure`):

| job | result | meaning |
|---|---|---|
| `Build and deploy to Cloudflare Workers` | **skipped**, 0 s | genuine. GitHub evaluated the job `if:` and never allocated a runner. **The gate blocked the publish.** |
| `Publish blocked — the checks did not pass` | failure, 2 s | **not** genuine — the annotation is the billing refusal, not the script. |

So demonstration 1 stands, with that caveat: the *gating* is proven, the
`blocked` job's *script* is not yet exercised anywhere. Say exactly this in the
PR; do not claim the blocked job has been run.

Useful corollary the billing block hands us for free: a **skipped** publish job
means the gate blocked it, whereas a publish job that reaches the billing
refusal means the gate **allowed** it and only the runner was denied. That is a
clean discriminator for allow-vs-block that costs nothing.

## Status

- [x] worktree + `npm ci` (exit 0)
- [x] `deploy.yml` rewritten, committed, rebased onto `d3bdbacc`
- [x] proof: blocked-on-failure (run 33277085176, deploy job skipped)
- [ ] proof: blocked-on-cancelled
- [ ] proof: allowed-on-success with the correct sha — **blocked on finding 2**
- [ ] gates: `tsc --noEmit`, full unpiped `npm run build`, `npm run test:procgen`
- [ ] PR

## Do not retry

Making any repository public to obtain CI minutes. The first engineer tried it;
it was blocked and it stays blocked. If verification cannot proceed without
minutes, that is a message to the Overseer, not a route to find round.
