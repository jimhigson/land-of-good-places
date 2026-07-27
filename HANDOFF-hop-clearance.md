# Handoff — item 1.0b, the auto-hop clearance gap

Branch `fix/hop-clearance`, worktree `.claude/worktrees/hop-clearance`.

## THE MEASUREMENT (the expensive part — do not re-derive, reuse)

Measured with `sweep.mts` in the worktree root: drives the **real**
`CollisionWorld` with a faithful copy of `Player.update`'s movement
integration (accelerate → step → `resolve` → escort latch → velocity read-back
→ auto-hop probe → vertical integrate → `hopClearance`). Run it with:

```
node --experimental-strip-types --import ./tsresolve-register.mjs sweep.mts
```

### The mechanism (this is the real finding)

`AUTO_HOP_LOOKAHEAD` is 0.5 m, so the hop fires only 0.5 m before the blocking
face. At 7.4 m/s she reaches the face 0.068 s later, **0.41 m up** — far below
any wall top. So she is *pinned against the near face and rises in place*,
with her velocity zeroed every frame by the resolver's own read-back. She is
only released when `y >= topHeight - JUMP_CLEARANCE_GRACE`, and must then
cross the whole footprint `2·(halfThickness + PLAYER_RADIUS)` **from a
standing start** before she falls back below that height.

Three outcomes, by wall height:

| outcome | what happens |
| --- | --- |
| **clean** | released early enough to fly the whole footprint untouched |
| **popped** | falls back below the line while inside the footprint; the wall goes solid under her and *ejects her out the far side* (up to 0.59 m in one frame). She gets across, but by glitch. The fling guard declines the derived velocity, so no fling — this is exactly the case `Player.update`'s latch was written for. |
| **stuck** | never released at all: she bounces against the face **forever**, re-firing the auto-hop every landing. This is the strand. |

### Numbers

- `JUMP_APEX_HEIGHT` (continuous) = **1.2812 m**; predicate today allows
  `topHeight <= 1.4312 m`.
- The **discrete** apex actually reached is lower, and frame-rate dependent:
  1.2583 @144, 1.2538 @120, 1.2446 @90, **1.2267 @60**, 1.1733 @30,
  1.0195 at `MAX_FRAME_DELTA` (1/12 s).
- **A 1.4 m wall at 60 fps is never released at all** — the discrete apex
  1.2267 never reaches `1.4 − 0.15 = 1.25`. Confirmed stuck-forever in sim.

Worst case over: half-thickness ∈ {0.22 wooden, 0.34 stone}, approach angle
∈ {0°, 20°, 40°}, walk and sprint, all frame-clock phases —

| frame rate | gets across at all (may pop) | crosses cleanly |
| --- | --- | --- |
| 120 fps | 1.365 | 1.089 |
| 90 fps | 1.362 | 1.075 |
| 60 fps | 1.342 | 1.080 |
| 30 fps | 1.291 | 1.073 |
| 20 fps | 1.259 | **1.045** |

- **True clearance, "never strands her", worst sustained rate: 1.259 m.**
- **True clearance, "the flight really carries her", worst sustained rate:
  1.045 m.**
- "Gets across at all" is nearly thickness-independent (the pop does the work);
  "cleanly" is strongly thickness-dependent — thicker wall, lower ceiling.

Chosen predicate ceiling: **1.04 m** (`JUMP_APEX_HEIGHT − 0.24`) — the clean
number, since a router must not plan over a glitch.

### Side finding, out of scope

At `MAX_FRAME_DELTA` (1/12 s) while sprinting, a single step is 0.93 m and she
**tunnels through walls of any height** (sim crossed a 2 m wall). Pre-existing;
worth its own ticket.

## Park geometry (`Scenery.ts`)

Wooden walls `halfThickness 0.22`, stone `0.34`; both `autoHoppable: true`.
Heights: wooden 0.95, 1.15, 1.25, **1.4**, 1.5, 1.75, 1.8, 2.1, 2.3, 2.6;
stone 0.7, 0.7, 0.85, 0.85, 0.95, 0.95, 1.2, 1.2.

Hoppable under today's 1.4312 ceiling: 0.7×2, 0.85×2, 0.95×4, 1.15, 1.2×2,
1.25, **1.4** ← the strand. Under the new 1.04 ceiling: 0.7×2, 0.85×2, 0.95×4.

## What landed

- `clearsTop(topHeight, clearance)` — the in-flight test, unchanged behaviour,
  used by `resolve`. **The manual jump button is untouched.**
- `autoHopClears(topHeight, apexClearance)` — the *planning* test, now
  `clearsTop(...) && topHeight <= MAX_AUTO_HOP_HEIGHT` (1.00 m). Used by
  `wouldAutoHopClear` and `NavGrid`. One definition, as before.
- `CollisionWorld.checkHoppableColliders(moverRadius, apexClearance)`, called
  from `Game` before the lattice is first baked. Catches a collider too tall
  for its width (via `measuredHopCeiling`), an `autoHoppable` one with
  `Infinity` topHeight, and a jump apex that has moved since the measurement.
  Reports and demotes to solid; never throws, never moves level geometry.
- `scripts/measure-hop-clearance.mts` + `ts-extension-resolver*.mjs` — the
  measurement itself, kept so the constant has a mechanism behind it.

## What the check found

Nothing on the park as it now stands (`problems` is empty; boot console clean).
Run against the **old** 1.4312 m predicate it would have fired on **five**
walls, not one:

| wall | height |
| --- | --- |
| wooden `[3,19]→[-4,20]` | 1.40 m ← the known strand |
| wooden `[-16,9]→[-8,10]` | 1.25 m |
| wooden `[-21,-8]→[-15,-9]` | 1.15 m |
| stone `[22,-6]→[22,4]` | 1.20 m |
| stone `[-24,4]→[-24,12]` | 1.20 m |

Only the 1.4 m one stranded outright; the other four "worked" by pop-through.

## Verified

- `npm run build` exit 0.
- Live park, `checkHoppableColliders` → `[]`, no console output at boot.
- Live `NavGrid.findRoute`, closest approach to each wall's centre line:
  routes **over** 0.70/0.85/0.95 m (approach 0.00 m), **around** 1.20/1.25/1.40 m
  (approach 1.18/1.23/1.06 m against a block radius of 0.96/0.84/0.84 m).
- Live `wouldAutoHopClear`: fires at 0.70/0.85/0.95, not at 1.20/1.25/1.40.
- Live driven walk over the 0.85 m stone wall: peak hop 1.20 m, wall crossed.

Driving longer scripted walks through `Game.tick` with a synthetic `LoopTick`
proved unreliable (the frame counter feeds the zone cache) — **the remaining
item is human visual QA**: tap across a low garden wall and watch the hop, and
tap across the 1.4 m wall at `[3,19]→[-4,20]` and watch her walk round it.
