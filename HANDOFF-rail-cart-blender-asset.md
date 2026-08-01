# Handoff: Rail Race cart → Blender-authored `.glb` asset

**Status: round 2 done, built (`npm run build` exits 0). PR #156 open from
round 1; round 2's commits need pushing/adding to it (or a follow-up PR) —
do that next if you're picking this up.**

**Read the "Round 2" section below first if you're continuing this** — the
shape changed substantially after live feedback and the part list is no
longer what round 1 shipped (`tub`/`nose` are gone; it's `hopper` +
`frame-rail-l/r` now).

## The ask

Jim, after a live playtest (1 August): "I don't see real mine cars with
wheels, just rectangles with headlights — check this pls, the wheels should be
on the rails and rotate." Root cause (found by the Overseer, reading the live
scene): the procedural tub (`RoundedBoxGeometry(1.15, 0.6, 1.7, ...)`) was
both wider and reached lower than the wheel positions, so the tub's own walls
and floor covered the wheels almost entirely. This had already happened
**twice** in hand-tuned procedural TypeScript. Jim's explicit direction: model
a real asset in Blender, following the kid's `.glb` pipeline
(`ART-AGENT-NOTES.md` §6a) — not another round of hand-picked numbers.

## What shipped

- `art/blend/cart.blend` — the authoring source, 12 named objects (see
  below), built with `bmesh` primitives + real (non-modifier) bevels for the
  chunky-rounded look.
- `art/blend/cart_export.py` — headless export, mirrors `kid_roundtrip.py`'s
  export step. No import/bootstrap step, unlike the kid: the cart has no
  procedural Stage A, `cart.blend` is the authoring source from day one.
- `scripts/pack-cart-asset.mts` + `scripts/lib/pack-glb-asset.mts` — the
  `.glb` → base64-module step, factored out of `pack-kid-asset.mts` since this
  is the **second** asset through the pipeline (verified the refactor is
  byte-identical for kid's own output before trusting it for cart's).
- `src/art/assets/cart.glb`, `src/art/assets/cartGlb.ts` — the packed asset.
  52 KB raw / 8.4 KB gzipped, comfortably inside the 150 KB/asset budget.
- `src/art/models/cartAsset.ts` — mirrors `kidAsset.ts`: `cartAssetPart`,
  `cartAssetMesh`, `cartAssetGeometry`, `cartAssetPartNames`.
- `src/world/railRace/cart.ts` — rewritten to build every part from the asset
  instead of primitives. Public contract unchanged: `createCart`,
  `CartHandle`, `SEAT_HEIGHT` all still there, so `RailRace.ts` needed **no**
  changes at all.
