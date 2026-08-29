# HANDOFF — Engineer, issue #376: the castle is still sparse

Branch `feat/castle-interior-376`, worktree `.claude/worktrees/castle-interior-376`.
Paired with a **3D Artist** working the same issue.

**§4 is the asset request contract** — the part the Artist reads and reconciles
against. Everything else is context. It follows `HANDOFF-castle-interior-363.md`
§4, which is the worked precedent, and does not repeat it: **that document is
still live and still binding.** Read it first.

---

## 0. Status

| | |
| --- | --- |
| Brainstorm and contract published | ✅ §2, §4 |
| Torch flames, soot, braziers, hearth fire | ✅ `castleLighting.ts` |
| Banners, rug, coat of arms, portcullis | ✅ `castleDecor.ts` |
| Wonky portrait, dragon painting, mouse hole, cat, woodpile, crates | ✅ `castleDecor.ts` |
| **Roof garden (#380)** | ✅ troughs, shrubs, flowers round the parapet |
| Pennants, carpet runner | ⬜ **cut, deliberately** — see §2 |
| Armour turned to watch you | ⬜ blocked — needs batch 1 wired, which nobody owns |
| The three prop assertions in `check:castle` | ✅ red first, four real bugs, §6 |
| Screenshots to the Overseer | ✅ hall and roof |
| Cost measured | ✅ §5 |
| Ruling on the child-scale renegotiation | ✅ §8 |

### Two facts about the state of the world that change the plan

1. **PR #368 does not wire anything into the game.** Its diff is
   `art/blend/*`, `art/renders/*`, `src/art/assets/castle.glb`,
   `castleGlb.ts`, `ASSET_MANIFEST.md`, `kid.ts` and two scripts. There is **no
   `src/art/models/castleAssets.ts`** and **no placement code anywhere** —
   `git diff --name-only origin/main...origin/art/castle-interior-assets`.
   So batch 1 exists as bytes and as nothing else. Wiring it is the Engineer's
   half of the seam (§4.1 of the 363 contract) and it is currently unowned.
   **Flagged to the Overseer rather than silently absorbed**: it is a whole
   piece of work, it is what actually puts a throne in the room, and it wants
   deciding rather than assuming.

2. **Everything in my own list below needs none of it.** Lighting, cloth,
   paint, floor treatment and the reused pets are primitives and canvas
   textures. So this branch is not blocked on #368 and does not touch its
   files — except for one item, the armour that turns to watch you, which is a
   single yaw on an asset that is not placed yet.

### The one number I take back off the Artist

`HANDOFF-castle-interior-363.md` §4.4 asked the Artist for
`SCONCE_CUP_OFFSET` and then had the Engineer copy it into `castleFabric.ts`
"provisionally". **That direction is wrong and I am reversing it.** The flame
is mine, and where a flame sits is the thing the room is judged on, so:

> **{@link CASTLE_TORCH_CUP} in `castleLighting.ts` is the single definition of
> where a torch's fire is.** The sconce is positioned *to* it. The Artist does
> not report a cup offset for me to copy; the sconce's cup is built to land on
> mine, and `check:castle` measures the built sconce against it when batch 1 is
> wired.

One owner, one number, and the copy that was going to be typed into a second
file never exists. This supersedes the `SCONCE_CUP_OFFSET` row of 363 §4.4 and
entry 2 of its reconciliation log.

---

## 1. What is actually wrong with the room

Measured, not assumed. On `origin/main` a castle storey contains: flagstones,
coursed walls, a timber wall-plate, a roundel with ten planters, eight benches
and the shop units. That is **five kinds of thing** across 2 640 m².

Two specific gaps, and they are the ones worth attacking first:

- **The upper third of frame is empty.** The wall is solid to 2.15 m, glass to
  3.26, trim to 3.60, and the only object above 2.15 m anywhere in the room is
  the wall-plate. At the game's 38° camera that band is roughly a third of the
  picture and it is currently a flat tint.
- **Nothing in the room emits, moves, or reacts.** Every surface is lit by the
  same fixed directional key from the same corner for ever. A room where
  nothing changes reads as a render, not a place.

Hence the order in §3: **light first, then the upper band, then the jokes.**

---

## 2. The brainstorm — what I am building, and why each one earns its place

`E` = mine. `A` = Artist. Ordered by delight per unit of work, which is the
same standard the 363 handoff used and the reason it got the mouse right.

### Tier A — the room stops being a render (all mine, no Blender)

| # | Thing | Why |
| --- | --- | --- |
| 1 | **Torch flames** — one instanced emissive mesh per storey, ~40 flames, **no lights at all** | The one thing that makes a castle feel like a castle rather than look like one. Designed in 363 §7 and never built. |
| 2 | **The flicker** — one `emissiveIntensity` per storey, written per frame | The only thing in the room that moves. As close to free as a per-frame effect gets: one float, no geometry, no recompile. |
| 3 | **Soot marks above every torch** | Costs a 256² texture and one instanced decal per deck, and it is the whole difference between a torch that was put there and a torch that has burned for a century. Placed from the **same anchors as the flames**, so a torch cannot move without its soot. |
| 4 | **Braziers** — tripod and bowl in primitives, fire from the same instanced flame mesh | The middle of a 60 × 44 m plate is where wall torches cannot reach, and it is where the room reads emptiest. |
| 5 | **Hearth fire** | Anchored at `CASTLE_HEARTH`, exported for the Artist's chimneypiece to be built around. Where the cat sleeps. |

### Tier B — the upper third of frame (all mine)

| # | Thing | Why |
| --- | --- | --- |
| 6 | **Banners** hung the length of the wall under the plate, heraldry painted into a canvas texture | Fills the band identified in §1 as empty. Long thin cloths on a wall are three vertices' worth of geometry and the largest visual change available after the flames. |
| 7 | **Pennants** — small triangles in a run between the banners | Rhythm. A wall of nothing but banners is a wall of banners. |
| 8 | **Coat of arms over the front door** | The first thing you see on the way in, and it says whose castle it is. |
| 9 | **Portcullis over the front door** | Instanced bars. Says "castle" from the threshold. |

### Tier C — floor treatment (all mine)

| # | Thing | Why |
| --- | --- | --- |
| 10 | **Big round rug on the roundel** | Goes over a keep-out that already exists, so it costs no new placement rule at all. |
| 11 | **Carpet runner** from the doorway lane toward the dais | Draws the eye down the hall and tells a child where to walk. |

### Tier D — the things that reward looking twice (all mine)

The previous engineer's standard, kept: *Eleri will remember the mouse longer
than the throne.* This tier is why the issue was raised, not garnish.

| # | Thing | Why |
| --- | --- | --- |
| 12 | **The wonky portrait** | Boxes and a canvas, hung 4° off level. **The joke is the 4°** — the same picture hung straight is furniture. |
| 13 | **A dragon painting** | Same construction, different canvas. Eleri bait. |
| 14 | **A mouse hole in the skirting, with `pets.ts`'s mouse peeking out** | Hidden, small, and a character she already knows. No new asset. |
| 15 | **A cat asleep by the fire** — `createPet('kitten')`, curled | No new asset, no commission, and it is the single most-loved thing on the list per byte spent. |
| 16 | **A suit of armour turned to watch you** | One yaw value. Blocked on batch 1 being wired; recorded so it is not lost. |
| 17 | **Woodpile and crates** | Instanced cylinders and boxes. A castle with tidy corners is a lobby. |

### Rejected, with reasons, so nobody re-proposes them

- **Any `PointLight` at all, in v1.** Issue #251 has the shadow pass at 57% of
  draw calls and the fader shows *every* deck up to the current one, so
  per-storey lights accumulate to thirty by the roof. Emissive first, measure,
  and only then decide. See §5.
- **A collider on anything.** Indoor collision is height-blind (363 §5.3) — a
  collider on deck 0 blocks that XZ on all five storeys.
- **Anything hanging into the room.** 3.30 m ceiling, 2.97 m hatted child, and
  3.08 m within 0.40 m of a wall. **Nothing in this room may loom.** Settled;
  not relitigated.
- **Decorating the stairs.** Issue #377: Jim has ruled the lift becomes the
  only way between floors. Do not dress a thing that is being deleted.

---

## 3. Order I am working in

1. ~~Publish this~~ ✅ — unblocks the Artist.
2. Flames, flicker, soot, braziers, hearth. Measure `renderer.info` before and
   after and **write the number down**. **Screenshot.**
3. Banners, pennants, coat of arms, portcullis, rug, runner. **Screenshot.**
4. Portraits, mouse hole, cat, woodpile, crates. **Screenshot.**
5. The three outstanding `check:castle` prop assertions, each proved red and
   the message quoted here.
6. `npx tsc --noEmit`, full unpiped `npm run build`, `npm run test:procgen`.
7. PR referencing #376. **Do not merge.**

---

## 4. THE ASSET REQUEST CONTRACT — batch 2

### 4.1 The seam, unchanged

Exactly as `HANDOFF-castle-interior-363.md` §4.1 and §4.2. Metres, origin at
the base centred on X and Z, facing +Z, `scale` left at 1, one node per
distinctly-coloured part named `<asset>-<part>` in lower-kebab, no colour and
no material in the `.glb`, chunky and rounded, toon ramp only.

**Batch 2 gets its own `.glb`**, per the Overseer's ruling: `castle.glb` is
128 KB of a 200 KB budget. Budget for `castle2.glb`: **200 KB**, 60 KB per
asset.

### 4.2 The four numbers I own, and which the Artist builds against

Every one is **exported from my code** and asserted by `check:castle` against
the built mesh. None of them is to be re-typed anywhere.

| Constant | Value | Module | Means |
| --- | --- | --- | --- |
| `CASTLE_CEILING_CLEAR` | 3.30 m | `castleFabric.ts` | Nothing standing on a floor may reach it. |
| `BEAM_UNDERSIDE` | 3.08 m | `castleFabric.ts` | The limit **within 0.40 m of a wall**. |
| `SCONCE_MOUNT_Y` | 2.10 m | `castleFabric.ts` | Where a wall bracket's back plate lands. |
| **`CASTLE_TORCH_CUP`** | **see the module** | **`castleLighting.ts`** | **New, and it replaces `SCONCE_CUP_OFFSET`.** The offset from the sconce's back plate to the **base of the flame**, in the game frame. The Artist builds the cup so its mouth lands here. See §0. |
| `CASTLE_HEARTH` | see the module | `castleLighting.ts` | Where the fire is. The chimneypiece is built round it, not the other way about. |

### 4.3 Batch 2 — requested now

`W×H×D` in metres, X × Y × Z. Sizes are **my proposals**; where the Artist has
started at a different size, publish yours and I reconcile in §4.4 rather than
either of us assuming. **Recognisability beats proportion** (Jim's standing
rule), and Jim has since ruled the furniture is **child-scaled** so Eleri can
sit on it and reach it — a bench she cannot climb is a bench she cannot use.

| # | Asset | Node prefix | W × H × D | Origin | Facing | Instances | Sits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | **Fireplace chimneypiece** — a big stone hood and jambs, **open at the front and hollow inside**; no fire, no logs, no grate — those are mine | `hearth-` | 3.40 × 2.60 × 1.10 | base, centred on the opening | +Z (opening faces +Z) | 1, deck 0 | Against the north wall, built round `CASTLE_HEARTH`. **Must clear 3.08 m: it stands against a wall.** |
| B2 | **Cauldron on a tripod** | `cauldron-` | 1.10 × 1.20 × 1.10 | base, centred | any | 2 | Beside B1 and one in a corner |
| B3 | **Barrel** | `barrel-` | 0.90 × 1.10 × 0.90 | base, centred | any | ~10 instanced | Corners, decks 0–2 |
| B4 | **Sack**, slumped, tied at the neck | `sack-` | 0.80 × 0.90 × 0.80 | base, centred | any | ~10 instanced | With B3 |
| B5 | **Crossed swords on a wall mount** | `swords-` | 1.60 × 1.30 × 0.16 | **the wall face**, back plate at z = 0 | out along +Z | 4 | y = 2.10 m, between banners |
| B6 | **Shield wall** — three shields on a rack | `shieldwall-` | 2.40 × 1.20 × 0.20 | the wall face | +Z | 3 | y = 1.40 m |
| B7 | **Helmet on a stand** | `helmstand-` | 0.60 × 1.40 × 0.60 | base, centred | +Z (visor forward) | 3 | Beside the armour |
| B8 | **Dragon egg in a nest** — the egg a **separate node** so I can make it do something | `egg-` | 0.80 × 0.80 × 0.80 | base, centred | any | 1 | Deck 2, a corner, findable and not signposted |
| B9 | **Owl**, asleep, feet apart to grip | `owl-` | 0.50 × 0.60 × 0.45 | **base, at the feet** | +Z | 2 | On the wall-plate at `BEAM_UNDERSIDE`. **Total 0.60 m against a 3.30 m ceiling from a 3.08 m perch: it must not exceed 0.22 m… so it does not go on the plate.** Resolved: it perches on B1's mantel instead. Height limit therefore 0.60 m and no ceiling problem. |
| B10 | **Cobweb**, a corner quarter-disc with sag | `cobweb-` | 1.20 × 1.20 × 1.20 | **hang point at the corner apex**, geometry below and inward | corner along −X−Z | ~8 instanced | Wall/ceiling corners only, where nobody walks |
| B11 | **Dropped gauntlet** | `gauntlet-` | 0.35 × 0.16 × 0.45 | base, centred | +Z | 1 | Beside the armour that turned to look at you (#16). The punchline; do not ship the joke without it. |
| B12 | **Crown on a velvet cushion** — crown a separate node | `crown-` | 0.55 × 0.45 × 0.55 | base, centred | any | 1 | Beside the throne |
| B13 | **Arrow in a target butt** | `butt-` | 1.20 × 1.30 × 0.70 | base, centred | face on +Z | 1 | Deck 1 |
| B14 | **Chandelier** — iron candle wheel on a chain. **Candles a separate node**: I light them, you do not | `chandelier-` | 2.20 × 1.60 × 2.20 | **hang point at the top of the chain**, all geometry below y = 0 | any | 2 | See the hard limit below |
| B15 | **Bell on a beam** | `bell-` | 0.70 × 0.90 × 0.70 | hang point | any | 1 | Same limit as B14 |

**B9's entry above is left with its own working shown on purpose.** I wrote it
against the wall-plate, noticed while writing the row that 3.08 + 0.60 is
3.68 m and would put an owl 38 cm inside the slab, and moved it to the mantel
rather than shipping the row and letting the check find it. It is recorded
because the next person to want something on that plate will do the same sum.

**The hard limit on B14 and B15, and it is tighter than it looks.** A hanging
asset's *bottom* must be at or above 3.30 m — which is the ceiling — so
**nothing may hang into the room at all** unless it hangs where nobody can
stand. So B14 and B15 hang only over the roundel's middle and over the table:
both are keep-outs already, and `check:castle` assertion 3 tests exactly that
rather than trusting this paragraph. **Total drop from the hang point: 1.60 m
maximum**, giving a bottom at 1.70 m over ground nobody stands on. If that
reads as too low from the 38° camera, tell me and I will move the anchor, not
weaken the rule.

### 4.4 Reconciliation log

*(Empty. Entries go here as the Artist publishes figures, in the form
`HANDOFF-castle-interior-363.md` §4.5 uses: figure, Artist's number, mine,
ruling, reason.)*

---

## 5. Lighting — the design, and its measured cost

Built as designed in `HANDOFF-castle-interior-363.md` §7, which is quoted here
only far enough to say what is load-bearing:

- **One `InstancedMesh` of flames per storey.** One draw call per storey, in
  the storey's own floor group so the cutaway fades it with everything else.
- **No lights.** Not one, in v1.
- **One `emissiveIntensity` per storey per frame.** A single material shared by
  every flame on that storey, so the whole wall breathes together.

**The trap the 363 handoff did not name, and it would have eaten the flicker.**
`FloorFader.addLayer` **claims materials by identity and clones any material a
later layer shares** (`floorFade.ts`). One flame material shared across all
five storeys would therefore be silently cloned four times, my per-frame write
would land on the original, and **four storeys out of five would not flicker**
— with the code, the material and the mesh all looking correct on inspection.
It is the hood-face bug's shape exactly. So: **a distinct material per storey**,
which is what the design wanted anyway for a different reason, and the
per-storey handles are what `update` writes to.

Ordering matters for the same reason: flames are added inside `dressDeck`,
which `Building` calls **before** `fader.addLayer`.

### Measured

Off the built scene, not off `renderer.info` — and the difference is worth
stating, because it is a weaker measurement in one way and a stronger one in
another. The production build exposes no renderer handle (`window.game` is
`import.meta.env.DEV`-only), so what is counted here is **every drawable this
feature adds to a storey's floor group, and every triangle in it**. That is an
upper bound on the draw calls: it counts a mesh the frustum may cull, and it
does not know about the renderer's own batching. It is also exact about the two
numbers that actually mattered.

| Storey | Draw calls added | Triangles added |
| --- | --- | --- |
| 0 (great hall) | 37 | 16 916 |
| 1 | 14 | 3 366 |
| 2 | 14 | 3 534 |
| 3 | 13 | 3 504 |
| 4 (roof garden) | 3 | 19 388 |
| **Total** | **81** | **46 708** |

**Shadow casters added: 0. Lights added: 0.** Those are the two the design was
about, and both are exactly what it promised. Issue #251 has the shadow pass at
57% of draw calls, so a feature that adds nothing to it costs nothing there —
**the answer to #251 for the castle's lighting is that it was free.**

Three notes on the numbers that a summary would hide:

- **Only one storey is drawn at full weight.** The cutaway fades every storey
  above the player, so the 37 is what a child standing in the great hall pays,
  not a total.
- **Deck 0's 37 is high because of the cat and the mouse.** `pets.ts` builds a
  creature out of about fifteen separate meshes, and reusing it means taking
  that shape as it is. It is worth it — no new asset, no commission, and two
  characters Eleri already knows — but it is two thirds of that storey's draw
  calls for two of its objects, and it is the first thing to look at if the
  castle ever needs a frame back.
- **The roof's 19 388 triangles come from 504 shrub and flower instances in 3
  draw calls.** Both spheres were dropped a segment ring after the first
  measurement (10×8 → 8×6, 8×6 → 6×4), which halved that figure and is invisible
  on a 0.34 m bush.
- **The pets were the only 8 shadow casters this feature added**, because
  `pets.ts` builds for daylight in the park. They are taken out of the pass by
  walking the built tree, so a pet gaining a part is covered without anybody
  remembering.

---

## 6. The three prop assertions

`check:castle` announces on every run that nothing in it measures a prop. That
stops being true on this branch. Each is proved red before being trusted green,
and the red message is quoted.

1. **No decoration intersects a walkable route or a shop stand** — measured XZ
   footprint against `keepOutsFor(deck)` inflated by `PLAYER_RADIUS`.
   `keepOutsFor` is not currently exported; exporting it is how this assertion
   avoids being a second copy of the placement rules.
2. **Nothing pierces the ceiling, and nothing hangs into head height** —
   measured `visibleBounds` against `CASTLE_CEILING_CLEAR`, or against
   `BEAM_UNDERSIDE` within 0.40 m of a wall.
3. **Every torch's soot mark is on the same wall as its flame** — the anchors
   are one list, so this asserts that the two consumers of it agree. It is the
   reported-versus-measured shape pointed at my own code.

*(Red output goes here.)*


---

## 8. Ruling: the child-scale renegotiation (batch 1, PR #368)

**I accept all three of the Artist's figures.** `BENCH_SEAT` 0.550 → **0.360**,
`TABLE_TOP` 1.050 → **0.675**, throne seat 0.880 → **0.360**. The named 0.42
fallback is **declined**. One condition, in §8.2, and it is not optional.

### 8.1 Why

- **It is derived from measured landmarks in the rig's owner, not from an eye.**
  That is the standard every other number on this branch is held to, and the
  Artist's own root-cause finding is the decisive part: **`kid.ts` published no
  landmark below the neck**, so batch 1 could not have been cut any way other
  than adult-proportions-by-eye. The fix for that is the landmark, and once the
  landmark exists the furniture follows from it. Declining the figures would be
  keeping a guess in preference to a measurement because the guess arrived
  first.
- **The no-knee argument makes 0.36 exact rather than approximate,** and that is
  a much stronger claim than "0.36 looks right". A rig with no knee joint has
  *one* seat height at which its feet reach the floor; every other value is a
  choice between dangling feet and legs through the floor. There is nothing to
  trade off, so there is nothing to compromise on.
- **`KID_REACH_HEIGHT` 1.04 against a table top of 1.05 settles it on its own.**
  A table one centimetre above the highest a child can reach is not a
  proportion I get to have an opinion about — it is the exact failure Jim's
  ruling was about, stated as a number. It is also, note, the *same shape of
  fault* as this branch's own flame overrun: a figure derived correctly and then
  invalidated by a second step nobody re-checked.
- **0.675 is bracketed from both sides and two independent derivations land
  inside the bracket.** A number with a floor (~0.62, thighs under a 0.14 m
  slab) and a ceiling (~0.72, a hand laid flat) is a far better answer than a
  number with neither.

### 8.2 Why the 0.42 fallback is declined, and it is not a close call

The fallback is offered as *park consistency* — the hotel chair's line. But the
hotel's furniture was built **before any below-neck landmark existed either**.
So 0.42 is not consistency with a measurement; it is consistency with the same
guess, made in a different file. Citing 0.74/0.42/0.50 as corroboration proves
the castle's 1.05/0.55 were outliers — which I accept, and which argues *for*
the change — but it cannot also serve as evidence that 0.42 is right, because
nothing measured a child against it.

If park consistency turns out to matter more than a child's feet reaching the
floor, that is **Jim's call and not mine**, and it should be taken on the hotel
and the castle together rather than by holding one room back.

### 8.3 The condition

**`KID_HIP_HEIGHT` and `KID_REACH_HEIGHT` must be read out of `kid.ts` at
asset-build time, the way `art/blend/hotel_build.py` already reads
`TALLEST_CHILD_HEIGHT` and `RIDER_HEADROOM`. Not typed into the `.py`.**

This is outstanding item 1 of `HANDOFF-castle-interior-363.md` §4.5 entry 3 —
the render script's scale post says 1.86 m under a comment claiming it came from
`TALLEST_CHILD_HEIGHT`, and the real figure is 2.97. Every size judgement made
against that post was wrong, and a 2.60 m suit of armour was called *towering*
while being shorter than a child in a tall hat.

Accepting two new hand-typed constants into the same script would replace one
stale number with three. The pattern exists in this repo precisely so a `.py`
cannot drift from the game, and a typed copy there is invisible to `tsc` and to
every check we have. **`check_child_can_use_it` is excellent and does not cover
this**: it would go on asserting, correctly and forever, that the furniture
matches the numbers the script was given.

Second, smaller: `check_child_can_use_it` has to run where `npm run build` runs
it. A Blender-side assertion that only fires when somebody regenerates the
`.glb` is not a gate on the repo.

### 8.4 Furniture built to be climbed on is a third collision category, and it is mine

The Artist is right to raise it and right that it is mine. Recording the rule
here so it survives into #377's collider pass:

> **A bench, a throne seat and a table top are things a child is *meant* to get
> onto. A blocking collider on one turns the single object built to be sat on
> into a wall.** They take a **jump-on plate**, the way `hotel/place.ts` already
> places props, and never a blocking body.

That has a consequence for `check:castle` that is worth writing down before
somebody hits it: **assertion 1 would currently fail a bench**, because a bench
is a solid object standing in a room where children walk, which is exactly what
that assertion exists to catch. It must gain a fourth exemption when batch 1 is
wired — and, like the other three, a **measured** one rather than a named one:

> Something whose measured top surface is at or below `KID_HIP_HEIGHT` plus a
> step is furniture a child steps onto, not an obstacle she walks into.

That criterion is available today only because the Artist published
`KID_HIP_HEIGHT`. Before this renegotiation there was no measurable way to state
the difference between "a bench" and "a low wall", which is worth noticing: the
landmark buys the *check* something as well as the furniture.

---

## 9. What #380 changes about this list, and what it does not

Jim has cut the castle to three floors — **mall / great hall / roof garden**.
This branch lands before that, on the five-deck castle, so:

- **The roof garden is built** (§2 gained it; `dressRoofGarden`). It is the one
  piece of #380 that is additive rather than a rearrangement, so it was worth
  doing now.
- **The hall dressing is currently on deck 0** — hearth, cat, woodpile,
  portcullis, coat of arms — because deck 0 is where the front door is. Under
  #380 those belong on the **middle** floor with the throne and the feast table,
  and the ground floor becomes the mall. **That is a one-line move**: they are
  all inside `if (deck === 0)` in `dressCastle`, deliberately, so whoever lands
  #380 changes one condition rather than hunting placements.
- **Banners, torches, soot, paintings, crates and the rug are per-storey and
  need no change at all.** They are placed off `castleTorchAnchors(deck)` and
  `keepOutsFor(deck)`, both of which follow the plan wherever it goes.
- **Nothing here decorates a stair or an escalator**, which #377 and #380 are
  deleting.

### Revisions to §2 and §4 that #380 justifies

- **More fire and more cloth in the great hall, less on the mall floor.** A mall
  wants shopfront character, and shops already bring their own. Once the floors
  have identities, `storeyHeraldry` should become *hall* heraldry rather than a
  per-deck cycle.
- **Batch 2's B14 chandelier and B15 bell become hall-only**, which removes the
  awkwardness in §4.3: they only ever had two legal places to hang, and both are
  in the hall.
- **The roof garden wants one batch-2 asset it does not have**: something to sit
  *at* rather than on. A parasol or an arbour. Not requested yet — the roof
  reads as a garden already, and it is better to see it with the family first.

---

## 10. Known gaps, in the order I would pick them up

1. **Batch 1 is still not wired into the game and nobody owns it** (§0). This is
   the biggest single thing missing from the castle: the throne, the table, the
   armour and the tapestries exist as bytes in `castle.glb` and are in no scene.
2. **The armour turned to watch you, and its dropped gauntlet**, blocked on (1).
   One yaw value once there is an armour to yaw.
3. **Pennants and the carpet runner, cut.** The runner's honest route is door →
   lift, which #377 is about to make the *only* route — so it is worth doing
   *after* that lands, when it is wayfinding rather than decoration. Pennants
   lost to the draw-call budget against a second heraldry texture, and would be
   better spent on the hall once it exists.
4. **Colliders**, once #377's split hands them back. In priority order: the
   **braziers** (a fire a child can stand inside is the only genuinely wrong one
   here), then the **crates** and the **woodpile** and the **hearth**. The
   banners, soot, arms, paintings, portcullis and rug want none — they are wall
   and floor treatment. The **cat and the mouse want none either**: walking
   through the cat is better than a child being bounced off it.
