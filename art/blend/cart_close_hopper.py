"""Closes the Rail Race cart's tub into a single watertight shell.

    blender --background --factory-startup --python art/blend/cart_close_hopper.py
    npm run blend:cart      # then export + pack

Jim, 7 August 2026, riding the ride: *"plus can see the corners though the cart
model, it needs to be a single complete mesh"*.

**What was actually wrong, measured.** Every other object in `cart.blend` — both
frame rails, both lamps, both pet parts, both seat parts, all four wheels — is a
closed solid, 0 boundary edges each. `hopper` alone was a **zero-thickness open
shell**: 40 verts, 33 faces, and **12 boundary edges forming a single loop, every
one of them at the rim** (local z 1.310). A floor and four walls with no inside —
a paper tub.

All 33 of its faces point *outward*, consistently (checked: 33 outward, 0
inward). `toonMaterial()` is `MeshToonMaterial`, whose `side` is three.js's
default `FrontSide`, and nothing in `railRace/` overrides it. So every interior
surface of the tub — the floor's top, the far wall's inside — presented a **back**
face to the ride camera and was culled outright. Jim was not seeing a gap between
panels: he was seeing *through* the tub into the park behind it, everywhere the
seat, the seat back and the rider did not happen to cover its inside. What they
leave uncovered is the corners, which is exactly what got reported.

**This did not come from today's widening.** `cart_widen_hopper.py` only remaps
`v.co.x`; it cannot add or remove an edge, and the pre-widening hopper measures
identically — 40 verts, 33 faces, 12 boundary edges. The hole was there from the
first Blender pass. What the widening changed was *visibility*: straightening the
taper into a vertical wall and taking the tub 0.06 wider turned interior that the
old slope had angled away from the camera into interior that now faces it.

**Why the new wall goes inward.** `CART_WIDTH_AT_PARK_SCALE` (1.10) is a ceiling
found by being caught — at 1.12 `raceCameraNeverRunsBackwards` fails on seed 5 —
and every lane's spacing derives from it. Thickening outward would take max |x|
past 0.55 and break both that constant and `check:cart-shape`. So the original
surface stays *exactly* where it is as the outer skin (`offset = -1`) and all the
new material goes inside. This adds an inside; it does not touch the outside.

**Why the wall is uniform and thin, which was found rather than chosen.** The
inner wall is the surface the rider's arm must now stay inside of, and her
clearance to the tub is only **0.057 m** (`check:rail-race`'s own arm sweep on
this branch, worst of five poses). A first attempt ramped the wall 0.020 at the
floor to 0.075 at the rim, for a chunkier visible lip — and `check:rail-race`
went **red at -0.062 m in the 'seated' pose**. Two things had gone wrong, and the
second is the interesting one:

  1. The tub has *no intermediate wall loops at all* — its vertices sit at z
     0.740–0.797 (floor and bevel) and then jump straight to the rim at 1.310. A
     height-ramped thickness therefore interpolates across one enormous quad, and
     everything in the upper two thirds of the wall gets nearly the full rim
     value.
  2. `use_even_offset` pushed the new inner rim loop **above** the old top, 1.310
     to 1.333. That raised `hopperBox.max.y`, and the arm sweep skips vertices
     *above the rim* — so a taller box silently pulled a fresh batch of her arm's
     vertices into the test, against the thickest part of the new wall. The rim
     is where her forearm rides, so that is the worst possible place to be thick.

Hence: one uniform `WALL_THICKNESS`, comfortably inside the 0.057 budget, and the
finished shell is **clamped back into the original bounding box** so the outer
surface — width, floor and rim height alike — is provably untouched. A flat rim
plane is also just what a mine cart's top edge should look like.
"""

import os

import bpy
import bmesh

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BLEND = os.path.join(REPO, "art", "blend", "cart.blend")

# The tub's wall gauge, in cart units, uniform from floor to rim. Bounded above
# by the rider's measured 0.057 m of arm clearance (see the module docstring):
# the inner wall eats that clearance one-for-one, and `check:rail-race`'s arm
# sweep is the arbiter. 0.030 leaves 0.027 m in hand and still reads as a real
# painted-wood edge rather than a paper fold at gameplay distance.
WALL_THICKNESS = 0.030


