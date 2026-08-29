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
| Renders | `art/renders/castle/` — **twelve** shots incl. an assembled hall, `throne-beam.png` and `lineup.png` (all ten in elevation against both scale posts) |
| Sizes published | §2 below, measured off the mesh |
| **Furniture child-scaled** | ✅ **§2.10** — `BENCH_SEAT` 0.55 → **0.36**, `TABLE_TOP` 1.05 → **0.675**, throne seat 0.88 → **0.36**. Jim's ruling of 29 Aug. **Awaiting the Engineer's acceptance — they are that side's §4.4 constants** |
| Gates | `blend:castle` 0, `.glb` byte-identical on re-run, `tsc` 0, full `npm run build` 0 (incl. `check:park-boot`, `check:castle`, `check:character-parity`), `test:procgen` 453 passed |
| Colour | **not mine** — the Engineer's, per their §4.1 |
| Batch 2 (their §4.6) | not started |
| Base | rebased onto `origin/main` **after #370 merged** — `castleFabric.ts` is now present and read, §2.9 |

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
| A1 | armour | 1.10 × 2.60 × 0.80 | **1.01 × 2.60 × 0.78** | under on width and depth; **2.85 m on its plinth is 0.12 m *shorter* than a hatted child — see §2.8** |
| A2 | plinth | 1.30 × 0.25 × 1.00 | **1.30 × 0.25 × 1.00** | exact |
| A3 | tapestry | 3.20 × 2.40 × 0.12 | **3.20 × 2.40 × 0.26** | depth renegotiated and **you approved it**; build now enforces 0.26 |
| A4 | tapestryrail | 3.60 × 0.14 × 0.14 | **3.59 × 0.14 × 0.14** | finials included in the 3.60 |
| A5 | sconce | 0.34 × 0.46 × 0.42 | **0.34 × 0.46 × 0.41** | ⚠️ rebuilt — now at the allowance, see §2.5 |
| A6 | throne | 1.60 × 3.00 × 1.20 | **1.60 × 2.75 × 1.06** | ⚠️ 2.75, not your 2.80 — the wall-plate, see §2.4 |
| A7 | table | 2.20 × 1.05 × 6.00 | **2.20 × 1.05 × 6.00** | exact — but the top is **above a child's shoulders**, §2.8 |
| A8 | bench | 0.60 × 0.55 × 2.80 | **0.60 × 0.55 × 2.80** | exact — but the seat is **0.19 m above a child's hip**, §2.8 |
| A9 | feast | ≤ 0.45³ each | **0.44 × 0.42 × 0.44** overall | four props, each under |
| A10 | chest | 1.20 × 0.90 × 0.80 | **1.20 × 0.91 × 0.79** | +1 cm on height, inside tolerance |

### 2.2 The numbers your §4.4 says we must agree on, exactly

| Constant | **Value** | How to re-derive it |
| --- | --- | --- |
| `SCONCE_CUP_OFFSET` | **(0.000, 0.285, 0.2475)** m ⚠️ **moved — was 0.3025** | `visibleBounds` of the `sconce-cup` node: x centre, **top** z, z centre. It is the middle of the cup's *mouth* — the flame's foot, not the cup's centroid. |
| `TABLE_TOP` | **0.675** m ⚠️ **moved — was 1.050. Needs your ruling, §2.10** | `visibleBounds(table).top` |
| `BENCH_SEAT` | **0.360** m ⚠️ **moved — was 0.550. Needs your ruling, §2.10** | `visibleBounds(bench).top` |
| Armour keep-out radius | **0.5052** m ⚠️ **corrected — was 0.638** | `max(hypot(x, z))` over every emitted vertex, i.e. about the **origin**, which is where a keep-out disc is centred. The old 0.638 was the half-diagonal about the *footprint centre*, which is a different point — the armour grounds a sword, so its origin is 0.040 m off centre. Still inside your 0.650. |
| Throne total on your dais | **3.05** m ⚠️ **was 3.10** | 2.75 + your 0.30. 3.10 stood **2 cm through your 3.08 m `BEAM_UNDERSIDE`** — see §2.4 |
| Chest hinge axis | at the `chest-lid` node's own origin | it is the only non-identity node in the file; `lid.rotation.x` opens it |

