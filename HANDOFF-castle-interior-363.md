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
| Check that can fail | ✅ `check:castle`, wired into `npm run build`. Went red on its first run and caught a real bug — then **review found two more ways it could not fail**, both now fixed and both proved red (§6). It measures the built mesh; it does not yet measure any prop, and says so on every run. |
| Screenshots to Jim | ✅ sent, storeys 0–2 |
| Lighting / torches | not started — next |
| Props | blocked on the Artist's batch 1 — **and the three assertions that guard them are not written yet** (§6) |
| Floor legibility | ⚠️ open. Review walked the middle of the hall and read it as a pink tiled patio: tones within a few percent, the "worn" flags invisible, joints on a regular grid. Deck 1 is worse — mint stones with pink joints, because the mortar hue is baked into the map while the stone hue comes from the storey tint. **Bundled with Jim's per-storey-tint ruling, because the fix depends on which way he goes.** |

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
| Armour footprint radius | **0.65 m** | me | Feeds the keep-out check in §6. Artist measured 0.638; mine is the conservative one and stands. |
| `BEAM_UNDERSIDE` | **3.08 m** | me, exported from `castleFabric.ts` | **Added 29 Aug, after the wall-plate was built.** The headroom within **0.40 m** of a wall (was 1.25 m before the plate moved flush — see reconcile entry 2). Tighter than `CASTLE_CEILING_CLEAR` and easy to miss. |
| `SCONCE_MOUNT_Y` / `SCONCE_HEADROOM` | 2.10 m / 0.60 m | me, exported from `castleFabric.ts` | A sconce must fit inside the headroom, or the wall-plate hides it. `check:castle` asserts the plate's own sightline against it. |

**Protocol:** the Artist publishes its actual figures in its own handoff. I
copy none of them by hand — every one that matters is either exported from
`castleAssets.ts` (mine) or **measured off the built mesh** with
`visibleBounds()` and asserted against the reported figure by the check in §6.
A number that is only written down in two documents is the bug this project
has hit more than any other.

### 4.5 Reconciliation log

**Entry 1 — 29 August 2026, Engineer, on the Artist's published batch-1 figures.**

| Figure | Artist | Me | Ruling |
| --- | --- | --- | --- |
| `SCONCE_CUP_OFFSET` | (0.000, 0.285, 0.3025) m, game frame, cup-mouth centre | not specified — I asked for it | **Accepted.** Exactly the form asked for, and measured off the mesh with the Blender→glTF conversion done in code beside the measurement rather than described in prose, which is the only version of that conversion that cannot rot. |
| `TABLE_TOP` | 1.050 | 1.05 | **Agreed.** |
| `BENCH_SEAT` | 0.550 | 0.55 | **Agreed.** |
| Armour keep-out radius | 0.638 measured | 0.650 budgeted | **Keep 0.650.** Mine is the larger, so it is the conservative one and the asset fits inside it with 12 mm to spare. No change either side. |
| Throne height | 3.10 m "on your dais, 0.20 m of ceiling to spare" | asked for 2.80 m + 0.30 m dais | **Accepted, on one reading — stated here so it cannot stay ambiguous.** I read 3.10 as the **total including the 0.30 m dais**, i.e. throne geometry of 2.80 m, which is what I asked for and which leaves 0.20 m under the 3.30 m ceiling. The other reading (3.10 m of throne *on top of* the dais) is 3.40 m and does not fit. `check:castle` assertion 2 measures floor-to-top and will go red if the second reading is the true one — which is the right way for this to be settled, rather than by either of us being sure. |
| **Tapestry depth 0.12 → 0.26 m** | requested | 0.12 specified | **Approved. Change it.** See below. |

**On the tapestry: yes, 0.26 m.** Three reasons, in order of weight. It is
inside my own 0.45 m wall-furniture rule (§5 rule 1) with 0.19 m to spare, so
it cannot narrow a route. The reason given is a **rendered frame** — the first
render came out a flat rectangle — and a picture beats a specification about
whether a thing reads as cloth; that is the same lesson the floating ceiling
beams taught me on this branch three hours ago. And 0.12 m was a number I
guessed at while writing a contract with no cloth in front of me, which is
exactly the sort of number that should give way. The rail (A4) can stay at
0.14 m: a cloth sagging away from its pole genuinely does stand proud of it.

**New constraint the Artist must have, which did not exist when the contract
was written.** The perimeter timber wall-plate I have since built hangs to
**3.08 m**, not 3.30 m, and it runs round every wall 0.9 m in. So:

