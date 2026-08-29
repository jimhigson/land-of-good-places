# HANDOFF — deploy stops re-running the checks

Branch `fix/deploy-skips-duplicate-checks`, worktree `.claude/worktrees/deploy-gating-2`.
Spec: `DEPLOY_NOTES.md` on `main`, entry 2026-08-29, "the version that loses nothing".

Second engineer on this branch (the first hung and was stopped). Its worktree
`.claude/worktrees/deploy-gating` was clean, fully pushed at `617c9267`, and has
been removed. Nothing was lost. Rebased onto `origin/main` (`d3bdbacc`) — clean,
diff is still only `deploy.yml` + this file.

## Where the fixture lives — DO NOT DELETE IT YET

`jimhigson/lgp-deploy-gating-proof` (private). Its README now records every
demonstration and, step by step, **the one experiment still outstanding**. Its
runs are the cited evidence in the PR, so deleting it breaks those links.
Delete only after this PR merges *and* the sha-pinning experiment has run.

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

**This is a real account-level limit, not an artefact of how I am provoking
runs.** It is not a fork, not a disabled runner, not a deliberately unbillable
context. Every job in the private fixture repo `jimhigson/lgp-deploy-gating-proof`
is refused before it starts, with the annotation:

> The job was not started because recent account payments have failed or your
> spending limit needs to be increased.

Reproduced at 21:50 (runs `33277080310`, `33277085176`) and again at ~23:00
(run `33279324990`) — over an hour apart, so it is persistent, not transient.
I have not touched billing and will not.

**Scope, which is the part that decides whether PRs in flight are at risk:**
the block applies to **private** repositories. `land-of-good-places` is
currently **public** (finding 1), so it draws on the free unlimited public
allowance and **its CI is unaffected**. Evidence that CI is healthy there right
now: run `33278187056` "Build and checks" ran 22:17:10 -> 22:33:09 (15m59s,
success) and `33278187055` Deploy ran 22:17:37 -> 22:33:47 (16m10s, success),
both well after the block was first observed.

**So: PRs in flight are fine — but only for as long as the repo stays public.**
The two findings are coupled, and that coupling is the real hazard:

> If anyone "corrects" finding 1 by making `land-of-good-places` private
> without first fixing the billing in finding 2, **all CI on this project stops
> dead**, immediately and for every PR.

Both levers are Jim's. Neither is mine, and neither is a thing to fix in
passing.

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

## The observability trick that makes all of this free

GitHub evaluates a job's `if:` **before** allocating a runner. Under the billing
block that yields a clean two-valued read-out of the gate's decision, at zero
minutes:

| publish job shows | the gate decided |
|---|---|
| **`skipped`** (0 s, no annotation) | **blocked** — `if:` was false, no runner ever requested |
| **`failure`** with the billing annotation | **allowed** — `if:` was true, runner requested and then denied |

Every result below is read that way. It proves *job selection* — which is the
whole of the gating logic. It cannot prove anything about what a job **does**
once running, which is exactly where the remaining gap is.

## Demonstrations, all in `jimhigson/lgp-deploy-gating-proof`

| # | scenario | check run -> conclusion | Deploy run | publish job | verdict |
|---|---|---|---|---|---|
| 1 | check **fails** | `33277080310` -> `failure` | `33277085176` | **skipped** | blocked ✔ |
| 1b | check **fails** (independent repeat) | `33279324990` -> `failure` | `33279327878` | **skipped** | blocked ✔ |
| 2 | check **cancelled** | `33279189449` -> `cancelled` | `33279202067` | **skipped** | blocked ✔ |
| 3 | check **effectively never ran** | `33279408661` -> `skipped` | `33279416987` | **skipped** | blocked ✔ |
| 4 | **`workflow_dispatch`** (manual rescue) | n/a — no payload | `33279362814` | **failure (billing)** = *selected* | allowed ✔ |

Demonstration 2 is the one the brief cares most about, and it needed a trick of
its own: under the billing block a run is refused within ~3 s, too fast to
cancel by hand. So the check jobs were pointed at `runs-on: [self-hosted,
never-serviced]` — a label no runner serves. **Queued jobs consume no minutes**,
so the run sat `queued` indefinitely, was cancelled deliberately, and settled
`cancelled`. That is a genuine `cancelled` conclusion reaching the gate, and the
publish job skipped on it. This is the timeout case: a job that hits
`timeout-minutes` reports `cancelled` too, and it is now proven to block.

