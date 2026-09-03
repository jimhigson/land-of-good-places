# HANDOFF — place the authored gate arch, then the bus arrival camera

Branch `feat/arch-placement`, worktree `.claude/worktrees/arch-placement`.
Based on `fix/torus-480` (PR #482), with `art/gate-arch-asset` merged in.
**Stacked on both** — do not rebase onto `main` until those land.

Dev server port: **5311** (`vite --port 5311 --strictPort`).

## Two pieces

1. **Place `createGateArch()`** — replace the procedural posts+torus that
   `src/world/entrance/gateArch.ts` builds, in both `Entrance.ts` and
   `BusJourney.ts`, with the authored `.glb`. Collider: two circles r
   `GATE_ARCH_PIER_KEEP_OUT` (0.80) at the feet, nothing else.
2. **Bus arrival camera** — doors → follow her under the arch → rise to the
   normal pseudo-isometric pose.

## Status

- [x] Worktree, install, merge of `art/gate-arch-asset` (clean; script set
      unchanged + `pack/blend/render:gate-arch`)
- [ ] Piece 1
- [ ] Piece 2

## Facts already established (do not re-derive)

- `park-gate-arch` is read by **two** consumers, both via
  `getWorldPosition`/`Box3.setFromObject` on whatever `Object3D` carries the
  name: `scripts/check-park-map.mts` (gate position) and
  `test/procgen/parkFacts.ts` → `theParkGateArchStandsOverItsGateway`.
  A `Group` is fine; it does not have to be a mesh.
- `park-gate-post-0/1` are read only by `parkFacts.ts`. The authored `.glb`
  has **one** `gate-arch-piers` mesh covering both piers, so there is no
  per-side node to inherit the name — the markers must come from
  `buildGateArch`'s own `feet`, the same one owner the colliders read.
- The invariant's `GATE_FOOT_TOLERANCE` (0.6) was sized for the torus's
  0.28 m tube overhang. The authored piers overhang by
  `GATE_ARCH_PIER_KEEP_OUT` (0.80), so the tolerance **must** be re-derived
  from the asset or clause 1 fails for a correct arch.
- **Do not probe on the gate line.** The park boundary keeps a child inside,
  so a `PLAYER_RADIUS` body on z = 60 is blocked whatever the gate does —
  33 of 33 probes, measured by the previous agent. Probe 1.5 m in for "open",
  1.0 m in front of a pier for "solid".
- Issue **#481** is open: on pool seed 288 and sweep seed 18 the boundary
  spline crosses the gate opening. The walkability clause is withheld for it
  and announces the gap on stderr. Not this branch's bug.

## Piece 1 measurements (canonical + all 16 pool seeds)

Placed arch, measured on the real built park:

```
arch spans 10.20 m along X   (2 x (4.3 + 0.80))
headroom  3.60 m             (needs TALLEST_CHILD_HEIGHT 2.97)
clear opening 7.00 m
piers solid within 1.42 m    (PLAYER_RADIUS 0.62 + keep-out 0.80)
```

The 3.60 m is **raycast up through the opening**, and it independently
reproduces the asset's own `TALLEST_CHILD_HEIGHT + 0.630` = 3.60. Two
different measurements of the same thing agreeing is the reason to believe
either.

### The old headroom clause was measuring the wrong thing

`probe-gate-pool.mts` clause 4 was `box.min.y - ground`. That was right only
because the old gate's *crossbar* was a separate mesh from its posts. The
authored arch is one asset whose piers reach the paving, so the same
expression reported **0.00 m of headroom under a gate you can walk through**.
Now raycast upward from a child's toes — see `scripts/gate-arch-measure.mts`.
Downward rays are useless here: toon materials are `FrontSide`, so a ray from
the sky cannot see an underside at all.

### The 0.80 keep-out costs nothing — controlled, not assumed

Same probe points, only the collider radius changed:

| pier collider radius | pool seeds failing |
|---|---|
| 0.80 (`GATE_ARCH_PIER_KEEP_OUT`, this branch) | 24, 288, 326, 451 |
| 0.55 (`fix/torus-480`'s value) — **control** | 24, 288, 326, 451 |

**Identical sets.** The four failures are the boundary spline crossing the
gateway — **issue #481, not this branch**. They show up here and not in the
previous agent's 15/16 because that probe only swept +/-2.04 m of the opening
and this one sweeps the full 7.00 m clear width.

### One probe point was a coin flip, not a measurement

The first sweep failed 5 seeds asymmetrically (24, 128 on the left; 326, 451
on the right). The outermost probe sat at exactly
`GATE_ARCH_CLEAR_WIDTH / 2 - PLAYER_RADIUS` = 2.88 m, where a child is
*tangent* to a pier: overlap zero, so whether `resolve` moves her is the last
bit of a float. `OPEN_PROBE_MARGIN` (0.2 m) makes it a question again.

## Every clause proved red — against the geometry below

**The geometry these were proved against** (canonical seed 20260728, this
branch's HEAD). Paste this with the transcript: a red run is a measurement and
measurements go stale.

```
park-gate-arch centre (0.00, 60.00)   root y = terrain -0.208
box  x [-5.100, 5.100]  y [-0.208, 7.952]  z [59.200, 60.800]
pier markers (-4.30, 60.00) and (4.30, 60.00)
lowest overhead 3.60 m above terrain, at (-2.55, 60.00)
```

| mutation | result |
|---|---|
| M0 control, unmutated | **pass** |
| M1 `outward` turned 90 deg | **red** — squareness 1.00 parallel, and facing 0.00 |
| M2 `outward` turned 180 deg | **red** — facing -1.00; squareness passes, box identical |
| M3 both pier colliders removed | **red** — child stands at (4.30, 59.00) |
| M3b left pier collider only | **red** — right pier not solid |
| M3c right pier collider only | **pass**, announced 1 of 2 piers measurable |
| M4 arch sunk 1.0 m | **red** — comes down to 2.60 m, needs 2.97 |
| M4b arch sunk 0.7 m | **red** — 2.90 m; the spare margin is 0.63 m |
| M5 arch node renamed | **red** — NO SCENE OBJECT "park-gate-arch" |
| M6 arch meshes dropped, markers kept | **red** — nothing overhangs the gateway |

### Three clauses were incapable of failing, and mutation is what found it

None of these would have been visible from reading the code.

1. **Clause 1 (feet on piers) cannot see a whole-gate rotation any more.** It
   caught #480 because the crossbar carried a rotation its posts did not — a
   *disagreement between two meshes*. The authored arch is one asset and
   `gateArch.ts` derives the pier markers from the very rotation it turns that
   asset by, so they now turn together by construction. M1 was **green** at
   first. Covered instead by two new clauses measured against the arch's world
   position on the boundary: **squareness** (long axis perpendicular to the way
   out) and **facing**.
2. **Facing is unfalsifiable from shape.** An arch installed 180 degrees out
   has an identical bounding box, identical piers, identical headroom and
   identical colliders, and reads LAND OF GOOD PLACES to the fountain. Only the
   world transform can see it — hence `forwardX/forwardZ`, and hence the
   `outward` parameter replacing a bare `yaw`, which could not express the
   difference.
3. **Half the solidity clause was dead, exactly as warned.** M3c — deleting the
   *left* pier's collider — was **green**. The boundary wall's end sits
   alongside that pier and pushes a child the *same direction*, so
   `isStandable` ("was she pushed?") could not tell them apart. Now the clause
   asks **where she is held**: a pier can only ever hold her at its own 1.42 m
   reach, and the left probe comes to rest at 1.53 m, so that pier is reported
   masked on stderr on every run — 2 of 5 suite seeds. A clause that could
   measure neither pier is now itself a failure.

M4 also passed at first: headroom was measured from the arch's own base, so
sinking the whole arch took the base down with it and the number never moved.
`measureGateArch` now returns an **absolute** `lowestOverheadY` and each caller
subtracts the ground a child actually stands on.

## Reachability: the 0.80 m piers take away nothing a child may stand on

Flood fill of the park's walkable ground, `PLAYER_RADIUS` body, 0.5 m cells,
seeded from the default spawn (0, 7). **Control on the instrument first**, per
CLAUDE.md — two agents have had confident, wrong answers from flood fills that
were measuring the wrong thing.

| run | reachable cells | note |
|---|---|---|
| gateway deliberately blocked (control on the instrument) | 44 655 | responds: 73 cells lost |
| piers 0.55 m (control on the change) | 44 728 | |
| piers 0.80 m (this branch) | 44 723 | |

Set difference, 0.55 minus 0.80 — **five cells, and none the other way**:

```
(3.0, 59.5) (3.5, 59.0) (5.0, 59.0) (5.5, 59.5) (5.5, 60.0)
```

All five are within the right pier's own 1.42 m reach of (4.3, 60) — the
ground immediately beside the pier. Nothing else in the park changes.

**One dud signal, recorded so nobody reads it as meaning something.** The
instrument also reports `reachesOutsideTheGate`, and it is `false` in **all
three** runs including the unblocked ones — the boundary keeps a child inside
the park, so it can never be true and it discriminates nothing. It is not
evidence the gate is shut. (The arrival puts her down at z = 52, *inside* the
gate, so she does not walk in through it under her own control today — which
matters for piece 2's third beat.)

## Piece 1 — in-game verification (browser, port 5311)

Screenshots at `/tmp/arch-front.jpeg`, `/tmp/arch-3q.jpeg`, `/tmp/arch-apex-a.jpeg`,
`/tmp/arch-walkup-1.jpeg`. Cameras used:

```
/view?camPos=0,4,72&camDir=0,-0.06,-1&timeOfDay=12:00        straight on, from the road
/view?camPos=9,3.2,68&camDir=-9,0.2,-8&timeOfDay=12:00       three-quarter, walking under
/view?camPos=2.5,6.2,64.5&camDir=-2.5,0.15,-4.5&timeOfDay=12:00   apex, bobbles + roundel
```

Verdict: the arch stands square in the gateway, LAND OF GOOD PLACES and the
ferris-wheel roundel face **out** at the arriving child, and a child walks
under it with room to spare. The roundel is crisp — no radial smearing, so the
artist's `paint_planar_uvs` fix survived into the game. `check:coplanar` exit
0, 250 seams, **none new**, so the bobbles, collar and plank against curved
stone are clean by measurement as well as by eye.

### One thing for Jim, not a defect

**In the park the band and the sign read paler and greyer than in the studio
render he approved.** The colours are unchanged — `stonePinkLight` is
`0xffe0ec` and `signBoard` is `0xfff2dc`, both near-white pastels — but the
render is flat studio light, whereas in the park the band self-shadows and the
sign hangs in the band's own shadow. The piers (`stonePink`, `0xffc2d8`) still
read clearly pink. Compare `art/renders/gate-arch-three-quarter.png` with
`/tmp/arch-3q.jpeg`. This is a look call for him, not something to fix quietly.

## Piece 2 — the arrival camera. DESIGN ONLY, NOT STARTED

Everything below is read off the code, not guessed. Whoever picks this up can
implement directly.

### What exists already

`ArrivalSequence` runs five phases (`PHASE_ORDER`), and the **only** camera
thing it does today is zoom: `arrivalCameraZoom(phase)` returns
`ARRIVAL_CAMERA_ZOOM` until `departing`, then 1. There is no focus change and
no rise. `Game.tick()` is the caller.

`IsoCamera` already has every seam needed, all damped inside `update()` so
nothing snaps:

- `setFocusOverride(point)` / `clearFocusOverride()` — orbit a fixed world
  point instead of the player. **Must be re-asserted every frame** while it
  holds; its own doc comment says so, and says why (`Game.tick` re-derives the
  world every frame and would silently drop it).
- `setZoomTarget(zoom)` — but **only when the target changes**, never
  unconditionally every frame: doing that fights `nudgeZoom` and silently eats
  every pinch and wheel notch (#329).
- `offset` = `cameraOffset(yaw, pitch, CAMERA_DISTANCE)` — **the one owner of
  the normal pseudo-isometric pose.** Read it; never copy the numbers.

### The three beats onto the existing phases

| beat | phases | camera |
|---|---|---|
| 1 doors | `doors-opening`, `stepping-down` | `setFocusOverride(bus.doorDrop)`, arrival zoom |
| 2 follow her in | `walking-in` | `clearFocusOverride()` — the ordinary damped follow tracks her under the arch |
| 3 rise | `departing` onward | zoom to 1, pose override damps to zero |

Beat 2 needs nothing new: `walkIn` already drives her along a bezier from the
bus door through the gate, and the damped player-follow is exactly "follow her
in". Beat 1 is `setFocusOverride` on the bus's **own** `doorDrop` (the bus owns
where its door is — `layout.ts` says so explicitly, so a bus of another length
still frames right).

### The one genuinely new thing

**There is no "rise" today, only a zoom.** Delivering Jim's third beat needs a
*pose* override on `IsoCamera` — a lower, flatter camera through beats 1-2 that
eases back to `offset`. Build it as a second damped offset alongside
`lookOffset`, which is the existing precedent for exactly this shape: a bounded
offset from her own camera that damps home on the same curve. Do **not** build
it as a separate camera, and do not write a second pitch number down — express
it as a delta from `offset` so the normal pose stays the single owner and beat
three lands on it exactly.

### Constraints, and where each is already satisfied

- **No snap at the handover.** Everything above is damped inside
  `IsoCamera.update`; the risk is only in *when* control returns.
  `ARRIVAL_CONTROL_AT` is the end of `walking-in`, so she already has the
  controls for the whole of beat 3. **Recommendation: keep it there.** The rise
  then happens under her hand rather than in front of it, which is what makes
  it a hand-back rather than a cutscene ending — and it is the existing
  behaviour, so it is one less thing to re-verify.
- **`dt`-driven.** `ArrivalSequence.update` already takes `dt` from
  `frameContext` and returns early on `dt <= 0`, so `gameStore.setPaused(true)`
  stops the timeline cleanly. Anything added must go through the same `dt`.
- **Deep links must not wait on it.** `/spawn`, `/view` and `RIDE_DEEP_LINKS`
  never construct an arrival at all (`Entrance.arrival` is `null` when none is
  due). Verify by loading each rather than reasoning about it — the seam to
  check is that a null arrival leaves no focus override asserted.
- **Skippable, never a trap.** Decide deliberately what input does. Simplest
  honest answer: any input during beats 1-2 clears the overrides and hands over
  at once, so the camera eases to the normal pose from wherever it is —
  which the damping gives for free.

### The gate is scripted, not walked

Worth knowing before touching beat 2: `walkIn` calls `setPlayerPose` directly
along a bezier, so she is **not** subject to collision while walking in. A
`PLAYER_RADIUS` body cannot in fact cross the gate line under its own power —
the boundary keeps her inside, 33 of 33 probes — so the scripted walk is what
gets her through the arch. Do not "fix" that as part of this; it is #481's
territory.
