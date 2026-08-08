# HANDOFF — the lobby's imperial staircase, art assets

Branch: `art/lobby-twin-stairs` · Worktree: `.claude/worktrees/lobby-art`
Role: **Artist.** Delivers the assets a features agent needs to lay the hotel
lobby out like Jim's reference photo of a grand resort lobby.

**Nothing here touches `src/world/**`.** The features agent owns the room.

## State: DONE and pushed (`2aaba3a`)

`npm run blend:hotel` exits 0. `npx tsc --noEmit` exits 0. Every check in
`npm run build` passes **except `check:hotel`**, which fails with exactly one
problem — the room still describes the old stair:

```
✗ the sweeping stair tops out at 3.68 m but the deck is at 3.20 m
  — the flight does not climb the full height
check:hotel FAILED — 1 problem(s)
```

Verified by running the rest of the chain past it by hand: `check:tap-spacing`
through `vite build` all exit 0. No PR, as briefed.

---

## The change — Jim, 8 August 2026, on the imperial renders

> *"Raise both landing and Mezzanine."*

The first cut of the imperial composition put the landing at half the rise,
1.6 m. The reference photograph's whole subject is the **arch under the landing
you can see straight through**, and 1.6 m of headroom is not an arch, it is a
shelf. The ruling: the see-through survives, and the composition rises until the
headroom is honest.

**So the landing's height stopped being a choice and became a measurement.**

### The derivation, in the order it runs

| | | m |
| --- | --- | --- |
| `TALLEST_CHILD_HEIGHT`, read out of `kid.ts` | every hair × every hat | 2.97 |
| `RIDER_HEADROOM`, read out of `train/clearance.ts` | the measured 0.346 m a hat pops by at 1.35×, rounded up | 0.40 |
| **`ARCH_CLEAR`** | what the arch must leave a child | **3.37** |
| `LANDING_SLAB_MIN` = 2 × `LANDING_NOSE_DROP` | thinnest slab the nosing still reads on | 0.30 |
| `STAIR_TREADS` = `ceil((3.37 + 0.30) / 0.32)` | the first whole riser that clears it | **12** |
| **`LANDING_HEIGHT`** = 12 × 0.32 | | **3.84** |
| `LANDING_SLAB_MAX` = 3.84 − 3.37 | past this the arch stops clearing her | 0.47 |
| `STRAIGHT_TREADS` | the ceremonial finish, unchanged | 5 |
| **`STAIR_RISE`** = 3.84 + 1.60 | ← **the new `LOBBY_MEZZANINE_Y`** | **5.44** |
| **`LOBBY_MIN_WALL_HEIGHT`** = 5.44 + 3.37 | ← **the new minimum `LOBBY.wallHeight`** | **8.81** |

Neither of the two source numbers is typed anywhere in this asset.
`hotel_build.py`'s `ts_const()` reads them straight out of the TypeScript at
asset-build time, so a taller hat landing in `kid.ts` months from now rebuilds
this staircase around it or fails the build saying which number moved.

**The arrow turned round.** `STAIR_RISE` used to be given by `layout.ts` (3.2)
with the landing derived from it. Now the landing is derived from a child and
the gallery is wherever the straight flight lands, so `layout.ts` follows —
because `layout.ts` does not know how tall a child in a party hat is and this
asset does.

### The quarter turn is back, and the *radius* is what gave way

The going must not move: 0.5184 m at mid radius against a 0.32 m riser is the
**31.69°** rake Jim approved, and the waist, the nosing chamfer, the string
easing and the baluster pitch are all cut for it. Twelve treads of it is 6.22 m
of run, and there are two ways to buy that on an arc.

**90° wins.** It is the only sweep at which a flight's foot is square to the room
*and* its top square to the landing — the 45° cut had to choose (a floor takes a
stair at any angle; a landing does not), chose the top, and stood both feet
diagonally in the room to pay for it. Past 90° the feet swing back outward and
the pair splays: a 108° pair on the old radii measures **1.4 m wider overall**
than this one framing the same archway.

