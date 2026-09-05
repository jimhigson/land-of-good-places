# HANDOFF — #510, the pool is the product and the gates measure a sixteenth of it

**Model: Opus (`claude-opus-5[1m]`).** Branch `fix/seed-coverage-510`, worktree
`.claude/worktrees/seed-coverage-510`, branched from `origin/main` at
`61e95fe5`. Invisible to a player, so it merges on review + QA measurement
without going to Jim.

## Findings before any design — several of them change the brief

### 1. `CI_SWEEP_SEEDS` is NOT a second definition of the pool

I went looking for the two-definitions bug and there isn't one.
`src/world/parkSeedPool.ts` is the single owner. `CI_SWEEP_SEEDS` is a
**guarded subset**: it `.map`s over its members and **throws** if one is not in
`PARK_SEED_POOL` (line ~196), and `check:seed-pool` fails if the set ever
differs from "exactly the pool seeds with a checked-in per-seed invariant file",
in either direction. Add a per-seed file and it tells you to add the seed;
delete one and it tells you to remove it.

**So do not "fix" this.** It is already the shape this repo asks for.

### 2. Both instrument defects named in the issue are ALREADY FIXED on `main`

The issue asks for them "whatever else is decided". They are done:

- **Bare `vet:seeds` no longer vets candidates 1–30 and calls it pool
  coverage.** It now `refuseBareInvocation()`s — prints the three real forms
  and `process.exit(2)`. There is no default, deliberately.
- **`vet:seeds` exits non-zero on failure.** `if (failed > 0) process.exitCode = 1`,
  with a message that says "these are parks a child can be given" when the run
  was `--pool`.
- `--pool` exists and reads `PARK_SEED_POOL` directly, so no pasted list.

**Do not redo this work.** Verify before building on the issue text.

### 3. The two broken seeds the issue was written about now PASS

Measured on this branch head (`61e95fe5`):

```
pnpm run vet:seeds -- --list 20260728,5,24,428 --jobs 4

20260728 PASS park=pass invariants=pass 52.0s  88 invariants passed
       5 PASS park=pass invariants=pass 53.3s  88 invariants passed
     428 PASS park=pass invariants=pass 58.1s  88 invariants passed
      24 PASS park=pass invariants=pass 63.4s  88 invariants passed
4/4 passed both gates          wall 1:03.69, exit 0
```

The issue's `poi.stranded` failures on 24 and 428 have since been fixed.
**The coverage gap is real; the specific broken parks are not. Do not report
those seeds as broken — that transcript is stale, which is exactly what
CLAUDE.md warns about.**

### 4. The cost model, measured rather than quoted

**52–63 s per seed for BOTH gates** (`check:park` + the invariant suite), four
lanes, 63.7 s wall on this Mac. The issue's "35–150 s" is per-seed for
`check:park` alone and is pessimistic against what I measured.

Whole pool, 16 seeds: ~4.3 min at 4 lanes locally.

### 5. THE BINDING CONSTRAINT — and an urgent finding of its own

`checks.yml` has `timeout-minutes: 30`. Recent **successful** runs on `main`:

```
26.7 min   Pets keep their daylight through a bend on the ginormous slide
26.8 min   CLAUDE.md: never git stash
25.9 min   Bushes ask the world instead of a list of two things
16.7 min   check:pet-slide was not flaky
```

**That is ~27 of 30 minutes, not the 25 of 30 CLAUDE.md records.** The gate is
roughly three minutes from producing the 29 August outage shape — a job killed
by `timeout-minutes` reports as `cancelled`, which reads as "superseded" rather
than as a failure, and nothing goes red.

**Consequence for this ticket: nothing seed-swept may be added to `checks.yml`.**
Not one seed. This is worth raising to the Overseer independently of #510.

### 6. The repo is PUBLIC

`gh repo view` → `"isPrivate": false`. GitHub Actions minutes on standard
runners are therefore **free**, so fanning out across runners costs wall time
and nothing else. No workflow in this repo uses `strategy: matrix` today; that
is the unused lever.

## Status

Design not yet agreed with the Overseer; nothing built. A classification of
which `check:*` steps are actually seed-dependent is in flight.

### 7. The announcement stream — MEASURED, and it refines CLAUDE.md

CLAUDE.md says a coverage note must go to `process.stderr`, "not `console.log`",
because Vitest's default reporter shows console output from *failing* tests
only. I ran the experiment rather than trusting it — a throwaway passing test
writing to all three, under `pnpm run test:procgen`, default reporter:

