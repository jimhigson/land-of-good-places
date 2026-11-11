"""Builds the doorway-frame kit: one frame per interior style, no door.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/doorframes_build.py

Jim, 11 November 2026: *"in the game when in interior spaces the exit to
outside is usually a door in a hidden wall, with no visual indicator where the
door is ... model a doorway (no door, just a frame) appropriate stylistically
to each setting, to make it obvious to the player where the exit is."*

Four styles, one per interior with a way out to the park:

* ``hotel``   — the lobby: painted wood trim, a plinth and a capital on each
  post, a panelled lintel, and a round fan bonnet over it with a star.
* ``library`` — the reading room: posts of stacked chunky books, a lintel of
  upright book spines, and an open book on top.
* ``reptile`` — the Reptile House: mossy stacked stones, a lintel that is a
  fat snake's body, and the snake's head resting on the front, looking out.
* ``castle``  — the castle's ground floor: ashlar quoins, a lintel of stone
  blocks and a keystone under the castle's own ceiling, and a crenellated
  gatehouse top with a shield standing over it, above the porch roof.

**The kit knows no opening.** Every doorway's width belongs to its room's own
owner (``hotel/layout.ts``'s ``DOOR_HALF``, ``reptileDoorGap()``,
``libraryDoorGap()``, ``INTERIOR_DOOR_MIN_X``), so the frame is built as parts
the game fits to whatever gap it is given — copying four widths in here would
be CLAUDE.md's "two definitions of one thing". ``src/art/models/doorFrames.ts``
stands a post either side of the gap, tiles the lintel across the posts and
the gap, and sets the crest on the lintel's middle; it **measures** every
figure it needs (post width, depth and height, a lintel tile's width and
height) off the shipped geometry, so the numbers below are owned here once.

Node naming: ``doorframe-<style>-<role>[-<variant>]``, ``role`` one of
``post`` (stood once at each side), ``lintel`` (one tile, repeated across) and
``crest`` (once, centred on the lintel's top). Every node has its own origin
at the **base centre of its role**: a post's foot, a lintel tile's underside,
the crest's seat on the lintel's top — so the game places each at a point it
already knows and nothing carries a pivot.

Shape only: no colour, no material (the loader paints each node). Blender −Y
is the game's +Z — the way out, towards the camera.

The heights are the one thing the game is held to from here: every post must
stand at least ``TALLEST_CHILD_HEIGHT`` + 5 cm (the hatted child walks under
every lintel), and the castle's whole frame must fit under its ceiling
(``BUILDING_FLOOR_HEIGHT − BUILDING_SLAB``). Both are read from the game's own
modules (``blendkit.ts_const``), never typed.
"""

import math
import os
import sys
import traceback

import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blendkit as kit  # noqa: E402

BLEND = os.path.join(kit.REPO, "art", "blend", "doorframes.blend")

TALLEST_CHILD_HEIGHT = kit.ts_const("src/art/models/kid.ts", "TALLEST_CHILD_HEIGHT")
CASTLE_CEILING = kit.ts_const("src/core/constants.ts", "BUILDING_FLOOR_HEIGHT") - kit.ts_const(
    "src/core/constants.ts", "BUILDING_SLAB"
)
#: How far over the tallest hatted child every lintel's underside stands.
HEADROOM = 0.05
#: How far under the castle's ceiling its frame's top stops, so the two never share a plane.
CEILING_GAP = 0.02