So `STAIR_RADIUS_PER_TREAD = 0.33` is now the owner of the pitch — on a quarter
turn, mid radius `0.33 × treads` gives a going of `0.33 × π/2` = 0.5184 m
**whatever the tread count**. The shipped 7 August flight was ten treads on
3.3 m; 3.3/10 is that number. Twelve treads on **3.96 m** is the same staircase,
longer, to the last micrometre of tread depth.

| | was | now |
| --- | --- | --- |
| `STAIR_SWEEP` | π/4 | **π/2** |
| `STAIR_TREADS` | 5 | **12** |
| `STAIR_INNER_RADIUS` | 2.4 | **3.06** |
| `STAIR_OUTER_RADIUS` | 4.2 | **4.86** |
| `STAIR_RAIL_RADIUS` | 4.27 | **4.93** |
| `LANDING_HEIGHT` | 1.6 | **3.84** |
| `STAIR_RISE` | 3.2 | **5.44** |
| going, rake, `STRAIGHT_*`, `BRIDGE_RAIL_TILE`, `STAIR_RISER` | | **unmoved** |

---

## What the room now needs — the numbers, not homework

### 1. `src/world/hotel/layout.ts`

```ts
export const LOBBY_MEZZANINE_Y = 5.44;   // was 3.2 — import STAIR_RISE if you can
// LOBBY:
wallHeight: 8.9,                          // was 6.4; the floor is 8.81
nearWallHeight: 3.4,                      // unchanged — nobody stands on those
windows: { north: { …, sill: >5.44, head: … } },  // the clerestory is now below the deck
mezzanine: {
  height: LOBBY_MEZZANINE_Y,
  stair: { innerRadius: 3.06, outerRadius: 4.86, treads: 12,
           fromAngle: 0, toAngle: ±Math.PI / 2, centreX: ±C, centreZ: Zc },
}
```

`Mezzanine.stair` describes **one** arc and there are three flights now, so it
wants two entries plus the straight flight — see the previous handoff's note,
still true. The north clerestory (`sill: 3.9, head: 5.7`) is the one window row
that must move: both panes are now *below* the gallery deck and would be lit
rectangles buried in its solid mass.

**Please make `layout.ts` and `hotelAssets.ts` agree by mechanism, not by hand.**
`Hotel.ts` already imports both; one `assertStairMatches()` there, run at build,
is the cheapest place for it. Six numbers kept in step by two files' comments is
this repo's most reliable bug.

### 2. The landing slab — the one number that can silently undo the ruling

The landing is **your** geometry, but its depth is what turns `LANDING_HEIGHT`
into headroom:

```
LANDING_SLAB_MIN = 0.30   ← thinner and the nosing has no face to sit on
recommended      = 0.40   ← 3.44 m of arch, 0.47 m clear over a hatted child
LANDING_SLAB_MAX = 0.47   ← thicker and the arch stops clearing her
```

Both are exported from `hotelAssets.ts`. Build outside that range and Jim's
ruling is gone with nothing to say so.

### 3. Placing the composition — **no rotation at all**

Everything is relative to the two arcs' centres at `(±C, Zc)` on the floor,
**`'right'` on `+X`**, `'left'` on `−X`:

```ts
right.root.position.set(originX + C, floorY, originZ + Zc);   // rotation.y = 0
left.root.position.set(originX - C, floorY, originZ + Zc);    // rotation.y = 0
straight.root.position.set(originX, floorY + LANDING_HEIGHT, originZ + Zc - LANDING_DEPTH);
```

`C = STAIR_RAIL_RADIUS + n · BRIDGE_RAIL_TILE / 2`, so the run between the two
top newels — which is the landing's front balustrade — is `n` whole tiles.

