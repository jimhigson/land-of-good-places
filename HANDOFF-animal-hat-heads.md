# Handoff — animal hat heads, then the plain cap, then shoes

**Branch** `animal-hat-heads`. **Worktree** `.claude/worktrees/animal-hat-heads`.

This branch has had three jobs in order. **§1–§8 are the two critter hoods,
finished and approved by the family — do not redesign them.** §9 is the plain
Cheery Cap, done. §10 is the shoes, in progress.

**§11 is a later, separate job on branch `fix/hood-face-baked-texture`** — the
hood faces turned out to be invisible in the running game, and fixing that
retired the separate face-patch mesh entirely. Read it before touching
`hoodShell.ts`.

---

# 1–8. The critter hoods (done, approved)

## The job

`hats.ts`'s `createRipikaHat()` and `createPuffHat()` currently perch a shrunken
copy of the *creature itself* on the wearer's crown (`buildRipikaHead()`,
`createPuffCreature()`). That reads as uncanny — you are wearing a tiny animal,
not a hat. Replace both with **designed critter hoods**: ears, a stylised face
on the front, a hood/cap silhouette, in each creature's own palette.

## What the reference told us (emp.co.uk Pikachu cap, photos saved)

Photos in `scratchpad/ref/{a,b,c,d}.jpg` (a = 3/4 front, b = back).

1. It is a **structured snapback**, not a soft hood: crown, panel seams, a
   crown button, a straight peak, a band.
2. **The face lives on the crown's front wall, entirely above the peak.** The
   peak is a separate horizontal plane below the chin. This is the thing that
   makes it read as a hat rather than a head.
3. **Ears are sewn onto the top-back of the crown**, at the 10-and-2 positions,
   leaning outward — placed for silhouette, not anatomy.
4. Face is appliqué: flat eyes, flat cheek discs, tiny nose, wide mouth. No
   sculpted muzzle anywhere.

We take (1)–(4) as the *genre*. Everything visual is our own.

## The two designs

**RiPika cap** — a neat six-panel plush cap. Yellow crown, deep-yellow peak
with a cream (`ripikaBelly`) lining, cream hem roll (the sweatband), a
deep-yellow crown button, and RiPika's own painted face (disc cheeks, cocoa
nose, `cat` mouth). Ears are **short, wide, blunt plush paddles** — RiPika's
own "short-for-their-kind, rounded" ears, flattened as appliqué, not the long
thin spikes of the reference. One ear droops more than the other (the required
asymmetric feature).

**Trilla bonnet** — deliberately a different *kind* of hat: a soft round
bonnet with **real earflaps**, which is what the hood shell's varying hem is
for. `blossomPink` shell, pale `stonePinkLight` brim and a pale bib patch above
it, `heartPink` hem roll, and the puff's own `heartPink` curl worn as the
bonnet's topknot (its asymmetric feature, and the only thing it borrows
literally). Trilla has no ears, so the flaps carry the silhouette instead.

## Peak height (the reported defect)

The prototype's peak sat too low. Fixed by giving the hood a **front hem well
above the side hem** so the peak springs from a brow line rather than the band:

| | peak y (head units) | in metres below the crown |
| --- | --- | --- |
| existing `cap` hat (family said correct) | −0.08 | −0.120 |
| RiPika cap | −0.086 | −0.129 |
| Trilla bonnet | −0.128 | −0.192 |

The kid's eye-tops are at −0.42 m below the crown, so both peaks clear the eyes
by ≥ 0.23 m.

## Method

Modelled in Blender against the hair agent's `KidRef_*` reference kid (still in
the scene; skull r = 0.66 m, hat anchor at z = +0.63 in that frame), then
hand-ported — the `hairShell.ts` precedent. The Blender prototype runs the
*same* parametric formulas the runtime will, so nothing is lost in the port.

Renders: `scratchpad/renders/ripika09_*.png`, `trilla04_*.png` (front / iso 38°
/ side / back / whole-kid).

