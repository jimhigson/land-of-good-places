# HANDOFF — bridge clipping (#349): pointer

**The handoff for this work is `HANDOFF-paving-drawn-stone.md`**, on this branch
(`fix/paving-follows-drawn-stone`). This file exists only because the ticket is
often referred to by the `bridge-clipping-349` name — the file of that name on
branch `bridge-paving-clip` belongs to the **closed** PR #352, and is history,
not current state.

## The answer, in one paragraph

The collider standing in seed 2's bridge deck at (12.4, −44.0) is **the
neighbouring bridge's own masonry parapet**. Seed 2 builds two bridges — index 0
over the crossing at (−2.19, −46.97) and index 1 over (15.35, −35.74) — and
their ramps run at each other. Bridge 1's ramp parapet crosses bridge 0's walked
centreline at `across = +0.11`, dead on the walking line, still 2.98 m tall in
absolute terms because that point is high up bridge 1's own ramp.

**Why the scene graph came back empty**: parapets are collision-only. They are
registered by `ParkTrain.ts`'s `for (const rail of built.guardRails)` loop and
have no scene node of their own — so no amount of walking `park.scene` was ever
going to name one. Interrogating the collision world is what found it, in one
run.

**Why its placement follows the real road width**: the exclusion that should
have prevented it, `planReal`'s `nearOtherGuardRail`, places the neighbour's
rail at `railAcross = deck.halfAcross`, which is `roadHalf +
BRIDGE_WALL_THICKNESS`. Widening the road slides bridge 1's real parapet
laterally, which moves where it cuts bridge 0's centreline — exactly the one
0.5 m step the predecessor measured. And `ACROSS_MARGIN` does nothing because it
belongs to the *conservative reservation*, which places no parapets at all.
**The predecessor's dead hypothesis was not a wasted hour**: measuring
`ACROSS_MARGIN` at 1.0/2.0/3.0 and getting a byte-identical span is what proved
the lever was on the real-pass side, and the real pass is precisely where the
bug turned out to be.

**The root cause**: `nearOtherGuardRail` clamps `along` to `±DECK_HALF_LENGTH`
(`FENCE_OFFSET + 1.2` = 3.2 m), modelling a neighbour's guard rail as 6.4 m
long. `bridges.ts` actually builds parapets over `-lengthNeg … +lengthPos` — the
deck **and both ramps**, measured out to `along ±11.27`, some 22 m. The blocking
segment sits at bridge 1's `along +8.73`, 5.53 m past the end of the rail the
check believes in, so the check reports "no nearby guard rail" and bridge 0
plans its ramp straight through a wall that is about to be built. The comment
claiming parapets are built "never a ramp" is stale.

Full evidence, tables and the reusable probe recipe are in
`HANDOFF-paving-drawn-stone.md`; the probe itself is
`scripts/probe-seed2-blocker.mts`.
