# HANDOFF — the lobby's twin-stair composition, art assets

Branch: `art/lobby-twin-stairs` · Worktree: `.claude/worktrees/lobby-art`
Role: **Artist.** Delivers the assets a features agent needs to lay the hotel
lobby out like Jim's reference photo of a grand resort lobby: two mirrored
sweeping staircases rising to a mezzanine **bridge** across the room, a central
archway you can see straight through at ground level, and a cluster-of-pendants
chandelier in the double-height space.

**Do not touch `src/world/**`.** The features agent owns the room.

## State

In progress. See "Deliverables" for what is done.

## Files this agent owns

| File | What |
| --- | --- |
| `art/blend/hotel_build.py` | The authoring source. Generated `.blend` follows. |
| `art/blend/hotel_export.py` | Writes `src/art/assets/hotel.glb`. |
| `art/blend/hotel_render.py` | Review renders → `art/renders/hotel/`. |
| `art/blend/hotel.blend` | **Generated — never hand-edited.** |
| `src/art/assets/hotel.glb`, `hotelGlb.ts` | Generated. |
| `src/art/models/hotelAssets.ts` | Factories, constants, colours, outlines. |
| `scripts/pack-hotel-asset.mts` | Byte budget only, flagged in the report. |

Read `HANDOFF-hotel-art.md` for the pipeline and everything the staircase
already knows.

## Deliverables

1. **Mirrored grand staircase.** In progress.
2. **Bridge balustrade module.** Not started.
3. **Pendant-cluster chandelier.** Not started.

## The mirror convention (decided, before any code)

Mirroring in code with `scale.x = -1` is forbidden — it flips triangle winding
and `MeshToonMaterial`'s `FrontSide` then culls the whole flight (CLAUDE.md's
hood-face lesson). So the mirror is **authored**: `stair_point()` takes a
`hand` of ±1 and the cross-sections are wound the other way round to match.

Handedness is named for **the climber**, never for a side of the room:

- `'right'` — climbing it you turn to your **right**. This is the flight that
  already shipped. Foot tread at game **+Z** from the origin, top tread at
  game **−X**. `LOBBY.mezzanine.stair`'s arc exactly, `fromAngle = 0`.
- `'left'` — the mirror image of that through the plane `x = originX`. Foot
  tread at the **same** place (game +Z from the origin); top tread at game
  **+X**.

Both share one origin convention, unchanged: **the arc's centre of curvature,
on the floor** — not the foot of the flight.

Consequence worth knowing for the composition: a `'right'` flight belongs on
the **east** side of the room and a `'left'` flight on the **west**, because
each one's top swings *toward* the room's centre from there. Put the two
origins at `(±C, Zc)` and the pair is an exact mirror about `x = 0`, the feet
land side by side at `z = Zc + r` (toward the entrance) and the two tops face
each other across a gap of `2·(C − STAIR_OUTER_RADIUS)` at `z = Zc` — which is
the bridge's span, and the archway's width at ground level.
