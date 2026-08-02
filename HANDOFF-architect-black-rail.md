# HANDOFF: black-rail architecture review + fix

## Root cause (settled, evidence-backed)
Jim's "we STILL only have the black between the tracks" was **not** a
regression from the level rework. `git diff 60be892 846dec7 -- src/world/railRace/track.ts`
is 55 lines: imports + `setHazardLevel` only; the colour machinery is
byte-identical. PR #164 only ever painted a rail's zone vertices ink inside
`setSparking`'s *active* list — i.e. during the transient flicker while a
rider is actually sparking (press within 0.3 s inside a zone). Every calm
frame reset all rails to bright lane colour. The static "black track"
marking only ever existed on the plate. The earlier verification forced
`setSparking([...], 0.1)` and read darkened vertex data — it proved the
transient path (which works), not the standing marking Jim asked for.

## The fix (committed cc8db89, this branch)
`track.ts` now keeps a per-lane *resting* colour buffer: lane colour end to
end, with `PALETTE.ink` over every zone's `railZoneVertexRanges` when
`level >= ZONES_FROM_LEVEL`. `setHazardLevel` recomputes it (and stamps it
into the live attributes); `setSparking` resets from it instead of the
bright base. Sparking now flashes over rail that is already black, same as
the plate.

## Verification done
- `npm run build` exit 0 (full check suite incl. check:rail-race).
- Live dev server, `/rail-race`, chooseLevel(2): raw vertex data — each of
  8 rail meshes has 301 ink vertices in 2 runs; runs at raw route coords
  [111.5–125.6] and [219.7–239.6] vs zones at [110.7–125.9] and
  [219.0–240.5] (one tube ring ≈ 0.8 m agreement).
- Screenshots (scratchpad): close-up of cart wheels on black tubes, with
  the zone-end colour transition visible on all four lanes.
- Post-race `arrive()` resets to level 1 and rails repaint bright: seen live.