**Worked at n = 6, `C = 7.99`**, which is what every `staircase-assembly*` render
shows, all measured off the placed meshes:

| | m |
| --- | --- |
| landing front balustrade, newel to newel | 6.12 = **6 tiles** |
| clear archway between the two flights' masses | **5.85** (5.82 to their outlines) |
| composition overall width | **16.21** |
| each flight reaches forward of its own centre | 5.09 |
| landing half width, `C − STAIR_INNER_RADIUS` | ±4.93 |
| `LANDING_BACK` = 5 tiles, front edge → gallery | 5.10 |
| `LANDING_DEPTH` = `LANDING_BACK − STRAIGHT_RUN`, → the flight's foot | 2.508 |
| composition depth, feet to gallery | **10.17** |

The landing at ±4.93 laps 3 cm into each curve's inner string, which is the same
`STAIR_STRING_BITE` overlap the string was designed with — overlapping solids,
never coincident faces.

**The platform has to be under all of it.** The straight flight's strings stop at
its own `y = 0`: it stands on the landing, it is not solid to the lobby floor the
way the curves are. Carry the 3.84 m platform the whole `LANDING_BACK`, not just
`LANDING_DEPTH`, or the flight floats — correctly lit — over nothing. It is the
one thing here that can be got wrong and not seen.

### 4. The balustrade schedule

`createBridgeRailing()` tiles at `BRIDGE_RAIL_TILE` = 1.02 with
`createBridgeNewel()` on the ends, set in from the edge by half the rail's depth
(0.115) so its outer face lands on the edge. Tile `i` goes at
`start + (i + 0.5) · BRIDGE_RAIL_TILE`.

| edge | run | tiles | newels |
| --- | --- | --- | --- |
| landing front, between the curves' tops | 6.12 | 6 | none — the curves' own top newels are the ends |
| landing side, ×2 | 5.10 | 5 | one each end |
| gallery front | the room's | — | one each side of a **4.06 m** gap for the flight |

### 5. Walk surfaces

Curves: twelve `ArcTread`s over `fromAngle → ±π/2` at radii 3.06…4.86, tread `i`
at `treadTop(i)` — **ask `treadArc(i)`** for the angular span, never subdivide
by hand (a left-hand flight climbs through decreasing angles and `covers()`
silently returns false for every descending range).

Straight flight: five rectangles `x ±STRAIGHT_WALK_WIDTH/2`, `z` from
`treadFront(i)` to `treadFront(i+1)`, at `landingY + treadTop(i)` — and they want
the **same four-slice ramp per tread** the curve already uses, for the same
ground-damp reason. Its flanks are solid from the landing to the tread at
`x = ±2.01`.

---

## ⚠ The arch is an overhang, and `CollisionWorld` is height-agnostic

**Read `layout.ts`'s `Mezzanine` doc before you build the landing.** It says, in
so many words, that the gallery deck sits on a *solid mass* with no space
underneath, because a collider carries `topHeight` above its own local ground and
a child on the lobby floor and a child 3.84 m up cannot be told apart — so **a
balustrade that stops her walking off the landing is the same collider that walls
off the lobby floor beneath it, at head height, invisibly.**

The whole point of this composition is that the landing *does* overhang. So:

- a naïve collider on the landing's front balustrade puts an invisible wall
  across the middle of the archway, and the see-through Jim asked for is gone;
- no collider at all means a six-year-old walks off a 3.84 m drop.

I could not find a third option in `CollisionWorld` and it is not mine to add.
**This needs solving before the room is built, and may need Jim.** It is the one
risk in the composition that geometry cannot answer.

Related, and cheaper: what is *behind* the arch is the gallery's own mass, so the
recess is 5.10 m deep and then stops. For it to genuinely **see through**, the
gallery has to be an arcade over that width, or set back past `LANDING_BACK`.
The asset is happy either way; the photograph wants the first.

---

## Measured, through the real factories, `root.scale` 1 (game frame)

