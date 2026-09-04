# HANDOFF — issue #511, "the park is not on a hill"

- **Model: Opus** (chosen by the Overseer for this task; a replacement must also be Opus).
- **Branch:** `feat/no-hill-511`
- **Worktree:** `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/no-hill-511`
- **Role:** Engineer. Reports to the Overseer, not to Jim. Does not merge.
- **Browser:** NOT owned by this agent. Build-verify only; list visual QA in the PR.

## The task

Jim, 4 September 2026, verbatim and it is the specification:

> "I think the answer there is to just not make the park on a hill. Let the land
> spread out in all directions for a long way but low poly"

The Overseer's explicit instruction: **do not start by editing constants.** Produce
the dependency inventory first, report it up with a proposed approach, and only then
change behaviour.

## Status

- [x] Worktree off current `origin/main` (`10fb7c2d`), `pnpm install --frozen-lockfile` clean.
- [x] Dependency inventory — below.
- [x] Sky measurement — the finding that changes the ticket. See "The sky" below.
- [ ] **BLOCKED: reported to the Overseer, waiting on a decision about the sky.**
- [ ] Implementation.

---

# The finding that has to be settled before any code changes

## The sky, measured

The instrument is at `scratchpad/skyfrac.mts` (not committed; it ray-marches the
real `terrainHeight` under the real camera constants and counts screen rows that
see no ground). **The control discriminates**: today's hill gives 19.8% sky at the
park edge at max zoom-out and 0% at the park centre, so the instrument can see sky
and can tell the two apart. I also derived the 19.8% analytically before believing
it — the disc's cut edge lands 39 m up-screen, which projects to screen-up
`39·cos38° − 17·sin38°... ` = 10.6 against a frame half-height of 17.86, leaving
20.3% of the frame above it. Measurement and algebra agree.

```
sky % of frame                             z1.00   z0.80   z0.60   z0.42
CONTROL: today, the hill (drop at 12 m outset)
  park centre                               0.0%    0.0%    0.0%    0.0%
  park edge (far side, up-screen)           0.0%    0.0%    6.8%   19.8%
flat, land simply ends at 40 m outset        0.0%    0.0%    0.0%    0.0%
flat, land simply ends at 300 m outset       0.0%    0.0%    0.0%    0.0%
flat to 40 m outset, then the drop           0.0%    0.0%    0.0%    0.0%
flat to 100 m outset, then the drop          0.0%    0.0%    0.0%    0.0%
flat to 200 m outset, then the drop          0.0%    0.0%    0.0%    0.0%

CONTROL: around the whole park edge at zoom 0.42 —
  3/24 bearings show any sky (225°, 240°, 255°); the most is 18.5%
```

### What this means

**Under an orthographic camera pitched down 38°, every view ray hits flat ground.**
There is no horizon in an ortho projection of a plane. Sky can therefore only
appear where the ground *runs out* — a cut edge, or a fall steep enough to carry
the ground below the bottom of the frame. That is a geometric fact, not a tuning
problem, and it is why `constants.ts:17-26` already says in as many words: *"With
an orthographic camera an endless ground plane would fill the frame forever and
the sky would never be seen."*

So **"land spreading out a long way in all directions" and "sky visible at ground
level" cannot both be true** with this camera. The middle option I expected to
work — keep the drop but move it far out — **does not work either**, and the
measurement is why I am not proposing it: at max zoom-out the frame only reaches
~29 m up-screen from the player, so a drop at 40 m or beyond is simply off-frame
and the visible land is flat to the frame edge. 0% sky in all three variants.

### Why this is much less alarming than it sounds

The comments defending the hill overstate what it currently buys:

- **At default zoom (1.0) the sky is already 0% at ground level, everywhere** —
  including standing at the park edge. `IsoCamera.ts:69` sets `zoomValue = 1`.
- Sky only appears below zoom 0.6, and only on **3 of 24** edge bearings, topping
  out at 18.5% of frame.