- `scripts/check-cart-shape.mts`, wired into `npm run build`.
- npm scripts: `pack:cart`, `blend:cart` (mirrors `blend:kid`'s shape).

## The parts, and the numbers they were modelled against

`CART_PARTS` in `cart.ts`: `tub`, `nose`, `seat-back`, `seat-base`,
`pet-seat`, `pet-back`, `wheel-fl/fr/bl/br` (one shared mesh, 4 nodes),
`lamp-l/lamp-r` (one shared mesh, 2 nodes). All at the cart's own
pre-`RIDE_SCALE` local metres, same convention the procedural version used.

Derived the target proportions from the **dodgem car's own** wheel/tub
relationship (`src/minigames/dodgems/car.ts`) — not copied numbers, the same
ratio applied to this cart's own reference numbers:

- `WHEEL_RADIUS = 0.16`, gauge half = `0.31` (= `RAIL_GAUGE / RIDE_SCALE / 2`,
  algebraically `0.62 / 2` regardless of `RIDE_SCALE`, since `RAIL_GAUGE :=
  0.62 * RIDE_SCALE` in `track.ts` — safe to bake).
- Tub: width **0.80 m** (was 1.15), height 0.56 m, bottom at **y = 0.16 m**
  (exactly the wheel's own axle height — exposes the bottom half of every
  wheel, the same relationship the dodgem's tub has to its own wheel).
- `SEAT_HEIGHT = 0.47` unchanged, and re-verified: the `seat-base` node's own
  top surface measures exactly 0.47 m (`check:cart-shape` asserts this against
  the real geometry, not the number that was supposed to produce it).

## The axis bug that ate most of the session — read this before touching Blender again

Blender is **Z-up, Y-forward**; the game is **Y-up, Z-forward**.
`export_yup=True` converts glTF(x,y,z) = Blender(x, z, −y). My first pass
authored positions using Blender's raw (x, y, z) as if `y` meant "height" —
it doesn't, in Blender's own convention. The result: the tub's 1.7 m length
came out along the exported **Y** (height) axis and its 0.56 m height came out
along **Z** (depth) — a cart that would have rendered impossibly tall and
short. Caught by reading the actual exported node positions back with the
game's own `readGlbParts` (not by eyeballing Blender's viewport) and comparing
against what was intended.

**Fix, and the thing to reuse next time:** a small `game_to_blender(x, height,
forward) -> (x, -forward, height)` helper in the authoring script, and box
dimensions built as `(width, depth, height)` along Blender's own
`(X, Y, Z)`. Verified afterward by reading the `.glb` back with
`readGlbParts` and checking real local extents and node positions — not by
trusting the Blender viewport or the export log.

## A second real bug, found by the same discipline: `dispose()`

The original procedural cart built its own private geometry per `createCart`
call, so its `dispose()` freeing every mesh's geometry outright was correct.
The asset changes that: all four carts (and any future one) now share the
**same** wheel/lamp/tub buffers (`cartAsset.ts`'s module-level cache,
`markShared`). The old hand-rolled dispose loop didn't check `isShared`, so
disposing one cart would have freed geometry the other three (and the next
race's carts) still needed — invisible until something re-rendered, per
`materials.ts`'s own warning about exactly this failure shape. Fixed by
switching to the existing `disposeTree()` helper, which already respects
`markShared`. **Could not be proven by reading buffer contents back in
Node** — `BufferGeometry.dispose()` only fires an event a live `WebGLRenderer`
listens for; the JS-side attribute arrays are untouched either way. What *is*
checked headlessly, and is the actual precondition the fix depends on: every
cart-asset geometry is asserted `isShared` in `check:cart-shape`.

## Verification — what was and wasn't checked, and how

**Checked, and how:**

1. **Geometry, read back through the game's own `readGlbParts`** (not trusted
   from the Blender export log) — confirmed real local extents, node
   positions and quaternions for every part after the axis fix.
2. **Ray-cast from outside** (`ART-AGENT-NOTES.md` §6, the exact technique
   that caught the invisible hood faces): a ray at each wheel's own axle
   height, from outside the cart, hits that wheel first, not the tub. All 4
   pass. Also cast the same ray against the checked-out `origin/main` cart
   (not committed, was a throwaway `cart-old-copy.ts` + script, both deleted
   after) — **it hits the tub on all four wheels**, with only 2 cm of
   vertical clearance, against the new cart's 13.6 cm. This is the
   "compare against the previous rendering, not against your own new code"
   check §6 insists on — not a tautology.
3. **`npm run build` exits 0** — every existing check plus the new
   `check:cart-shape`, `tsc --noEmit`, `vite build`. Checked the actual exit
   code, not piped through `head`/`tail`.
4. **`npm run pack:kid`'s refactor** verified byte-identical before trusting
   the shared helper for cart's own script.

**Not checked, and why:**

- **No browser.** Did not have the shared chrome-devtools Chrome profile and
  wasn't told to take it (CLAUDE.md). Everything above is Node-side
  measurement against the real built meshes, not a screenshot. **This still
  needs a live look** — ray-casts prove the geometry is theoretically visible
  from a side angle, not that the toon shading/lighting reads well, or that
  the bevel/rounding looks right at gameplay distance. Whoever owns the
  browser next should load `/rail-race`, look at a passing cart from the
  side, and confirm it actually reads as "wheels."
- **No `test:procgen`.** `vitest` isn't installed anywhere reachable in this
  environment (neither this worktree's `node_modules`, which doesn't exist,
  nor the shared checkout's) — a pre-existing environment gap, not something
  this change caused. Irrelevant to this task anyway: nothing here touches
  procgen.

## Coordination note for whoever is adding real headlamp lights

**Found and identified, not yet merged with this branch (1 August, during
round 2):** that separate task has already landed — `feat/rail-race-polish-round2`
(commit `e044d61`, "Rail Race: the cart's headlamps are real lights that light
the rail ahead") replaces the emissive-disc lamps with real `SpotLight`s (a
`lampAim` target `Object3D`, `beams: SpotLight[]`, a new `setHeadlamps(on)`
method on `CartHandle`, and `RailRace.ts` wiring to light them on boarding and
douse them on dismount). **This branch does not include it** — checked via
`git merge-base --is-ancestor e044d61 HEAD`, confirmed not an ancestor — and
this branch's own `cart.ts` still has the old emissive-only lamp material,
because round 2's full-file rewrite (to `hopper`/`frame-rail-l/r`) was done
without that commit merged in first.

**Whoever reconciles these two branches** needs to re-apply the `SpotLight`
work on top of round 2's `hopper` shape rather than a plain merge — the old
beam position (`side * 0.3, 0.34, 1.3`, hand-picked against the old `nose`)
needs to move to wherever the new asset's `lamp-l`/`lamp-r` nodes actually
sit (read via `cartAssetPart('lamp-l').position`, not a second hardcoded
number), and `lampAim`'s target position (`0, -0.55, 9`) should be sanity
checked against the new hopper's own forward-facing geometry. The lamp
*mesh* still lives in the asset, mounted on the hopper's own sloped front
face — only the beam's light-emission behaviour needs to move from `cart.ts`.

## Round 2 (same day): "half-wheels vanishing at random", and a reshape to a real mine-cart silhouette

Two things landed on top of each other from the coordinator, both addressed
in this round:

**Bug report.** After PR #156 was combined with three other rail-race
fixes (RIDE_SCALE duck-bar/pitch, 2 laps, lookahead) and put in front of Jim
live, he reported wheels "vanishing at random below a weird looking box
thing" while riding/watching. The coordinator had already ruled out winding,
`.visible`/spin-math and frustum culling before handing this back.

**Root cause, found by reproducing the real viewing conditions rather than
the level, static ones `check:cart-shape` originally tested.** Round 1's
asset cleared the wheel by a *partial* margin only — the tub's floor sat at
exactly the wheel's own axle height (0.16 m), which is provably fine for a
level cart viewed dead side-on (which is all the original check tested), but:

- `RailRace.ts`'s `placeCarts()` pitches the whole rigid cart with the hill
  it's on: `cart.group.rotation.x = -Math.asin(tangent.y)`, several degrees
  either way around this route's real climbs.
- `camera.ts`'s rig looks down at a real angle (confirmed via
  `check:rail-race`'s own printed figures, ~20° declination) — it is not a
  level ray.

Neither of those was in the original `check:cart-shape`, which only cast a
level ray at a level cart — a check that cannot catch "vanishes at some
points on the track and not others" by construction, because it only ever
looked at one point, one angle. Reproduced properly with a script (not
committed until turned into the permanent lap-sweep check, see below) that
built the real `RAIL_RACE_PLAN.route`, the real `RaceCamera` (`rig.reset(s)`
— **not** `rig.update()`, which needs several damped steps to converge and
gave a nonsense camera position on a single call), and applied
`RailRace.ts`'s own pitch formula verbatim. First attempt aimed test rays at
each wheel's exact centre and found ~100% occlusion everywhere — a **false
positive**: a wheel's geometric centre sits nested under the tub by
construction and is essentially never the thing a viewer judges "is this
wheel visible" by. Rebuilt the probe to sample points round the wheel's own
*rim*, counting only the camera-facing hemisphere (the wheel's own far side
not being visible is correct, not a bug) — that gave real numbers: ~75-92%
of the rim clear at every point on the lap, i.e. never *fully* vanishing but
genuinely shrinking and growing as the cart pitches, which is exactly what
"vanishing at random" reads as from the sofa even without ever hitting 0%.

**While this was in progress, Jim separately sent a reference silhouette**
(a TurboSquid "cartoon mine cart" listing) with direction to reshape to an
actual mine-cart read — a hopper that flares wider at the rim than at the
floor, on a visible wheeled underframe — using this game's own bright toon
colours, not the reference's presumably muted/rusty ones. **Could not fetch
the reference page (403)** — worked from the well-established generic
"cartoon mine cart" archetype instead (tapered hopper + underframe), which
is defensible given the direction was explicitly "for silhouette/general
mine-cart read, not exact geometry."

**The coordinator's call, once both were in flight: skip root-causing the
partial-clearance bug further and go straight to the reshape, on the bet that
a properly-proportioned mine-cart hopper would resolve wheel visibility as a
side effect.** It did, decisively — see the numbers below.

### What changed

`CART_PARTS` is now: `hopper` (replaces `tub`, and absorbs what `nose` used
to be — the front is now the hopper's own sloped face, no separate nose
mesh), `frame-rail-l`/`frame-rail-r` (new — one shared mesh, mirrored),
`seat-back`, `seat-base`, `pet-seat`, `pet-back`, `wheel-fl/fr/bl/br`,
`lamp-l/lamp-r`. Headlamps now mount directly on the hopper's front slope
(parametrically, from the same floor/rim numbers the hopper itself is built
from — not a second hand-picked coordinate).

**The load-bearing change, not just cosmetic:** rather than exposing the
wheel by a *partial* margin (which is what broke under pitch), the hopper's
floor is now set **entirely above the wheel's own top point** —
`FLOOR_Y = 0.38` against a wheel top of `2 * WHEEL_RADIUS = 0.32`, a 0.06 m
clear margin in the cart's own **local, unrotated frame**. Because this is a
fact about the rigid assembly's own geometry, not about any particular
camera/pitch combination, it holds at every pitch and every camera angle —
there is no rotation of the whole cart that can bring the hopper's floor
plane down through the wheel's silhouette, because it never has to cross
zero clearance to do it.

The underframe rails (`frame-rail-l/r`) are thin (9 cm wide) and deliberately
**inboard** of the wheels (`x = ±0.20` against the wheel's `x = ±0.31`) —
close enough to visually read as "the hopper sits on a frame that reaches the
wheels" without ever being positioned to occlude one. Real mine carts often
run the axle beam right at the wheel's own x, which would look slightly more
authentic, but risks exactly the kind of partial, angle-dependent occlusion
this whole round was about fixing — not worth it for a detail this minor.

Pet perch also moved: `pet-seat`/`pet-back` were poking about 4.5 cm through
the hopper's own tapered wall at the height they sat at (`x` reached −0.41 m
against an interior half-width of ~0.366 m there) — caught by a small
one-off script comparing each interior part's real bounds against the
hopper's own floor/rim interpolation, not by eye. Narrowed and moved inboard
(`x: −0.30 → −0.26`, width `0.22 → 0.20`); re-checked clear at both the
bottom and top of each part's own height range.

### Verification for round 2

- **`check:cart-shape.mts` rewritten** to add a **lap sweep**: 240 samples
  round the whole route, using the real `RAIL_RACE_PLAN.route`, the real
  `RaceCamera` (`rig.reset(travelled)`), and `RailRace.ts`'s own pitch
  formula verbatim (not a copy) — not the generator's own numbers, the
  actual classes the game runs. For the wheel nearest the camera at each
  sample, ray-casts from the camera's real position to 24 points round that
  wheel's own rim, counting only camera-facing points. Result on the new
  hopper: **mean 1.000, worst 1.000, at every single one of the 240
  samples** — full clearance holds everywhere, not just at the points that
  happened to get tested before. This is the check that would have caught
  round 1's bug before it reached Jim; it didn't exist yet.
- Also kept the round-1 checks (level ray-cast, `markShared`, rail gauge,
  `SEAT_HEIGHT`), updated for the new part names, and added a direct
  local-frame assertion (`hopper floor > wheel top + 20mm margin`) that's
  true independent of any camera/pitch — the property that actually matters.
- Interior-part clipping checked with a one-off script (not committed —
  the geometry values it depends on live in the Blender authoring script,
  not in `cart.ts`, so there's no natural permanent home for it without
  duplicating those numbers; flagging here instead) comparing `pet-seat`/
  `pet-back`'s real world bounds against the hopper's own floor/rim taper at
  the heights they occupy. Both clear now.
- `npm run build` exits 0 (checked the real exit code).
- **Still no browser.** Everything above is geometric/ray-cast verification
  against the real built meshes and the real route/camera classes — strong
  evidence the *occlusion* bug is fixed and the silhouette is a tapered
  mine-cart shape, but not a substitute for someone actually looking at the
  toon-shaded, lit result at gameplay distance. The reference silhouette
  itself was also never actually seen (403 on the TurboSquid URL) — the
  "wider top, narrower bottom hopper on a frame" read is the generic
  archetype, not a verified match to Jim's specific reference image.

### If you're picking this up

1. Get eyes on it — browser or a render — and confirm: (a) it reads as a
   mine cart, not a box; (b) wheels stay visibly wheel-shaped in motion,
   not just geometrically unoccluded; (c) it's at least roughly what Jim's
   TurboSquid reference showed (nobody on this branch has actually seen that
   image).
2. If the pitch-tilt itself still doesn't read as tilting (a *separate*
   report from the coordinator, not addressed here — they'd already verified
   `RailRace.ts`'s pitch computation produces correct values, so if it's
   still not visible it's a perception/shading/framing question, not a
   numbers one) — investigate separately, don't assume it shares a root
   cause with the wheel bug.
3. Push these commits / open a follow-up PR if #156 is already in review.