## Decisions worth keeping

- **Face patch is a sector of the hood's own surface**, not `createFacePatch`'s
  sphere patch. A sphere patch floats off an ellipsoidal hood at the top.
  `hoodFacePatchGeometry` UV-maps a (φ, y) window of the shell and offsets it
  along the true surface normal.
- **A bolt badge on the side of the RiPika cap was tried and dropped** — three
  rounded slabs read as a defect, not a lightning flash, and it broke the
  silhouette. Worth retrying as a proper extruded bolt polygon if the family
  wants more RiPika signature.
- **The puff hat sings** (`createPuffCreature` schedules a melody, bursts
  notes, swaps to a singing face and jiggles). The bonnet must keep all of
  that — do not drop it when replacing the creature reuse.

## Two numbers that bit, so they do not bite twice

- **`check:hat-fit`'s `span` counts forward reach as width** — it is
  `2 × max hypot(x, z)`. A long peak therefore fails the width bound even
  though the hat is narrow. First pass had `peakLen` 0.26/0.175 and measured
  1.32×/1.16× against a 1.15 limit. Shortened to 0.145/0.14, which is also
  closer to the reference's own peak:crown ratio (0.39, not the 0.68 we had).
- **A brim has to clear its own band.** Trilla's peak at y = −0.128 sat
  entirely inside the hem roll's tube (±0.036 about −0.127) and was invisible
  from every angle. Now −0.100.

## Cross-check that the port is faithful

`check:hat-fit`'s measured `rise` (the top of the hat above the crown, walked
off the real three.js vertices) is 0.695 m for the cap and 0.683 m for the
bonnet — 0.463 and 0.455 head units, which is where Blender puts the ear tips
and the curl. The runtime build and the Blender prototype are the same shape.

## Status

- [x] Reference studied, both designs modelled and rendered in Blender
- [x] Ported to `src/art/models/hoodShell.ts`
- [x] `hats.ts` rewired; the puff's song, note burst, singing face and jiggle
      all rebuilt on the bonnet (the old builder got them free from
      `createPuffCreature`; losing them would have been a regression)
- [x] Shop copy + GAME_DESIGN.md amendment + the now-stale `KNOWN_LONG` entry
- [x] `npm run build` exit 0; `check:hat-fit` all 8 hats pass, spans 1.08 and
      1.09 of the bare head, tips 1.28× the kid's height (limit 1.45×)
- [ ] **No in-game QA.** The browser was contested (another agent's PR opened
      today, many vite servers up) and CLAUDE.md says do not drive it unless
      told you own it. Needs a look at `/art-samples.html` and at the hat shop
      stands, plus one wear/remove cycle in the character creator to confirm
      the pop-in scale and that the bonnet still sings.

## Open questions for the next round

1. **The RiPika cap's ears still lean toward the reference's silhouette** —
   they are RiPika's own cocoa-tipped ears, so some of that is the character,
   but if the family reads it as merchandise the move is blunter, rounder
   tips and less splay.
2. **A bolt badge was tried and dropped** (see above). If more RiPika
   signature is wanted, it wants a properly extruded bolt polygon, not slabs.
3. **Trilla's pale bib and pale brim merge** into one light area under the
   face at the iso angle. Deeper pink on one of them would separate them.
4. **The cap has panel seams (`seamR`), the bonnet barely any.** They are
   invisible at gameplay distance by design; if we want the sewn read to
   carry further, that is one number.
   → **Answered in §9.** `cos` relief makes broad *lobes*, not seams. The new
   `seamSharp` turns them into narrow creases. It defaults to 1, so both
   hoods are byte-identical; raise it on a hood if the family wants the sewn
   read there too.

---

# 9. The Cheery Cap — the plain one (done, needs family eyes)