# -----------------------------------------------------------------------------
# The contract: every figure the game measures, owned here once.
#   post   W (across, X)  D (deep, game Z)  H (to its top = the lintel's underside)
#   lintel T (one tile's width)  L (its height)  DL (its depth, proud of the post)
# The posts are deeper than every room's wall (0.6 m at the most) so no face
# of a post lies in a wall face's plane.
# -----------------------------------------------------------------------------
CONTRACT = {
    "hotel": {"W": 0.44, "D": 0.80, "H": 3.25, "T": 0.90, "L": 0.42, "DL": 0.90},
    "library": {"W": 0.56, "D": 0.80, "H": 3.25, "T": 1.00, "L": 0.56, "DL": 0.86},
    "reptile": {"W": 0.60, "D": 0.82, "H": 3.25, "T": 0.80, "L": 0.56, "DL": 0.86},
    "castle": {"W": 0.62, "D": 0.80, "H": TALLEST_CHILD_HEIGHT + HEADROOM, "T": 0.80, "L": 0.0, "DL": 0.88},
}
# The castle's lintel fills the band between its posts' tops and its ceiling.
CONTRACT["castle"]["L"] = round(CASTLE_CEILING - CEILING_GAP - CONTRACT["castle"]["H"], 4)
#: The castle's gatehouse top over the lintel: width, depth, block height, merlon height.
PARAPET_W, PARAPET_D, PARAPET_H, MERLON_H = 4.2, 0.6, 0.85, 0.55
#: The top of the castle porch roof just outside the door — the line the
#: parapet must clear to be seen. Read from `Shell.ts`, never typed.
PORCH_ROOF_TOP = kit.ts_const("src/world/building/Shell.ts", "INTERIOR_PORCH_ROOF_Y") + kit.ts_const(
    "src/world/building/Shell.ts", "INTERIOR_PORCH_ROOF_THICKNESS"
) / 2


def box_at(part, sx, sy, sz, x=0.0, y=0.0, z0=0.0, radius=0.05, segments=2):
    """A rounded box standing on ``z0``, centred on (x, y)."""
    verts, faces = kit.rounded_box(sx, sy, sz, radius, segments)
    return part.at(verts, faces, x=x, y=y, z=z0 + sz * 0.5)


def flat_box_at(part, sx, sy, sz, x=0.0, y=0.0, z0=0.0, radius=0.05):
    verts, faces = kit.flat_top_box(sx, sy, sz, radius)
    return part.at(verts, faces, x=x, y=y, z=z0 + sz * 0.5)


# =============================================================================
# hotel — painted wood trim
# =============================================================================


def build_hotel(coll):
    c = CONTRACT["hotel"]
    W, D, H, T, L, DL = c["W"], c["D"], c["H"], c["T"], c["L"], c["DL"]
    post = kit.Part("doorframe-hotel-post")
    # A plinth, a shaft and a capital: the three things that say "door trim"
    # rather than "plank". The plinth and capital are the post's full width and
    # depth; the shaft is inset, so the silhouette steps.
    flat_box_at(post, W, D, 0.42, radius=0.06)
    box_at(post, W * 0.78, D * 0.82, H - 0.42 - 0.26, z0=0.42 - 0.02, radius=0.07)
    flat_box_at(post, W, D, 0.26, z0=H - 0.26, radius=0.06)
    post.emit(coll)

    lintel = kit.Part("doorframe-hotel-lintel")
    # One panel of the panelled header: the panels' rounded ends make the seams.
    box_at(lintel, T, DL, L, radius=0.08)
    lintel.emit(coll)

    crest = kit.Part("doorframe-hotel-crest")
    # A round fan bonnet: a half-disc standing on the lintel, chunky and soft.
    r = 0.78
    outline = [(r * math.cos(math.pi * i / 16), r * math.sin(math.pi * i / 16)) for i in range(17)]
    verts, faces = kit.extrude_outline(outline, 0.36, centre=(0.0, r * 0.4))
    crest.add(verts, faces)
    crest.emit(coll)

    star = kit.Part("doorframe-hotel-crest-star")
    points = []
    for i in range(10):
        radius = 0.3 if i % 2 == 0 else 0.13
        a = math.pi / 2 + i * math.pi / 5
        points.append((radius * math.cos(a), 0.4 + radius * math.sin(a)))
    verts, faces = kit.extrude_outline(points, 0.2, centre=(0.0, 0.4))
    # Proud of the bonnet's front face (y −0.18) by 6 cm; its back face is buried.
    star.add(verts, faces, Matrix.Translation((0.0, -0.14, 0.0)))
    star.emit(coll)