- The day/night cycle is *not* mainly seen through visible sky. It is carried by
  the light colour, the ambient, and the fog tint, all of which paint the ground
  and every prop — `DayNight.ts:79-180`'s `SKY_KEYS` each carry their own `fog`,
  applied at `:796-801`. The sky quad itself is a full-screen pass
  (`Sky.ts:226-248`) drawn *behind* everything.
- The genuinely sky-filled views are the ones that raise the camera or free it:
  the ferris wheel's climb via `setSpaceFactor`, the sky cruiser, and `/view`.
  None of those are affected by ground extent.

So the real cost of Jim's instruction is: **the 3-bearings-at-max-zoom-out sliver
of sky at the park edge goes away.** That is a much smaller loss than
`constants.ts` implies, and it is a loss Jim may well accept — losing the diorama
look is arguably the point of the ticket. But it is his call, not mine, and it is
visible, so per CLAUDE.md it waits for him.

## The three routes, honestly

- **A — Do what Jim said.** Flat land spreading far, low-poly. Sky at ground level
  goes to zero on all bearings and all zooms. `Sky.ts`'s `HORIZON_Y_LEVEL = 0.5`
  and its comment about the crest become dead. Simplest code: `terrain.ts:36`
  loses its `smoothstep`, the disc grows, an outer low-poly annulus is added.
- **B — Flat land, and give the sky back another way.** Same as A, but earn the
  sky by raising the camera pitch or adding a distance fade-to-sky on the ground
  material. Raising the pitch breaks ARCHITECTURE.md's "One camera angle,
  forever". A fog/alpha fade to the sky colour at the frame's far edge is the
  honest version and is not expensive — but it is a new look, and a real
  art-direction decision rather than an engineering one.
- **C — Flat *apron*, hill kept far out.** Keep a drop but push it to ~40 m. This
  fixes #498 completely (the road at 11.94 m outset is then on dead-flat ground)
  and is by far the smallest change. It does **not** keep the sky (measured), so
  it buys nothing over A on that axis — but it keeps the world bounded, which
  keeps the treeline's job, the budget, and every rim-relative thing simple.

My recommendation is **B**, with **C as the fallback** if the fade is judged too
big a look change to take on this ticket. A is B without the thing that stops the
frame being solid green at the top edge.

## The low-poly budget, if we do extend

Today's ground: **18,432 triangles, 9,417 verts, 1 draw call** (`Garden.ts:88-150`,
72 rings x 128 segments, radius `pow(ring/rings,1.35) * TERRAIN_EDGE_RADIUS`,
124.9 m today). Proposed outer annulus from 125 m to ~400 m at 8 rings x 64
segments = **1,024 triangles, 585 verts, 1 extra draw call** — a 5.6% increase in
ground triangles for 10x the radius. That is the measurable budget the issue asks
for. Two cautions:
- `boundary.ts:652` requires an even polar grid for the grass UV tiling; the
  annulus must share the same polar parameterisation or the grass seams.
- The annulus must be `receiveShadow` only, never a shadow **caster** — the shadow
  camera is a fixed 52 m box that follows the player (`DayNight.ts:359-379`,
  `SHADOW_AREA = 26`), so a 400 m caster is pure cost.
- Camera `far = 270` (`IsoCamera.ts:150`) hard-clips ground at ~228 m. Land
  authored past that is invisible *and* clipped mid-plane. Either stop the annulus
  near 200 m or raise `far`.

---

# The inventory

## The hill is one expression

`src/world/terrain.ts:36` is the entire hill:

```ts
const beyondEdge = -PARK_BOUNDARY.distanceToEdge(x, z);
return base - smoothstep(RIM_OUTSET_START, RIM_OUTSET_END, beyondEdge) * RIM_DROP;
```

`base` is three sine waves scaled by `TERRAIN_HEIGHT_SCALE` (0.55) — the gentle
rolling hills *inside* the park, which stay. Everything hill-shaped comes out of
that one `smoothstep`. That is the good news: the drop can be removed in one place.

