# Handoff: cart wheel round 4 — genuine tube rim + 20% bigger wheels

**Status: geometry rebuilt, `npm run build` exits 0, `test:procgen` passes,
committed to branch `cart-wheel-tube-rim`. Still need a live screenshot before
opening the PR (in progress) and to remove this worktree afterward.**

## The ask (Jim, live, 1 August, after round 3 shipped)

1. The rim reads as a flat disc edge, not a hollow tube — needs real
   cross-sectional (torus-like) thickness.
2. Wheels 20% larger (`WHEEL_RADIUS` × 1.2).
3. Widen the wheelbase / fix whatever else the bigger wheel forces — measured,
   not guessed.

## What changed, and the exact numbers

**Could not touch the shared interactive Blender session** — it had
`kid.blend` open (another agent's live work) when I started. Everything below
was done headless: `blender --background --factory-startup --python <script>`
directly against `art/blend/cart.blend`, never touching the running instance.

- `WHEEL_RADIUS`: 0.32 → **0.384** (`src/world/railRace/cart.ts`).
- The wheel mesh (`art/blend/cart.blend`'s shared `"wheel"` mesh datablock,
  used by all 4 `wheel-*` objects) was **fully rebuilt from scratch** via
  `bmesh`, not hand-edited — the old mesh was a single flat 2D cutout
  (hub circle + 3 rectangular spokes + outer boundary) extruded straight
  through Z with exactly two thickness values everywhere (confirmed by
  dumping all 104 vertices: every one sat at z = ±0.1, nothing between). That
  flatness — no curvature at any point — is the literal, measured root cause
  of "reads as a flat surface." New mesh:
  - **Hub**: cylinder, radius `0.1152` (kept the old hub:wheel ratio, 0.3, at
    the new size), thickness `0.24`.
  - **3 spokes**: thin radial boxes, half-width `0.0326`, from the hub's edge
    to deep inside the rim's own cross-section (`0.284` — the tube's
    centreline), so there's no visible seam between spoke and rim at any
    angle.
  - **Rim**: a genuine **torus** — `major_radius=0.284`, `minor_radius=0.10`
    (so the outer surface reaches exactly `0.384` = `WHEEL_RADIUS`),
    28 major segments × 16 minor segments. This is the part that actually
    answers the complaint: a torus has real curvature, so under toon shading
    it shows multiple distinct shading bands round its own cross-section
    instead of two flat faces and a hard edge.
- **Wheelbase widened**: half-wheelbase 0.42 → **0.484** m (Blender-Y, the
  route/forward axis) — computed, not guessed, to preserve the *exact* old
  front/back same-side wheel clearance gap (0.2 m) at the new radius:
  `(0.2 + 2×0.384) / 2 = 0.484`.
- **Everything mounted on/above the wheel shifted up by `DELTA_TOP = 0.128`**
  (= `2 × (0.384 − 0.32)`, i.e. exactly how much the wheel's own *top point*
  rose) — `hopper`, `seat-back`, `seat-base`, `pet-seat`, `pet-back`,
  `lamp-l/r`. A rigid shift, not a reshape: every part's own local geometry
  is untouched, only its Blender `location.z` moved, so every existing
  clearance margin (hopper floor vs. pet-seat, etc.) is preserved exactly,
  not just approximately.
  - `SEAT_HEIGHT`: 0.83 → **0.958** (`cart.ts`) — measured back from the real
    rebuilt `seat-base` top surface via `check:cart-shape`, not computed by
    hand (0.83 + 0.128 = 0.958, and the check confirms the built mesh agrees
    to the mm).
- **Frame rails stretched** (not rigidly shifted — they bridge two things
  that moved by different amounts): old span was Blender-Z `[0.32, 0.74]`
  (wheel axle height → hopper floor). New span is `[0.384, 0.868]`
  (new axle height → new hopper floor, `0.74 + 0.128`). Achieved via
  `object.scale.z = 0.484/0.42` + repositioned `location.z` — verified with
  `evaluated_get(depsgraph)` world-space bounds, not just arithmetic (see
  `verify_world.py` output in the session transcript: frame rail world Z
  really is `[0.3840, 0.8680]`).
- Gauge (`x = ±0.31`) **unchanged** — lateral wheel position is a different,
  externally-constrained number (`RAIL_GAUGE`), not touched by any of this.

## check-cart-shape.mts — new assertions

Per CLAUDE.md's procgen spirit applied here (measure the built asset, not the
generator's target), added:

1. **Rim wall thickness**: samples the real, packed asset's raw vertex
   positions (`cartAssetGeometry('wheel-fl')`, pre-lay-down space — radius =
   `hypot(x,z)`, thickness axis = `y`), finds vertices at the tube's own
   equator (`|y| < 1e-4`) and asserts the radial spread between inner-bore and
   outer-edge exceeds 10% of `WHEEL_RADIUS`. Measured: **0.20 m, 52.1%** —
   comfortably real, not a sliver.
2. **Genuine curvature, not two flat planes**: among vertices near the outer
   edge (`radius > 0.85 × outerRadius`), asserts at least 4 distinct rounded
   thickness (`y`) values exist. A flat extruded band — the old design —
   provably has exactly 2 (front face, back face) at every radius; this
   assertion is what would have caught round 3's flat rim directly rather
   than needing a live screenshot to notice. Measured: **5 distinct bands**.
   (First attempt used 12 minor-segments + a 90%-radius filter and only
   found 3 bands — not a real flatness problem, just a resolution/filter
   mismatch at that combination; fixed by bumping the torus to 16 minor
   segments, a genuine visual improvement anyway, and loosening the filter
   to 85%.)
