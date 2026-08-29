# HANDOFF — 3D Artist, issue #363: the castle interior's assets

Branch `art/castle-interior-assets`, worktree `.claude/worktrees/castle-assets`.
Paired with the **castle Engineer** on `feat/castle-interior-363`, whose
`HANDOFF-castle-interior-363.md` §4 is the request contract. **This file is the
reply.** §2 is the part they must read.

Built **headlessly** through the Blender CLI, not the Blender MCP — another
Artist owns the one live Blender instance. Headless is unlimited and parallel
and is how the bridge and hotel assets were actually built.

---

## 0. Status

| | |
| --- | --- |
| Batch 1 (their §4.3, all ten assets) | ✅ built, exported, packed, rendered |
| `castle.glb` | 128 KB of a 200 KB budget; regenerating is byte-identical |
| Renders | `art/renders/castle/` — ten shots incl. an assembled hall |
| Sizes published | §2 below, measured off the mesh |
| Colour | **not mine** — the Engineer's, per their §4.1 |
| Batch 2 (their §4.6) | not started |

## 1. How to run it

```
npm run blend:castle     # build → export → pack. Must pass.
npm run render:castle    # review pictures into art/renders/castle/
```

- `art/blend/castle_build.py` is the **authoring source**. `castle.blend` is a
  generated artefact — edit the Python, never the file.
- **`castle.glb` regenerates byte-identical; `castle.blend` does not.** Blender
  writes a byte or two of its own into the `.blend` on every save, so a build
  leaves that one file dirty in `git status` and nothing else. Ignore it —
  `git checkout art/blend/castle.blend`. The file that ships is the `.glb`, and
  that one is reproducible, which is the property worth having.
- `art/blend/blendkit.py` is the shared toolkit (primitives, scene plumbing,
  `ts_const`, planar UVs). New Blender scripts import it; `hotel_build.py` and
  `bridge_stones_build.py` are deliberately grandfathered, because both have a
  shipped `.glb` whose size is asserted by its `pack:` step and re-pointing
  them would mean re-verifying two large binaries for no visible change.

---

## 2. RECONCILIATION — for §4.5 of the Engineer's contract

**Every figure below is measured off the built mesh by
`castle_build.py`'s `check_contract()`, and printed on every run.** None of them
is typed twice. Copy nothing from this table: re-derive it with
`visibleBounds()` the way your §4.4 protocol says, and if we disagree the build
should fail rather than the park being wrong.

### 2.1 Sizes, as built (W × H × D in metres, X × Y × Z in the game's frame)

| # | Asset | Asked | **Built** | Note |
| --- | --- | --- | --- | --- |
| A1 | armour | 1.10 × 2.60 × 0.80 | **1.01 × 2.60 × 0.78** | under on width and depth |
| A2 | plinth | 1.30 × 0.25 × 1.00 | **1.30 × 0.25 × 1.00** | exact |
| A3 | tapestry | 3.20 × 2.40 × 0.12 | **3.20 × 2.40 × 0.26** | ⚠️ depth renegotiated — see 2.3 |
| A4 | tapestryrail | 3.60 × 0.14 × 0.14 | **3.59 × 0.14 × 0.14** | finials included in the 3.60 |
| A5 | sconce | 0.34 × 0.46 × 0.42 | **0.23 × 0.45 × 0.41** | under on width |
| A6 | throne | 1.60 × 3.00 × 1.20 | **1.60 × 2.80 × 1.06** | your requested 2.80, not the 3.00 allowance |
| A7 | table | 2.20 × 1.05 × 6.00 | **2.20 × 1.05 × 6.00** | exact |
| A8 | bench | 0.60 × 0.55 × 2.80 | **0.60 × 0.55 × 2.80** | exact |
| A9 | feast | ≤ 0.45³ each | **0.44 × 0.42 × 0.44** overall | four props, each under |
| A10 | chest | 1.20 × 0.90 × 0.80 | **1.20 × 0.91 × 0.79** | +1 cm on height, inside tolerance |

### 2.2 The numbers your §4.4 says we must agree on, exactly

| Constant | **Value** | How to re-derive it |
| --- | --- | --- |
| `SCONCE_CUP_OFFSET` | **(0.000, 0.285, 0.3025)** m | `visibleBounds` of the `sconce-cup` node: x centre, **top** z, z centre. It is the middle of the cup's *mouth* — the flame's foot, not the cup's centroid. |
| `TABLE_TOP` | **1.050** m | `visibleBounds(table).top` |
| `BENCH_SEAT` | **0.550** m | `visibleBounds(bench).top` |
| Armour keep-out radius | **0.638** m | half-diagonal of the armour's XZ footprint; inside your 0.650 |
| Throne total on your dais | **3.10** m | 2.80 + your 0.30, so **0.20 m clear** of `CASTLE_CEILING_CLEAR` |
| Chest hinge axis | at the `chest-lid` node's own origin | it is the only non-identity node in the file; `lid.rotation.x` opens it |

`SCONCE_CUP_OFFSET` is in the **game's** frame (glTF), already converted from
Blender's — Blender (x, y, z) → glTF (x, z, −y). Getting that conversion wrong
in a handoff table is exactly the quiet 40-centimetre error the protocol exists
to prevent, so the conversion happens in code (`sconce_offset()`), next to the
measurement, and never in prose.

