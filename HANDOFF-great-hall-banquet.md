# HANDOFF — the great hall becomes a banquet (#413)

Branch `feat/great-hall-banquet`. Worktree `.claude/worktrees/great-hall-banquet`.
Dev port **5416** (`vite --port 5416 --strictPort`).

Jim, 31 Aug: *"ok let's do the banquet with the huge table, lots of other
children eating at the tables, and a large fireplace with a roaring fire"*

## Measured facts about the hall as it stands (deck 1)

Read off the built scene, not off the source:

```
HALL_DECK 1   INTERIOR_HALF_X 21.213   INTERIOR_HALF_Z 15.556
ceiling clear 3.30   beam underside (near a wall) 3.08
sconce mount 2.10    SCONCE_HEADROOM 0.60  ->  wall-flame budget 2.70
bench seat 0.35999998   table top 0.67500001   plinth top 0.250
KID_HIP_HEIGHT 0.36   KID_REACH_HEIGHT 1.04
hall axis x = 10.636 (middle tapestry bay)   north wall face z = -15.331
throne (10.64, -12.53)   dais front edge z = -11.31
feast table centre (10.64, -6.83), box x 9.54..11.74, z -9.83..-3.83
benches x 8.49..9.09 and 12.19..12.79 (BENCH_OFFSET 1.85, plank 0.6 wide)
hearth (-9.899, -14.781) — WEST end of the north wall, 20 m from the throne
keep-outs on deck 1: (19.21, 5) r4 ; (-4.24, 8.76) r7.6 ; (0, 11.56) r7
```

**There is no fireplace.** `CASTLE_HEARTH` is a log pile + three flame cones
against bare wall. `castleDecor.ts`'s `hearthside()` adds only a cat and a
woodpile. The chimneypiece the `CASTLE_HEARTH` doc comment refers to ("the
Artist's chimneypiece, batch 2 B1") was never built.

### The kid rig, measured (`createKid`, bunches)

```
leg pivot   y 0.360, x +-0.155      feet bottom y -0.007
torso       y 0.180..1.020, plan +-0.366 (hem +-0.398)
arm pivot   y 0.720, x +-0.380      hand y 0.253..0.547
head crown  y 1.360                 top of skull 2.109
```

**There is no knee, so the legs can only hang vertically.** Any rotation about
the hip lifts the foot by `0.36 * (1 - cos t)`. So a seated child is
`root.y = 0`, feet on the floor, hip pivot at 0.360 = the bench top exactly.
That is the whole reason `CASTLE_BENCH_SEAT` is `KID_HIP_HEIGHT`.

Consequence: she cannot sit *centred* on the plank — her torso reaches down to
0.180 and would be 0.18 m inside it. She sits on the plank's **inner face**
(`axis +- 1.55`), which puts her front hem at `axis +- 1.152` against a table
edge at `axis +- 1.10` — 5.2 cm of clearance — and her behind over the plank.

## The plan

1. `castleFurniture.ts`: factor the hall's axis out as `greatHallPlan(deck)`,
   and turn the single feast table into a **run of three** repeated
   `createCastleFeastTable()` down the axis (18 m, z -9.83 .. +8.17), benches
   and the laid meal repeated with them. Export the bench placements as the
   one owner of where a diner sits.
2. New `greatHallBanquet.ts`: a `GreatHallBanquet` with `dress(deck, floor)` /
   `update(elapsed)`, owned by `Building` exactly as `CastleFire` is, seating
   an instanced crowd of children on those benches and animating them eating.
   **Parented to the floor group** (#412's trap).
3. `castleLighting.ts`: build the chimneypiece **inside the same
   `if (deck === CASTLE_HEARTH.deck)` block that places the logs and flames**,
   so the fire and its fireplace have one owner and cannot separate again.
   Make the fire roaring within the budget.
4. `check:castle`: two new assertions — a seated diner's feet are on the floor
   and her hips are on a bench top; and every hearth flame is inside the
   fireplace's own opening (the assertion #412 says nobody had).

## Budget finding (recorded early, per CLAUDE.md)

`SCONCE_HEADROOM` (2.70 m) is the **wall torch** budget only — `check:castle`
assertion 7 loops `i < anchors.length`, and the hearth's flames are pushed
onto the same instance list *after* the wall torches, so they are not measured
against it. The hearth's real ceiling is assertion 6's prop test:
`BEAM_UNDERSIDE` = **3.08 m**, because the hearth is within `BEAM_WIDTH` of a
wall. So a roaring fire fits with room to spare and **no threshold needs
relaxing**. The binding constraint is the fireplace's own opening, not the
ceiling.

## Status

- [x] worktree, install, hall measured, rig measured
- [ ] table run
- [ ] diners
- [ ] fireplace + roaring fire
- [ ] assertions
- [ ] browser pass at player height
