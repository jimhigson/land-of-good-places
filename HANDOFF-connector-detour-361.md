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
