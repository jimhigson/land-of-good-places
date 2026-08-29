# HANDOFF — Engineer, issue #363: the castle interior

Branch `feat/castle-interior-363`, worktree `.claude/worktrees/eng-363`.
Paired with the **castle 3D Artist**, who works headlessly through Blender CLI.

**This file is the asset request contract.** §4 is the part the Artist must
read and reconcile against. Everything else is context.

---

## 0. Status

| | |
| --- | --- |
| Contract published | ✅ (§4 below) |
| Fabric work (mine) | ✅ first pass — flagstone floors, coursed walls, timber wall-plate |
| `/castle?deck=N` deep link | ✅ added; there was no way to reach the interior at all |
| First Artist batch | requested, awaiting the Artist's own sizes |
| Check that can fail | ✅ `check:castle`, wired into `npm run build`, **went red on its first run and caught a real bug** (§6) |
| Screenshots to Jim | ✅ sent, storeys 0–2 |
| Lighting / torches | not started — next |
| Props | blocked on the Artist's batch 1 |

### Two things found the hard way, both by looking at a rendered frame

1. **You could not reach the castle interior at all.** `/spawn?pos=600,0.73,600`
   photographs an empty sky: being inside is a *space*, not a position.
   `/castle?deck=N` now exists, and goes through `changeSpace` — the door's own
   sequence — because a first cut that called `enterInterior()` directly
   switched the room on and left the camera out over the garden.
2. **Ceiling beams fight the cutaway.** Cross-hall beams were the obvious
   reading of the brainstorm and were wrong: the storey above is faded out so
   you can see in, so there is no ceiling for them to hang from, and fifteen
   timbers floated over the room hiding the floor. Replaced with a perimeter
   wall-plate, which does the same job from somewhere the cutaway does not
   delete. **The code and the geometry both looked right; only the frame
   said otherwise.**

### One open question for Jim

Each storey tints the stone with its own colour (the existing "layer cake"), so
floor 1's flagstones come out mint green. It is consistent with what the family
liked before, but a castle arguably wants **one** stone the whole way up. Not
changed either way pending a ruling.

---

## 1. What the room actually is

Measured off `origin/main`, not assumed:

| Fact | Value | Source |
| --- | --- | --- |
| Floor plate | 60 m × 44 m | `INTERIOR_HALF_X` 30, `INTERIOR_HALF_Z` 22, `src/core/constants.ts` |
| Storeys | 5 (`deck` 0–4); deck 4 is the open roof terrace | `BUILDING_FLOOR_COUNT` |
| Storey height | 3.60 m | `BUILDING_FLOOR_HEIGHT` |
| Slab thickness | 0.30 m, hanging *below* the walking surface | `BUILDING_SLAB` |
| **Clear headroom** | **3.30 m** = floor height − slab | derived; see §4's hard ceiling |
| Solid wall band | floor → 2.15 m | `BUILDING_PARAPET` |
| Translucent band | 2.15 → 3.26 m (`buildGlass`) | `GLASS_TOP = 3.6 − 0.34` |
| Header/trim band | 3.26 → 3.60 m | `buildTrimBand` |
| Wall thickness | 0.45 m | `BUILDING_WALL_THICKNESS` |
| Perimeter, one deck | ≈ 208 m of wall | 2 × (60 + 44) |
| Front door | south wall, deck 0, `INTERIOR_DOOR_MIN_X`…`MAX_X` | `layout.ts` |
| Lift door | east wall, every deck, `LIFT_DOOR_MIN_Z`…`MAX_Z` | `layout.ts` |
| Existing dressing | roundel at (−6, 12) r6, 10 planters, 8–10 benches per deck | `dressing.ts` |
| Existing keep-outs | stairs, lift lobby, roundel, doorway, shops, toilets, helter, roof furniture | `dressing.ts` `keepOutsFor` |

**Only the deck you are standing on is drawn** — the cutaway fades the rest.
That is the single biggest budget fact here: per-deck decoration is not
multiplied by five at draw time.

The exterior in the garden is already a castle (`buildCastle` in `Shell.ts`:
curtain wall, courtyard, corner towers, battlement, grand arch, rose window).
The interior shares nothing with it but the doorway coordinates, by design
(GAME_DESIGN item 30c). So the interior is free to be a castle *interior*
without having to agree with the facade's plan — but it must agree with its
**material story**, or walking through the door swaps worlds.

