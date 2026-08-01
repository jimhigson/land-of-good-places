# HANDOFF: Rail Race — blacken the actual rails in spark zones

Branch: `worktree-agent-a4332413669aaf572` (this worktree). Commit `f6fe231`.

## Task

Jim (1 Aug 2026): "Make the actual track back[sic, black] as well." The
spark-zone overlay plate (`buildSparkRibbons` in `src/world/railRace/track.ts`)
already flashes black over hazard zones, but the rail geometry underneath
kept its flat per-lane `MeshToonMaterial` colour, visible from the side-on
race camera.

## What was done

`src/world/railRace/track.ts`:
- Rail materials switched to white `MeshToonMaterial` + `vertexColors: true`
  (was flat `toonMaterial(colour)` per lane).
- Each rail's `sweptRails()`-built `TubeGeometry` gets a `color`
  `BufferAttribute`, seeded per-vertex with the lane's own `LANE_COLOURS`
  entry (so non-sparking rail looks identical to before).
- New `buildRailZoneVertexRanges()` (next to `buildSparkRibbons`, same file)
  maps each `HazardLayout` zone to the tube's vertex ring range. Because
  `RailRaceRoute.pointAt`/`tangentAt` are pure closed-form (a circle +
  sinusoid, not a sampled curve — see `route.ts`), and every lane's tube
  shares the same `tubularSegments` (same `route.length`, same
  `RAIL_TUBULAR_PER_METRE`), this is built **once**, not per lane.
  Approximates ring `i`'s route distance as `(i/tubularSegments) *
  route.length` — not exact (`TubeGeometry` samples arc-length along the
  *fitted* Catmull-Rom curve, not raw route distance) but accurate to
  centimetres given the loop's gentle, near-circular shape — see that
  function's own doc comment for the full reasoning.
- `setSparking()` extended: after its existing plate reset-then-repaint,
  does the same for the rails — copies each lane's base colours back in,
  then overwrites the active zone×lane's vertex ranges with the *same*
  `sparkColour` (ink/flash lerp) already computed for the plate, so plate
  and rail flash in phase.

## Status

- `npm run build` — exit 0 (full chain incl. `tsc --noEmit`, `check:rail-race`).
- `npm run test:procgen` — 80/80 pass. No invariant added: this is pure
  rendering (vertex colour), not placement — nothing to measure geometrically
  that isn't already covered.
- **Visual verification not yet done.** Need to confirm with the Overseer who
  owns the shared Chrome profile before driving it (CLAUDE.md: only one agent
  at a time, ask first). Plan once granted: own dev server on its own port
  (`--strictPort`), open a private/incognito-equivalent fresh page
  (background: true), ride to a spark zone (or teleport via
  `window.game.world.railRace` rider state — same technique as the session's
  earlier duck-bar work), screenshot a sparking rail next to a calm one.

## Next steps for whoever picks this up

1. Get Chrome ownership from the Overseer, or ask Jim to eyeball it directly
   on a dev server.
2. Take before/after screenshots (calm rail vs. sparking rail) confirming the
   rail itself — not just the plate — visibly blackens.
3. `gh pr create` — do not merge. One review is enough (Jim's 1 Aug policy).
4. Kill the dev server (by PID) and close any browser pages opened.
