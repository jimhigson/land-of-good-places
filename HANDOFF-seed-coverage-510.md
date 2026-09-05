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
