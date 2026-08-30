# Notes — sha-pinning proof (engineer 3)

Worktree `.claude/worktrees/deploy-397`, branch `fix/deploy-skips-duplicate-checks`.
Written incrementally; API drops are constant today.

## Pre-flight (confirmed by inspection, 30 Aug)

Fixture `jimhigson/lgp-deploy-gating-proof` is armed correctly:

- `mode.txt` = `pass`.
- Both check jobs back on `ubuntu-latest` (demonstration 2's
  `runs-on: [self-hosted, never-serviced]` has been reverted) — so the check
  workflow can actually conclude `success`.
- `deploy.yml` step 1 is `sleep 75`, **before** `Checkout` — so main's HEAD can
  move during the window while the checkout has not yet happened.
- `deploy-unpinned.yml` differs from `deploy.yml` in exactly three ways, verified
  by diff: `name:` (`Deploy X`), `concurrency.group` (`deploy-unpinned`), and the
  removed `ref:` pin block. Nothing else. It is a true control.
- Both deploys use `cancel-in-progress: false`, and they are in **separate**
  concurrency groups — so X's two deploy runs cannot be cancelled by Y's, and
  pinned and control run in parallel on the same event.
- The receipt is `Say which commit is being published`, which echoes
  `git rev-parse HEAD` (post-checkout) against the expected sha. All build and
  wrangler steps are stubbed echoes, so nothing can fail before the receipt.

## Experiment

1. push X to fixture `main`
2. wait for "Procgen invariants" -> success on X
3. both Deploy workflows fire on `workflow_run`, enter `sleep 75`
4. during that window, push Y
5. expect: pinned logs `Publishing commit: X`; control logs `Publishing commit: Y`


## OUTCOME: the proof did not happen, and will not

Ran it at 22:37 UTC 30 Aug. Pushed commit X `bd24048c` to the fixture. The check
run (`33339650818`) concluded `failure` in **2 seconds**, both jobs with zero
steps executed — the runner was never allocated. Literal annotation, verbatim:

> The job was not started because recent account payments have failed or your
> spending limit needs to be increased. Please check the 'Billing & plans'
> section in your settings

Third independent observation, ~23 hours after the first two. I did not diagnose
it, touch billing, change any repository's visibility, or refresh auth scopes —
all of those are report-not-act, and the standing rule now says so explicitly.

**Then the question was closed by ruling, not by evidence:** CLAUDE.md now
forbids creating a GitHub repository for anything, the fixture repo has been
deleted, and so the sha-pin experiment cannot be run at all. It needs a
default-branch `workflow_run`, which needs a repo we will not create.

### Consequences, all now reflected in the PR body

- The sha pin and the `blocked` job's script are stated as **unproven, at the
  top of the PR**, with the reason.
- The fixture's demonstration evidence has been **inlined as text** in the PR
  body, because deleting the repo breaks every run link that used to carry it.
- `timeout-minutes: 30` restored (the rebase carried the PR's reduction to 10
  through as a *non-conflicted* hunk — nothing flags that, and every check stays
  green). Reason written into `deploy.yml` and the PR body so it is not lowered
  again by the same sensible-looking reasoning.
- Rename coupling added to `DEPLOY_NOTES.md`.

### Rebase note for whoever picks this up

`main` moved to **pnpm** under this branch. The conflict was real: publish job is
now `pnpm install --frozen-lockfile` + `pnpm exec vite build`, and the
present-tense `npm ...` mentions in comments were updated. `pnpm-lock.yaml` taken
from `main` as-is, never hand-merged.

**NOT MERGED.** Authority to merge was conditional on proving the pin; it is
unprovable by ruling, so the PR stays open with an honest gap for Jim to weigh.