> Anything standing **within 1.25 m of a wall** must clear **3.08 m**
> (`BEAM_UNDERSIDE`), not 3.30 m. Out in the room it is still 3.30 m.

That affects the armour (2.85 m with plinth — fine, it is against a wall) and
would affect any tall prop pushed back against the wall. `check:castle` gains
this as an assertion when batch 1 lands.

**On the `.glb` budget split — I agree with the Overseer's ruling, with one
correction to the reasoning, because I own the loading side.**

Batch 2 gets its own `.glb`. Splitting is right and the budget should not be
raised to fit whatever arrives.

But **it will not "let the interior load in stages"**, and nobody should plan
around that. `src/art/style/glb.ts` is a synchronous reader, and every asset
module parses its own bytes at *import* time (`const parts = readGlbParts(...)`
at module scope, as `hotelAssets.ts` does). The bytes are base64 in the main
bundle, so both files are downloaded and parsed at boot whether or not a child
ever walks into the castle. Two files instead of one splits that work in half
and then does both halves anyway; the total is identical.

The real lever is a **dynamic import** of the castle's asset module, so the
castle's bytes are fetched when the castle is first entered. That is mine, not
the Artist's, and it is a genuine change — `Building` builds its props during
construction today. I will measure the boot cost once batch 1 is wired and say
whether it is worth doing. Splitting the files early makes that easier if it
is, so the ruling is right either way — just not for the stated reason.

**Entry 2 — 29 August 2026, Engineer, on the Artist's second round.**

| Figure | Ruling |
| --- | --- |
| `SCONCE_CUP_OFFSET` → (0.000, 0.285, **0.2475**) | **Accepted.** Z only; the mouth height is unchanged, which is the part my flame placement depends on. **My provisionally-typed 0.3025 is now stale and must not be used** — it was always marked provisional precisely because it was a typed copy of someone else's measurement. |
| Sconce 0.23 → 0.34 m | **Accepted.** |
| Armour keep-out radius 0.638 → **0.5052** | **Accepted, and my 0.650 budget stands unchanged.** The asset got smaller, so it fits inside the budget with more room than before. I am not shrinking the budget to match: a keep-out is how much floor the prop is *given*, not how much it occupies, and the slack is what stops a child brushing it. |
| Tapestry depth | **0.26 m, settled on both sides.** |
| **Throne 2.75 m** (Artist) vs 2.78 m (reviewer) | **Artist's 2.75 stands. Not overruled.** Its reasoning is better than the reviewer's: a 2 mm margin is "a rounding error waiting for a felt pad", and I would add that it is also below the precision anything downstream actually holds. The check measures floor-to-top against a real ceiling, so the margin has to survive a build, not a spreadsheet. |

**The wall-plate moved, and it changes a number I gave the Artist.** §4.4's
`BEAM_UNDERSIDE` rule said *"anything within 1.25 m of a wall must clear
3.08 m"*. The plate is now **flush with the wall and 0.40 m wide** (it was
hiding all forty sconces — see §7), so that band has shrunk:

> Anything standing **within 0.40 m of a wall** must clear **3.08 m**.
> Beyond 0.40 m it is the full 3.30 m.

That is strictly more permissive than what the Artist was working to, so
nothing already built can have broken — but it is more room than it thought it
had, and it is the sort of change that would otherwise be discovered by
somebody building to the stricter number for no reason.

**Two new numbers the Artist owns a constraint against**, both exported from
`castleFabric.ts` and both asserted by `check:castle`:

| Constant | Value | Means |
| --- | --- | --- |
| `SCONCE_MOUNT_Y` | 2.10 m | Where the back plate lands. Unchanged. |
| `SCONCE_HEADROOM` | **0.60 m** | **A sconce must fit inside this, measured up from the mount.** It is the budget the plate's sightline is checked against; deliberately generous against the ~0.46 m asked for, so a sconce growing a little does not silently vanish behind a timber. |

**Entry 3 — for whoever replaces the castle Artist.** Its session was lost on
29 Aug; its work is pushed and PR #368 carries its answers, so nothing is gone.
Two things are outstanding on that side, and both are small:

