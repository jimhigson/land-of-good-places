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