# =============================================================================
# library — books
# =============================================================================

# Book sizes for the posts: (height, width scale, depth scale, x nudge, y nudge).
# Deterministic, hand-set: a stack that leans a little this way and that.
POST_BOOKS = [
    (0.50, 1.00, 1.00, 0.00, 0.00),
    (0.42, 0.92, 0.94, 0.03, -0.02),
    (0.46, 0.98, 0.97, -0.02, 0.02),
    (0.38, 0.90, 0.92, 0.02, 0.00),
    (0.48, 0.96, 0.99, -0.03, -0.01),
    (0.44, 0.93, 0.95, 0.01, 0.02),
]
# Spines across one lintel tile: (width, height) — five books, sized to sum to T.
LINTEL_SPINES = [(0.22, 0.56), (0.18, 0.48), (0.21, 0.53), (0.17, 0.44), (0.22, 0.51)]


def build_library(coll):
    c = CONTRACT["library"]
    W, D, H, T, L, DL = c["W"], c["D"], c["H"], c["T"], c["L"], c["DL"]
    parts = {v: kit.Part(f"doorframe-library-post-{v}") for v in "abc"}
    total = sum(b[0] for b in POST_BOOKS)
    z = 0.0
    for i, (h, ws, ds, dx, dy) in enumerate(POST_BOOKS):
        h = h * H / total
        # Never wider or deeper than the post's own footprint, so the measured
        # W and D are the stack's bottom book, the one that is the full size.
        bw = W * ws
        bd = D * ds
        bx = max(-(W - bw) / 2, min((W - bw) / 2, dx))
        by = max(-(D - bd) / 2, min((D - bd) / 2, dy))
        box_at(parts["abc"[i % 3]], bw, bd, h, x=bx, y=by, z0=z, radius=0.05)
        z += h
    for p in parts.values():
        p.emit(coll)

    spines = {v: kit.Part(f"doorframe-library-lintel-{v}") for v in "abc"}
    width = sum(s[0] for s in LINTEL_SPINES)
    x = -T / 2
    for i, (w, h) in enumerate(LINTEL_SPINES):
        w = w * T / width
        h = h * L / max(s[1] for s in LINTEL_SPINES)
        box_at(spines["bca"[i % 3]], w, DL - 0.04 * (i % 2), h, x=x + w / 2, z0=0.0, radius=0.04)
        x += w
    for p in spines.values():
        p.emit(coll)

    # The crest: an open book, its two leaves spread like a roof, on the
    # spines' tallest top. Cover and pages are two nodes for two colours.
    cover = kit.Part("doorframe-library-crest-cover")
    pages = kit.Part("doorframe-library-crest-pages")
    for side in (-1, 1):
        tilt = Matrix.Rotation(side * math.radians(-18), 4, "Y")
        leaf = Matrix.Translation((side * 0.36, 0.0, 0.16)) @ tilt
        verts, faces = kit.rounded_box(0.74, 0.5, 0.08, 0.03)
        cover.add(verts, faces, leaf)
        verts, faces = kit.rounded_box(0.66, 0.44, 0.1, 0.03)
        pages.add(verts, faces, Matrix.Translation((0.0, 0.0, 0.06)) @ leaf)
    cover.emit(coll)
    pages.emit(coll)


# =============================================================================
# reptile — mossy stone and a snake
# =============================================================================

STONES = [
    (0.62, 1.00, 1.00, 0.00, 0.00),
    (0.48, 0.90, 0.94, 0.03, 0.02),
    (0.56, 0.96, 0.97, -0.03, -0.02),
    (0.50, 0.92, 0.95, 0.02, 0.01),
    (0.58, 0.97, 0.98, -0.02, 0.00),
    (0.51, 0.94, 0.93, 0.01, -0.02),
]