```
console.log('...')                  NOT VISIBLE on a passing run
process.stdout.write('...')         VISIBLE
process.stderr.write('...')         VISIBLE
```

**So the real distinction is `console.*` (which Vitest intercepts and buffers)
versus a direct stream write — not stdout versus stderr.** Either direct write
is audible on a passing Vitest run. CLAUDE.md's advice is safe but its stated
reason is narrower than the truth; worth correcting there if this lands.

In a plain Node check script both streams are unconditionally visible, and
**stdout is the right one** — a reviewer found stderr gets buried under ~288
lines of `THREE.Texture` noise.

### 8. The chain, classified (63 expanded steps)

- **40 steps are seed-dependent and canonical-only.** They build a real park
  via `scripts/park-harness.mts`, `World.ts`, or a seeded `*/plan.ts`, and in
  Node with no `LGP_SEED` that resolves to `CANONICAL_PARK_SEED` every time.
- **1 step sweeps** — `check:fountain-hop`, over `CI_SWEEP_SEEDS` (7 seeds).
- **22 steps are seed-independent** (typechecking, character/model geometry,
  text lint, HUD state machine, `check:seed-pool` itself).

**Nine pool seeds are built by no required check at all: 115, 128, 208, 225,
267, 274, 346, 428, 451.** Six more get `check:fountain-hop` only.

### 9. Comment-vs-code drift found while classifying (small, worth sweeping)

- `check-fountain-hop.mts:34,59` — says "all five CI seeds", names seeds 2 and
  18; the code at `:72` uses `CI_SWEEP_SEEDS`, which is **7** seeds and contains
  neither. Correct comment sits one line from correct code.
- `check-path-preference.mts:27,111,785,843` — hard-codes the basis list as
  "canonical plus 5, 11, 18, 24", including **retired seed 18**, while the
  script sweeps nothing at runtime.
- `parkSeedPool.ts:176` — "the whole 58-step chain"; measured today it is
  **59 top-level / 63 expanded**.
- `check-rail-race.mts:1942` — `FIELD_SEEDS`, 24 hard-coded values. These are
  **rival-race RNG seeds**, not park seeds. Biggest `SEEDS = [...]` in the
  chain and the easiest to misread as pool coverage.

---

## What was built

Two parts, both agreed with the Overseer before building.

### Part 1 — `check:park-pool`: `check:park` on all sixteen parks

`scripts/check-park-pool.mts`, wired into the **`Procgen invariants`** job.

- Runs **the real `scripts/check-park.mts`** once per pool seed in a child
  process with `LGP_SEED` (`parkManifest.ts` reads the seed once at import, so
  one process cannot build two parks). It states **no standard of its own** —
  `check-park.mts` owns that — so there is nothing to drift.
- **Ratchet ENFORCED**, deliberately. `LGP_RATCHET=off` exists for
  `sweep-park-seeds.mts`, which is *hunting* candidates; under it `poi.stranded`
  goes soft — and `poi.stranded` is the exact key #510's own evidence cited. The
  pool is not a hunt, so it is held to the bar `vet:seeds --pool` already uses
  (`checkPark(seed, true)`).
- **16/16 pass today**, 1:54 wall on four lanes. Seed 288 alone is 99 s.
- `--list` prints the seeds it will sweep, as JSON — the handle Part 2 uses.

**Why not a new `Seed pool` matrix workflow, which is what I first proposed:**
`procgen-invariants.yml` already runs `check:gateway` over the whole pool, and
its comment gives the reason — that job is **already a required status check**,
so a sweep put there gates on the day it lands instead of waiting on a
branch-protection change only Jim can make. A separate workflow would have been
inert until somebody changed a repo setting, which is a workflow that looks like
a gate and is not: the very thing this ticket is about. **This design needs no
branch-protection change at all.**

### Part 2 — `check:seed-coverage`: coverage is an asserted, printed fact

`scripts/check-seed-coverage.mts`, in the `check` chain (seed-independent,
~1 s). Fails hard; does not ratchet.

- Runs `check:park-pool --list` **in a child process** and compares what the
  sweep *says it will ask* against `PARK_SEED_POOL`. Reading the pool here and
  calling it coverage would be a constant asserted against itself.
- Checks the sweep is wired into a job that blocks a merge, and that the job's
  `name:` still exists — a required check is matched **by name**.
- **Names every workflow that runs on a PR and blocks nothing.** On `main`
  today: `Coplanar faces` and `A reload gets the new build`. Deploys are
  excluded (`NOT_A_GATE`) so the real two are not skimmed past.
