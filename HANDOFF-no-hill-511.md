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
- [ ] Inventory reported to the Overseer, approach agreed.
- [ ] Implementation.

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
