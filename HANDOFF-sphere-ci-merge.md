# HANDOFF — restore CI on `feat/sphere-combined` (PR #600)

**Model: Claude Opus 5 (1M context).** Chosen by the Overseer that dispatched
this task. A replacement runs the same model.

**Branch:** `feat/sphere-combined` (PR #600)
**Worktree:** `.claude/worktrees/sphere-ci-merge` (detached HEAD; pushes with
`git push origin HEAD:feat/sphere-combined`)
**New head:** `d880c916`  (was `90e62c5b`)

## Why this task existed

PR #600 had run **no `pull_request` workflows since 2026-09-11**. Not red —
*absent*. `gh pr checks 600` said "no checks reported on the
'feat/sphere-combined' branch".

Root cause, verified before acting:

- Every workflow triggers on `pull_request`, which GitHub can only run against
  a computed **merge ref**.
- `git merge-tree --write-tree origin/main origin/feat/sphere-combined` gave
  `CONFLICT (content): Merge conflict in src/main.ts` — one file.
  `src/Game.ts` and `src/world/hotel/Hotel.ts` auto-merged.
- `main` was 3 commits ahead of the merge base `dd5b3b6b`
  (`49310060` CLAUDE.md, `2e168982` check:park-boot #606, `c29dfb49` pet
  beds #582). Branch was 247 ahead.
- PR `mergeStateStatus: DIRTY`, `mergeable: CONFLICTING`.

No merge ref ⇒ no workflows ⇒ a silent five-day CI blackout on the branch
every other sphere lane stacks onto.

## How `src/main.ts` was resolved

**It was an adjacent-edit conflict, not a semantic one.** Established by
reading all three versions of the line, not by trusting git:

- **merge base** `dd5b3b6b`: `deepLink !== undefined ? { ...options, arriveByBus: false } : options;`
- **`main`**: *same line, unchanged.* Main only **inserted** the `?pets=N`
  `grantDebugPets(location.search)` block plus its comment immediately after it.
- **branch**: changed the value to `wantsTheBus` (the `/arrive` deep link, so
  `/arrive` forces the bus instead of deferring to `arrivalIsDue()`).

Resolution takes **both**: the branch's `wantsTheBus` value, and main's
`grantDebugPets` call with its comment, in main's own position — after
`gameOptions`, before `new Engine(canvas)`, which is what main's own comment
requires ("the one funnel every boot path reaches *before* `new GameClass(...)`").

Neither `--ours` nor `--theirs` was used.

### `rerere` — the documented hazard is not live

CLAUDE.md says `rerere.enabled` is `true` and will replay stale resolutions.
**Measured: it is `false`** in this repo today (local scope; global and system
unset). `.git/rr-cache` still holds ~90 stale entries, so if anyone re-enables
it that hazard returns immediately. Nothing was replayed here — the resolution
was written by hand.

## Verification done (not assumed)

- **No conflict markers** anywhere under `src/`, `scripts/`, `test/`.
- **Every line `main` added** to `src/main.ts`, `src/Game.ts` and
  `src/world/hotel/Hotel.ts` is present in the result — checked line by line,
  including the two files that auto-merged (a clean auto-merge is the exact
  shape of a silent revert, so they were not taken on trust).
- **Every line the branch added** to `src/main.ts` is still present.
- Deep-link machinery intact: `RIDE_DEEP_LINKS`, `parseDebugSpawn`,
  `parseDebugView`, `parseArriveLink`, the `DeepLink` union and the `'arrive'`
  kind all still present and referenced.
- **`package.json` scripts parsed, never grepped**: merged object has **122**
  keys — exactly the union of main's 117 and the branch's 122. Nothing missing
  from either side, nothing extra. (`package.json` did not conflict; checked
  anyway because a swap keeps the count identical.)
- **Three-dot diff vs the old branch tip**
  (`git diff --stat origin/feat/sphere-combined...HEAD`): 17 files, **zero
  deletions**. Every file is main's three commits arriving.
- Three-dot diff vs `origin/main`: one deletion,
  `test/procgen/seed-5.test.ts` — **pre-existing**, removed by branch commit
  `364672c1` ("Retire pool seeds 5, 115, 225 and 346 while the generator is
  being replaced"), absent from `90e62c5b` too. Not mine.
- `pnpm run build` → **exit 0**, 698 ms, on Node **v26.5.0**
  (`fnm use --install-if-missing`; pnpm 12.1.0).

## Result: CI runs again

On push of `d880c916` all **seven** workflows started. PR went
`DIRTY`/`CONFLICTING` → `BLOCKED`/`MERGEABLE` (blocked = waiting on checks,
which is correct).

### The ledger on `d880c916`

| workflow | result | required? |
|---|---|---|
| **Checks** | **failure** | **yes** |
| **Procgen invariants** | **failure** | **yes** |
| **Coplanar faces** | **failure** | no |
| Entrance road | success | no |
| Swept bus | success | no |
| PR preview | success | no |
| Update adoption | success | no |

Required checks (read back from branch protection) are exactly
`["Procgen invariants", "Checks"]`.

### The important finding: `Checks` aborts at step 19 of 65

`check` is an `&&` chain. It died **40 seconds in**, after only 18 of 65 script
invocations, at:

```
check:npc-perch FAILED — climbable tree 0 has no foliage to measure.
watchdog[check] — took 0m40s of a 30m00s cap (2.2% used, 29m20s spare)
                  across 18 script invocations.
```

**So 46 steps never ran — including all seven of the #630 steps this branch was
expected to be red at.** `check:hotel` is step 42, `check:rail-race` 47,
`check:tie-frame` 49, `check:cruiser-clearance` 52, `check:castle-window` 53,
`check:keyring-view` 57, `check:climb-wave` 58. **Their state is unknown.** CI
cannot say anything about them until `check:npc-perch` is fixed. Anyone
reporting them as "still red" or "now green" from this run is reading a chain
that stopped 23 steps earlier.

Steps that *did* pass, and are therefore real: `check:chain-coverage`,
`check:node`, `check:text`, `check:shop-spacing`, `check:stall-shape`,
`check:gondola-sightline`, `check:hop-clearance`, `check:deck-fallthrough`,
**`tsc --noEmit`**, **`typecheck:test`**, `check:brevity`, `check:assets`,
`check:hat-fit`, `check:glasses-fit`, `check:hood-face`, `check:baked-face`,
`check:character-parity`, `check:hair`. The merge typechecks.

### `check:npc-perch` — bisected to a commit from the blackout

Not caused by this merge. Proved by running it at three points:

- `36ee9ce4` (the last sha CI ever checked, 11 Sep) — **exit 0**, "check:npc-perch OK"
- `90e62c5b` (pre-merge branch tip) — **exit 1**
- `d880c916` (post-merge) — exit 1

`git bisect` over the unchecked range names the culprit:

**`23e90a0a` — "A leaning tree's sightline sphere goes where its canopy
actually is"** (12 Sep, `src/world/Scenery.ts`, +27/−2).

### What the blackout actually cost

The last CI run was on **`36ee9ce4`**, not on the branch tip. `90e62c5b` was
committed **14 Sep**, three days later. **73 commits were pushed to this branch
with no CI at all** — including `ce528d0b` "The sphere is the domain: Geo,
Frame, Chart, Field, Anchor, and the geodesic primitives". At least one of them
(`23e90a0a`) introduced a red that now masks 46 further steps.

### Procgen invariants — 128 failures, and the merge did not cause them

CI and a local run agree exactly, so this is deterministic, not flaky:

| | Test Files | Tests | exit |
|---|---|---|---|
| pre-merge `90e62c5b` (local) | 6 failed / 14 passed (20) | **128 failed / 501 passed (629)** | 1 |
| post-merge `d880c916` (local) | 6 failed / 14 passed (20) | **128 failed / 501 passed (629)** | 1 |
| post-merge `d880c916` (CI) | 6 failed / 14 passed (20) | **128 failed / 501 passed (629)** | 1 |

**Identical before and after — the merge changed nothing here.** 501 + 128 =
629, so nothing is being silently skipped.

Failing files: `seed-131` (26), `seed-326` (26), `seed-24` (25), `seed-11`
(25), `seed-canonical` (25), `scatterDecoupling` (1). The failures are
overwhelmingly sphere-geometry ones, each hitting all 5 seeds: "the ground is
the sphere it claims to be", "every Rail Race post is solid all the way up a
child", "the Sky Cruiser stands on its own supports", "the cat bus is actually
in the park", "every modelled coping stone sits on the wall it caps",
"the attractions use the whole park".

### Coplanar faces

**54 new-or-worse coplanar seams**, plus **9 `BASELINE LOOSE`** entries (baseline
rows whose meshes no longer exist — #520's rename hazard, live here). Worst
offenders include the boundary wall, the rail-race finish rainbow legs, and the
dodgems/railRacer stall groups. Not a required check.

**None of the above is this task's to fix; they have owners.** The deliverable
was an accurate ledger, and the headline of it is that `Checks` currently
answers for only 19 of 65 steps.

## Notes for whoever is next

- The branch is **also checked out** at `.claude/worktrees/sphere-combined`
  (clean, idle at the old tip `90e62c5b` as of 14 Sep). It was deliberately
  **left untouched** — that is why this worktree is detached and pushes
  `HEAD:feat/sphere-combined`. That worktree's local branch ref is now behind
  origin; `git pull --ff-only` there if you want it current.
- Do not push a trivial commit while CI is mid-flight — it restarts all seven
  workflows and costs another ~25 minutes of ledger.
- `checks.yml` is at ~25 minutes against a 30-minute cap. A timeout reports as
  `cancelled`, not red.
