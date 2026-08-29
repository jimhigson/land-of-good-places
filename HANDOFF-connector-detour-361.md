# HANDOFF — issue #361, connector rejects a 14 m link and routes 238 m

Branch: `fix/connector-detour-361`, worktree `.claude/worktrees/eng-361` (off
`origin/main` @ `929563b`). A second, **detached** measurement worktree lives at
`.claude/worktrees/eng-361-measure` at `ec74974` = `origin/bridge-paving-clip`
(PR #352) — the defect only appears with #352's shorter bridges, so every red
measurement has to be taken there, not on `main`.

Both worktrees needed `npm ci` (issue #356).

## Red reproduced (2026-08-29), on `ec74974`

`npx vitest run test/procgen/seed-11.test.ts` → 1 failed / 74 passed:

```
'ballPit' and 'exit-ginormousSlide' are 14.1 m apart in a straight line but
238.7 m apart by paving (16.98x, wasting 224.7 m) — closer than 28.1 m (2x the
park's own 14.1 m median destination spacing) with no direct connector between them
```

Same test file on `origin/main` (this branch): 74 passed, 0 failed. So the
baseline to compare against is `ec74974`, not `main`.

## Findings so far

1. **The invariant asked for in the ticket already exists**:
   `detourRatiosStayReasonable` in `test/procgen/invariants.ts` (~line 1789),
   registered as *"no two close destinations are left with a wildly
   disproportionate paved detour"*. It is the check that is red above. Its
   thresholds are already park-derived (`medianDestinationSpacing`), with
   `DETOUR_RATIO_LIMIT = 15`. So this PR does not need a *new* invariant —
   it needs the existing one green with its limit **not** weakened.
2. **The rule and the rejection site**: `carriesAnOffLatticeStreetRun`
   (`src/world/paths.ts:2856`), called from `addInterconnects` at
   `paths.ts:4205`, only when the lattice plan failed (`!plan`) — i.e. only
   for *fallback* `routeLeg` paving.
3. **What it protects**: it is a mirror of the invariant
   `streetsShareLatticeLines` (`invariants.ts`, "every street sits on the
   shared 12 m lattice"), down to the same 8 m run length, 0.9 m tolerance,
   15 m door-approach reach and the "both neighbouring lattice lines
   obstructed" excuse. **Therefore a naive escape trades one red invariant for
   another** — anything it lets through is by construction an off-lattice
   street run that `streetsShareLatticeLines` will flag. This is the crux of
   the ticket and any fix has to answer it.
4. Seed 11 has exactly **one** off-lattice rejection in the whole park
   (`LGP_DEBUG_STREETS=1`): this pair. The only other connector rejection is
   `stall.skyCruiser-exit-skyCruiser`, "crosses a ride corridor" (a different,
   already-exempted rule).

## Next

Instrumenting `carriesAnOffLatticeStreetRun` in the *measure* worktree to see
the offending run — its axis, length, how far off the lattice line it sits, and
why `planStreetBetween` returned null for this pair.

## The fix (committed)

Two commits in `src/world/paths.ts`, inside `addInterconnects`:

1. `ac6324c` — **the disproportion escape**. `latticeHonestWalk =
   |dx| + |dz| + 2 * STREET_PITCH`: a lattice-respecting route only turns at
   right angles (Manhattan) and needs at most one street pitch of dog-leg at
   each end to get on and off a line. A paved alternative longer than that is
   not tidiness, it is a failure to connect. No typed ratio anywhere.
   `carriesAnOffLatticeStreetRun` yields when `paved > latticeHonestWalk`.
2. `719c705` — the **slide-corridor** screen yields too, but only when the
   escape has fired *and* one end of the pair stands inside the corridor.
   Discovered by measurement: relaxing the off-lattice rule alone does not
   fix seed 11, because the connector is then refused by
   `slideOverlap > 8`. You leave the ginormous slide underneath its own
   chute, so `exit-ginormousSlide` is inside the leg corridor by
   construction and its own mandatory spur already paves there — the same
   doorstep exemption the cruiser screen already grants. 20.3 m of the
   23.4 m connector is in the corridor because *both* ends are.
3. `c1a4816` — a `[escape]` trace line under `LGP_DEBUG_STREETS`.

## Measured

`npx vitest run`, whole suite:
- `origin/main` + fix: **443 passed, 0 failed**
- `ec74974` (#352) + fix: **448 passed, 0 failed** — the blocker is cleared.

Connectors drawn, per seed, before → after (`tmp-connectors.mts`, uncommitted
scratch listing `connector-*` routes off the built park):

| seed | on `main` | main+fix | on #352 | #352+fix |
| --- | --- | --- | --- | --- |
| canonical | 3 | **4** (+ballPit–exit-ginormousSlide) | 3 | **4** (same pair) |
| 2 | 5 | 5 | 6 | 6 |
| 5 | 3 | 3 | 3 | 3 |
| 11 | 3 | **4** (+building–stall.skyCruiser) | 2 | **3** (+ballPit–exit-ginormousSlide) |
| 18 | 4 | 4 | 4 | 4 |

So the escape draws **one** extra connector on two of five seeds and changes
nothing on the other three — it is not a general loosening.

## Still to do

- `npm run build` unpiped, exit code checked.
- Visual QA: headless playwright-core, production build, port 5361, before/
  after screenshots of the seed 11 ball pit / slide exit area; screenshots
  onto `qa-screenshots`.
- PR referencing #361, noting it unblocks #352.

## Done

- **PR #366** raised (`fix/connector-detour-361` → `main`), referencing #361 and
  noting it unblocks #352. Not merged — the Overseer merges.
- Screenshots on `qa-screenshots` under `issue-361/` (before/after crop, close,
  oblique, park-wide). Both preview servers (5361, 5362) killed by PID.
- Worktrees still in place: `.claude/worktrees/eng-361` (this branch),
  `.claude/worktrees/eng-361-measure` (detached, used to build `origin/main`,
  `ec74974` and `ec74974`+fix), `.claude/worktrees/eng-361-qa`. Remove them once
  #366 is merged; they each carry their own `node_modules` (issue #356).

To re-take the measurement, the two scratch scripts were
`tmp-connectors.mts` (lists `connector-*` routes off `buildParkFacts(seed)`) and
`tmp-qa-361.mjs` (playwright shots); both deleted, both trivial to rewrite —
they are three lines each and are described in the PR body.
