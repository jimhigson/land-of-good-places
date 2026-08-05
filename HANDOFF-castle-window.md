# HANDOFF — E4-castle-window, issue #113 second half

**State: build green, `test:procgen` 90/90 on five seeds, ready for QA. No PR
raised (waiting on the Overseer).**

- Branch `feat/castle-cruiser-window`, worktree `.claude/worktrees/castle-window`
- Dev server port **5313** (`npx vite --port 5313 --strictPort`)
- Based on `chore/invariant-return-complaints` (needed its `Invariant` shape).
  **Not** on E3's `generate.ts` commit any more — `generate.ts` is untouched.

## What it does

Where the Sky Cruiser meets the castle it now flies **through** it: in one side
wall, across the courtyard, out the other, through large stone-framed openings.

## The four things worth knowing

1. **The opening is cut from the route; the route is never bent to an opening.**
   The loop solves against a castle described as real masonry
   (`building/cruiserWindow.ts`) with the middle of each side wall passable;
   `coaster/castleWindows.ts` then walks the built curve through the wall slabs
   and reports the hole. `Shell.ts` cuts exactly that. Nothing reserves space —
   Jim's ruling, recorded as **Decision 6** in `ARCHITECTURE-DECISIONS.md`.

2. **`rail/generate.ts` is plan-view only, so it cannot backtrack on a vertical
   collision.** At the moment it accepts a piece there is no height yet.
   Measured over 24 free solves: 20/24 crossings landed within 1.1 m of the
   panel midpoint (a 4.07 m allowance) — the search constrains that itself —
   but only **1/24** at a height where a window fits inside the wall. So the
   height is a **carve applied where the plan turned out to run inside the
   castle**, exactly as the profile is already carved to 1.1 m at the station.

3. **Carve order is load-bearing.** The castle carve runs *after* the station's.
   The other way round, the station's 26 m ramp overran it and one crossing came
   out at 2-4 m instead of 5.6 — a hole through the courtyard floor.

4. **A seed whose loop misses the castle cuts no windows and that is a pass.**
   `route.castleSpan` is `null`, `Shell.ts` takes the untouched two-band path.
   Do not make anything assume a window exists.

## Two bugs this found, both by measuring rather than reasoning

- **`castleSpan` was in plan arc length, used as built-curve arc length.** The
  plan runs ~1.5% short, so the span stopped a metre before the second crossing
  and one window was silently never cut. Three of five CI seeds caught it. It is
  now measured on the finished curve.
- **`sweptCartHits` was measuring nothing.** A headless park never renders, so
  every `matrixWorld` was still the identity and the rays passed through a
  castle that was nowhere near the coaster. Fixed by updating world matrices
  from the scene root first. **If you add any raycast assert to a headless
  check, this will bite you too.**

## Asserts, each proven red before being trusted

`npm run check:castle-window` (in `build`) and the invariant "the Sky Cruiser
fits through the window it cut in the castle" both run the same two functions:

- `checkCastleWindows` — geometric, says *why* (within one panel, masonry left
  beside the tower, wide enough for the car, both openings level);
- `sweptCartHits` — fires the car's four envelope corners at **every mesh under
  the castle's garden root** and names what they struck.

Proven to fail by: shrinking the opening below car width; cutting it 3 m from
where the route crosses; shoving it 5.5 m along into a corner tower; raising it
through the battlements; and building the wall solid while still declaring the
openings (that last is what exposed the `matrixWorld` bug).

## Numbers (canonical seed)

Openings 3.30 m and 3.27 m wide; sill 3.94 m, head 7.65 m in an 8.8 m wall, so a
1.15 m lintel; track dead level at castle-local 5.60 m. Loop 185 m, 8 pieces.

## Left undone / next

- **Visual QA has not happened.** Nobody has looked at this in a browser. The
  masonry surround (quoined jambs, lintel, projecting sill, both faces) is
  build-verified only.
- `restarts` raised 200 → 2000 in `coaster/route.ts`; canonical route unchanged
  (same 185 m, 8 pieces, 6 backtracks, 192 candidates). Failure cost measured by
  `npm run measure:solver-budget`: 24 ms / 89 ms / 483 ms at 200 / 1000 / 5000.
- `STEPS_PER_START` (1200) in `generate.ts` is the other cap and is **not**
  raised — it is shared with E3's slide work and raising it could move the
  cruiser's solved route.

---

## What happened after this branch (added at handover)

This work is done and queued for QA. Three things came out of it that live
elsewhere, so a replacement does not go looking for them here.

- **`feat/cruiser-3d-clearance`** (worktree `.claude/worktrees/cruiser-clearance`,
  commits 57c9233 + 5281d98, no PR). Generalises the castle's swept-car check to
  the whole park: the Sky Cruiser measured against every mesh actually built,
  replacing the hard-coded `['building', 'ferrisWheel']` that three separate
  checks were all re-reading. Runs as `npm run measure:cruiser-clearance`. Its
  own `HANDOFF-cruiser-clearance.md` carries the reasoning — read that, not this.

- **Issue #198 — the Sky Cruiser flies through foliage on the station ramp.**
  Found by that check, and **inherited, not caused here**: an A/B with the same
  envelope numbers gives `origin/main` 3 strikes at a 216 m loop against this
  branch's 2 at 185 m. Cause is narrow — `stationWindowIsClear` proves the ground
  clear for ±6 m of the platform while the ramp is 26 m long, so ~20 m of it has
  never been checked. **Not started**, by instruction.

- **Issue #197 — `scripts/` is not typechecked** (42 files, including every
  `check:*.mts` that gates the build). Opened citing #192, branch
  `chore/typecheck-scripts` off `origin/main` with a baseline
  `tsconfig.scripts.json`, essentially unstarted. Note #192 is on
  `fix/typecheck-tests` and **has not landed on main**, and its own commit
  message says `typecheck:test` was deliberately not wired into `build` yet.

**Deliberately not done, and it would be wrong to just do it:** the
`TOO_TALL_TO_FLY_OVER` comment in `test/procgen/invariants.ts` still claims the
castle and the wheel are "the only horizontal obstacles the loop actually has",
which is false. Retiring the list and wiring the real measurement in turns CI red
on #198, which is not this change's bug. It wants sequencing behind the ramp fix
— the same call #192 made with `typecheck:test`.
