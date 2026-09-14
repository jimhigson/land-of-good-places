# HANDOFF — radial world UI, effects and lighting

- **Branch**: `eng/radial-fx`, off `origin/feat/sphere-combined` (`31d0fb2a`).
- **Worktree**: `.claude/worktrees/eng-radial-fx`.
- **Model**: Opus 5 (1M context). Chosen by the Overseer when this engineer was
  dispatched — a replacement must be the same model (CLAUDE.md).
- **Reports to**: the Overseer, `landofgoodplaces-fc`. Lead engineer for the
  radial conversion is `ad0ca7dab45dd5e3a`.

## The brief

`RADIAL-INVENTORY.md` (on `seek/radial-inventory`, **not** on this branch)
§3.1, §3.2 and §3.4 — the ~15 `src/` world-UI, effects and lighting sites the
earlier altitude sweep never looked at. **`tapMarker.ts` and `rainbowRing.ts`
are the lead's, not mine** — do not touch them.

## Rows closed, in commit order

| row | file | commit subject |
|---|---|---|
| §3.1 `Highlights.ts:281,217` | `src/world/Highlights.ts` | guarantee ring lies on the ground it marks |
| §3.2 both rows | `src/world/DayNight.ts` | fill + sky ambient use the player's up |
| — | `scripts/measure-fill-elevation.mts` | the measurement behind it, re-runnable |
| §3.1 `flowerSparkle.ts` | `src/art/effects/flowerSparkle.ts`, `src/world/up.ts` | `tiltFor`, and the pick flourish plays in the flower's frame |
| §3.1 `puffs.ts`, `dustPuff.ts` | both | smoke and heel dust leave the ground they were kicked off |
| §3.1 `ActionChips.ts:210` | `src/ui/ActionChips.ts` | the action chips anchor above the thing |
| §3.4 | `src/core/constants.ts`, `src/world/Garden.ts` | `TERRAIN_RADIUS` deleted |

**Left open deliberately**: §3.1's `interact.ts:254` (and with it §2.4 #2). I
closed it, then reverted it — see below. The row is still open and its right
home is the checks side.

**Still open otherwise in my area**: nothing. §3.1's `rainbowRing.ts:140,290,317` and
`tapMarker.ts` are the lead's. §3.3 (coaster/castleWindows clearance) is not
world UI and was left alone.

## The two shared things I added — tell whoever owns them

1. **`tiltFor(x, y, z, target)` in `src/world/up.ts`** — the space-aware twin
   of `tiltToSphere`: the rotation from the flat authoring frame into the frame
   at a world point, the identity indoors. Four effects use it. The lead owns
   shared helpers; if it wants this shaped differently, it is one function.
2. ~~`sameStorey` moved into `interact.ts`~~ — **done and then reverted.**
   `interact.ts` **cannot import `world/spaces.ts`**: the chain is `spaces` →
   `building/layout` → `parkLayout` (seed-dependent), and `building/layout` →
   `tapSpacing` → back into `interact`. A static import from `test/procgen`
   then loads the park manifest before the seed is set and `parkFacts` throws
   at collection time. Measured: `test:procgen` went from the base's
   `49 failed | 269 passed | 279 skipped` to `132 passed | 465 skipped` — no
   failures, 137 fewer tests run, nothing red. The fix belongs one layer out,
   or behind a `spaces`-free owner of "which space is this"; the note is
   written into `ZONE_HEIGHT_TOLERANCE`'s doc comment. `scripts/`,
   `check-tap-spacing.mts` and `invariants.ts` are untouched by this branch, so
   there is no conflict waiting for whoever takes §2.4 #2.

## What has NOT been verified, and why

- **The park does not build headlessly on this branch** — `check:park` and
  `check:hotel` die inside `new World` on a `railD 0.0` crossing throw that
  pre-dates all the sphere work (inventory §0). So every park-shaped check is
  asserting nothing, mine included, and the lighting/effects work has to be
  judged in a browser.
- `tsc --noEmit` and `typecheck:test` are clean on every commit.

## Findings worth keeping

- **The fill light was below the horizon across the whole outer park.**
  Measured, `scripts/measure-fill-elevation.mts`, sun 30° up: the fill sat at
  +32.0° above the local horizon at the park's centre, +6.2° at 100 m and
  **−11.5°** at 157 m. Its own comment two lines above said underneath-lighting
  was the thing it existed to prevent.
- **`TERRAIN_RADIUS` was read by nothing.** The drawn ground disc comes from
  `boundary.ts`'s `TERRAIN_EDGE_RADIUS` (251.7 m); the constant said 83.5 m and
  two other comments in `constants.ts` reasoned from it.
- **`DayNight`'s terminator is Jim's call, not an engineer's** (inventory §3.2,
  third row). Deliberately untouched. The outer park sits in true geometric
  shadow for hours while `nightFactorValue` says noon.


## Verified

Every run below was done **twice — once on this branch and once on its base at
`31d0fb2a`** — because the base is already red (inventory §0) and a bare exit
code from a red branch says nothing. What is being asserted is *parity*, not
green.

- **`tsc --noEmit`** and **`typecheck:test`** clean.
- **`pnpm run check`**: both runs execute the **same 20 steps in the same
  order** and both die at `check:npc-perch` on the same pre-existing
  `railD 0.0` crossing throw inside `new World`. The chain itself is
  **65 steps, step set identical to the base's** — parsed from the `scripts`
  object, not grepped; no step added, none dropped, and the full 122-name
  script set is equal.
- **`pnpm run check:coplanar`** and **`pnpm run check:swept-bus`**: both die in
  `new World` on that same throw, on this branch and on the base, with the
  identical message. Neither can assert anything until §0 is fixed.
- **`pnpm run test:procgen`**: `49 failed | 269 passed | 279 skipped`, failing
  set **identical to the base's**, name for name and count for count (the base
  is red before this branch — inventory §0, the `railD 0.0` crossing throw).
  Compared by name rather than by count, because a count cannot see a swap.
- **In a browser**, two dev servers side by side (base on 5419, this branch on
  5418), `/spawn?seed=428&pos=118,0&facing=270` — 118 m out, 30° of lean:
  - the park builds, no new console errors (only the base's own `skyCruiser`
    warnings, byte-identical on both);
  - the grass at the rim reads brighter after the hemisphere fix — sampled
    mean green **111.5 → 114.9** over the same patch;
  - running leaves a proper trail of dust puffs lying flat on the leaned grass.
- **The fill-light direction is proved by measurement, not by eye**:
  `scripts/measure-fill-elevation.mts`, sun 30° up, elevation above the *local*
  horizon **+32.0° / +22.1° / +6.2° / −11.5°** at 0/40/100/157 m before, and
  **+32.0°** at every radius after.
- **Not shown in a frame**: the fill's worst case is a low sun, and `/spawn`
  cannot freeze the clock while `/view` has no player for `followPlayer` to
  read — so the blue underneath-lighting itself was not photographed. The
  measurement above is the evidence for that row.