`HatKind: 'cap'`, `createCap()`. The last hat still built the old way. Same
diagnosis as the hoods, no animal theme: it is now cut from the same
`hoodShell.ts` surface and has the same anatomy, with **nothing** added — no
face, no ears. Specs are `CHEERY_HOOD` / `CHEERY_PEAK` in `hoodShell.ts`.

## What the old one actually was (worth knowing, it explains the bug report)

A squashed sphere with `CylinderGeometry(0.24, 0.24, 0.04, 18, 1, false, 0, PI)`
stuck on the front. That is a **half**-disc, and with `rotation.y = PI` the flat
straight edge ended up facing forward and the semicircle sideways — so the
"peak" was a flat green tongue sticking out of one side of the head. **That is
the "one-sided peak" the family saw.** It was never a peak that had gone wrong;
it was a half-disc that was never rotated into place. There is no band, and the
dome just floats on the skull.

Reconstructed faithfully from the committed code and rendered as the before
shot: `scratchpad/renders/old_cap_{front,side,iso38}.png`. (The uncommitted
throwaway patch made in a scratch worktree is deliberately **not** in it.)

## The three findings, all from angles other than the front

1. **Peak and band were both `leafMid` and merged into one green bowl** at the
   game's own 38° camera — a mint dome sitting in a green cup. The RiPika cap
   escapes this only because its band is *cream* against a *yellow* peak. The
   band is now the crown's own mint (a self-fabric sweatband, which a plain cap
   has anyway) and the green peak is the sole accent. **If you change one
   colour on this hat, check it at iso38 before anything else.**
2. **The RiPika peak's 60°-either-side wrap is hidden by its face patch.** On a
   bare crown that wrap reads as a bowl. Arc pulled in to 50° and the root
   buried deeper (`inset` 0.90 → 0.84) so the flanks stay inside the crown and
   only the actual bill emerges. `length` went 0.150 → 0.165 to buy back the
   reach the deeper inset costs.
3. **A plain cap wants a shallower crown and straighter sides.** `semiY` 0.245
   (the RiPika cap's 0.335 is paid for by the ears standing on it; with nothing
   up there that dome reads as a bonnet) and `semiLow` 0.92, which stops the
   crown overhanging its own band — the first pass looked like a mushroom.

## Two numbers not to re-derive

- **`semiLow` is pinned by the grip, not by taste.** The hem must land on the
  skull's own width at that height: skull radius at −0.205 is
  `sqrt(0.88h − h²)` = 0.372, and `0.385·sqrt(1 − (0.205/0.92)²)` = 0.375.
  Change `semiLow` or `shellR` and you must redo that or the band hovers.
- **The asymmetry is a *yaw*, not a tilt** (`CAP_JAUNT = 0.11`). A tilt lifts
  one side of a hem cut to hug the skull and opens a ~3 cm gap; a yaw moves the
  band along its own contact ring, costs nothing, and is free in
  `check:hat-fit` (which measures `hypot(x, z)` about that same axis).

## Cross-check that the port is faithful

`check:hat-fit` measures the built hat's `rise` at **0.435 m**; the Blender
prototype measures **0.435 m**. Same shape. `grip` went 0.81 → **1.00** (the
band lands on the skull instead of hovering), `span` 0.94 → **1.09** against the
1.15 limit, `tip` 1.16× the kid's height against the 1.45 limit.

Renders: `scratchpad/renders/cheery04_{front,side,iso38,back,kid}.png`.

## Status

- [x] Modelled in Blender against the same `KidRef_*` kid, then hand-ported
- [x] `seamSharp` added to `HoodShellSpec`, defaulting to 1 so both approved
      hoods are untouched
- [x] `npm run build` **exit 0** (checked directly, not piped);
      `check:hat-fit` all 8 pass; `check:assets` records no drift for the cap
- [ ] **No in-game QA** — the browser was not mine to drive (CLAUDE.md), and PR
      #131 was open from another agent. Needs `/art-samples.html`, the hat shop
      stand, and one wear/remove cycle in the character creator.