def build_reptile(coll):
    c = CONTRACT["reptile"]
    W, D, H, T, L, DL = c["W"], c["D"], c["H"], c["T"], c["L"], c["DL"]
    post = kit.Part("doorframe-reptile-post")
    moss = kit.Part("doorframe-reptile-post-moss")
    total = sum(s[0] for s in STONES)
    z = 0.0
    for i, (h, ws, ds, dx, dy) in enumerate(STONES):
        h = h * H / total
        sw = W * ws
        sd = D * ds
        sx = max(-(W - sw) / 2, min((W - sw) / 2, dx))
        sy = max(-(D - sd) / 2, min((D - sd) / 2, dy))
        box_at(post, sw, sd, h, x=sx, y=sy, z0=z, radius=0.12, segments=3)
        if i % 2 == 1:
            # A cushion of moss on the stone's front shoulder, towards the camera.
            verts, faces = kit.ellipsoid(sw * 0.34, 0.12, 0.09, 2)
            moss.at(verts, faces, x=sx + (0.08 if i % 4 == 1 else -0.08), y=sy - sd * 0.5 + 0.06, z=z + h - 0.03)
        z += h
    # And a mossy cap on top, under the snake.
    verts, faces = kit.ellipsoid(W * 0.42, D * 0.4, 0.06, 2)
    moss.at(verts, faces, z=H - 0.02)
    post.emit(coll)
    moss.emit(coll)

    # One tile of the snake's body: a fat round tube along X, lying on the posts.
    r = L / 2
    body = kit.Part("doorframe-reptile-lintel")
    pts = [(-T / 2 + T * i / 6, 0.0, r) for i in range(7)]
    verts, faces = kit.sweep_path(pts, r, sides=14, up=(0.0, 1.0, 0.0), closed=False)
    body.add(verts, faces)
    body.emit(coll)
    # Its markings: three flat diamonds on the top and front of each tile.
    spots = kit.Part("doorframe-reptile-lintel-spots")
    for i, x in enumerate((-T / 3, 0.0, T / 3)):
        verts, faces = kit.ellipsoid(0.11, 0.07, 0.05, 1)
        angle = math.radians(35 if i % 2 == 0 else 60)
        place = Matrix.Translation((x, 0.0, r)) @ Matrix.Rotation(angle, 4, "X") @ Matrix.Translation((0.0, 0.0, r - 0.01))
        spots.add(verts, faces, place)
    spots.emit(coll)

    # The head, resting on the front of the body in the middle, looking out.
    # The crest's seat is the lintel's top, so the head hangs down its front.
    head = kit.Part("doorframe-reptile-crest")
    verts, faces = kit.ellipsoid(0.36, 0.3, 0.24, 3)
    head.at(verts, faces, y=-r - 0.08, z=-r * 0.55)
    # A brow ridge each side, for the eyes to sit on.
    for side in (-1, 1):
        verts, faces = kit.ellipsoid(0.12, 0.12, 0.1, 2)
        head.at(verts, faces, x=side * 0.15, y=-r - 0.02, z=-r * 0.55 + 0.17)
    head.emit(coll)
    eyes = kit.Part("doorframe-reptile-crest-eyes")
    pupils = kit.Part("doorframe-reptile-crest-pupils")
    for side in (-1, 1):
        verts, faces = kit.ellipsoid(0.1, 0.08, 0.1, 2)
        eyes.at(verts, faces, x=side * 0.15, y=-r - 0.1, z=-r * 0.55 + 0.2)
        verts, faces = kit.ellipsoid(0.05, 0.03, 0.06, 2)
        pupils.at(verts, faces, x=side * 0.15, y=-r - 0.17, z=-r * 0.55 + 0.2)
    eyes.emit(coll)
    pupils.emit(coll)
    tongue = kit.Part("doorframe-reptile-crest-tongue")
    base = (0.0, -r - 0.36, -r * 0.55 - 0.08)
    for side in (-1, 1):
        pts = [base, (side * 0.02, base[1] - 0.1, base[2] - 0.05), (side * 0.07, base[1] - 0.16, base[2] - 0.06)]
        verts, faces = kit.sweep_path(pts, 0.022, sides=6, up=(0.0, 0.0, 1.0), closed=False)
        tongue.add(verts, faces)
    tongue.emit(coll)