### The one open structural decision (mine, flagged early)

Today the wall above 2.15 m is a translucent band and a trim header. A great
hall wants **solid wall to the ceiling with openings cut in it**. I intend to
raise the interior's solid band to the full 3.26 m and cut arched/arrow-slit
openings into it, keeping the emissive lift that stops the interior going
grey. That changes where a tapestry can hang from — so the Artist's tapestry
must be authored to hang from a **stated rail height**, not from "the top of
the wall". §4 pins it at 2.90 m.

---

## 2. The brainstorm, judged for a six-year-old

Ordered by how much each one buys per unit of work. **E** = mine (primitives,
textures, placement, light). **A** = Artist (authored geometry through the
GLB pipeline).

### Tier 1 — without these it is still a box

| # | Thing | Who | Why it earns its place |
| --- | --- | --- | --- |
| 1 | Stone-flagged floor | E | The floor is the largest surface in frame. One tiling canvas texture turns 2 640 m² of flat pink into masonry. Biggest single win available, and it costs nothing but a texture. |
| 2 | Stone coursing on the walls | E | Same argument, second-largest surface. |
| 3 | Timber ceiling beams | E | A hall reads as a hall from its *ceiling*. Instanced boxes; one draw call per deck. |
| 4 | Wall torches, warm and flickering | E + A | Jim named lighting explicitly. The sconce is A; the flame, the glow and the flicker are E. This is the thing that makes it feel like a castle rather than look like one. |
| 5 | Tapestries | A + E | Jim named them. Woven cloth is organic — it hangs, sags and fringes — so the *cloth* is Blender; the *picture* is a canvas texture painted into that cloth's own UV (never a second mesh — CLAUDE.md's hood-face rule). |
| 6 | Suits of armour | A | Jim named them. The single most recognisable object in the whole list. |
| 7 | Arched / arrow-slit windows | E | Cut into the wall, with warm stained glass. Turns the wall band from "trim" into "architecture". |

### Tier 2 — the grand furniture

| # | Thing | Who | Note |
| --- | --- | --- | --- |
| 8 | Throne on a dais with a carpet runner | A (throne) + E (dais, runner) | A destination. Children should want to sit on it. |
| 9 | Long banqueting table, benches, goblets, a roast, a pie | A | The set piece of the great hall. |
| 10 | Fireplace with a fire | A (chimneypiece) + E (fire, light) | The room's warm anchor, and where the cat sleeps. |
| 11 | Iron candle-wheel chandelier | A | Hangs on a chain to a ceiling boss (E). |
| 12 | Banners and pennants | E | Long thin cloths hung from the beams; heraldry is a canvas texture. Cheap, and they fill the upper third of frame that nothing else uses. |
| 13 | Big round rug | E | Goes over the existing roundel — reuses a keep-out that already exists. |
| 14 | Treasure chest | A | |
| 15 | Barrels, crates, sacks | A (barrel, sack) + E (crates) | Corner clutter. A castle with tidy corners is a lobby. |
| 16 | Heraldic shield / coat of arms over the doorway | E | Shield-shaped extrude + painted canvas. |
| 17 | Cauldron on a tripod | A | |
| 18 | Woodpile | E | Instanced cylinders beside the fire. |
| 19 | Portcullis over the front door | E | Instanced bars. Says "castle" from the moment you walk in. |
| 20 | Braziers | A (bowl) + E (fire, light) | For the big open middle of the plate, where wall torches cannot reach. |
| 21 | Crossed swords, halberd rack, shield wall | A | Fills wall between tapestries. |
| 22 | Knight's helmet on a stand | A | |
| 23 | Bell on a beam | A | |

### Tier 3 — the things that reward looking twice

This tier is not garnish. Jim's brief and the issue both single it out, and a
six-year-old will remember the mouse longer than the throne.