1. **The render script's scale post still types the child's height.** It says
   1.86 m under a comment claiming the figure came from `TALLEST_CHILD`. The
   real numbers are 2.12 m, and 2.97 m hatted. That post is the reference object
   every render is judged against, so while it is wrong **every size judgement
   made from those pictures is wrong** — a 2.60 m suit of armour was called
   towering while being shorter than a child in a tall hat.

   **Do not simply retype it as 2.97.** Read it out of `src/art/models/kid.ts`
   at asset-build time, the way `art/blend/hotel_build.py` already reads
   `TALLEST_CHILD_HEIGHT` and `RIDER_HEADROOM`. That pattern exists in this repo
   precisely so a `.py` cannot drift from the game — and a typed copy there is
   invisible to `tsc` and to every check.

   I have fixed the two source documents (`ASSET_MANIFEST.md`,
   `ART_DIRECTION.md`) that told the Artist 1.86 in the first place. Once the
   render script is on a branch I can see, `check:castle` gains an assertion
   that its scale post equals the imported constant — the reported-vs-measured
   shape already used three times on this branch.

2. **Re-judge the batch-1 silhouettes against a correct post.** Every size
   decision so far was made against one a quarter too short. The armour is the
   one most likely to need to grow.

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
3. **Two facts established 29 Aug, both of which change the plan.**

   **Indoor collision is height-blind.** `registerInteriorCollision` walls the
   shell once and it holds on every storey at once, because collision has no
   idea what height you are at. So a collider added for a prop on deck 0 would
   block that same square metre on **all five decks** — a suit of armour in the
   great hall would be an invisible wall in the middle of floor 3. Therefore
   **decorative props get no colliders at all.** That is not a compromise, it
   is the only correct answer here, and it removes a whole class of bug.

   **But it means placement is the only protection there is.** With no
   collider, a child NPC walks *through* a suit of armour rather than round it:
   props do not appear in the lattice `journey.ts` routes on, so nothing steers
   her round them. A prop in a walking route is therefore a visible fault, not
   a stuck child — which is worse in one way (it always happens) and better in
   another (nobody gets trapped).

   **#355's castle destinations are the seven shop stands** and nothing else —
   `castleAttractions()` maps `Shops.stands` straight through, on decks 0, 1
   and 2. Those are *already* covered by `dressing.ts`'s `shopKeepOut`, counter
   and three serving spots and queue radius included, so reusing `keepOutsFor`
   protects them for free. What is **not** yet covered is the route between the
   door and a shop: `check:castle` assertion 1 must test props against the
   paths children actually walk, not only against the destination discs. That
   is the form it takes when batch 1 lands.

4. **Children's destinations (#362) come first.** Anything indoors that
   a child NPC routes to gets a keep-out before a prop is placed near it. If
   #362 lands after this, its destinations must be added to `keepOutsFor` —
   noted here so whoever picks that up sees it.
5. **Hanging things clear a hatted child**: bottom of any hanging asset ≥
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

### What is actually written, and what is not

**Corrected 29 Aug after review.** This section previously said "assertions 1
and 2 are in". **They were not**, and nothing in `check:castle` measured a prop
at all. That claim mattered more than a documentation slip, because §5 tells
the Artist that props get no colliders and that *placement is the only
protection there is* — so the contract promised a guard that did not exist.