- Prints what is **still** uncovered every run: nine pool seeds have no
  per-seed invariant file, and ~40 chain steps remain canonical-only.

## Branch protection — read back, not assumed

```
gh api repos/jimhigson/land-of-good-places/branches/main/protection \
  --jq '.required_status_checks.contexts'
["Procgen invariants","Checks"]
```

Exactly two. **#510 needs nothing added** — the sweep rides inside
`Procgen invariants`. The two that genuinely run and gate nothing, with the
exact strings GitHub matches (the job's `name:`, not the workflow's):

| exact string | file | note |
|---|---|---|
| `Coplanar faces` | `coplanar.yml` | CLAUDE.md's own table says "not yet — needs adding" |
| `A reload gets the new build` | `update-adoption.yml` | guards #341; runs on every PR, gates nothing |

`entrance-road.yml` **does not exist on `origin/main`** nor on any remote
branch I could find — if an ask is queued for it, it is premature.

## Proved red — with the input, since transcripts go stale

`check:park-pool`, retired seed 18 injected into the sweep list (it needs a
level crossing; since 2 Sep every rail crossing is a bridge, so its park does
not build):

```
seed 18: FAIL  did not build: Error: bridges: no walkable bridge fits at proven
crossing railD 46.0 (-58.9, 53.7). The planner proved this site; the real search
refused it — find the drift between them (issue #414).
check:park-pool: 16/17 pool seed(s) pass ... 1 FAILED     exit 1
```

`check:seed-coverage`, three mutations, control exit 0 between each:

| mutation | result |
|---|---|
| drop 115 and 428 from the sweep | `FAIL 2 pool seed(s) are built by no whole-pool sweep: 115, 428` — exit 1 |
| replace the workflow step with `echo skipped` | `FAIL no merge-blocking workflow runs check:park-pool` — exit 1 |
| rename the job to `Procgen invariants (fast)` | `FAIL ... no longer contains a job named "Procgen invariants"` — exit 1 |

## Three defects proving-red found in my own checks

Worth reading; all three are this repo's standard diseases, in new code.

1. **A sweep that could vanish.** Six lanes saturated the Mac, one lane threw,
   `Promise.all` rejected and took the entire report with it: ten seeds printed,
   six never ran, **exit 1 with no error, no summary and no seed named**. In CI
   that reads as "a park is broken" while naming none. Lanes now default to 4
   (`LGP_LANES` overrides) and a lane cannot reject.
2. **A failure message naming the runtime instead of the fault** — `did not
   complete: Node.js v26.5.0`, because it quoted the last non-empty line. The
   *first* fix for it also printed the version:
   `/^[A-Za-z_$][\w$]*Error\b/` requires a character before `Error`, so it
   matches `TypeError` and not a bare `Error:`. Only re-running the mutation
   showed it.
3. **`check:seed-coverage` could not see the rename it exists to catch.** Its
   job-name regex matched the workflow's **top-level** `name:` (line 1) instead
   of the job's (line 40), so renaming the job left it at exit 0. Fixed by
   requiring indentation.

## Measured, for whoever needs the numbers

- `check:park`: **4.9 s** canonical, **16.6 s** seed 428, **99 s** seed 288.
- whole pool, both gates, `vet:seeds --pool`-style: 52–63 s per seed.
- `check:gateway`, whole pool: **56 s** wall, 487% CPU.
- `checks.yml` recent **successful** runs on `main`: **26.7 / 26.8 / 25.9 min**
  against `timeout-minutes: 30`. Handed to another Engineer by the Overseer;
  **do not add to that chain.**

## Vitest streams — measured, and it corrects CLAUDE.md's stated reason

Throwaway passing test, default reporter, `pnpm run test:procgen`:

```
console.log(...)              NOT VISIBLE on a passing run
process.stdout.write(...)     VISIBLE
process.stderr.write(...)     VISIBLE
```

So the real distinction is **`console.*` interception**, not stdout-vs-stderr.
CLAUDE.md's advice ("write to `process.stderr`, not `console.log`") is safe, but
its reason is narrower than the truth, and somebody reasoning from the stated
reason will make the wrong call in a new situation. The Overseer is putting the
edit to Jim. In a plain Node script both streams are visible; these two use
**stdout**. (The "stderr gets buried under 288 lines of `THREE.Texture` noise"
caution did not reproduce on `check:park` or `check:gateway` — **0** such lines
in either.)