# =============================================================================
# castle — stone
# =============================================================================


def build_castle(coll):
    c = CONTRACT["castle"]
    W, D, H, T, L, DL = c["W"], c["D"], c["H"], c["T"], c["L"], c["DL"]
    post = kit.Part("doorframe-castle-post")
    # Quoins: long and short blocks alternating, the long ones the full width.
    courses = 6
    h = H / courses
    for i in range(courses):
        long_block = i % 2 == 0
        bw = W if long_block else W * 0.8
        bx = 0.0 if long_block else (W - bw) / 2
        bd = D if long_block else D * 0.92
        # A 2 cm joint between courses, none at the floor or under the lintel.
        z0 = i * h + (0.01 if i > 0 else 0.0)
        z1 = (i + 1) * h - (0.01 if i < courses - 1 else 0.0)
        box_at(post, bw, bd, z1 - z0, x=bx, z0=z0, radius=0.06)
    post.emit(coll)

    lintel = kit.Part("doorframe-castle-lintel")
    # One voussoir-ish block; the rounded edges between tiles read as joints.
    box_at(lintel, T, DL, L, radius=0.05)
    lintel.emit(coll)

    # The keystone: a wedge wider at the top, standing proud of the lintel
    # towards the camera — within the lintel's own band, because there is no
    # room above it under the ceiling.
    crest = kit.Part("doorframe-castle-crest")
    top_w, bottom_w = 0.62, 0.42
    outline = [(-bottom_w / 2, 0.0), (bottom_w / 2, 0.0), (top_w / 2, L), (-top_w / 2, L)]
    verts, faces = kit.extrude_outline(outline, 0.24, centre=(0.0, L / 2))
    # Seated on the lintel's top means its foot is at −L in the crest's frame.
    crest.add(verts, faces, Matrix.Translation((0.0, -DL / 2 - 0.08, -L)))
    crest.emit(coll)

    # **The gatehouse top.** From the game's camera the castle's porch roof,
    # just outside, hides everything at the doorway lower than its own top
    # (3.21 m) — posts, lintel and keystone included — so on its own the frame
    # was a strip of stone a child could not find. This stands on the lintel,
    # in the gap the walls leave over the door, and rises clear above the
    # porch roof and the wall's own top: a crenellated block with a pink
    # shield, the one part of the frame the camera always sees.
    parapet = kit.Part("doorframe-castle-crest-parapet")
    flat_box_at(parapet, PARAPET_W, PARAPET_D, PARAPET_H, radius=0.06)
    merlons = 4
    pitch = PARAPET_W / merlons
    for i in range(merlons):
        x = -PARAPET_W / 2 + pitch * (i + 0.5)
        box_at(parapet, pitch * 0.62, PARAPET_D * 0.9, MERLON_H, x=x, z0=PARAPET_H - 0.02, radius=0.06)
    parapet.emit(coll)
    shield = kit.Part("doorframe-castle-crest-shield")
    sw, sh = 0.86, 0.72
    outline = [(-sw / 2, sh), (sw / 2, sh), (sw / 2, sh * 0.45), (0.0, 0.0), (-sw / 2, sh * 0.45)]
    verts, faces = kit.extrude_outline(outline, 0.16, centre=(0.0, sh * 0.55))
    # On the parapet's camera face, proud of it, its back buried in the block,
    # and its top well under the block's (check:coplanar: never in one plane).
    shield.add(verts, faces, Matrix.Translation((0.0, -PARAPET_D / 2 - 0.04, 0.04)))
    shield.emit(coll)


# =============================================================================
# Assertions on what was emitted
# =============================================================================


def bounds(obj):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for v in obj.data.vertices:
        for i in range(3):
            lo[i] = min(lo[i], v.co[i])
            hi[i] = max(hi[i], v.co[i])
    return lo, hi