The bad news is what the drop is currently *doing*, which is not "being a hill" —
it is **hiding the cut edge of the terrain disc and letting the sky be seen.**
`constants.ts:17-26` and `terrain.ts:24-28` both say so outright. Remove the drop
and you do not get flat land; you get a flat disc of radius ~`TERRAIN_EDGE_RADIUS`
ending in a cliff-less cut edge at eye level, with the skybox below the horizon
line. So the drop cannot simply be zeroed — the land has to be *extended*, which
is exactly what Jim asked for.

## The terrain mesh today

`src/world/Garden.ts:88` `buildTerrain()`, called from the `Garden` ctor at `:70`.

- Polar disc: `TERRAIN_SEGMENTS` (72) rings x 128 radial segments, hard-coded at
  `Garden.ts:90`.
- **73 x 129 = 9,417 vertices, 18,432 triangles.** One indexed `BufferGeometry`,
  one draw call.
- Radius `Math.pow(ring/rings, 1.35) * TERRAIN_EDGE_RADIUS` (`Garden.ts:106`) — a
  plain circle, **not** boundary-following, despite what `boundary.ts:719` claims.
- Per-vertex Y from `terrainHeight` (`Garden.ts:112`). This is the only place the
  rim becomes geometry.
- Vertex colour ramp keyed on `height / (TERRAIN_HEIGHT_SCALE * 1.3)`
  (`Garden.ts:124`) — the rim's -17 m clamps to full `grassDark`, so the slope is
  currently coloured "off the bottom of the ramp". A flat extension will be
  mid-ramp instead, i.e. **the colour of the land beyond the wall changes even
  if nothing else does.**
- Material `MeshStandardMaterial { map: grassTexture(1), vertexColors: true }`,
  name `'terrain'`, `receiveShadow = true`. UVs are world XZ / `GRASS_TILE_METRES`.

**Budget baseline for #511's "low poly must be measured": 18,432 tris / 1 draw
call / 9,417 verts is what the ground costs today.**

## The five constants, and which are actually live

| Constant | Where | Live? |
|---|---|---|
| `RIM_DROP = 17` | `constants.ts:47` | Live, one consumer: `terrain.ts:36` |
| `RIM_OUTSET_START = 12` | `constants.ts:66` | Live: `terrain.ts:36`, **plus two assertions** (below) |
| `RIM_OUTSET_END = 22` | `constants.ts:67` | Live: `terrain.ts:36` and `TERRAIN_APRON` |
| `TERRAIN_APRON = RIM_OUTSET_END + 1.5` | `boundary.ts:679` | Live: `boundary.ts:681,720`, `Scenery.ts:1135` |
| `TERRAIN_EDGE_RADIUS = maxRadius + APRON` | `boundary.ts:681` | Live: `Garden.ts:106` (the disc radius) |
| `TERRAIN_RADIUS = 83.5` | `constants.ts:26` | **DEAD.** Imported `Garden.ts:17`, never referenced. Doc-only at `constants.ts:215,268`, `Garden.ts:84`. |
| `TREELINE_INNER_RADIUS = 71.5` | `constants.ts:78` | **DEAD as a value.** Doc-only. The treeline really uses the local `TREELINE_OUTSET_INNER = 11.5` at `Scenery.ts:19`. |
| `terrainEdgeRadiusAt()` | `boundary.ts:719` | **DEAD — no callers**, and its docstring asserts a boundary-following disc that `buildTerrain` does not build. |

Two orphan constants and one orphan function that all read as live tuning knobs.
Per CLAUDE.md ("a constant kept in case is one a reader has to prove is dead")
these should go in this PR rather than be left looking load-bearing next to a
rewritten hill.

## What is positioned off the rim — the things that must move

### Hard blockers (assert on the rim, will fail the moment it changes)