def close_hopper() -> str:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    hopper = bpy.data.objects.get("hopper")
    if hopper is None:
        raise SystemExit("cart_close_hopper: no 'hopper' object in cart.blend")

    # --- refuse to double-wall an already-closed tub -------------------------
    # This script rewrites `cart.blend` in place, so running it twice must not
    # quietly build a wall inside the wall.
    bm = bmesh.new()
    bm.from_mesh(hopper.data)
    before_boundary = len([e for e in bm.edges if len(e.link_faces) < 2])
    bm.free()
    if before_boundary == 0:
        raise SystemExit(
            "cart_close_hopper: the hopper is already closed (0 boundary edges). "
            "Nothing to do — refusing to solidify a solid."
        )

    verts = hopper.data.vertices
    bounds_before = (
        max(abs(v.co.x) for v in verts),
        min(v.co.z for v in verts),
        max(v.co.z for v in verts),
    )

    # --- the shell must be consistently outward-facing before it is thickened,
    # or Solidify puts the new wall on the outside in patches -----------------
    bm = bmesh.new()
    bm.from_mesh(hopper.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(hopper.data)
    bm.free()

    modifier = hopper.modifiers.new(name="close-shell", type="SOLIDIFY")
    modifier.thickness = WALL_THICKNESS
    # -1 keeps the ORIGINAL surface as the outer skin and grows inward, which is
    # what leaves the cart's footprint and CART_WIDTH_AT_PARK_SCALE untouched.
    modifier.offset = -1.0
    # Off deliberately: it is what pushed the inner rim above the old top on the
    # first attempt, and a taller tub changes which of the rider's arm vertices
    # the arm sweep tests. See the module docstring.
    modifier.use_even_offset = False
    modifier.use_rim = True       # bridges the two shells at the rim: the closure
    modifier.use_rim_only = False

    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = hopper
    hopper.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)

    # --- clamp the result back inside the original bounding box --------------
    # Belt and braces over `offset = -1`: whatever Solidify does at a corner, the
    # outer surface of this tub is a published number. Only new inner-shell
    # vertices can be outside the old box at all, and pulling them back flattens
    # the rim into a true plane, which is what the top edge should be anyway.
    half_x, z_lo, z_hi = bounds_before
    for v in hopper.data.vertices:
        v.co.x = max(-half_x, min(half_x, v.co.x))
        v.co.z = max(z_lo, min(z_hi, v.co.z))
    hopper.data.update()

    # --- weld, then PROVE it closed ------------------------------------------
    bm = bmesh.new()
    bm.from_mesh(hopper.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(hopper.data)
    bm.free()
    hopper.data.update()

    bm = bmesh.new()
    bm.from_mesh(hopper.data)
    boundary = [e for e in bm.edges if len(e.link_faces) < 2]
    nonmanifold = [e for e in bm.edges if len(e.link_faces) > 2]
    counts = (len(bm.verts), len(bm.faces))
    bm.free()

    if boundary or nonmanifold:
        raise SystemExit(
            f"cart_close_hopper: the hopper is STILL not closed — "
            f"{len(boundary)} boundary edge(s), {len(nonmanifold)} non-manifold edge(s)"
        )

    after = hopper.data.vertices
    bounds_after = (
        max(abs(v.co.x) for v in after),
        min(v.co.z for v in after),
        max(v.co.z for v in after),
    )
    for label, was, now in zip(("half-width", "floor", "rim"), bounds_before, bounds_after):
        if abs(was - now) > 1e-6:
            raise SystemExit(
                f"cart_close_hopper: the tub's {label} MOVED, {was:.6f} -> {now:.6f}. "
                f"The outer surface is what CART_WIDTH_AT_PARK_SCALE, the wheel-clearance "
                f"check and the arm sweep all measure; refusing to save."
            )

    bpy.ops.wm.save_mainfile(filepath=BLEND)
    return (
        f"hopper closed: {before_boundary} boundary edges -> 0; "
        f"{counts[0]} verts / {counts[1]} faces; uniform {WALL_THICKNESS} wall; "
        f"outer surface held exactly — half-width {bounds_after[0]:.4f}, "
        f"floor {bounds_after[1]:.4f}, rim {bounds_after[2]:.4f}"
    )


if __name__ == "__main__":
    print(close_hopper())