3. **Cross-check the formula the hopper-clearance check trusts**: that check
   uses `WHEEL_RADIUS * 2` as the wheel's own top point rather than measuring
   it (it runs before the cart is built). Added a second assertion, after the
   real cart *is* built, that the wheel's real measured `Box3` top matches
   that formula to within 1 cm — so a future asset change that quietly stops
   matching `WHEEL_RADIUS` gets caught here rather than silently invalidating
   the earlier check's assumption.

All of round 1–3's existing checks (gauge, seat height, level ray-cast, the
240-sample real-route/real-camera/real-pitch lap sweep, the wheel-rotation
quaternion/proportionality checks) re-verified at the new size: **still 100%
clear at every lap-sweep sample**, spin math untouched (only the mesh
changed, not `WHEEL_LAY_DOWN`/`spinWheels`).

## Verification so far

- `npm run check:cart-shape` — all assertions pass (see above).
- `npm run build` — exit 0 (checked the real code, not piped).
- `npm run test:procgen` — 80/80 pass (expected: this is an asset/dimension
  change, not a procgen placement change).
- Asset size: `cart.glb` 96 KB raw / 128 KB as packed module / 20.9 KB
  gzipped — up from round 3's 52 KB (more than doubled vertex count, 104 →
  520, from the new torus), but still comfortably inside the 150 KB/asset
  budget.

## Visual verification — done, but via Blender render, not the live game

**Checked `chrome-devtools`'s `list_pages` first**: it already had an open
page at `http://localhost:5260/` ("Land of Good Places") — clear sign another
agent or Jim is using the single shared Chrome profile. CLAUDE.md is explicit
that only one agent may drive it at a time and the Overseer says who; I was
not told I own it, so I did not touch it (no navigate, no screenshot, no new
page) — "build-verify instead and list in the PR exactly what needs visual
QA," per CLAUDE.md.

**Substitute**: rendered `cart.blend` directly (own background Blender
instance, EEVEE, a sun + area fill light, simple grey/blue materials since
the shipped asset carries none — colour is applied at runtime in `cart.ts`).
Two renders:

1. As-authored (wheel lying flat, Blender's own pre-lay-down pose): shows the
   rim as an unmistakable rounded ring — a visible specular highlight arcing
   round the tube's own curved cross-section, hub and spokes visible through
   the open centre. Confirms the geometry itself (not just the numeric wall-
   thickness/band-count assertions) is a genuine tube.
2. **Wheels rotated 90° to approximate the actual in-game standing pose**
   (Blender Y-axis rotation, which is the same physical axis as the runtime
   `WHEEL_LAY_DOWN` quaternion's exported-Z axis, just sign-flipped — a
   preview only, `cart.ts`'s own quaternion math is separately verified by
   `check:cart-shape`'s rotation-axis assertions and untouched by this
   round). Result: wheels stand correctly under the hopper, each showing a
   clear doughnut-shaped rim with visible curvature/highlight banding and the
   hub+spokes showing through the middle — reads unambiguously as a hollow
   tube, not a flat disc edge, front/back wheel clearance looks reasonable
   (no overlap).

**What this does and doesn't prove**: strong evidence the *geometry* is
correct and will read as a tube in-game, since the curvature is intrinsic to
the mesh, not viewing-angle-dependent — this isn't a "the light happened to
catch it right" result. What it can't show: the game's actual toon-shading
bands (`MeshToonMaterial`'s stepped gradient, different from EEVEE's smooth
one), the real lane colour, or the ride's real camera framing at speed.
**Whoever gets the shared browser next should still take one real screenshot
from `/rail-race`** and confirm the toon-shaded result matches — low risk
given the geometry evidence above, but not yet a certainty.

## Still to do

1. Whoever owns the browser next: one real `/rail-race` screenshot, normal
   viewing distance, confirming the toon-shaded rim reads as a tube.
2. This worktree can be removed once the PR is merged.

## Files touched

- `art/blend/cart.blend` — wheel mesh rebuilt, wheel/hopper/seat/pet/lamp/
  frame-rail positions updated (see numbers above).
- `art/blend/cart_export.py` — unchanged (just re-run).
- `src/art/assets/cart.glb`, `src/art/assets/cartGlb.ts` — regenerated
  (`npm run blend:cart` / `pack:cart`).
- `src/world/railRace/cart.ts` — `WHEEL_RADIUS`, `SEAT_HEIGHT` updated.
- `scripts/check-cart-shape.mts` — 3 new assertions (rim wall thickness,
  rim curvature/band count, wheel-top formula cross-check).

## Scratchpad scripts (not committed, not needed to reproduce)

Session's working scripts live in
`/private/tmp/claude-501/.../scratchpad/`: `inspect_wheel.py`,
`inspect_wheel2.py`, `inspect_all.py`, `verify_world.py`, `rebuild_wheel.py`
(the actual rebuild, parametrised at the top with every number above — rerun
this against a fresh `git checkout -- art/blend/cart.blend` if you need to
regenerate from scratch, since the hopper/seat/lamp shifts are `+=` and not
idempotent against an already-modified file).