| Assertion | State |
| --- | --- |
| Headroom figure is above the tallest child | written |
| Wall-plate fixed to real slab across its **whole measured footprint** | written |
| Wall-plate under the ceiling and over a child's head, from **measured geometry** | written |
| `BEAM_UNDERSIDE` equals the built mesh | written |
| **1. No prop intersects a walkable route or a shop stand** | **NOT written** |
| **2. No prop pierces the ceiling** (settles the throne's two readings) | **NOT written** |
| **3. Reported figure equals measured figure, for the Artist's numbers** | **NOT written** |

The three missing ones land with batch 1, which is what they measure.
`check:castle` now **prints their absence on every run** rather than letting a
green line imply cover it does not give:

```
check:castle props: NOT CHECKED — batch 1 is not wired yet, so nothing here
measures a prop. Placement is the only protection props get, and it is not
yet enforced.
```

### A green build is not a green repo

**`npm run test:procgen` is not in the build chain**, and it caught a
regression this branch shipped that `npm run build` could not see.

The wall-plate was named `castle-wall-plate-N`. `test/procgen/parkFacts.ts`
measures the top of the castle's stonework by matching
`/^(castle-wall-|crenellations$)/` across the **whole scene**, and the
ginormous-slide clearance invariant is built on the result. So an interior
timber 4.5 m above the real parapet was read as the battlements,
`castleMasonryTopY` jumped **10.29 → 14.83 m**, and all five seeds failed —
with a completely honest green build, because CI gates that suite separately.

**The fix is the name, not a narrower pattern**, and the evidence is concrete:
the facade has **four** `castle-wall-*` bands (`-lower`, `-upper`, `-window`,
`-lintel`) and gained two of them long after the invariant was written, picking
them up for free. Enumerating them instead would make the check fail *unsafe* —
a fifth band would be silently excluded, the measured masonry top would read
low, and a slide that really does clip the battlements would pass.
Over-measuring costs a false failure; under-measuring costs a child hitting a
wall. So the interior is what stays clear of the pattern, and `check:castle`
asserts it (`naming: ... is an interior mesh whose name matches ...`), proved
red at exit 1 by putting the old name back.

**Run `npm run test:procgen` as well as `npm run build` before every push on
this branch.** They do not cover each other.

### Two more ways it could not fail, both found by review

Both were the same disease, and the one this file's own header forbids: **the
checker re-derived the thing it was checking instead of measuring it.**

**It sampled the segment's centre only.** The builder rejects a segment unless
its centre *and both ends* are over slab. Deleting the builder's hole test
outright produced 408 segments instead of 380 and the check still said OK — the
28 extra being exactly those whose *ends* overhang a shaft. It now takes each
placed instance's **measured world-space box** and samples a 5x5 grid over its
real footprint, so it follows `BEAM_SEGMENT` if that ever changes.

**It computed the timber's half-depth as `(CASTLE_CEILING_CLEAR -
BEAM_UNDERSIDE) / 2`** — algebraically `BEAM_DEPTH / 2`, *whatever geometry was
actually built*. Swapping two `BoxGeometry` arguments made every timber 0.70 m
deep, hanging to 2.60 m, 37 cm through a hatted child, with the check green. It
now calls `geometry.computeBoundingBox()` and transforms that box by each
instance matrix.

Proved red, both, before trusting either green:

```
$ # solidRun replaced with `return true`
check:castle — 28 failure(s):
  x beams: deck 0 segment 15 covers (0.50, -20.93), where deck 1 has a hole —
    part of it is fixed to a ceiling that is not there.
exit 1

$ # BoxGeometry(BEAM_SEGMENT, BEAM_WIDTH, BEAM_DEPTH) — two args swapped
check:castle — 761 failure(s):
  x beams: deck 0 segment 0 reaches 3.540 m, above the 3.300 m ceiling.
  x beams: deck 0 segment 0 hangs down to 2.840 m, which the tallest child
    (2.97 m) would walk into.
  x BEAM_UNDERSIDE says the timbers hang to 3.080 m, but the built mesh
    measures 2.840 m. The Artist sizes wall-standing props against that
    constant — fix the constant or fix the geometry.
exit 1
```

The last of those is the real prize: it is assertion 3's shape — reported
figure against measured figure — working on my own constant, which is the
evidence that the pattern will catch the Artist's `TABLE_TOP` and
`SCONCE_CUP_OFFSET` when they arrive.

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

### The design to build, decided but not yet written

**v1 is flames with no lights at all**, and that is a deliberate reading of the
brief rather than a corner cut. The whole cost of "warm and flickering" can be
paid by an emissive material:

- **Flames**: one `InstancedMesh` of squashed cones per storey, ~40 of them,
  `toonMaterial(flame, { emissive, emissiveIntensity })`, `castShadow = false`,
  `receiveShadow = false` (a self-lit thing is a decal by §7's table). **One
  draw call per storey, no lights, nothing in the shadow pass.**
- **Flicker**: one `update(dt)` writing **one** `emissiveIntensity` per storey.
  Not per instance — a single material shared by all forty flames, so the whole
  wall breathes together. No geometry touched, no material recompiled, no
  uniform array. This is as close to free as a per-frame effect gets.
- **Then measure**, and only then decide about `PointLight`s. If emissive alone
  reads as torchlight on stone, the lights never get added and the answer to
  #251 is that this feature cost nothing.

**Where a flame goes.** `SCONCE_MOUNT_Y` 2.10 m (mine) + the Artist's published
cup-mouth offset (0.000, 0.285, 0.3025) puts the flame's base at **2.385 m**,
0.3025 m out from the wall face. Until batch 1 lands, that offset has to be
typed into `castleFabric.ts` — which is the two-definitions trap, so it is
marked provisional there and `check:castle` gains assertion 4 against the
built mesh the day the sconce arrives. **Do not let that TODO survive the
batch-1 wiring.**

**The trap to avoid, which cost this branch an hour already.** Do not parent
`PointLight`s into a deck's floor group and assume the cutaway will switch them
off. The fader shows every storey **up to** the current one, not just the
current one, so lights parented per-storey would accumulate — six on the ground
floor becomes thirty by the roof. If lights are ever added they must be a fixed
pool of six that is *moved* to the storey the player is on, driven off
`Building.currentDeck`.

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