- [ ] Family has not seen it yet.

## Deliberately not done

The shop blurb stays "Minty, with a little green peak." — still accurate, and
`check:copy-brevity`'s rule is to say what the child gets, not how it is built,
so "six mint panels" would be worse copy, not better. No `GAME_DESIGN.md`
amendment either: unlike the RiPika hat, nothing the family explicitly asked
for has been departed from here.

---

# 10. Shoes — `src/art/models/shoes.ts` (asset side done)

Four kinds: `'plain' | 'ripika' | 'sandal' | 'sparkle'`. Committed in `ec4f1ef`.
**Asset side only** — the character-creation picker and its state are a parallel
Sonnet task, and everything that agent needs is in this section.

## Read this before wiring anything

**There were no shoes at all.** Not a stub, not an anchor. Each foot was two
unnamed `blob()`s written inline in `createKid`'s leg loop (`kid.ts` ~340–356),
painted `ART.kidShoe`. The only footwear concept in the repo was the *colour*:
`setShoeColour` on `KidHandle`, `CharacterColours.shoe`, and the crowd's
`ColourRole 'shoe'`. So the anchor design below is new, not discovered.

**`BackpackKind` is not on this branch.** The brief said to mirror it; it lives
only on the unmerged `origin/backpack-picker` (PR #131). It is also *not* a
`createX(kind)` + `BUILDERS` factory — it is `buildBackpacks(options):
BackpackRig`, a body-part rig in `hair.ts`'s style, and its own header explains
why. I followed that, not `hats.ts`. **If PR #131 lands first, re-read
`backpacks.ts` and align naming** — I have matched its shape from memory of the
diff, not from a merged file.

## The two structural decisions

1. **A rig, not an asset-on-an-anchor.** A hat is bought, worn and removed, so
   it is a separate asset that `WornHat.ts` swaps at runtime. A shoe is chosen
   once and never taken off — the relationship *hair* has with the head. So:
   `ShoePart {mesh, kinds}`, one `setKind` flipping `visible`, materials passed
   in, metres in the leg pivot's space.
2. **No single anchor is possible.** `applyWalk` rotates `limbs.leftLeg` and
   `limbs.rightLeg` every frame. A shoe must swing with its leg, so every part
   is built **twice, one per pivot**, and `buildShoes` takes
   `legs: [left, right]`. Anything hung off one point on the body slides off the
   foot the moment she walks.

## The API

```ts
buildShoes({ legs, footMaterial, kind, kinds? }): ShoeRig   // { parts, setKind }
createShoe(kind, colour?): AssetHandle                      // swatch / shop stand
SHOE_KINDS, CROWD_SHOE_KINDS, type ShoeKind, type ShoePart
```

- `footMaterial` is **the kid's own `shoeMat`**, not a colour: the rig repaints
  it in `setKind`, so `setShoeColour` keeps working and the creator's live
  recolour is unaffected.
- `kinds` builds more than the one worn. Pass all four only where the child is
  about to tap through them — the creator rebuilds the whole kid per tap.
- `CROWD_SHOE_KINDS` is `['plain', 'sandal']`. `kidCrowd.ts` bakes one instanced
  draw call **per mesh on the prototype**, so every kind the crowd can show
  costs the whole park a draw call. Same reasoning as `CROWD_BACKPACK_KINDS`.

## Three numbers not to re-derive

- Foot ellipsoid semi-axes **(0.175, 0.1365, 0.224) m**, at **(0, −0.22, 0.045)**
  in its leg pivot — read off `blob(0.175, shoeMat, [1, 0.78, 1.28])` in
  `kid.ts`. Every shape in `shoes.ts` is cut to those, so **if `kid.ts`'s foot
  changes, `FOOT`/`FOOT_AT` must change with it.**
- `FOOT_AT` is an offset **inside the pivot**, not inside the shoe. `createShoe`
  has to emulate a pivot for that reason; not doing so put every part 22 cm
  below the foot.
- The left shoe is a **true x-mirror** (`mirrorX`, lifted from `hoodShell.ts`'s
  `mirrorEar`). `scale.x = -1` lights from the wrong side; a π turn about Y
  mirrors *forward* too and puts the toe cap on the heel.

## Design notes from the renders

- **RiPika**: a flat cocoa **paw print**, not a sculpted ear tab. The tab was
  built first and reads as a stray flap — the same failure as a sculpted muzzle
  turning a hat back into a head. Appliqué, the RiPika Cap's own rule.
- **Sandal**: a sandal must *show the foot*, so `'sandal'` repaints the foot
  blob `PALETTE.skin`. That is why the rig owns the material, not just meshes.
  Its strap is a swept **rounded** ribbon — a rectangular sweep gives a flat
  outer face and open ends and reads as tape stuck on.
- **Sparkle**: stars are **stratified**, not freely random; ten independent ones
  clump and a clump reads as a rash. Instanced `starGeometry`, seeded `Rng`,
  `MeshBasicMaterial` pigment — the `flowerSparkle` / dodgems convention.
  `createCrown`'s "Sparkly Crown" has **no** sparkle technique to reuse: its
  sparkle is one static star-shaped jewel and the name is copy.
- Toe cap rims turn **inward** before closing. A fan to the axis crosses the
  foot's own surface and leaves notches all round the rim.

Renders: `scratchpad/renders/shoe4_{ripika,sparkle}_{iso,out,kid}.png` and
`shoe6_sandal_{iso,back,kid}.png`.

## Status / what is left

- [x] `ShoeKind`, `SHOE_KINDS`, `CROWD_SHOE_KINDS`, geometry, `buildShoes`,
      `createShoe`; `npm run build` **exit 0**; all four sit on the ground
      (base −0.011 against the 0.02 tolerance), `root.scale` untouched
- [ ] **Not wired into `kid.ts`.** `createKid` still builds its own two foot
      blobs inline. Wiring is: build the blobs as now, then
      `buildShoes({ legs: [limbs.leftLeg, limbs.rightLeg], footMaterial: shoeMat, kind })`,
      expose `shoeParts` + `setShoeKind` on `KidHandle` beside `hairParts` /
      `setHairStyle`, and add `KidOptions.shoe?: ShoeKind`.
- [ ] **Not in `check:assets`.** It enumerates rather than discovers. Add
      `for (const kind of SHOE_KINDS) { const kid = createKid(); kid.setShoeKind(kind); add(\`kid.shoe.${kind}\`, kid); }`
      beside the hair loop. A new asset gets **no** `KNOWN_DRIFT` allowance.
- [ ] No in-game QA (browser not mine — see §9).
- [ ] Family has not seen them.

---

# 11. The invisible hood faces — root cause, and the baked-UV fix

**Branch** `fix/hood-face-baked-texture`. **Worktree**
`.claude/worktrees/hood-face-texture`.

RiPika's and Trilla's painted faces did not appear in the running game at all.

## The root cause is NOT the panel-seam bulge

The working hypothesis when this task was handed over was depth occlusion:
`hoodPatchGeometry` samples the shell's *smooth* base radius, while
`hoodShellGeometry` adds panel-seam relief on top of it (`r = radiusAt(y, phi)
* (1 + amp * seam)`), and at the front `panels` is even for both hoods, so
`cos(panels·π) = +1` and the front sits on a bulge. The patch was said to be
buried inside that bulge.

**That is not what was happening, and it is why padding `lift` did nothing.**
Two measurements, both taken in Node against the real built hats:

1. **Arithmetic.** RiPika's front bulge is `radiusAt(0, π) · seamR` =
   `0.385 × 0.02` = **0.0077** head units; the patch's `lift` was **0.010**.
   Trilla's bulge is `0.42 × 0.01` = **0.0042** against a `lift` of **0.008**.
   The patch was already standing clear of the bulge at the front, and clear by
   more everywhere else — off the centre line the seam relief goes *negative*
   and the shell pulls further in.

2. **A ray cast from outside the hat, straight in at each painted feature**
   (both eyes, the mouth, the middle of the face). Raycasting is what the depth
   test does, so whatever comes back first is what the camera sees. The
   `hoodFace` mesh **never appeared in any hit list at all** — not in front, not
   behind, not anywhere. Only the shell and its outline were ever hit.

The reason is a **reversed triangle winding**. `hoodShellGeometry`'s outer skin
winds `a, c, b / a, d, c`; `hoodPatchGeometry` wound `a, b, c / a, c, d` — the
other way round. Averaged over every vertex, `normal · outward-radial` came out
at **−0.92** for the RiPika patch and **−0.93** for Trilla's. The face patch was
facing the wearer's skull, and `MeshToonMaterial` is `FrontSide`, so it was
back-face culled and never rasterised. No amount of `lift` can fix a surface
that is pointing the wrong way.

**`hoodBibGeometry` had the identical bug** (−0.998), so Trilla's pale bib has
been invisible in game since it was written. Only `hoodPeakLiningGeometry`
escaped, and only because `hats.ts` sets `side = DoubleSide` on it by hand.

Reproduce either measurement with `npm run check:hood-face` (below), or read
`scripts/check-hood-face.mts` — the ray test is the same one.

## The fix: one surface, one texture

Rather than fix the winding and leave two surfaces to be kept in step by a
formula, the face is now **baked into the hood shell's own UV map**:

- `hoodShellGeometry(spec, face?)` takes an optional {@link HoodFaceWindow} and,
  when given one, emits `uv` on every vertex using the *same* `(φ, y)` window
  the old patch used. No second mesh exists, so no second mesh can face the
  wrong way, sink into a bulge, or drift out of sync.
- The hood's material becomes `toonMaterial(0xffffff, { map })` where the map is
  the base colour painted as a filled rect with the face composited on top
  (`paintFaceOnFill` in `faces.ts`). Opaque — no `transparent`, no `alphaTest`,
  no `renderOrder`.
- **Opt-in.** Pass no window and `hoodShellGeometry` is byte-identical to
  before, so the Cheery Cap keeps its flat-colour material and its exact
  geometry.

## Three things that had to be got right, and will bite again if changed

1. **The seam column is split.** A UV that runs with azimuth cannot close: the
   wrap quad would interpolate `u` from one end of the texture to the other and
   smear the whole face across the back of the hood. So with a face window the
   shell is built with `segments + 1` columns, the last duplicating the first at
   `φ = 2π` with its own `u` — the same thing `SphereGeometry` does. Without a
   window the old `(i + 1) % segments` wrap is kept exactly.
2. **The duplicated seam's normals are welded** after `computeVertexNormals`.
   Each copy would otherwise average only its own side's faces, and the toon
   ramp draws a visible band edge down the back of the hood — and the
   inverted-hull outline splits along the same line.
3. **The face is inset into the canvas** by `FACE_FILL_INSET` (0.08), leaving a
   border of pure base colour. Everything on the hood outside the face window
   has UVs outside `[0, 1]` and clamps to that border. The border must stay
   wide enough that mip-mapping cannot pull face pixels into it: 0.08 of 512 is
   41 texels, and at gameplay distance the mip block is ~6 texels.

   The cost is that the face is drawn at 84% of the canvas — 430 px of 512 for
   RiPika, where it used to have the whole 512. Invisible at gameplay distance.

Trilla's bib is baked into the same texture (the same lozenge taper, drawn in
canvas space), so `hoodBibGeometry` and `hoodPatchGeometry` are both gone and
neither hood has a decal patch left on it.

