"""Widens the Rail Race cart's tub sideways, in the authoring source.

    blender --background --factory-startup --python art/blend/cart_widen_hopper.py

Jim, 7 August 2026, having ridden the ride: *"the characters arm clips through
the mine cart - make the box of the cart wider until this no longer happens"*.

**Why the tub and not her arm.** Measured by ray-casting the built hopper
against every vertex her arms actually draw, in all four poses that move them
(`scratch-arm-clip.mts`, round 9): her hand reached **0.285 m outside** the tub's
own surface at ride scale. The cause is the taper, not the overall width — the
tub was 0.62 m across at the floor and 1.04 m at the rim, and her hands hang
**24% of the way up that wall**, where it had only just started to flare. Her
hand's outer edge sat at 0.523 in cart units against a wall at 0.409.

So this widens the tub where she actually is, by remapping each hopper vertex's
x by a factor that ramps with height and is then capped: the floor half-width
goes 0.31 -> 0.52 and the wall runs **vertical** at 0.55 from the bevel to the
rim, where it used to slope from 0.37 up to 0.52.

That is deliberately *not* a uniform scale. Scaling the whole tub enough to fix
the floor would have needed a rim of 0.68 and taken the cart's footprint with
it — and the footprint is the **park's** problem, not the cart's: every lane's
spacing, the trestle beams, the duck bars and the finish arch's own span are
derived from `CART_WIDTH_AT_PARK_SCALE` in `railRace/route.ts`. Most of this fix
is therefore shape; only 0.06 of it is footprint (1.04 -> 1.10).

**Why the rim stops at 0.55 and not wider**, which is the one number here that
was found rather than chosen: at 0.56 the park's own
`raceCameraNeverRunsBackwards` invariant fails on seed 5. Widening the lanes
walks the outermost lane — the one the player rides — further out, and a camera
standing off a rider on a ~22 m hairpin is already riding a tighter circle than
she is (see `RaceCamera.measureZoomCeiling`). Swept against the real invariant,
1.04 / 1.06 / 1.08 / 1.10 pass and 1.12 fails. So 1.10 is the widest the ring can
carry, and it happens to be enough.

The floor stays narrower than the rim, so the tub still reads as a soapbox tub
with a flared foot rather than a crate; it is just far less tapered than it was.

Run `npm run blend:cart` afterwards to export and pack, or let this script's
own save be picked up by the next export.
"""

import os

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BLEND = os.path.join(REPO, "art", "blend", "cart.blend")

# The tub's half-width at its floor and at its rim, in cart units. The rim is
# half of `CART_WIDTH_AT_PARK_SCALE`; keep the two in step by hand only here,
# where the shape is authored — the game reads the built asset, and
# `check:cart-shape` asserts the two agree so this comment cannot rot silently.
FLOOR_HALF_WAS, FLOOR_HALF_NOW = 0.310, 0.520
RIM_HALF_WAS, RIM_HALF_NOW = 0.520, 0.550


def widen_hopper() -> str:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    hopper = bpy.data.objects.get("hopper")
    if hopper is None:
        raise SystemExit("cart_widen_hopper: no 'hopper' object in cart.blend")

    verts = hopper.data.vertices
    z_lo = min(v.co.z for v in verts)
    z_hi = max(v.co.z for v in verts)
    if z_hi - z_lo < 1e-6:
        raise SystemExit("cart_widen_hopper: the hopper is flat in z; refusing to guess")

    scale_lo = FLOOR_HALF_NOW / FLOOR_HALF_WAS
    scale_hi = RIM_HALF_NOW / RIM_HALF_WAS

    before = max(abs(v.co.x) for v in verts)
    for v in verts:
        t = (v.co.z - z_lo) / (z_hi - z_lo)
        widened = v.co.x * (scale_lo + (scale_hi - scale_lo) * t)
        # **Capped at the rim's own half-width, and that cap is the point.**
        # The ramp alone bulges: the tub's lowest bevel loop starts at |x| 0.374
        # against the floor's 0.310, so the floor's much larger scale factor
        # reaches it too and threw the widest part of the cart down to 0.608 —
        # a tub with a belly, wider below than at its rim, and a footprint 8%
        # bigger than the rim it is supposed to be sized by. Clamping turns the
        # same ramp into a **vertical wall** at `RIM_HALF_NOW` from the bevel
        # upwards, which is both the shape that gives her arm the most room and
        # the one that costs the park nothing: the cart's footprint is exactly
        # its rim, so `CART_WIDTH_AT_PARK_SCALE` stays the one number every lane
        # is derived from.
        v.co.x = max(-RIM_HALF_NOW, min(RIM_HALF_NOW, widened))
    hopper.data.update()
    after = max(abs(v.co.x) for v in verts)

    bpy.ops.wm.save_mainfile(filepath=BLEND)
    return (
        f"hopper widened: floor half {FLOOR_HALF_WAS} -> {FLOOR_HALF_NOW}, "
        f"rim half {RIM_HALF_WAS} -> {RIM_HALF_NOW}; "
        f"max |x| {before:.4f} -> {after:.4f}"
    )


if __name__ == "__main__":
    print(widen_hopper())