| # | Thing | Who | Note |
| --- | --- | --- | --- |
| 24 | A cat asleep by the fire | E | Reuse `src/art/models/pets.ts`'s kitten, posed curled. No new asset, and it is *already* a character she knows. |
| 25 | A mouse hole in the skirting, with a mouse peeking out | E | Arch painted into the wall's own UV + the existing `pets.ts` mouse. |
| 26 | A wonky portrait | E | Frame from boxes, painting on canvas, hung 4° off level. The joke is the 4°. |
| 27 | A dragon painting | E | Same construction, different canvas. |
| 28 | A dragon egg in a nest | A | Eleri bait. |
| 29 | Cobwebs in the corners | A | Organic — goes to Blender. |
| 30 | One suit of armour turned to look at you | E | Pure placement on the Artist's asset. Costs one yaw value. |
| 31 | A dropped gauntlet on the floor beside it | A | The gag's punchline. |
| 32 | A crown on a velvet cushion by the throne | A | |
| 33 | An owl asleep on a beam | A | |
| 34 | Soot marks above every torch | E | Painted into the wall UV. Free, and it is what sells the torches as having burned for a hundred years. |
| 35 | An arrow stuck in a target butt | A | |

### Explicitly rejected

- **Spiral stair** — the interior already has stairs, an escalator, a lift, a
  trampoline, a bubble and a helter-skelter through it. Another way up is a
  navigation problem dressed as decoration.
- **Rope-and-pulley, drawbridge winch** — reads as machinery, not castle, at
  this camera distance, and neither is worth an asset slot ahead of Tier 2.
- **Rush matting** — loses to the round rug on the same floor area.
- **A squeaky flagstone** — no audio in scope for this issue.

---

## 3. Non-proportional scale — the binding rule

Jim, on this issue: *"it doesn't matter if things are a realistic size, only
that they are easily recognisable as what they are."*

So sizes in §4 are chosen for **recognisability at gameplay distance**, and
several are deliberately far from life size. The suit of armour is 2.6 m —
taller than the tallest possible child (2.97 m with hair and hat, but she is
a *child*, and the knight should loom). The goblets are the size of buckets.
Do not shrink anything toward realism.

**Two hard limits override the rule, and only two:**

1. **Nothing standing on a floor may exceed 3.30 m total** (clear headroom,
   §1). A prop through the ceiling is not stylisation, it is a bug.
2. **Nothing may be so wide it cannot clear the keep-outs in §5.**

---

## 4. THE ASSET REQUEST CONTRACT

### 4.1 The seam between us

Mirroring `src/art/models/hotelAssets.ts`, which is the worked precedent:

- **The Artist owns shape and nothing else.** `art/blend/castle_build.py`
  writes `art/blend/castle.blend`; `castle_export.py` writes `castle.glb`;
  `npm run blend:castle` runs the pair and packs it to
  `src/art/assets/castleGlb.ts` via `scripts/lib/pack-glb-asset.mts`.
  The `.blend` is a generated artefact — edit the Python, never the file.
- **I own `src/art/models/castleAssets.ts`**: the `STYLES` colour table, the
  `AssetHandle` factories, outlines, shadow flags, and every placement.
- **The GLB carries no colour and no material.** `src/art/style/glb.ts` reads
  meshes, vertex attributes and one level of node transform. Nothing else.

### 4.2 Rules every part must obey

Non-negotiable, from `ASSET_MANIFEST.md`'s shared contract and
`ART_DIRECTION.md` §7:

- **Metres.** 1 unit = 1 m.
- **Origin at the base**, centred on X and Z, so `root.position.y = floorY`
  seats it with no fudge. **Exception:** hanging things (chandelier, banner,
  cobweb) take their origin at the **hang point**, with all geometry below
  y = 0 — the documented balloon/disco-ball exception.
- **Facing +Z.** A suit of armour at `rotation.y = 0` faces the camera.
- **`scale` left at 1.** Bake size into the geometry.
- **One node per distinctly-coloured part**, named `<asset>-<part>` in
  lower-kebab. I write one `STYLES` entry per node name; a node I have no
  entry for throws at load, so **tell me the node list when you publish**.
- **Chunky and rounded** (§1), toon ramp only, no micro-detail, no realistic
  shading. Recognisable at 10 m from a 38° camera beats detail.
- **Budget: 60 KB per asset, 200 KB for the whole `castle.glb`.** Smaller than
  the character budget on purpose — this is set dressing, not a hero asset,
  and it is base64'd into the bundle.