1. **`test/procgen/invariants.ts:2834`** — asserts both Rail Race rings stay inside
   `RIM_OUTSET_START` (12 m outset), message at `:2837`: *"past the 12 m where the
   hill starts falling away — there is no flat ground out there to stand a trestle
   on."* Once the land is flat this premise is **false**, and the assertion is
   asserting a thing that has stopped being true. This is not a "weaken it to pass"
   case — the *reason* dies, so the invariant is replaced, not relaxed.
2. **`scripts/check-rail-race.mts:344`** — the same clause as a check script:
   `outermost < RIM_OUTSET_START`, message at `:346`.
3. **`src/world/railRace/route.ts:142`** — derives the ring's 6.92 m outer limit
   from `RIM_OUTSET_START` in its docs.

### Geometry that leans on the slope existing

4. **The treeline, `src/world/Scenery.ts:1134-1144`.** 540 trees in a band
   `edgeRadiusAt + 11.5 .. TERRAIN_APRON - 1.5`, i.e. straddling the whole crest.
   Its *only* stated job is hiding the disc's cut edge. When the land runs on, the
   cut edge is far away — so the treeline either moves out to the new edge, or
   changes job (becomes ordinary woodland just outside the wall) and something else
   handles the far edge. **This is the single biggest visible decision in the ticket.**
5. **`src/world/railRace/track.ts:1591`** — rainbow-arch legs, sunk by a tube radius
   because the outer feet land "past `RIM_OUTSET_END`, where the terrain has already
   fallen the full `RIM_DROP`". On flat ground that sinking is wrong.
6. **`src/world/railRace/track.ts:829`** — trestle post heights are `beamY - ground`;
   outer posts currently stand on falling apron. They get shorter and even.
7. **`src/world/railRace/route.ts:420`** — samples terrain at +/-`WIDEST_HALF_SPAN`
   to choose `this.base`. The spread it is compensating for largely vanishes.
8. **`src/world/entrance/arrivalSightline.ts:151`** — `BUS_GROUND_Y`. Doc cites
   -1.35 m at z=74 and **-14 m at z=80**. The most rim-sensitive single sample in
   the repo.
9. **`src/world/entrance/Entrance.ts:797`** — road/pavement ribbon vertices draped
   at `terrainHeight + 0.06`. **This is #498's blocker**: at 11.94 m outset the
   carriageway sits on a 5.57 m cross-fall over 7.78 m of width. Flat land is the
   fix, and #498 unblocks the moment this lands.
10. **`src/world/entrance/Entrance.ts:349`** (bus-stop shelter, ~gate+4.5),
    **`:318`** (gate-arch feet, on the outline where the rim function starts), and
    **`ArrivalSequence.ts:760,794,838,997,1029,1075`** (bus body, step-down, the
    crowd of kids) — all on ground outside the gate.
11. **`src/world/railRace/exitCrowd.ts:153,231`** and **`RailRace.ts:1157`** — the
    exit crowd spawns and walks on the apron.
12. **`test/procgen/parkFacts.ts:2191-2194`** — an arch-leg daylight check that
    samples 16 points around each leg *specifically because* "these legs land on the
    rim, the steepest ground in the park". Its stated reason dies too.
13. **`src/world/entrance/BusJourney.ts:96`** — documents that the bus ride is its
    own scene precisely because there is no ground outside the park.

### Everything inside the park — unaffected, and this is the point

~120 call sites of `terrainHeight`/`terrainNormal` place the player, NPCs, the
parade, paths, the wall, trees, bushes, flowers, lamps, fountain, fairy lights,
the slide, the ball pit, the coaster, the ferris wheel, the train, its bridges and
fences, and the minigame plots. **Every one of these is strictly inside the park
edge, where `distanceToEdge > 0` makes the smoothstep return 0.** They read the
`base` sine waves only and are therefore **untouched, bit for bit, by removing the
rim.** That is what makes "a child standing in the park sees the same park"
mechanically true rather than a hope — and it is worth asserting, not assuming.

## Things to be careful of

