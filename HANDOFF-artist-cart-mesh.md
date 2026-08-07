# HANDOFF — artist-cart-mesh (see-through cart corners)

Branch `fix/cart-watertight-mesh`, off `chore/rail-race-pr-triage` (PR #223).
Worktree `.claude/worktrees/artist-cart-mesh`. Blender 5.2.0 LTS at
`/opt/homebrew/bin/blender` — driven **headless**, the GUI MCP on :9876 was not
running and was not needed.

## The fault, measured

Jim: *"can see the corners though the cart model, it needs to be a single
complete mesh"*.

`hopper` was a **zero-thickness open shell** — 40 verts, 33 faces, **12 boundary
edges in one loop, all at the rim**. Every other object in `cart.blend` (frame
rails, lamps, pet parts, seat parts, four wheels) was already a closed solid,
0 boundary edges each.

All 33 hopper faces point **outward** (checked: 33 outward, 0 inward), and
`toonMaterial()` leaves `side` at three.js's default `FrontSide` — nothing in
`railRace/` overrides it. So every interior surface presented a **back** face to
the ride camera and was culled. Not a gap between panels: you were seeing
*through* the tub into the park, everywhere the seat, seat back and rider did
not cover its inside. What they leave uncovered is the corners.

## Did today's widening open it? No.

**The hole predates it.** `cart_widen_hopper.py` only remaps `v.co.x` — it
cannot add or remove an edge — and the pre-widening blend (`git show
76520bc^:art/blend/cart.blend`) measures identically: 40 verts, 33 faces, 12
boundary edges. The widening changed *visibility*, not topology: straightening
the taper to a vertical wall and going 0.06 wider turned interior the old slope
angled away from the camera into interior that now faces it.

**What is at risk elsewhere:** nothing from the widening edit. But nothing in
the repo checked closure until now, so any other authored asset could carry the
same latent hole. The new guard covers the whole cart; other assets are not
covered.

## The fix

`art/blend/cart_close_hopper.py` (new) — Solidify, `offset = -1` so the original
surface stays put as the **outer** skin and all new material goes inside, then
clamped back into the original bounding box and welded. 12 boundary edges -> 0,
80 verts / 78 faces. Outer surface provably unmoved: half-width 0.5500, floor
0.7400, rim 1.3100. `CART_WIDTH_AT_PARK_SCALE` = 1.10 untouched.

Two things found the hard way, both written up in the script's docstring:

1. **A height-ramped wall (0.020 floor -> 0.075 rim) failed at -0.062 m.** The
   tub has *no intermediate wall loops* — verts sit at z 0.740–0.797 then jump
   to the rim at 1.310 — so a ramp interpolates across one huge quad and nearly
   everything gets the rim value. Now a uniform **0.030** wall.
2. **`use_even_offset` pushed the inner rim above the old top** (1.310 ->
   1.333), which raised `hopperBox.max.y` and pulled fresh arm vertices into the
   arm sweep. Off, plus the explicit clamp.

## The arm check measured the wrong surface once the tub had an inside

`check-rail-race.mts`'s `wallAt` took the **middle** pair of ray crossings. On a
paper shell that is 2 crossings, so the middle pair *was* the outer skin. On a
solid it is 4, and the middle pair silently became the **inner** skin — asking
"does her arm touch the wall's material" instead of "does her arm come out of
the cart". Her forearm rests on the inside and enters it by 0.017 m, buried in a
0.030 m wall, invisible.

Changed to first/last crossing (the outer skin). **Not a loosened bar** — the
five poses now report `0.057 / 0.116 / 0.057 / 0.116 / clear`, *identical* to
what this check gave on the open-shelled asset this morning.

Also note: `wallAt` returns `null` on fewer than 2 crossings, i.e. a hole made it
pass vacuously. The new closure guard is what makes that safe.

## The guard

`check:cart-shape` now asserts **every** `CART_PARTS` entry is a closed shell —
counted off the built asset (`cartAssetGeometry`), not the blend. Welds by
quantised position first, because a glTF export splits vertices at normal/UV
seams and comparing raw indices would call a perfect solid full of holes.

**Proved red on today's asset before the fix:** `✗ hopper ... found 12 open
edge(s)`, all 12 other parts green. Log:
`…/scratchpad/cartshape-RED.log`.

## Status

- [x] `check:cart-shape` green (incl. new closure assertion, width still 0.5500)
- [x] `check:rail-race` green (arm clearances identical to this morning)
- [ ] `npm run build`
- [ ] `npm run test:procgen` (bar: 221 / 9 files / 0 skipped)
- [ ] Visual verification in the running ride, headless Chromium, corners from
      several angles
- [ ] PR against `chore/rail-race-pr-triage`

## Rebuilding the asset

```
blender --background --factory-startup --python art/blend/cart_close_hopper.py
npm run blend:cart     # export + pack
```
`cart_close_hopper.py` refuses to run twice (it checks for 0 boundary edges
first), so it cannot double-wall the tub.