def union_bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objs:
        a, b = bounds(obj)
        for i in range(3):
            lo[i] = min(lo[i], a[i])
            hi[i] = max(hi[i], b[i])
    return lo, hi


def check_contract():
    tol = 1e-3
    by_name = {o.name: o for o in bpy.data.objects if o.type == "MESH"}
    for style, c in CONTRACT.items():
        posts = [o for n, o in by_name.items() if n.startswith(f"doorframe-{style}-post")]
        lintels = [o for n, o in by_name.items() if n.startswith(f"doorframe-{style}-lintel")]
        crests = [o for n, o in by_name.items() if n.startswith(f"doorframe-{style}-crest")]
        assert posts and lintels and crests, f"{style}: missing a role ({len(posts)} posts, {len(lintels)} lintels, {len(crests)} crests)"
        # The stone (or wood, or books) is the contract; moss sits on it.
        stone = [o for o in posts if not o.name.endswith("-moss")]
        lo, hi = union_bounds(stone)
        size = hi - lo
        assert abs(size.x - c["W"]) < tol, f"{style} post is {size.x:.3f} m wide, contract {c['W']}"
        assert abs(size.y - c["D"]) < tol, f"{style} post is {size.y:.3f} m deep, contract {c['D']}"
        assert abs(lo.z) < tol, f"{style} post's foot is at {lo.z:+.3f}, not on the floor"
        assert abs(hi.z - c["H"]) < tol, f"{style} post is {hi.z:.3f} m tall, contract {c['H']}"
        assert c["H"] >= TALLEST_CHILD_HEIGHT + HEADROOM - 1e-6, (
            f"{style}: its lintel's underside ({c['H']:.3f} m) is under the tallest child ({TALLEST_CHILD_HEIGHT}) + {HEADROOM}"
        )
        assert abs(lo.x + hi.x) < tol and abs(lo.y + hi.y) < tol, f"{style} post is not centred on its origin"
        lo, hi = union_bounds(lintels)
        size = hi - lo
        assert abs(size.x - c["T"]) < tol, f"{style} lintel tile is {size.x:.3f} m wide, contract {c['T']}"
        assert abs(size.z - c["L"]) < tol, f"{style} lintel tile is {size.z:.3f} m tall, contract {c['L']}"
        assert abs(lo.z) < tol, f"{style} lintel tile's underside is at {lo.z:+.3f}, not its origin"
        # Never the post's own depth, so a lintel's face and a post's are never one plane.
        assert abs(size.y - c["D"]) > 0.02, f"{style} lintel ({size.y:.3f} m deep) is as deep as its post ({c['D']})"
        lo, hi = union_bounds(crests)
        assert abs(lo.x + hi.x) < 0.02, f"{style} crest is not centred across"
    # The castle's posts, lintel and keystone fit under its ceiling; the
    # gatehouse top stands in the gap over the door and clears the porch roof.
    c = CONTRACT["castle"]
    _, hi = union_bounds([by_name["doorframe-castle-crest"]])
    top = c["H"] + c["L"] + hi.z
    assert top <= CASTLE_CEILING - CEILING_GAP + 1e-6, f"castle keystone tops out at {top:.3f}, ceiling {CASTLE_CEILING}"
    lo, _ = union_bounds([by_name["doorframe-castle-crest-parapet"]])
    assert c["H"] + c["L"] + lo.z > PORCH_ROOF_TOP, "the castle's gatehouse top starts under the porch roof's top"
    for obj in by_name.values():
        assert "." not in obj.name, f"{obj.name}: a dotted name loads back renamed"
    print("  contract holds:", ", ".join(f"{s} post {c['W']}×{c['D']}×{c['H']:.3f}" for s, c in CONTRACT.items()))


def main():
    kit.reset_scene()
    for style, build in (("hotel", build_hotel), ("library", build_library), ("reptile", build_reptile), ("castle", build_castle)):
        build(kit.collection(f"doorframe-{style}"))
    check_contract()
    print(kit.summarise())
    print(f"  {kit.total_triangles()} triangles")
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("  wrote", BLEND)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