## Verification

`scripts/check-hood-face.mts`, wired into `npm run build` as
`check:hood-face`, and it fails on the bug as it stood:

- the shell of every faced hood carries a `uv` attribute;
- **exactly one** mesh per hat carries a texture map, and it is the solid shell
  — no transparent decal patch anywhere in the hat;
- a ray cast from outside at each painted feature hits **the shell first**, and
  the UV interpolated at that hit is within 0.02 of where the feature was
  painted on the canvas. That is the assertion that would have caught the
  original bug, and it checks the mapping rather than trusting the formula;
- a ray at the back of the hood lands outside the face rect, i.e. on the
  plain-colour border;
- every face window sits strictly inside the crown (`yHi < semiY`), which is
  what lets the pole fan clamp to the texture's top border.

## Status

- [x] `hoodShellGeometry(spec, face?)`, `hoodFaceUv`, `HoodFaceWindow`, the
      split seam and the normal weld
- [x] `paintFaceOnFill` + `FACE_FILL_INSET` in `faces.ts`; `css` exported
- [x] `hats.ts` rewired: both hoods are one textured shell; the bonnet's song,
      note burst, singing-face swap and jiggle all still there (the swap is now
      a swap of the whole hood skin, same two canvases)
- [x] `hoodPatchGeometry` and `hoodBibGeometry` deleted
- [x] `scripts/check-hood-face.mts`, wired into `npm run build`
- [x] ART_DIRECTION.md §3 records the pattern
- [x] **`npm run build` exit 0**, checked directly, not piped. `check:hat-fit`
      unchanged: `rise` 0.695 / 0.683 and span 1.08 / 1.09, exactly the numbers
      §1–8 recorded. `check:assets` reports no new drift.

