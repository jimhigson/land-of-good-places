# HANDOFF — the castle lift has no lift to stand in (#450)

Branch `fix/castle-lift-car`, worktree `.claude/worktrees/castle-lift`.
Dev server port **5515** (`vite --port 5515 --strictPort`).

## What was wrong, in two layers

**1. Nothing was drawn in the castle's lift alcove.** The castle's lift logic
was already correct — a portal lift behind Decision 3's `floors()` / `go(n)`
seam, same as the hotel's. But `GlassLift` was deleted with the floor split
(#377/#380) and *nothing replaced it*: `Shell.ts` cut a doorway in the wall,
`liftRide.ts` glided her through it to `LIFT_CAR_X`, and there was no car, no
floor, no ceiling — the deck slab stopped at the wall. She rode in open air.

**2. The alcove was in the wrong wall.** Hanging the hotel's `LiftAlcove` in
the castle's **east** wall made it worse in a way only riding it could show:
the park camera is fixed at 45° looking along −X−Z, so an east-wall alcove
faces *away* from it. The car's own back panel stood between the camera and
the rider and she **disappeared** — name tag hovering over a solid box — and
the dial faced into the room where nothing can see it.

Two workarounds were built and both were wrong, which is worth knowing so
nobody rebuilds them:

- **Ghosting the car** (`FloorFader` at the hotel overhang's 0.24). The shell
  is panelled, so a sightline crosses four or five of its own surfaces and
  translucency compounds: at 0.24 the box still reads as solid and she cannot
  be seen at all; at the ~0.06 that does let her through, the lift has
  effectively vanished. Measured on screen, not reasoned about.
- **Hiding the shell while she rides.** Deterministic, but it leaves a doorway,
  a slab and a wire handrail. Not a lift.

Both are apologies for the wrong wall. The east wall was only ever right for
the *glass* lift that used to hang there.

## The fix

- **`src/world/lift/LiftAlcove.ts`** — the hotel's car + architrave + sliding
  doors + pointer dial, extracted out from under `Hotel.fitLiftAlcove` and used
  by **both** buildings. One orientation input (`yaw`); every offset derives
  from it, so the same class serves a west wall in either building.
- **`src/world/lift/phases.ts`** — the six-phase union, the timings and
  `liftDoorOpenness`, shared by `HotelLift` and `LiftRide`. The castle had no
  `doorOpenness` at all; the hotel did. That asymmetry *is* #450.
- **`glbCanvasTexture` moved to `art/style/glb.ts`**, beside the reader whose
  UV convention it exists for, so the dial can paint its face.
- **The castle's lift moved to the west wall** (`LIFT_WALL_X`, `LIFT_OUT_YAW`,
  `LIFT_RIDER_DEPTH` in `layout.ts` — one owner, everything else derives).
  Wall gap, windows, roof parapet, collision and the deck's alcove floor all
  followed.
- **`LIFT_RIDER_DEPTH = 0.9`**, not the hotel's 1.7: at 1.7 m back her head is
  behind the car's own 2.62 m ceiling from every camera position.

## The check that would have caught it

`scripts/check-castle.mts` section 9 — `check:castle lift`. Builds a real
`LiftAlcove` and asserts (a) the rider's spot is inside the car and (b) a
raycast from head, chest and waist out along the game's own camera bearing
leaves the car.

**Proved red**, on the exact #450 arrangement (`LIFT_WALL_X = +INTERIOR_HALF_X`
and `LIFT_OUT_YAW = -Math.PI/2`), against a car measured at: shell x −24.20…
−21.77, ceiling top y 2.62, mouth x −21.77, rider x −22.91:

```
✗ at 2.08 m up her body the line to the camera meets 'lift-car' 0.68 m out
✗ at 1.34 m up her body the line to the camera meets 'lift-car' 1.89 m out
```

Note the first draft used bounding boxes and could never pass — a hollow
shell's box contains the whole inside of the car. It uses a real `Raycaster`
against triangles now.

## Status

- [x] root cause, both layers
- [x] shared `LiftAlcove` + `phases`, hotel migrated onto them
- [x] castle wired up, west wall
- [x] `check:castle` probe, proved red and green
- [x] ridden on all six floor pairings, screenshotted mid-ride
- [x] hotel lift ridden and unchanged
- [ ] full `check` / `test:procgen` / `build` (running)
- [ ] PR

## QA harness

`qa-lift.mjs` and `qa-hotel-lift.mjs` at the worktree root are **scratch, not
to be committed** (copies in the session scratchpad). They drive
`playwright-core` against port 5515:

```
node qa-lift.mjs 5515 <fromDeck> "<floor name>" <outDir> <tag>
node qa-hotel-lift.mjs <outDir>
```

Two traps that cost time and will cost the next person the same:

- **The chrome-devtools MCP was being driven by another agent** — pages opened
  on my port were navigated to somebody else's within seconds. Headless
  playwright is the reliable route here.
- **A backgrounded MCP tab throttles `requestAnimationFrame`**, so screenshots
  are stale frames of a game that has moved on. Several "the box is opaque"
  conclusions came from that before it was spotted.
