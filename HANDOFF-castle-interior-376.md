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
| Torch flames, soot, braziers, hearth fire | ⬜ |
| Banners, pennants, rug, runner, coat of arms, portcullis | ⬜ |
| Wonky portrait, dragon painting, mouse hole, cat, woodpile, crates | ⬜ |
| Armour turned to watch you | ⬜ blocked — needs batch 1 wired |
| The three prop assertions in `check:castle` | ⬜ |
| Screenshots to Jim | ⬜ |

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

*(Measured `renderer.info` before/after goes here.)*

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