- `test/procgen/invariants.ts:5871,8604,8608` — `terrain.ts` **must not** be
  statically imported into the invariants; it pins the seed via
  `boundary.ts -> parkManifest`. Use dynamic import, per the existing note. This is
  the "76 silent skips" trap from CLAUDE.md.
- `boundary.ts:652` says the disc must stay an even polar grid because the grass
  tiling depends on it. Any LOD scheme has to respect that or the grass texture
  seams.
- `src/world/paths.ts:1246` records that a `terrainHeight` boundary walk was removed
  as a **25.7 ms hot spot**. `terrainHeight` is cheap but not free; a much larger
  ground must not multiply calls to it.

---

# Continuation — perspective prototype (Opus 5, 1M context)

Jim, 4 Sep, after being shown that a bus-safe sphere's horizon sits at 870 m and
ortho cannot compress it: *"Maybe we just use a perspective camera then"* — and
*"Ok try it and give me preview link when ready"*.

## Built

`?projection=perspective` on any route (`src/core/perspectiveFlag.ts`). Same
position, same pitch, same yaw — **projection only**, so ARCHITECTURE.md's fixed
angle is untouched. FOV is derived from the existing zoom
(`2·atan(halfHeight / CAMERA_DISTANCE)`), so every framing still frames what it
asked for at the player's distance. At default zoom that is **~22°** — a long
lens, which is why the look is preserved rather than transformed.

`viewHalfWidth/Height` now go through one owner (`focusHalfHeight`) that answers
for both projections **at the focus**, and says in its own doc that it is
approximate off-focus rather than being silently wrong.

`tsc` exit 0. Committed, pushed. **Prototype, not a migration.**

## Measured: perspective alone gives NO sky back

Screenshots, canonical park, park centre and park edge (`/tmp/persp/`):

| frame | sky |
|---|---|
| ortho centre | 0% |
| perspective centre | 0% |
| ortho edge (240° bearing) | 0% |
| perspective edge | 0% |

(A pixel count reports 0.5–4.9%, but that is the pale Menu pill, the fountain
water and the blue rail line — not sky.)

**Why:** there is nothing distant to see. Today's ground is a 125 m disc ending
in a cliff, with a treeline in front of it. Perspective compresses distance, but
only if there is distance. At the park edge the **treeline fills the up-screen
area in both projections**.

## The conclusion that matters

**Neither half works alone, and together they should.**

- The **sphere alone** fails because ortho draws its 870 m horizon at 870 m,
  against a ~29 m frame.
- **Perspective alone** fails because today's land stops at 125 m and the
  treeline covers what is left.
- **Perspective + far-spreading gentle ground** is the combination that puts a
  horizon on screen: perspective supplies the compression, the extended ground
  supplies something to compress. The treeline would then also need to stop
  being a wall at the frame's top edge.

So the sphere is not superseded by perspective — it is **unblocked** by it. That
is the opposite of how it looked before this was measured.

## Cost/consequence list for the projection swap — reported, not fixed

Anything assuming a world object has a fixed screen size becomes suspect:

- **Name pills and speech bubbles** — `clampToFrustum` and `screenOffset` are
  exact only at the focus now. Pills on distant NPCs will drift.
- **`check:pet-slide`'s frame-share clauses** (`PET_FRAME_FLOOR/CEILING`) measure
  a raster, so they still measure truly — but the *numbers* would move, and
  `chaseEye`'s `estimatedFrameShare` assumes a fixed angular frame.
- **The slide chase camera and arrival camera** are separate rigs and unaffected
  by this flag, but they would need their own answer in a real migration.
- **Occlusion is new**: buildings will hide what is behind them, the castle will
  cover the park. Nothing in the layout has ever had to avoid that.
- **`worldUnitsPerPixel`** is now depth-dependent; anything sizing UI from it is
  approximate.

## Status

Prototype pushed, both frames captured, sky measured. **Do not merge.** Next
question for Jim is whether to try perspective **with** extended ground, which is
the only combination the measurements say can work.
