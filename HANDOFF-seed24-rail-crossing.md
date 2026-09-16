# HANDOFF — seed 24 unbridged rail crossing (and the three siblings)

Model: Opus 5 (1M context), chosen by the Overseer's dispatch (Engineer).

Branches:
- `eng/seed24-enclave` (PR -> `feat/sphere-combined`): the seed 24 cure + invariant.
- `eng/seed11-phantom-paving` (PR -> `feat/sphere-combined`): seed 11 cure.
- `eng/seed24-rail-crossing`: reproduction branch = `eng/sphere-six-reds` + both
  cures, for testing #650 with them in. Not for merging.

## Seed 24: SITING, not routing (measured)
Offending edge `spur-stall.spookyHouse`. The loop pinched to a neck: centre
lines at railD ~36 and ~151 are 4.0 m apart ((23.9,-29.6) vs (26.0,-33.0)), so
the two fences meet. Flood fill of ground clear of rail by FENCE_OFFSET +
FENCE_HALF_THICKNESS + PLAYER_RADIUS (2.8 m), masked by PARK_BOUNDARY:
3 regions, 18594 / 684 / 528 m2. Both CROSSING_SITES (railD 0, 180) join the
18594 and 684 m2 regions; spookyHouse (10.6,-53.6) is alone in the 528 m2 lobe.
explainBridgeRefusal over the whole loop: no bridge fits on that lobe's rail.
CONTROL: clearance 0.3 m opens the neck -> 2 regions, lobe merges. No legal leg
exists; the router's local-side clamping drew the only one it could.

## Cure
`train/route.ts` `loopKeepsItsCrossing` clause 3,
`loopLeavesEveryDestinationOnTheCrossing`: a closed loop is refused unless every
PARK_LAYOUT doormat, the cruiser dismount and the gate walk lie in the two
regions the start-pose bridge lands in (read at the foot of the proven ramp).
Search moves to its next pose. Boundary mask matters (without it the rim
strips reconnect round the outside of the wall — seed 451 read as fine).

## Fingerprints (loop hash, sites, path-network hash) — scripts deleted,
scratch `zz-fingerprint.mts` hashed 720 loop samples + every edge's points.
feat/sphere-combined before == after on canonical, 11, 24, 131, 326 (full) and
128, 208, 274, 428 (loop). Only 451 changed: base THREW (unbridged crossing
railD 133.9), now builds (loop 348.71 -> 217.94 m). 451's base loop, measured
with the boundary: 44 regions, main 15737 m2; its one bridge joined a 773 m2
rim strip (railRacer + exit) and a 2384 m2 lobe (dodgems), neither the main park.
Control that the fingerprint can move: seed 24 on six-reds 65851c4b2c47 ->
255d58377383, sites [0,180] -> [20,182,234], builds.

## Invariant
`every doormat in the park can be walked to from the gate` (nav lattice).
Red-proved on six-reds seed 24 with clause 3 removed and crossings.ts's throw
muted: "stall:spookyHouse at 10.6, -53.6 cannot be walked to from the park
entrance". Green, 14 doormats, on canonical/11/24/131/326 (combined).

## Seed 11 (six-reds): different root cause — phantom street paving
spur-stall.keychain starts at (21.2,-17.1) on `spur-stall.spaceFerrisWheel`,
which is `paved: false` (destination already on the network) but whose street
route still committed lattice paving. Fix: snapshot/restore lattice state
around an unpaved spur (paths.ts). By name: six-reds seed 11 loses exactly
"no paved path stops anywhere but a destination"; combined base seed 428 loses
the same failure (latent there); 11 and 131 on combined: identical failing
names. Path hashes change on combined 11, 131, 428 only.

## Seed 326 (six-reds): NOT FIXED — a measurement mismatch, needs a ruling
ferrisWheel/exit-ferrisWheel: paths.ts measures 28.4 m (connector not needed:
waste 18.9 < minWaste 25.8); invariant measures 157.5 m. The exit spur starts on
spur-building's 90-degree corner vertex (11.1,-32); the drawn ribbon fillets that
corner (CORNER_FILLET 1.75) and passes 0.62 m from it, and the invariant's
DETOUR_SPLICE_TOLERANCE is 0.6. Ribbon half-width 1.4, so the paving overlaps.

## Seed 131 (six-reds): scatter, NOT routing, not fixed
tree at (-87.8, 29.3) reaches -0.20 m of the rail centre line; nearest path 21.5 m.
