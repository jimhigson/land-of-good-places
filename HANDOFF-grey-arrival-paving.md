# Handoff — grey arrival paving (issue #477)

Branch `fix/grey-arrival-paving`, worktree `.claude/worktrees/grey-arrival-paving`.

## The ask

Jim: *"the paving outside the park that the bus arrives on should be grey during
gameplay - don't change the intro sequence."*

## What the paving actually is

`src/world/entrance/Entrance.ts`'s `buildEntranceRoad()` — two ribbons, both
built from **one** `roadMaterial()`:

- `entrance-road-kerb` — z = `ENTRANCE_BUS_STOP_Z` (69), x from about −12 to
  +12. This is the strip the cat bus stands on, outside the wall (wall at
  z = 60).
- `entrance-road-gateway` — x = 0, z from 72.89 down to `ENTRANCE_STOP_Z` (52),
  i.e. through the arch to the bus-stop marker inside.

Colour today: `roadTexture()` in `src/core/textures.ts` paints sandy slabs
(`PALETTE.pathSand` / `pathSandDark` / `pathEdge`) with `stonePink` kerbs and a
`markerLemon` centre line. So it reads the same sand as the park's own paths.

## The seam that keeps the intro untouched

`roadMaterial()` has exactly **two** call sites:

- `Entrance.ts:647` — the park scene (gameplay, and the last few seconds of the
  arrival, which happens in the park scene).
- `BusJourney.ts:1256` — the **intro ride's** lane, its own `Scene`, built
  before any park exists.

So making the *park's* entrance road grey and leaving `BusJourney` on the
default sand changes nothing whatever in the ride. That is the whole diff.

## Decision: the whole entrance road goes grey, not just the bit outside the wall

The spur is one continuous road through the arch to the bus stop; splitting it
at z = 60 would put a hard sand/grey seam in the middle of a road surface, and
the 8 m inside the arch is the bus-stop apron, not a park path. One colour.

## Files touched

- `src/core/textures.ts` — `roadTexture(tone: RoadTone = 'sand')`, cached under
  `road:${tone}`. Grey ladder reuses `ART.statueStone{Light,,Mid}` (the park's
  one documented grey), so no new colour is invented. Kerbs stay `stonePink`
  and the centre line stays `markerLemon` — deliberately, so it still reads as
  the same road.
- `src/world/entrance/road.ts` — `roadMaterial(tone)` passes it through.
- `src/world/entrance/Entrance.ts` — `roadMaterial('grey')`.

## Status

Implementation done; running check / test:procgen / check:coplanar / build.
No browser owned by this agent — visual QA listed in the PR.

Deep link for looking at it:
`/spawn?pos=0,66&facing=0` — stands outside the wall on the kerb road looking
in at the arch.