### 4.3 Batch 1 — requested now

Sizes are **my proposals**. Where the Artist has already started at a
different size, **write yours into your own handoff and say so; I will
reconcile explicitly in §4.5 rather than either of us assuming.**

`W×H×D` is the bounding box in metres, X × Y × Z.

| # | Asset | Node prefix | W × H × D | Origin | Facing | Instances | Sits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | **Suit of armour** — helm with a plume, breastplate, pauldrons, gauntlets, greaves, one hand on a grounded sword | `armour-` | 1.10 × 2.60 × 0.80 | base, between the feet | +Z (visor forward) | **8** across decks 0–3 | Against a wall, back to it, 0.55 m clear of the face |
| A2 | **Armour plinth** — a plain chamfered stone block | `plinth-` | 1.30 × 0.25 × 1.00 | base, centred | any | 8 (one per A1) | Under A1. Separate node so I can drop it where a plinth would trip somebody |
| A3 | **Tapestry cloth** — a hanging cloth with sag across the top, a wavy hem and a fringe. **Must carry a UV map spanning its whole front face**, authored off the same vertices as the shape. I paint the picture into it | `tapestry-` | 3.20 × 2.40 × 0.12 | **hang point**: middle of the top rail, geometry below y = 0 | front face on **+Z** | **6**, three pictures × two colourways | Rail at y = **2.90 m** on the wall; hem ends at 0.50 m |
| A4 | **Tapestry rail** — a turned wooden pole with finials, wider than the cloth | `tapestryrail-` | 3.60 × 0.14 × 0.14 | middle, at the pole's axis | any | 6 | y = 2.90 m |
| A5 | **Wall-torch sconce** — an iron bracket and cup, wall-mounted. **No flame** — I build the flame, the glow and the flicker | `sconce-` | 0.34 × 0.46 × 0.42 | **the wall face**, i.e. the back plate is at z = 0 and the cup sticks out to +Z | bracket projects +Z | **~40** (instanced) | y = 2.10 m, every 5.2 m round the perimeter |
| A6 | **Throne** — a tall-backed carved chair, arms, a cushion, finials | `throne-` | 1.60 × 3.00 × 1.20 | base, centred | +Z (sitter faces +Z) | 1, deck 0 | On a dais I build (0.30 m) — **so 3.00 + 0.30 = 3.30 m exactly, my ceiling. Please come in at 2.80 m and give me headroom.** See §4.4 |
| A7 | **Banqueting table** — long, heavy, trestle legs, flat top at 1.05 m | `table-` | 2.20 × 1.05 × 6.00 | base, centred | long axis along **+Z** | 1, deck 0 | Great hall, north of the roundel |
| A8 | **Bench** — a plain heavy bench, seat at 0.55 m | `bench-` | 0.60 × 0.55 × 2.80 | base, centred | long axis along +Z | 4 | Both sides of A7 |
| A9 | **Feast props** — a goblet, a roast, a round loaf, a pie. One node each, sized like buckets | `feast-` | each ≤ 0.45 × 0.45 × 0.45 | base | any | ~14 total | On A7's 1.05 m top |
| A10 | **Treasure chest** — domed lid, iron bands, a big lock, **lid a separate node so it can be opened** | `chest-` | 1.20 × 0.90 × 0.80 | base, centred; **the lid's own node origin must be its hinge axis** | opening toward +Z | 3 | Corners of decks 0–2 |

### 4.4 The numbers the two of us must agree on, exactly

These are the ones a spot-check would miss. The bridge pair's failure was two
formulas that agreed where they were checked and diverged in between, so:

| Constant | Value | Who owns it | Why it bites |
| --- | --- | --- | --- |
| `CASTLE_CEILING_CLEAR` | **3.30 m** | me, exported from `castleAssets.ts` | Nothing standing on a floor may reach it. The throne (A6) is the one at risk. |
| Tapestry rail height | **2.90 m** | me | A3's hang point and A4's centre must be the *same* number. If the Artist wants a different rail height, say so — I will move the wall band, not fudge the cloth. |
| Sconce mount height | **2.10 m** | me | A5's back plate lands here. The flame I build sits at the cup, so **tell me the cup's centre offset from the back plate** as a number, `SCONCE_CUP_OFFSET`, exported from the Python and re-derived by me from `visibleBounds`. I will not measure it by eye. |
| Table top | **1.05 m** | Artist, reported back | A9 sits on it. I will assert the measured top equals the reported number. |
| Bench seat | **0.55 m** | Artist, reported back | So a child model can be posed sitting. |
| Chest hinge axis | at the lid node's origin | Artist | Otherwise opening it is a second formula tracking the first. |
| Armour footprint radius | **0.65 m** | me | Feeds the keep-out check in §6. |

