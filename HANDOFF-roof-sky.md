# HANDOFF — roof garden sky and clouds (#455)

Branch `feat/roof-garden-sky`, worktree `.claude/worktrees/roof-sky`,
dev server port **5527**.

## The finding — measured, not guessed

The green floor is **`Shell.ts`'s `buildInteriorPlaza()`**, a
`CircleGeometry(52)` of `PALETTE.grassLight` at `y = -INTERIOR_PLAZA_DROP`
(−1.20) with a 22 m `grassDark` skirt under it. It was built **per floor**,
including the roof garden.

Found by building `BuildingShell('interior')` headlessly and casting rays out
over the roof's east parapet from a child's eye (1.4 m):

```
pitch  -2° -> nothing (sky)
pitch  -5° -> nothing (sky)
pitch  -8° -> 23.9 m  y=-1.20  building-shell-floor-2/interior-plaza/Mesh
pitch -12° -> 16.0 m  y=-1.20  interior-plaza
pitch -20° ->  9.7 m  y=-1.20  interior-plaza
```

Not the park's terrain (600–1200 m away and far past fog), not anything the
roof garden builds itself. The disc was correct for the stacked building it was
written for — the roof was five storeys above it — and became wrong the day
#377/#380 put every floor at the same `y` in its own space.

## What shipped

1. `Shell.ts` — the plaza disc is built only for `deck < plan.enclosedDecks`.
   Enclosed floors keep theirs (their windows must look out on something); the
   roof gets sky. Nothing walkable changes: `registerInteriorCollision` walls
   the roof's whole perimeter, so the disc was scenery there and only ever
   scenery.
2. `src/world/building/roofClouds.ts` (new) — transparent puff clouds drifting
   round the roof plate's own rounded-rectangle outline, in two tiers (near/head
   height, deep/below). One `InstancedMesh`, one draw call, updated by
   `Building` only while the roof is the space being drawn.
3. **Time of day needed no new code.** `Building.playerInRoofedInterior` already
   reports `false` for the roof (`CASTLE_ROOF.roofed === false`), so `DayNight`
   was already running the real sky there — the disc was simply covering it up.
   No second sky was written; `check:sky-view` and `check:space-night` untouched.
4. `check:castle` gained a roof section — see below.

## Two things the measurements caught that reasoning had got wrong

- **The orthographic frame is tiny.** One screen half-width is ~12 m (measured
  by projecting the plate's own corners). The first cloud field was a 6–40 m
  band, 40 m deep: 116 puffs rendered, **0 on screen**. Anyone retuning the
  tiers must re-measure rather than reason.
- **The stand-off arithmetic was wrong by 0.87 m.** The comment claimed no puff
  could reach back over the garden because `PUFF_SPREAD_Z × radius <
  NEAR_OUT_MIN`; it had forgotten the puff's *own radius*. `check:castle` found
  it on its first run (1425 puff-frames over the meadow). Each cloud is now
  shaped first and its stand-off **derived** from the puffs it actually got.

## Gates

`pnpm run check` 0 · `test:procgen` 497 · `build` 0 · `check:castle`,
`check:castle-floors`, `check:sky-view`, `check:space-night`,
`check:deck-fallthrough` all pass. The new roof section was proved red in three
directions (plaza back on the roof; plaza deleted everywhere; the cloud
stand-off bug, against the geometry as committed in 8e8b6d6).

## Looked at

`/castle?deck=2&at=18,-11`, `&at=2,12`, `&at=-18,0`, at 08:00, 12:30, 19:24 and
23:00, in headless Chromium at 1280×800. Shots in `/tmp/roof-shots`. Clouds do
not read from the middle of the plate — the frame is too tight — only from the
rim, which is where the height is.

`scripts/shoot-roof.mts` is the throwaway harness (`SHOOT_PATH='a|b'`); delete
it before merge if a reviewer would rather not carry it.
