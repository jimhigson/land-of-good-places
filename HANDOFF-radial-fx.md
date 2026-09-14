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
| §3.1 `ActionChips.ts:210`, `interact.ts:254` **and §2.4 #2** | `ActionChips.ts`, `interact.ts`, `tapSpacing.ts`, `check-tap-spacing.mts`, `invariants.ts` | `sameStorey` is one function and asks the planet |
| §3.4 | `src/core/constants.ts`, `src/world/Garden.ts` | `TERRAIN_RADIUS` deleted |

**Still open in my area**: nothing. §3.1's `rainbowRing.ts:140,290,317` and
`tapMarker.ts` are the lead's. §3.3 (coaster/castleWindows clearance) is not
world UI and was left alone.

## The two shared things I added — tell whoever owns them

1. **`tiltFor(x, y, z, target)` in `src/world/up.ts`** — the space-aware twin
   of `tiltToSphere`: the rotation from the flat authoring frame into the frame
   at a world point, the identity indoors. Four effects use it. The lead owns
   shared helpers; if it wants this shaped differently, it is one function.
2. **`sameStorey` moved from `tapSpacing.ts` into `interact.ts`** and its
   signature changed from `(aY, bY)` to `(ax, ay, az, bx, by, bz)`.
   `tapSpacing.ts` re-exports it, so the name still imports from there, but the
   **four call sites in `scripts/check-tap-spacing.mts` and
   `test/procgen/invariants.ts` were updated in the same commit**. Whoever owns
   §2 of the inventory should know that row is closed, and that a rebase of
   those two files will conflict here.

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