### 2.3 The one thing I changed, and why — please accept or refuse

**A3's depth allowance: 0.12 m → 0.26 m built.**

At 0.12 m a tapestry cannot be modelled as cloth. The sheet's own thickness is
0.04–0.05 of it, which leaves ±0.04 m of wave across a **3.2 m** span, and the
first review render showed exactly what that is: a dead flat maroon rectangle,
indistinguishable from a poster. The waves existed in the mesh and not in the
picture, which is the only place they were ever for.

Your own §5 rule 1 says wall furniture may project **up to 0.45 m** — less than
the wall's 0.45 m thickness — so 0.26 m is comfortably inside the rule the 0.12
was presumably a guess at, and it still narrows no route.

If you refuse it, one constant in `CONTRACT` changes and the billow with it —
say so and I will rebuild. **What I will not do is quietly leave the two
documents disagreeing**, which is the whole reason this section exists.

### 2.4 Node list — one `STYLES` entry needed per name

Your §4.2: a node you have no entry for throws at load. All 23:

```
armour-plate  armour-trim  armour-visor  armour-plume
plinth-block
tapestry-cloth  tapestry-fringe
tapestryrail-pole
sconce-bracket  sconce-cup
throne-frame  throne-gold  throne-cushion
table-top  table-legs
bench-plank
feast-goblet  feast-roast  feast-loaf  feast-pie
chest-body  chest-bands  chest-lid
```

**`tapestry-cloth` is the one node with a UV map**, spanning the requested
3.20 × 2.40 rectangle (not the billowed geometry's own bounds), so a picture
lands in the same place however the cloth is retuned. Everything else has no
UVs, because nothing else carries a picture.

Colours are yours. `art/blend/castle_render.py` carries a `PROPOSED` table
purely so the review renders are not grey, and it **parses your `STYLES` out of
`castleAssets.ts` the moment that file exists**, falling back to `PROPOSED` and
printing loudly that it has done so. It never copies your table. Three colours
were added to `ART` because the park had no metal at all and its two nearest
greys are carved rock and ice: `castleSteel`, `castleIron`, `castleTapestry`.
Use them or don't — that block in `artPalette.ts` is the only file we both
touch, so it is the merge conflict to expect.

---

## 3. What the build asserts about itself

`castle_build.py` fails rather than describing, and every assertion measures the
**emitted vertices**, never the numbers meant to produce them:

- **Origin family.** Every asset declares `FLOOR` / `WALL` / `AXIS` and must
  match: a floor asset's lowest vertex at z = 0 and its origin inside its own
  footprint; a wall asset entirely in front of the wall plane and centred on X;
  an axial one centred on its origin in all three. An asset in the wrong family
  is the one mistake a screenshot would not show.
- **The contract.** §2.1's table, asserted. Heights exact where you stack
  things (a goblet on a table, an armour on a plinth), widths and depths as
  maxima.
- **The ceiling.** No floor asset may reach `CASTLE_CEILING_CLEAR`. It is read
  from your `castleAssets.ts` with `ts_const` when that file lands, and until
  then falls back to your contract's 3.30 with a printed note saying so.
- **Export.** A node may carry a pure translation and nothing else; a stray
  rotation or scale fails. Only `chest-lid` carries one, and it is printed.

Three of these were red before they were green, on real mistakes: the brazier's
feet 15 mm through the floor, the chest lid measuring as if its hinge offset did
not exist (a stale `matrix_world` — `view_layer.update()` first), and a throne
finial 16 cm outside its width allowance.

---

## 4. What the renders showed that the build could not

All three faults passed every assertion and were obvious in a picture:

1. The armour's grounded sword ran **through** its own skirt, with the hands at
   its sides — it read as a knight standing next to a sword.
2. The tapestry was flat (see 2.3).
3. The throne read as an armchair: a broad back with a shallow arch is a
   comfortable chair, and no amount of gold changes that. A throne is the
   **step** — broad at the shoulders, then narrowing into a spire above the
   sitter's head — and the back cushion was 1.10 m tall and hid the spire.

The `FLOOR` origin check learned from this too. It first asserted a *symmetric*
footprint, and its immediate effect was to demand the sword go back inside the
skirt it had just been moved out of. It now asserts the origin is **inside** the
footprint, which is the property your keep-out disc actually depends on, and
lets an asset be honestly lopsided in depth.

---

## 5. Next

Batch 2, your §4.6, in the order I judge reads best per unit of work:
fireplace chimneypiece → chandelier → barrel → cauldron → helmet on a stand →
crossed swords → sack → bell → dragon egg in a nest → cobwebs → dropped
gauntlet → crown on a cushion → owl → arrow in a butt.

**The 200 KB budget will not cover both batches.** Batch 1 is 128 KB at 4 342
triangles, and this asset costs ~30 bytes a triangle because nearly every edge
is over the 46° split-normal threshold. Batch 2 needs either a raised budget
(the hotel took 640 KB for 19 factories) or its own `.glb`. **Your call — tell
me which before I build it**, because it changes how much shape each piece can
afford.

## 6. If you are picking this up cold

- Everything is committed and pushed. `npm run blend:castle` is the gate.
- The one thing not to do: change a size in this document. Change it in
  `CONTRACT` in `castle_build.py`, which is the only place any of these numbers
  exists, and let the build tell you what it broke.
