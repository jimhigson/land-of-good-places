# Handoff — animal hat heads, then the plain cap, then shoes

**Branch** `animal-hat-heads`. **Worktree** `.claude/worktrees/animal-hat-heads`.

This branch has had three jobs in order. **§1–§8 are the two critter hoods,
finished and approved by the family — do not redesign them.** §9 is the plain
Cheery Cap, done. §10 is the shoes, in progress.

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
