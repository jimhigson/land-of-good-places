# HANDOFF — issue #480, "a weird segment of a torus near the park edge"

Branch `fix/torus-480`, worktree `.claude/worktrees/torus-480`.

## Found it — measured, not guessed

`park-gate-arch`, the crossbar of the park's entrance gate, built in
`src/world/entrance/Entrance.ts` (~line 311). It is a half `TorusGeometry`
(radius `ENTRANCE_GATE_HALF_WIDTH` = 4.3, tube 0.28, arc π), and it carries two
rotations that are both wrong:

- `rotation.z = Math.PI` — inverts the semicircle, so the arch hangs **down**
  from the post tops instead of springing up over the gateway.
- `rotation.y = Math.PI / 2` — turns it 90° out of the gate plane, so it lies
  **along** the path instead of spanning it.

Measured on the built park (`scripts/measure-torus-480.mts`, canonical seed),
world bbox:

```
park-gate-arch  TorusGeometry  centre 0.00,0.95,60.00
                size 0.53 x 4.58 x 9.16
                min -0.27,-1.34,55.42   max 0.27,3.24,64.58
```

0.53 m thin across X (one tube diameter), 9.16 m long in Z (2 × (4.3 + 0.28)),
top at y 3.24 (the post tops) and bottom at y −1.34, i.e. **1.34 m below
ground**. So what a player sees is two curved prongs coming out of the paving
either side of the gate, 4.3 m up and down the path, with no collider — a
segment of a torus by the park edge. Gate centre is (0, 60); the boundary is
there.

The instrument walked 5510 meshes and found 178 torus/tube/lathe, 66 of them
≥ 1.5 m — that is the control: it saw everything else too (the rail-race
finish rainbow, the ferris rim, the dodgem rails), and this is the only one
out of place.

`src/world/entrance/BusJourney.ts` (~1498) builds the same arch for the
park-seen-from-the-road at the end of the bus ride, and has **its own copy** of
the geometry and the `rotation.z = Math.PI` inversion (its yaw is right, only
because that gate happens to lie along X). Two definitions of one thing.

## The fix

One owner — `src/world/entrance/gateArch.ts` — that both call: post positions,
cap, crossbar and its orientation all derived from one `yaw`, so the crossbar
can never again point somewhere the posts do not.

Collider: the arch's only ground-level parts are its two feet, which land
exactly on the posts, and the posts already carry `collision.addCircle(r 0.55)`
in `Entrance.ts` (post radius 0.5, arch tube 0.28 — covered). Everything else
is ≥ 3.45 m up, over the gateway a child must walk through, so a collider
under the span would block the way in. Proved with an instrument + control.

Jim has commissioned an authored Blender arch (ferris logo, painted title), so
nothing here touches the arch's *appearance* — only orientation, ownership and
solidity.

## Status

- [x] Found and measured
- [ ] Owner extracted, both callers on it
- [ ] Invariant/check
- [ ] check / test:procgen / build
- [ ] Browser screenshots before+after, posted to #480
- [ ] PR