`SCONCE_CUP_OFFSET` is in the **game's** frame (glTF), already converted from
Blender's — Blender (x, y, z) → glTF (x, z, −y). Getting that conversion wrong
in a handoff table is exactly the quiet 40-centimetre error the protocol exists
to prevent, so the conversion happens in code (`sconce_offset()`), next to the
measurement, and never in prose.

### 2.3 The tapestry depth — asked for, and now approved

**A3's depth allowance: 0.12 m → 0.26 m built.**

At 0.12 m a tapestry cannot be modelled as cloth. The sheet's own thickness is
0.04–0.05 of it, which leaves ±0.04 m of wave across a **3.2 m** span, and the
first review render showed exactly what that is: a dead flat maroon rectangle,
indistinguishable from a poster. The waves existed in the mesh and not in the
picture, which is the only place they were ever for.

Your own §5 rule 1 says wall furniture may project **up to 0.45 m** — less than
the wall's 0.45 m thickness — so 0.26 m is comfortably inside the rule the 0.12
was presumably a guess at, and it still narrows no route.

**Settled, 29 August.** You approved 0.26 in your §4.5 ("Approved. Change
it."). One correction to the record on my side: `CONTRACT` was enforcing
**0.28** while this section asked you for **0.26** — the two documents were 2 cm
apart, inside the section whose entire job is to stop that, which is as clean an
illustration of the failure mode as this repo has produced. The build now
enforces 0.26 and there is no slack only one document knows about.

**One caveat on my own justification, so nobody inherits it wrong.** I claimed
the depth was what stopped the cloth reading as a poster. Looking again at
`tapestry-elevation.png` head-on, and at both hall shots at gameplay distance,
it is *still* essentially a flat maroon rectangle — the billow buys a silhouette
from a ¾ angle and almost nothing from the front. **The thing that will make
these read as cloth is your heraldry texture over the UVs**, not the geometry.
`tapestry-cloth` carries the UV map spanning the requested 3.20 × 2.40 rectangle
for exactly that. Do not conclude the depth was the fix.

### 2.4 The throne, the wall-plate, and what your 3.08 m actually caught

**This is the one that needs your ruling.**

Your `BEAM_UNDERSIDE` (3.08 m, added 29 August after the wall-plate) superseded
the 3.30 m I was building against. On your 0.30 m dais my 2.80 m throne stood at
**3.10 m — 2 cm through the beam**.

The 2 cm was the small half. **The real defect was that nothing here could see
it**: `check_contract` asserted the *bare mesh* (2.80) against the headroom,
while the dais existed only as prose in a docstring. So when your
`castleAssets.ts` lands and the headroom drops to 3.08, the assertion would have
gone on passing while the throne stood through your beam. Three changes:

1. **`Requested` now carries the mount**, so what is asserted is what has to
   clear. `stands_on` names another asset here and its **measured** top is
   used — the armour on the plinth, the feast on the table — so nothing is
   typed twice. `dais=0.30` is the one figure I cannot measure because you
   build it; it is the only typed number in the table and it is called out as
   one.
2. **`CEILING_CLEAR_FALLBACK` 3.30 → 3.08.** Every floor asset is checked
   against the tighter number, not only those within 1.25 m of a wall. Not
   because they all go against a wall but because they all *may*, and an asset
   that only fits in the middle of the room carries an unwritten placement rule.
3. **The throne is 2.75 m**, so 3.05 m on your dais, clearing by 0.03 m.

**Your call, and it is genuinely yours:** if you would rather have 2.80 m of
throne and a 0.25 m dais, say so and I will rebuild — it is one constant. What
matters is that it is now asserted rather than assumed, and that if the dais
ever grows a step the build goes red instead of a finial going through a beam.
`throne-beam.png` is the picture: throne, dais, wall-plate, square on.

**Two asks at the seam, both small and both about numbers I currently cannot
read:**

- **Export `BEAM_UNDERSIDE` and `CASTLE_CEILING_CLEAR` as plain literals.**
  `ts_const` reads `export const NAME = <number>;` and nothing else — by design,
  so it cannot silently return a default. Both of yours are *derived*
  (`BEAM_UNDERSIDE = CASTLE_CEILING_CLEAR - BEAM_DEPTH`), so the regex will not
  match them **even once your file lands**, and my "the moment your module
  exists this reads it" promise cannot currently be kept. Until then I fall back
  to 3.08 and print that I have. If you would rather keep them derived, export a
  literal mirror for tooling to read and assert the two agree on your side.
- **Export the dais height** the same way, and I will stop typing 0.30.

### 2.5 The sconce is rebuilt, and `SCONCE_CUP_OFFSET` has moved

**Read this one — you have the old number typed into `castleFabric.ts`.**

`SCONCE_CUP_OFFSET` is now **(0.000, 0.285, 0.2475)**, was (0.000, 0.285,
0.3025). **Only Z moved**; the cup's mouth height is deliberately unchanged, so
your flame's base is still at `SCONCE_MOUNT_Y` + 0.285 = 2.385 m and only its
distance from the wall changes, 0.3025 → 0.2475 m. Your §7 marks that figure
provisional pending assertion 4 against the built mesh — this is exactly the
TODO you said must not survive the batch-1 wiring, so please land the assertion
rather than re-typing the new number.

**Why it moved.** The sconce was built 0.23 m wide against your 0.34 m
allowance — 32% under, and the only asset meaningfully under in the dimension
that decides whether a thing reads. At ~40 instances it is the most-repeated
object in the room, and in the hall shots it was a dark smudge. Jim's standing
rule is that recognisability beats proportion, so it is now at the full 0.34 m:
the cup grows to the allowance, and the reach comes in from 0.28 to 0.225 to pay
for it inside your 0.42 m depth. All three dimensions are now at the allowance
(0.34 × 0.46 × 0.41), so **there is nothing left to spend here without you
widening the allowance** — worth knowing if your flame turns out not to carry it.

### 2.6 Two things the pictures found that you should see

**1. Your wall-plate may occlude the sconces from the game's own camera.** At
the 38° camera elevation, the sightline grazing the plate's inner-bottom edge
lands on the wall at almost exactly **2.10 m** — your `SCONCE_MOUNT_Y`. In
`hall.png` (38°) the sconces are right on the edge of being hidden by it; in
`hall-low.png` (16°) they are perfectly clear. I have not changed anything for
this because the plate and the mount height are both yours, but it is worth 20
minutes before you instance 40 of them. Dropping `SCONCE_MOUNT_Y` a little, or
narrowing the plate, would both do it.

**2. The armour does not tower over a child, and a stale number said it did.**
`castle_render.py` drew its scale post at a typed **1.86 m** under a comment
claiming the figure came from `TALLEST_CHILD`. It did not. From `kid.ts`: a
child is **2.12 m** (`KID_HEIGHT`) and **2.97 m** in the tallest hair-and-hat
combination. So the 2.60 m armour is half a metre over an ordinary child and
**shorter than a child in a tall hat** — not the looming thing the contract note
described. Both posts are now drawn in the hall shots, both read from `kid.ts`.
The 2.60 m is your contract figure and I have not changed it; but if it was
chosen to loom, it does not, and that is your call to revisit.

### 2.9 Rebased onto #370 — two of the three fallbacks are now real reads

The Engineer's interior merged to `main` while this branch was open, so
`src/world/building/castleFabric.ts` now exists here. The promise §2.5 made —
that these figures start reading their module the day it lands — **was kept by
the machinery without anyone editing it**, which is the whole point of having
written it as a fallback rather than a typed number:

```
mount  from src/world/building/castleFabric.ts's SCONCE_MOUNT_Y     2.10 m
budget from src/world/building/castleFabric.ts's SCONCE_HEADROOM    0.60 m
```

Both agree exactly with the figures reconcile entry 2 gave, so nothing moved —
but they are now *derived* rather than *believed*, and a change on their side
will now reach this build instead of silently disagreeing with it.

**The third is still a fallback, and it is open item 2 in §7.** `BEAM_UNDERSIDE`
is a derived expression (`CASTLE_CEILING_CLEAR - BEAM_DEPTH`), not
`export const NAME = <number>;`, so `ts_const`'s regex cannot read it. The build
now says so in those words rather than claiming the module is absent:

```
clear headroom 3.08 m, from the fallback — castleFabric.ts exists but
`BEAM_UNDERSIDE` is a derived expression ... so it cannot be read
```

3.08 is right — the Engineer's own `check:castle` prints *"BEAM_UNDERSIDE agrees
with the mesh at 3.080 m"* — so the value is not in doubt, only its provenance.
**One `export const BEAM_UNDERSIDE_M = 3.08;` on their side closes it.**

`check:castle` runs in the `build` chain on this branch and passes. Note its own
second line: *"props: NOT CHECKED — batch 1 is not wired yet"*. Nothing yet
measures a batch-1 prop in the game; this build's `check_contract()` is still
the only thing that does.

And the line in its output worth reading twice, because it is §2.8's finding
stated by the Engineer's own check: *"all clear of a **2.97 m** child under a
**3.30 m** ceiling"*. That is 0.33 m, and it is the whole loom budget.

### 2.7 Node list — one `STYLES` entry needed per name

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

### 2.8 The batch-1 re-judgement against a true post — and what it found

Your reconcile entry 3 asked for every batch-1 silhouette to be re-judged now
the post is honest. Done, and the answer is not the one either of us expected.

**The post is now read, not typed.** `castle_build.py` `ts_const`s `KID_HEIGHT`
and `TALLEST_CHILD_HEIGHT` out of `kid.ts`, `castle_render.py` draws both from
those, and the script **prints the figures it drew with** on every run, so a
reference object that lies cannot do so silently again. There is a new
`lineup.png`: all ten assets in flat ortho elevation, one depth, one floor,
both posts at the left. The per-asset shots have no post at all and the hall
shots are at 38° where height foreshortens — neither could settle a size
question, which is why this shot exists.

**The finding is not about any one asset. Batch 1 was sized for a person with
adult proportions, and this rig is chibi.** Measured off a real `createKid()`,
not derived from the numbers that place it:

| Rig landmark | Height |
| --- | --- |
| Total (default style) | 2.12 m |
| **Shoulders** (`KID_SHOULDER_HEIGHT`, guarded by `check:bus-journey`) | **0.99 m** |
| Head pivot | 1.36 m |
| **Hands, hanging at rest** | **0.40 m** |
| **Hip pivot — the whole leg is this long** | **0.36 m** |

More than half a child (1.13 m of 2.12) is head. Against that rig:

| Asset | Built | The rig figure it has to work with | Verdict |
| --- | --- | --- | --- |
| **Bench** | seat **0.55 m** | hip **0.36 m** | **0.19 m above her hip.** She climbs it, she does not sit on it, and her feet hang 0.55 m clear of a floor her leg cannot reach. Your §4.4 asks for this number so *"a child model can be posed sitting"* — that is a function, not a style choice. |
| **Table** | top **1.05 m** | shoulders **0.99 m**, hands **0.40 m** | **The tabletop is above her shoulders.** A child standing at the feast table is a head peering over the edge with the food out of reach. |
| **Throne** | seat (cushion base) **0.88 m**, +0.30 m dais = **1.18 m** | hip **0.36 m** | Chest-height on her. Your tier-2 note is *"a destination — children should want to sit on it"*; as built she cannot get onto it. |
| **Armour** | 2.60 m + 0.25 m plinth = **2.85 m** | tallest child **2.97 m** | **0.12 m shorter than a hatted child.** |

**On the armour specifically, since it was flagged as the likeliest to grow: it
cannot meaningfully grow, and that is a fact about your room, not my asset.**
Against the wall it must clear `BEAM_UNDERSIDE` 3.08 m, so on the 0.25 m plinth
the armour's ceiling is **2.83 m** — 0.23 m of growth, which spends the entire
margin to stand 0.11 m over a hatted child. Out in the room at 3.30 m the best
case is 3.05 m of armour, 0.33 m of loom, and no margin at all.

Generalised, which is the part worth your time:

> The tallest child is **2.97 m**. Your ceiling is **3.08 m** at the walls and
> **3.30 m** in the room. **Every floor-standing prop in the castle has between
> 0.11 m and 0.33 m of headroom above a child in a party hat.** Nothing in this
> room can loom over one, whatever it is or however it is built.

§3's *"the knight should loom"* and §3's two hard limits are in direct conflict,
and the limits win. Either the room gets taller or "looming" comes off the
brief. **It is yours either way** — I have changed no contract figure, and
nothing above blocks batch 1 landing.

I have deliberately **not** resized the table, bench or throne. All three are
your §4.3 figures, two of them (`TABLE_TOP`, `BENCH_SEAT`) are constants you
pose children against, and re-cutting them is a bigger change than this PR was
scoped for. Figures are above; the ruling is the Overseer's and yours.

One thing I did *not* change and want on the record as considered: the armour is
built **1.01 m wide against your 1.10 m allowance**, 8% under. That is real but
it is nothing like the sconce's 32%, and mass is not what is wrong with the
armour — height is, and height is capped by the ceiling. Left alone on purpose.

### 2.10 The furniture is child-scaled — `TABLE_TOP` and `BENCH_SEAT` moved

**This is a renegotiation of two of your §4.4 constants and it needs your
acceptance. Nothing is landed behind your back** — the figures are cut into the
build so there is a rendered frame to argue from, exactly as the tapestry's
0.12 → 0.26 was, because on this ticket a picture has beaten a paragraph every
single time.

**Jim's ruling, 29 August**, having seen `lineup.png` and chosen it
deliberately: child-scale the furniture. *"Eleri can sit on the bench, sit on
the throne, and reach the food on the table."*

| Constant | Was | **Now** | What it is |
| --- | --- | --- | --- |
| `BENCH_SEAT` | 0.550 | **0.360** | `KID_HIP_HEIGHT`, exactly |
| `TABLE_TOP` | 1.050 | **0.675** | midway hip → shoulder |
| Throne seat (yours by implication, not a named constant) | 0.880 | **0.360** | the same hip; your dais does the raising |

**Nothing else moves.** Widths, lengths, the throne's 2.75 m, the 0.30 m dais,
`SCONCE_CUP_OFFSET`, the 0.5052 m keep-out, tapestry 0.26, `SCONCE_MOUNT_Y`,
`SCONCE_HEADROOM`, `BEAM_UNDERSIDE` — all untouched. The whole change is
vertical, so the throne still totals 3.05 m on your dais under the 3.08 m beam,
and the armour is deliberately left alone (§2.8: it is capped by your ceiling
and cannot loom, which is recorded and accepted).

#### The rig, measured, not asserted

Two new constants in `kid.ts`, measured off a real `createKid()` and
**re-measured against the built rig by `check:character-parity`** so they cannot
drift. `npm run measure:kid-landmarks` prints the full set.

| Landmark | Height | |
| --- | --- | --- |
| Hip pivot — **the whole leg** | **0.36 m** | `KID_HIP_HEIGHT`, new |
| Hands, hanging at rest | 0.40 m | |
| Arm pivot | 0.72 m | the arm is **0.32 m** long |
| Reach, arm straight up | **1.04 m** | `KID_REACH_HEIGHT`, new |
| Shoulders | 0.99 m | `KID_SHOULDER_HEIGHT`, existing |

**Why these had to exist before the furniture could be right.** `kid.ts`
published a total height and a shoulder height and nothing else, so anything
sizing furniture for a child had no landmark below her neck to work from and
reached for adult proportions scaled down by eye. There was no other way to cut
it. That is the root cause of this whole section, and it is now closed.

#### Why 0.36, and why it is not a matter of taste

**This rig has no knee** — your own `TALLEST_CHILD_SEATED_HEIGHT` doc comment
says so. The whole leg is one segment swinging from one point. Sat on a seat of
height `H` her feet land at `H − 0.36`, and **there is no joint anywhere that
can take up the difference**. So 0.36 m is not "about right", it is *the one
seat height at which a child's feet reach the floor*. At 0.55 they hung 0.19 m
clear of it.

#### Why 0.675 — bracketed from both sides, and it nearly picks itself

- **Above:** she reaches **1.04 m**. The table was built at **1.05 m**. The
  feast was not awkwardly high, it was *one centimetre above the highest a child
  can reach* — and fourteen goblets were asserted onto it by a check that was
  entirely correct in its own terms. To put a hand flat on a top rather than paw
  at its edge it wants to be at or below the arm pivot, 0.72 m.
- **Below:** sat on the bench, her thigh lies at seat height and is ~0.12 m
  thick, so a 0.14 m slab's top must clear ~0.62 m or she cannot get her legs
  under.

That leaves **0.62–0.72**, and the hip/shoulder midpoint — Jim's own "roughly
between hip and shoulder" — is 0.675, inside it. Two derivations aimed at
different things agreeing on a number neither targeted is the best evidence
available that it is right.

#### Your own park corroborates, and the castle was the outlier

| | |
| --- | --- |
| Hotel breakfast table (`world/hotel/Hotel.ts`) | **0.74 m** |
| Hotel chair (`CHAIR_SEAT_Y`) | **0.42 m** |
| Hotel sofa (`SOFA_SEAT_TOP`) | **0.50 m** |
| Castle table / bench, as built | 1.05 / 0.55 |

The house scale for furniture a child uses is 0.4–0.75 m. Nothing else in the
park is anywhere near 1.05.

**If you would rather have 0.42 m** — the hotel chair's line, 0.06 m above the
hip — say so and it is one constant. It costs her feet touching the floor, and
it buys consistency with a piece the family has already seen and accepted. I
went with the rig because the rig's answer here is exact and the consistency
argument is not, but it is a genuine call and it is yours.

#### The assertion that was missing, and now exists

`check_contract` asked *"is it the size the Engineer asked for"* and the answer
was **yes, to the centimetre**. A contract check cannot catch a wrong contract.
`check_child_can_use_it` asks the other question, against the child rather than
the request, and is proved red against the real batch-1 geometry:

```
bench: the seat measures 0.550 m against a 0.36 m hip. This rig has no knee,
so her feet hang by the whole difference — a seat she cannot sit on is a shelf.

table: the top measures 1.050 m and a child reaches 1.04 m. **The feast on it
would be literally out of reach.** This is the assertion batch 1 did not have.
```

#### What you need to do

1. **Rule on 0.675 and 0.360.** If you accept, your `check:castle` assertion 3
   should compare the measured mesh against these rather than against 1.05 and
   0.55 — please land the assertion rather than re-typing the numbers, same as
   `SCONCE_CUP_OFFSET`.
2. **Your child-posing code moves with it.** These are the constants you pose
   children against, and a child posed at 0.55 on a 0.36 bench now floats.
3. **The dais is now load-bearing for the throne's grandeur**, not just its
   height. A child climbs it and then sits at her own hip height, which is what
   makes a throne a throne. If the dais changes, tell me.

### 2.11 Three more found by looking, none by a check

The tally on this asset is now **eight faults, eight found in a picture, zero
found by an assertion.** Do not judge this asset from the build alone.

7. **The bench stopped being a bench.** At 0.36 m a 2.80 m plank on two 0.14 m
   stubs read as a shelf beside the table's heavy trestles — every measurement
   correct. Recognisability beats proportion, so the ends are 0.34 m boards now,
   with a stretcher, and a slab thickened to 0.13. No constant changed.
8. **The throne's cushion was stacked on top of its seat**, putting a child's
   weight at **0.54 m** — 0.18 m above her hip, the exact fault being fixed —
   while the assertion measured the *plank* and passed. Third instance on this
   ticket of a check describing something other than the thing that matters
   (§2.4's throne through the beam, §2.2's keep-out about the wrong point). The
   wood is now built *down* from the sitting surface, and the check measures the
   cushion.
9. **The lineup could not answer the question it was being asked.** The posts
   give total height, which settles "does the armour loom" and cannot settle
   "can she sit on it" — those are landmarks part-way up her. `lineup.png` now
   draws rules across the row at the **hip (red)**, **shoulder (amber)** and
   **reach (blue)**, all read from `kid.ts`. A seat belongs on the red line, a
   table between red and amber. Taken of batch 1, this shot would have shown the
   table top above the *blue* one.

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
- **The ceiling, and the height that actually has to clear.** No floor asset's
  **mounted top** — its own height plus whatever it stands on — may reach the
  headroom. The mount is measured for anything standing on another asset here
  and typed only for your dais. The headroom is read from your modules with
  `ts_const` when they land and falls back to **3.08** (your `BEAM_UNDERSIDE`,
  the tighter of the two ceilings) with a printed note saying so. It used to
  assert the bare mesh against 3.30, which passed a throne standing 2 cm
  through your beam — see §2.4.
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
2. The tapestry was flat (see §2.3).
3. The throne read as an armchair: a broad back with a shallow arch is a
   comfortable chair, and no amount of gold changes that. A throne is the
   **step** — broad at the shoulders, then narrowing into a spire above the
   sitter's head — and the back cushion was 1.10 m tall and hid the spire.

The `FLOOR` origin check learned from this too. It first asserted a *symmetric*
footprint, and its immediate effect was to demand the sword go back inside the
skirt it had just been moved out of. It now asserts the origin is **inside** the
footprint, which is the property your keep-out disc actually depends on, and
lets an asset be honestly lopsided in depth.

**Three more on the second pass, 29 August**, and the pattern is now hard to
miss — every single fault in this asset that mattered was found by looking, and
none of them by a check:

4. **The sconce was too small to read** (§2.5). Found by a reviewer looking at
   the hall shots, not by any assertion — it was comfortably *inside* its
   allowance, which is precisely why nothing complained.
5. **The hall preview was hiding every sconce inside a tapestry.** The four
   sconces sat at x ±1.2 and ±4.0; the two 3.20 m tapestries covered ±1.0..±4.2
   at a height spanning the sconces' 2.10 m. So the pictures that the sconce was
   judged from were not showing a sconce at all. **A preview that answers a
   question about an asset it is not displaying is the picture-shaped version of
   a check that passes without checking anything**, and it is worth naming as
   its own failure mode: the discipline of "always look" does not help if the
   thing you are looking at is behind something else.
6. **The scale post was typed 1.86 m under a comment saying it was read from
   `TALLEST_CHILD`** (§2.6). Every judgement about whether the armour towers had
   been made against a post a quarter shorter than a real child.

**One caveat on all of these pictures, which the reviewer was right to flag.**
They are `BLENDER_WORKBENCH` renders with `STUDIO` solid shading — *not* the
game's four-band toon ramp, and not its lighting. They are honest about
**shape, size and silhouette**, which is what this file owns. They are **not a
colour preview**: the palette entries read notably darker here than their hex
values, so do not judge `castleSteel`, `castleIron` or `castleTapestry` off
them.

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

- Everything is committed and pushed. `npm run blend:castle` is the gate;
  `npm run render:castle` makes the pictures. Both exit 0 on this branch, and
  the full `npm run build` does too, `check:park-boot` included.
- The one thing not to do: change a size in this document. Change it in
  `CONTRACT` in `castle_build.py`, which is the only place any of these numbers
  exists, and let the build tell you what it broke.
- **Never judge this asset from the build alone.** Six faults so far, six found
  in a picture, zero found by an assertion. Re-render and actually look at the
  images after any change — and check that what you are judging is not behind
  something else (§4, fault 5).

## 7. Open, and waiting on the Engineer

Item 0 blocks; the rest is seam work and none of it blocks batch 1 landing.

0. **Rule on `TABLE_TOP` 0.675 and `BENCH_SEAT` 0.360** (§2.10) — the one thing
   actually blocking. They are your constants, you pose children against them,
   and `lineup.png` is the argument. The fallback if you want park consistency
   over the rig's exact answer is 0.42 (the hotel chair's line); it costs her
   feet touching the floor.
1. **The throne's 3 cm** (§2.4). 2.75 m of throne on their 0.30 m dais, or
   2.80 m on a 0.25 m dais — their call, one constant either way.
2. **Export `BEAM_UNDERSIDE`, `CASTLE_CEILING_CLEAR` and the dais height as
   plain literals** (§2.4), so `ts_const` can read them. Until then the headroom
   here is a printed fallback, and the promise that it starts reading their
   module the day it lands cannot actually be kept.
3. **`SCONCE_CUP_OFFSET` moved to (0.000, 0.285, 0.2475)** (§2.5) — they have
   0.3025 typed provisionally in `castleFabric.ts`. Land assertion 4 against the
   built mesh rather than re-typing it.
4. **The wall-plate may occlude the sconces at the game's 38° camera** (§2.6).
   Theirs to judge; worth 20 minutes before 40 instances go in.
5. **The armour does not tower over a child** (§2.6). Their contract figure,
   their call whether 2.60 m still buys what it was meant to.
6. **Batch 2 needs its own `.glb`** — agreed with them already; batch 1 is
   128 KB of the 200 KB budget.
