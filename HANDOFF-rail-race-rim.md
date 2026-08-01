# Rail-race stall moved to the park rim — handoff

**Status: done.** Build green (exit 0), `test:procgen` 75/75 across 5 seeds
(canonical + 11, 18, 2, 5), `check:park` clean (74/74 waypoints connected, no
ratchet regressions). PR not yet opened as of this handoff — see "next step"
at the bottom if you're picking this up mid-flight.

## What was asked

PR #159 tried moving `stall.railRacer` to the park rim and concluded it was
blocked (stranded `poiGraph` waypoints at every rim position tried). A second
reviewer independently reproduced that finding. Jim asked for the real fix,
not another "still blocked" report.

## What was actually wrong (two independent bugs, not one)

1. **`paths.ts`'s spur `past` extension overshoot.** Every stall spur's last
   control point ("a couple of metres beyond the doormat into the plot
   mouth") walked a flat 2 m towards the plot regardless of how far the
   doormat already stood from the plot's real edge. For every stall (2.6 m
   footprint, 1.4 m standoff from `parkLayout.ts`) that lands 0.6 m *inside*
   the booth's own collision. Inland, `findClearSpot`'s nudge search can
   rescue that in any direction and still land near some other waypoint by
   luck (dense mesh). At the rim, with only one way back to the network, a
   nudge onto the booth's *far* side strands the waypoint behind its own
   wall — this is what PR #159 actually hit, both times it tried.

   Fixed generically in `src/world/paths.ts`'s `spur()`: `past` is now capped
   to stop `PAST_CLEARANCE` (1 m) short of the plot's real edge, computed via
   `edgeDistanceAlong` (exported from `parkLayout.ts`, same math the solver
   used to place the doormat). Applies to every stall and anchor, not just
   this one.

2. **Scenery RNG-cascade collateral strand.** Once (1) was fixed, most rim
   bearings *still* failed, for a second, unrelated reason: `Scenery`'s walls
   and trees draw from one shared, seeded RNG stream via rejection sampling.
   Moving the stall makes its spur ~2.5x longer, which changes how much
   ground counts as "on path" early in that stream, which cascades into
   different wall/tree positions much further round the park on *some*
   bearings. At bearing ~10-18° this landed a garden wall across the **ferris
   wheel kiosk's own line of sight** — a waypoint with zero relation to the
   rail-race stall, stranded as pure collateral. Confirmed by diffing every
   `PARK_LAYOUT` entry's position before/after the move: byte-identical
   except the moved entry itself, which rules out a layout-solver RNG shift
   and points at scenery specifically.

   This is *not* a bug to "fix" in general (it's inherent to shared-RNG
   rejection sampling) — the fix was to sweep real candidate positions
   against the actual built park and pick one that doesn't trigger it, per
   CLAUDE.md's "swap the seed, don't weaken the assertion" rule.

## The sweep

Swept bearing 0-35° x radius 38-46 m, pin+band edited via script, each point
built for real and measured with `check:park` (`LGP_RATCHET=off` for speed,
then the winning candidate re-verified in full strict mode). Two independent
failure modes showed up as distinct bands:

- bearing 0-15° and 25-35°: solver **rejects the pin outright** — the plot's
  edge comes within `CORRIDOR_GAP` (5 m) of the `waterFight` anchor's own
  15 m plot at low bearings, or of others at high bearings.
- bearing 8-22° (with some radius-dependent exceptions): the ferris-kiosk
  collateral strand from bug 2, above.

Clean band: **bearing 18-22°, radius 40-41 m** is clean on every invariant in
strict mode. Chose **20°, 41 m** — comfortable margin either side in the
sweep, plot edge (41 + 3.4 = 44.4) well short of the train's 48 m inner edge
so the rail loop is untouched.

Final pin: `[38.527397452222246, 14.022825876352417]`, band
`{ min: 13, max: 42 }`. See the comment on the manifest entry
(`src/world/parkManifest.ts`) for the full account.

## Files changed

- `src/world/parkLayout.ts` — exported `edgeDistanceAlong` (was private).
- `src/world/paths.ts` — `spur()`'s `past` extension now clamped to
  `PAST_CLEARANCE` short of the target plot's real edge.
- `src/world/parkManifest.ts` — `stall.railRacer` pin moved to the rim, band
  widened to allow it, comment records the two bugs and the sweep.
- `test/procgen/invariants.ts` — new invariant
  `railRaceStallStandsAtTheRim`: proves (a) the stall's gap to the *built*
  rail-race ring is the smallest of every plot in the park (checked
  non-vacuous — fails against the old inland pin, where the ferris wheel's
  plot was closer), and (b) its doormat is standable and reachable from the
  entrance on the real nav lattice (the latter wasn't covered by any existing
  invariant for any entrance).

## Verification performed

- `npm run build` — exit 0, checked directly (not piped through
  `tail`/`head`).
- `npm run test:procgen` — 75/75 passed, 5 seed files (after `npm install` in
  this fresh worktree — `vitest` wasn't in `node_modules` until then, a known
  shared-checkout quirk per PR #159's own review, not something this change
  introduced).
- `npm run check:park --verbose` — 15/15 attractions route, 0 rail crossings,
  74/74 waypoints connected, 5 recorded ratchet deviations all within their
  historical worst (no regressions), exit 0.
- `npm run check:rail-race` — unaffected: arch tracks the booth's new bearing
  automatically (`route.ts`'s `startDistance` derivation), exit at
  `(43.2, 15.7) r=46.0`, "rail race: OK".
- Manually confirmed the new invariant is non-vacuous by re-running it
  against the old inland pin (fails: 6 other plots closer to the ring) and
  the new rim pin (passes on all 5 seeds).

## Next step if you're picking this up

Everything is committed on this branch. Open the PR with `gh pr create`
(don't merge it — per current policy this gets one review pass, not two).
