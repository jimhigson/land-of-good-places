# HANDOFF — bend building exteriors to the sphere (eng/bend-exteriors)

Branch off `feat/sphere-combined`. Jim's brief: a building wider than ~4.7 m must
**bend**, not tilt rigidly. The castle's four corner towers each stand along their
*own* local up and splay outward ~3°.

## The finding that shapes the whole job

Every large exterior today is `standOnSphere(group)` — **one** rigid tilt taken at
the group's own position (`terrain.ts:329`). That is correct only for something
small enough that the tangent plane is a good approximation over its footprint.
The measured threshold is 5 cm of departure at 4.69 m of radius.

Call sites found (grep `standOnSphere|tiltToSphere|standOnGround`):
- `building/layout.ts:208` — castle, via `deckClearanceOverFootprint` + one `upAt`
- `hotel/*`, `boundary.ts`, `wallRuns.ts`, `Scenery.ts:2294/2303` (wall + coping)
- `entrance/gateArch.ts:180`, `entrance/Entrance.ts:416/529`
- `Fountain.ts:191`, `KeychainShop.ts:688`, `FacePaintStall.ts:170`,
  `minigames/stalls.ts:215`, `train/station.ts:135` (other engineer's lane)

## The primitive being built

`src/world/geo/bend.ts` — `bentFrame(centre, lx, ly, lz, out)`:
walk the geodesic from the structure's centre frame along its own tangent by
`hypot(lx,lz)`, parallel-transporting the heading (`geodesic.ts`'s `advance`
already does the transport), then rebuild the frame at the arrival point so the
part's authored local direction still points where it did. Derivation:

    u = unit(lx, 0, lz);  b = atan2(lx, lz)
    h = q_centre · u                      // world tangent at the centre
    advance(g, h, hypot(lx,lz))           // g moves, h is transported
    tilt = quat(+Y -> up(g))
    h' = tilt⁻¹ · h;  ψ = atan2(h'.x, h'.z)
    q   = tilt · Ry(ψ - b)                // so q·u == h exactly
    then lift by ly along up(g)

`q·u == h` is the control worth asserting: it is the statement that the part
still points where the author meant, measured after the bend rather than assumed.

## Status
- [ ] bend.ts + its unit control
- [ ] castle exterior: towers splay
- [ ] long walls segmented
- [ ] hotel, boundary, gate arch, fountain