## What has actually been verified, and how

Everything below was run in Node against the real built hats. **None of it is a
screenshot and none of it is code reading.**

- **The Cheery Cap is untouched.** Its shell was built by this branch and by
  `origin/main`'s generator side by side: same 2306 vertices, `max |Δposition|`
  **0**, `max |Δnormal|` **0**.
- **The hoods' geometry only gained the seam.** All shared vertices identical
  (`max |Δposition|` 0); +32 vertices on the cap and +44 on the bonnet, exactly
  `rings × 2`; the seam's two copies coincide to 1e-16; the only normals that
  changed at all are that one column's, which is the weld.
- **The face is on the surface the camera sees.** A ray in from outside at each
  painted feature hits the shell first, and the UV interpolated at the hit is
  within **0.0003** of where the feature was painted. Against `origin/main` the
  same ray never hits the face patch at any distance.
- **The texture is painted as claimed.** Recorded the real canvas calls: the
  RiPika skin is a `#ffd63f` `fillRect` over the whole 512² canvas with the face
  composited at (41, 41, 430, 430) — the 0.08 inset exactly; Trilla's is
  `#ffa9d4` over 256² with the bib path (97 points, spanning canvas y 145–253,
  where the bib's height range maps to) drawn under a face at (20.5, 20.5, 215,
  215).
- Texture count is unchanged: three composited canvases where there were three
  face canvases. The face canvases are transient and discarded.

## Not verified — needs the browser

**No in-game QA. The browser was not this agent's to drive** (CLAUDE.md: do not
use it unless told you own it, and this agent was not). Everything above is
Node-side. Still needs eyes on:

- `/art-samples.html` and both hat shop stands, at gameplay distance and at the
  game's own iso38 camera;
- one wear/remove cycle in the character creator (pop-in scale, and that the
  bonnet still sings and swaps to its singing face);
- **the back of both hoods specifically** — the split seam is the one new thing
  that could show as a line, and the weld is what should stop it;
- **the bib, which is visible for the first time.** Open question 3 in §1–8
  (bib and brim merging into one pale area at iso38) was written off Blender
  renders where backface culling was off; it becomes a live question now and may
  want a deeper pink on one of them.