| asset | height | bottom | bbox x | bbox z |
| --- | --- | --- | --- | --- |
| `grandStaircase('right')` | 4.988 | −0.022 | −5.081…0.134 | −0.134…5.092 |
| `grandStaircase('left')` | 4.988 | −0.022 | −0.134…5.081 | −0.134…5.092 |
| `straightStaircase` | 2.748 | −0.022 | −2.032…2.032 | −2.726…0.134 |
| `bridgeRailing` | 0.938 | −0.020 | −0.530…0.530 | −0.135…0.135 |
| `bridgeNewel` | 1.148 | −0.018 | −0.149…0.149 | −0.134…0.134 |
| `landingNosing` | 0.024 | −0.166 | −0.526…0.526 | −0.076…0.078 |
| `chandelier` | 3.016 | −3.016 | −1.036…1.065 | −0.974…1.091 |

Non-zero `bottom` is the inverted-hull outline standing proud, as everywhere
else. A curve's `height` of 4.988 is its **top newel's finial** standing on the
landing, not a walkable height — the walkable top is `rise` (3.84).

## The API — unchanged in shape, moved in value

```ts
createGrandStaircase(handedness: 'right' | 'left' = 'right'): GrandStaircaseHandle
// + handedness, innerRadius, outerRadius, railRadius, sweep (SIGNED), rise (= LANDING_HEIGHT),
//   treads, riser, railHeight, treadTop(i), treadArc(i)
createStraightStaircase(): StraightStaircaseHandle
createLandingNosing() · createBridgeRailing() · createBridgeNewel() · createChandelier()
```

New exports: `ARCH_CLEAR` (3.37), `LANDING_SLAB_MIN` (0.30), `LANDING_SLAB_MAX`
(0.47), `LOBBY_MIN_WALL_HEIGHT` (8.81), `STAIR_RADIUS_PER_TREAD` (0.33),
`STAIR_MID_RADIUS` (3.96), `STAIR_WALK_WIDTH` (1.8).
`STAIR_INNER_RADIUS`/`STAIR_OUTER_RADIUS`/`STAIR_TREADS`/`LANDING_HEIGHT`/
`STAIR_RISE`/`STRAIGHT_RISE` are now **derived** rather than literal.

---

## Two files outside the artist's usual patch, both flagged on purpose

**`scripts/pack-hotel-asset.mts`: the budget goes 640 KB → 720 KB.** Its own doc
asked whoever needed that to say so out loud with arithmetic, so:
**16,912 triangles / 619,536 bytes → 19,464 / 713,212** — +2,552 triangles for
+93,676 bytes, **36.7 bytes a triangle**, the rate this file has always run at.
All of it is seven more treads on each curve at ~205 triangles a tread (strings,
rail, coping and balusters are all sampled per metre of run, so a flight scales
with its length). Nothing was made more detailed. 696.5 KB against 720 KB leaves
~23 KB — the same deliberate tightness as before. The 98 KB on the table is still
the authored mirror, and it is still not taken: what it buys is
`assert_stairs_mirror` comparing two meshes vertex for vertex, which no runtime
flip can be.

**`package.json`: `--python-exit-code 1` on both `blend:hotel` Blender steps.**
See below — without it every constant check in `hotel_build.py` was unable to
fail. The same hole exists in `blend:kid`, `blend:cart` and `blend:duckbar` and I
have deliberately **not** touched them: adding the flag could turn someone else's
build red mid-task. Somebody should, and it should be a decision, not a
side-effect of mine.

## Every assertion in `hotel_build.py` could pass without being able to fail

The find of the round, and it came from breaking the new checks on purpose and
reading the **exit code** rather than the traceback.

The file already knew Blender exits 0 on an uncaught Python exception — it says
so at the bottom and wraps `main()` in a `try/except` that exits 1. **That block
cannot catch anything raised while the module body runs**, and every constant
check lives out there. A bad constant printed a traceback, never wrote the
`.blend`, and reported success — so `npm run blend:hotel` went on to export the
*previous* `.blend`, pack it and pass. Exactly the failure the footnote was
written about, one scope out. Three asserts that shipped on 7 August were in it
too.