**Protocol:** the Artist publishes its actual figures in its own handoff. I
copy none of them by hand — every one that matters is either exported from
`castleAssets.ts` (mine) or **measured off the built mesh** with
`visibleBounds()` and asserted against the reported figure by the check in §6.
A number that is only written down in two documents is the bug this project
has hit more than any other.

### 4.5 Reconciliation log

*(Empty. First entry goes here the moment the Artist publishes its sizes.)*

### 4.6 Batch 2 — queued, not yet requested

Fireplace chimneypiece, chandelier, barrel, sack, cauldron, helmet on a
stand, crossed swords, shield wall, bell, dragon egg in a nest, cobwebs,
dropped gauntlet, crown on a cushion, owl, arrow in a butt. Requested once
Batch 1 is in and Jim has seen it.

---

## 5. Placement — what decoration may not do

`dressing.ts` already owns a keep-out system (`keepOutsFor(deck)`), and it
already covers: the stairs pad, the lift lobby, the roundel, the doorway, the
toilets, the helter entry, the roof furniture, and **every shop unit's counter
plus its three serving spots plus queue room** (`shopKeepOut`, scaled by
`SHOP_SCALE_XZ`, with extra radius where a shop has a sunken forecourt).

**I extend that system rather than writing a second one.** Two placement
rules kept in step by hand is the single most common bug in this repo.

Additional rules for castle decoration specifically:

1. **Wall furniture stays on the wall.** Tapestries, sconces, banners and
   shields project at most 0.45 m from the wall face — less than the wall's
   own thickness, so nothing narrows a route.
2. **Floor furniture obeys the existing keep-outs**, plus a new one round the
   doorway *lane* rather than just the doorway disc: children walk in and keep
   walking.
3. **Children's destinations (#355, #362) come first.** Anything indoors that
   a child NPC routes to gets a keep-out before a prop is placed near it. If
   #362 lands after this, its destinations must be added to `keepOutsFor` —
   noted here so whoever picks that up sees it.
4. **Hanging things clear a hatted child**: bottom of any hanging asset ≥
   `TALLEST_CHILD_HEIGHT + RIDER_HEADROOM` (2.97 + 0.40 = 3.37 m)… which is
   *above* my 3.30 m ceiling. So: **nothing hangs low enough to walk into.**
   Chandeliers and banners hang in the 3.0–3.3 m band and are therefore only
   ever over places a child cannot stand — the roundel's middle, the table,
   the void of a deck hole. The check in §6 enforces exactly that.

---

## 6. The check that can fail

Home: **`test/procgen/invariants.ts`** is for the seeded park. The castle
interior is *not* per-seed — it is the same room on every seed. So this goes
in a **`scripts/check-castle.mts`**, wired into `npm run build` alongside
`check:park`, and it builds the real interior and measures it. Four
assertions, all measured off built objects, none off the rules that built
them:

1. **No decorative asset intersects a keep-out.** For every placed prop,
   its measured XZ footprint against every `keepOutsFor(deck)` disc, inflated
   by `PLAYER_RADIUS`. This is the "no prop in a walkable route or on a shop
   stand" requirement, stated as a measurement.
2. **No prop pierces the ceiling.** Measured `visibleBounds(root).top` +
   its floor y < `CASTLE_CEILING_CLEAR`. Catches the throne and the armour.
3. **Nothing hangs into head height.** For every hanging asset, measured
   bottom ≥ 3.30 m, *or* it hangs over a point where `deckIsSolid` is false
   or which is inside a keep-out — i.e. somewhere nobody stands.
4. **Every reported figure equals its measured figure.** `tableTop`,
   `benchSeat`, `sconceCupOffset` from the handle vs `visibleBounds`. This is
   the §4.4 protocol with teeth.