Demonstration 4 also confirms the other half of the `if:` — on dispatch the
`blocked` job was correctly **skipped**, so a manual rescue does not produce a
spurious red "publish blocked".

Demonstration 3 additionally settles a question the brief asked: a workflow run
whose jobs are all skipped reports conclusion **`skipped`**, not `success`, so
it blocks. Good — and it also means a `success` conclusion cannot be
manufactured without a runner, which is what closes off the last gap below.

## The honest gap: the success path is NOT proven

**Unverifiable by me, and I am not working around it.** What is missing is the
half of the success path that needs a job to actually *execute*:

- that the publish job, once allowed, checks out and publishes the **triggering
  sha** rather than the default branch's newer HEAD, and
- the measured runtime of the new job.

Proving it needs one successful run of the fixture, which needs runner minutes,
which needs either the billing fixed or a repo made public. Routes considered
and rejected:

- **Making a repo public** — forbidden, and rightly. Not attempted.
- **Registering a self-hosted runner** (free, unbilled) — attempted; the
  download and configure step was **denied by the permission classifier**. Not
  worked around.
- **Running it in `land-of-good-places` itself** — impossible before merge:
  `workflow_run` only ever fires from the **default branch's** copy of the
  workflow file, so this cannot be exercised from a PR branch at all.

The predecessor had already built the right fixture for it: `deploy.yml` in the
proof repo carries a `sleep 75` first step, and `deploy-unpinned.yml` is a
byte-identical control with the `ref:` pin removed. Push a commit, let the check
pass, push a second commit during the 75 s window, and the pinned deploy should
print the *first* sha while the control prints the second. **That is the
experiment to run the moment there are minutes.** It is one push once CI works.

Until then, the sha pinning rests on reading
`ref: ${{ github.event.workflow_run.head_sha || github.ref }}` and on the
`Say which commit is being published` step, which prints the resolved sha
alongside the expected one and is the receipt if it ever disagrees. **State
this as an open gap in the PR; do not claim the success path was demonstrated.**

## Status

- [x] worktree + `npm ci` (exit 0)
- [x] `deploy.yml` rewritten, committed, rebased onto `d3bdbacc`
- [x] proof: blocked-on-failure (x2), blocked-on-cancelled, blocked-on-skipped
- [x] proof: `workflow_dispatch` still allowed through
- [ ] proof: allowed-on-success with the correct sha — **blocked on finding 2, escalated**
- [x] second edit: `procgen-invariants.yml` now says its `name:` and its
      unfiltered `push` trigger are load-bearing for deploys. `deploy.yml`'s
      header had *claimed* that comment existed; this makes the claim true
      rather than leaving a comment asserting something absent.
- [x] gates on the rebased base, quiet machine, unpiped: `npm ci` **0**,
      `npx tsc --noEmit` **0**, `npm run build` **0**, `npm run test:procgen`
      **0** (14 files, 453 tests)
- [x] #324 quiet-machine repro posted to the issue
- [x] **PR #397** raised. Do not merge — Overseer merges, after one review + QA.

## `check:park-boot` — the flake, and what was actually done about it

First full build exited **1** at `check:park-boot` (25.0 ms advance against an
8 ms budget). Per CLAUDE.md, flaky is failing, so this was not waved through:

- **3/3 pass** on this branch on a quiet machine.
- **2/2 pass** on `origin/main` (literal `git checkout --detach origin/main` in
  this worktree, then back).
- This branch touches **no runtime source at all** —
  `git diff --name-only origin/main...HEAD` is two workflow files and this
  handoff — so it is not capable of moving a timing check.

That is issue **#324**, open, titled "possibly sandbox-contention-sensitive,
needs a quiet-machine repro". The failing run happened while CI polling ran in
parallel on a box carrying ~150 worktrees, and the passes happened when it was
idle — which is a quiet-machine repro, so **post this to #324**; it is the
evidence that ticket is asking for. Root-causing #324 is its own ticket and its
own agent, not this PR.

## Do not retry

Making any repository public to obtain CI minutes. The first engineer tried it;
it was blocked and it stays blocked. If verification cannot proceed without
minutes, that is a message to the Overseer, not a route to find round.