`--python-exit-code 1` covers import-time and run-time alike. **A hand-run
`blender --background --python art/blend/hotel_build.py` is still deaf to it** —
read the output, not the shell.

## Checks broken on purpose, and watched go red

| broken | said |
| --- | --- |
| `STAIR_TREADS` pinned at 11 | *"a 3.52 m landing on a 0.30 m slab leaves 3.22 m of headroom and a child in a party hat needs 3.37 m"* — exit 1 |
| …and every arithmetic check neutered, leaving only the mesh measurement | *"the curves deliver onto 3.520 m, so a 0.30 m landing leaves 3.220 m of arch…"* — exit 1 |
| `STAIR_TREADS` = 13 | *"the landing is at least one riser higher than it has to be… every riser here costs the lobby 0.32 m of wall"* |
| `TALLEST_CHILD_HEIGHT` renamed in `kid.ts` | *"…must declare `export const … = <number>;` exactly once and declares it 0 times"* |
| `STAIR_RADIUS_PER_TREAD` 0.33 → 0.30 | *"the going has moved to 0.4712 m from the 0.5184 m Jim approved"* |
| `LANDING_SLAB_MIN` 0.30 → 0.60 | no depth left for the room to build at |

The second row is the one that matters: `assert_landing_clears_a_child()` reads
the height **off the emitted mesh** and the child **out of `kid.ts`**, so it
still fails when every piece of arithmetic around it has been removed.

A taller hat in `kid.ts` correctly *rebuilds* rather than fails — verified at
3.60 m, which produced a fourteen-tread flight and then stopped on the handrail
radius, which `hotelAssets.ts` re-declares. That message now says why.

## Renders — `art/renders/hotel/`, all looked at

- **`staircase-assembly-arch.png`** — **the one to show Jim.** A *perspective*
  camera standing in the lobby at a child's eye height, 7.5 m back, looking at
  the arch, with a 2.97 m scale figure standing under it. Every other render here
  is orthographic, which is the right way to judge a shape and the wrong way to
  answer "can you walk through it": an ortho camera has no viewpoint, and
  headroom is something you experience from one height.
- `staircase-assembly-front.png` — the composition in elevation, with the figure
  in the archway. The whole design in one picture.
- `staircase-assembly.png`, `staircase-assembly-landing.png` — the park's own
  camera angle, and the join where three flights and two balustrade runs meet.
- `staircase{,-rake}.png`, `staircase-left{,-rake}.png` — the curves at 12/90°.
  The rake shot is the one that says the sweep is consistent: string top,
  handrail and coping are three parallel lines the whole way up.
- `staircase-mirror.png` — both curves overlaid at the origin, exactly symmetric.
- `staircase-straight{,-rake}.png`, `landing-nose.png`, `bridge-rail.png` —
  unchanged geometry, re-rendered.

The scale figure is two boxes because it is two constants: `KID_HEIGHT` (2.12,
default style) and the 0.85 m a party hat adds. Seeing the join is the point —
hats, not hair, are what this arch had to be built for. It stands against the
*thinnest* landing the room may build, because that is the slab that flatters the
design most.

## Not done

- **No browser QA.** Judged in Workbench renders only. It wants one look under
  the real toon ramp, at gameplay distance — after the room rebuild, since there
  is nothing to stand on until then.
- `check-asset-contract.mts` still does not know about any hotel factory. The
  measured table above is what it should see; the staircase (centre of
  curvature), the straight flight (centre of its bottom riser), the nosing (its
  own edge line) and the chandelier (hang point) all need `Origin: 'anchor'`-style
  treatment like the disco ball.
- The overhang/collision question above. That is the first thing to settle.