**I will break each of these deliberately and quote the red message here
before trusting any of them green.** A check that has never been red is worse
than no check.

### It went red on its first run, before it ever went green

Assertion 3 fired 1 232 times, and it was not a contrived break — it was a real
bug I had just written and could not see:

```
check:castle — 1232 failure(s):

  ✗ beams: deck 0 beam segment 0 hangs down to 2.900 m, which the tallest
    child (2.97 m) would walk into.
```

The timbers were 0.40 m deep under a 3.30 m ceiling, and
`TALLEST_CHILD_HEIGHT` is 2.97. Fixed by giving the timber its bulk **across**
instead of **down** — 0.70 × 0.22 — which also reads chunkier from a 38°
camera, where you see a timber's width far more than its depth.
`buildCeilingBeams` now throws rather than shipping a ceiling children walk
through, and there are only 33 cm between the ceiling and a tall child, so that
is the entire budget for anything that ever hangs in this room.

**The check's own first draft carried the same disease it exists to catch**: it
typed `2.97` instead of importing `TALLEST_CHILD_HEIGHT` from `kid.ts`, its
owner. It now imports it, and derives the timber's half-depth from
`BEAM_UNDERSIDE` rather than repeating the cross-section.

Assertions 1 and 2 are in; assertion 4 (reported figure vs measured figure)
lands with the Artist's batch 1, which is what it measures.

---

## 7. Lighting, and its stated cost

Today: `InteriorLighting` is **one** shadow-casting `DirectionalLight` with a
fixed frustum framed to the floor plate, plus a `HemisphereLight` fill. No
per-frame update at all. Issue #251 records the shadow pass at 57% of draw
calls, so the rule is simple:

**Not one new light casts a shadow.** Torches, braziers and the fire get
`castShadow = false` `PointLight`s. That adds zero draw calls to the shadow
pass — a non-shadowing light costs uniforms and a per-fragment term, not a
render pass.

Budget I will hold myself to, and measure rather than assume:

| | Plan |
| --- | --- |
| Shadow-casting lights added | **0** |
| `PointLight`s live at once | **≤ 6**, only on the deck you are on |
| Flicker | one `update(dt)` writing 6 intensities. No geometry changes, no material recompiles. |
| Flame geometry | one `InstancedMesh` of emissive cones for *all* torches on a deck — 1 draw call, `castShadow = false` |
| Glow | emissive material, **not** a sprite and not a second light |

Measured before/after draw calls and triangles go here, from
`renderer.info`, on deck 0 with everything on. If the delta is not tiny, the
torches lose their lights and keep their emissive.

*(Measurements go here.)*

---

## 8. Order I am working in

1. ~~Read the room, publish this contract~~ ✅ — unblocks the Artist.
2. Fabric, which needs no Blender: stone floor texture, wall coursing, ceiling
   beams. **Screenshot to the Overseer.**
3. Torches: flame, glow, flicker, light budget measured. **Screenshot.**
4. `scripts/check-castle.mts`, broken deliberately first.
5. Banners, rug, portrait, mouse hole, cat, soot — all mine. **Screenshot.**
6. Wire Batch 1 as it arrives from the Artist. **Screenshot per asset.**
7. `npx tsc --noEmit`, `npm run test:procgen`, full unpiped `npm run build`.
8. PR referencing #363. **Do not merge.**

Screenshots: headless `playwright-core`, production build, **port 5463**,
`--strictPort`, killed by PID. Hosted on the `qa-screenshots` branch, linked
by raw URL. Not the chrome-devtools MCP.

**Not 5363, despite the ticket naming it.** Checked before starting: PID
81373, a vite from `.claude/worktrees/review-353-r3`, has held 5363 since
13:09 today — a Reviewer agent's server, not mine, and not mine to kill.
`--strictPort` would have made this loud; asking first made it silent. 5463
verified free at the same moment.

---

## 9. If you are picking this up cold

- Nothing is committed beyond this file yet.
- The Artist's handoff is the other half of §4. Read it before touching
  `castleAssets.ts`.
- The one thing not to do: place a prop by copying a number out of this
  document. Ask the owner named in §4.4, or measure it.
