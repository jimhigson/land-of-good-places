"""Renders the Library's secret den kit to ``art/renders/library-den/`` so a human can eyeball it.

    pnpm run render:library-den

Not part of ``pnpm run blend:library-den`` — it produces review pictures, not
shipped bytes. Run it whenever the shapes change.

``library_render.py``'s sibling, and it imports that script's machinery rather
than copying it: the Workbench set-up, the framing, the stand-in boxes, the
checked part-file write and the folder clearing (``castle_render`` and
``library_render``), and ``place_asset``/``clone``. It reads the geometry from
``libraryDen.blend`` — the mesh that ships — and, for the compositions, appends
the library kit's own nest, dragon, bookcases and book blocks out of
``library.blend``, so the den is pictured with the things that will stand in
it. Every size comes from ``library_den_build`` and ``library_build``,
imported: the niche rows, the bays, the doorway, the child post. Nothing is
typed here.

The colours are the Engineer's ``LIBRARY_DEN_GLB_STYLES`` in
``src/art/models/libraryDenAssets.ts`` (read by the same regex
``library_render`` reads ``LIBRARY_GLB_STYLES`` with) and, for the appended
library pieces, that table; without the den module, :data:`PROPOSED` — palette
keys, never hex — printed loudly as a proposal.

A run is all or nothing, ``library_render``'s way: the folder is cleared
first, and every frame goes through a checked part-file and an atomic rename.
"""

import math
import os
import re
import sys
import traceback

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import library_build as lb  # noqa: E402
import library_den_build as ldb  # noqa: E402
import library_render as lr  # noqa: E402
from blendkit import REPO  # noqa: E402
from castle_render import GAME_ELEVATION, configure, linear_rgba, palette_values, standin  # noqa: E402

OUT = os.path.join(REPO, "art", "renders", "library-den")
ENGINEER_MODULE = "src/art/models/libraryDenAssets.ts"

# The Artist's suggestion for the Engineer's LIBRARY_DEN_GLB_STYLES table — palette keys only.
PROPOSED = {
    "den-floor": "PALETTE.wood",
    "den-wallWest": "PALETTE.buildingTrimDeep",
    "den-wallNorth": "PALETTE.buildingTrimDeep",
    "den-wallSouth": "PALETTE.buildingTrimDeep",
    "den-lintel": "PALETTE.buildingTrimDeep",
    "den-nicheBacks": "PALETTE.woodDark",
    "den-shelves": "PALETTE.wood",
    "den-stars": "PALETTE.liftFrame",
    "den-moon": "ART.cream",
    "denLantern-bracket": "PALETTE.liftFrame",
    "denLantern-glow": "PALETTE.fairyWarm",
    "secretBook-cover": "ART.helmetGold",
    "secretBook-pages": "ART.cream",
    "secretBook-star": "ART.shine",
}

# The library kit pieces the compositions borrow, by collection.
BORROWED = ("secretShelf", "shelf", "dragonNest", "dragon") + tuple(
    f"book-{h}-{t}" for h, _ in lb.BOOK_HEIGHTS for t, _ in lb.BOOK_THICKNESSES
)
# The game's camera stands south-east of the den — on the asset's doorway
# side (−Y) and its south side (−X) — so this is the azimuth that shows the
# den as she sees it: the far walls and their niches, the near ones hidden.
DEN_AZIMUTH = -45.0


def resolve_den_colours(values):
    """``{node: hex}`` for the den's nodes, from the Engineer's table or the proposal."""
    path = os.path.join(REPO, ENGINEER_MODULE)
    styles = None
    if os.path.exists(path):
        found = re.findall(
            r"['\"]?([a-z][\w-]*)['\"]?:\s*\{[^}]*?colour:\s*((?:PALETTE|ART)\.\w+)",
            open(path, encoding="utf-8").read(), re.DOTALL)
        styles = {name: key for name, key in found} or None
    if styles:
        source = f"{ENGINEER_MODULE} — the Engineer's own table"
    else:
        styles = PROPOSED
        source = ("PROPOSED in library_den_render.py — the Engineer's module is not on this branch "
                  "yet, so these renders show the Artist's SUGGESTED colours, not the game's")
    missing = [k for k in styles.values() if k not in values]
    assert not missing, f"colours named but not in the palette modules: {missing}"
    return {node: values[key] for node, key in styles.items()}, source, styles


def borrow_library_pieces() -> None:
    """Append the library kit's collections the compositions need, out of
    ``library.blend`` — the shipped shapes, not stand-ins."""
    with bpy.data.libraries.load(lb.BLEND, link=False) as (data_from, data_to):
        missing = [name for name in BORROWED if name not in data_from.collections]
        assert not missing, f"{lb.BLEND} lacks collections {missing}"
        data_to.collections = list(BORROWED)
    for coll in data_to.collections:
        assert coll is not None
        for obj in coll.objects:
            obj.hide_render = True


def shoot(stem, objects, azimuth, elevation, camera, pad=1.25, size=(900, 700)):
    lr.shoot(stem, objects, azimuth, elevation, camera, pad, size, out=OUT)


def shelve(made, bay0: float, bay1: float, rows, at, spine_colour_from: int = 0) -> int:
    """Fill a run of shelf rows with the kit's book blocks, as the game's
    ``shelveFace`` does: a row of spines with a gap every nine books.
    ``at(along, z)`` places one book's base-centre. Returns how many stood."""
    book_names = [f"book-{h}-{t}" for h, _ in lb.BOOK_HEIGHTS for t, _ in lb.BOOK_THICKNESSES]
    n = spine_colour_from
    stood = 0
    for z in rows:
        x = bay0 + 0.05
        while True:
            name = book_names[(n * 7 + int(z * 10)) % len(book_names)]
            t = bpy.data.objects[name].dimensions.x
            if x + t > bay1 - 0.05:
                break
            location, yaw = at(x + t * 0.5, z)
            made.append(lr.clone(name, location, yaw,
                                 colour=linear_rgba(lr_values[lr.SPINES[n % len(lr.SPINES)]])))
            x += t + 0.004
            n += 1
            stood += 1
            if n % 9 == 0:
                x += 0.22
    return stood


lr_values = {}


def main() -> None:
    global lr_values
    values = palette_values()
    lr_values = values
    den_colours, source, den_styles = resolve_den_colours(values)
    library_colours, library_source, _ = lr.resolve_colours(values)
    bpy.ops.wm.open_mainfile(filepath=ldb.BLEND)
    borrow_library_pieces()
    configure({**library_colours, **den_colours})
    os.makedirs(OUT, exist_ok=True)
    print("\nlibrary_den_render")
    print(f"  cleared {lr.clear_renders(OUT)} old file(s) from {OUT}")
    print(f"  den colours from: {source}")
    print(f"  library colours from: {library_source}")
    undressed = sorted(o.name for o in lr.meshes()
                       if o.name not in den_styles and o.name not in library_colours)
    assert not undressed, f"nodes with no colour (would render magenta): {undressed}"

    cam = bpy.data.objects.new("review-cam", bpy.data.cameras.new("review-cam"))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    child_h, tallest_h = lb.CHILD_HEIGHT, lb.TALLEST_CHILD
    floor_top = ldb.FLOOR_TOP

    # --- one render per asset, each beside a child-height post --------------
    for asset in sorted(ldb.CONTRACT):
        lr.hide_all()
        shown = list(bpy.data.collections[asset].objects)
        for obj in shown:
            obj.hide_render = False
        lo, hi = lb.asset_bounds(asset)
        span = max(hi.x - lo.x, hi.y - lo.y)
        base = floor_top if asset == "den" else 0.0
        post_x = hi.x + max(0.5, span * 0.15)
        post = standin(f"post-{asset}", (0.42, 0.42, child_h), (post_x, 0.0, base + child_h * 0.5),
                       values[lr.POST])
        floor_w = (post_x + 0.6 - lo.x) + 1.2
        floor = standin(f"floor-{asset}", (floor_w, (hi.y - lo.y) + 1.6, 0.1),
                        ((lo.x + post_x + 0.6) * 0.5, (lo.y + hi.y) * 0.5, base - 0.05), values[lr.FLOOR])
        azimuth = DEN_AZIMUTH if asset == "den" else 24.0
        shoot(asset, shown + [post, floor], azimuth, GAME_ELEVATION, cam, 1.12)
        lr.remove([post, floor])
    print(f"    each beside a {child_h:.2f} m post (KID_HEIGHT, kid.ts via library_build)")

    # --- the den as she finds it: niches full of books, the dragon on its ----
    # --- nest in the far corner, the secret shelf swung open along the south --
    # --- wall, lanterns on the far walls, a child inside the doorway ----------
    lr.hide_all()
    made = []
    for obj in bpy.data.collections["den"].objects:
        # The south wall is the camera's near side: the game draws it hidden.
        # The lintel is part of the room's west wall, which fades while she is
        # in the den; without the wall's spans either side it would float, so
        # the doorway shot below is where it is pictured.
        if obj.name not in ("den-wallSouth", "den-lintel"):
            obj.hide_render = False
            made.append(obj)
    rows = [floor_top + ldb.NICHE_Z0 + row * ldb.ROW_PITCH + lb.SHELF_BOARD for row in range(lb.SHELF_ROWS)]
    spine_in = lb.BOOK_DEPTH * 0.5 + 0.03  # a spine 3 cm behind the wall's face
    books = 0
    for bay0, bay1 in ldb.niche_bays(ldb.SOUTH_X, ldb.NORTH_X):
        books += shelve(made, bay0, bay1, rows, lambda along, z: ((along, ldb.FAR_Y + spine_in, z), 0.0), books)
    for bay0, bay1 in ldb.niche_bays(ldb.NEAR_Y, ldb.FAR_Y):
        books += shelve(made, bay0, bay1, rows, lambda along, z: ((ldb.NORTH_X + spine_in, along, z), -90.0), books)
    # The nest in the far corner, from layout.ts's LIBRARY_DRAGON_NEST (−22.6,
    # −6.3) in the room: the den's frame has x = −(z_room + 4) and y = x_room + 18.
    nest_at = (2.3, 4.6, floor_top)
    made += lr.place_asset("dragonNest", nest_at)
    _, pad_hi = lb.node_bounds("dragonNest-pad")
    made += lr.place_asset("dragon", (nest_at[0], nest_at[1], floor_top + pad_hi.z), yaw=35.0)
    # The secret shelf swung open: its hinge at the doorway's south edge on the
    # room wall's inner face, lying along the den's south wall, books facing in.
    made += lr.place_asset("secretShelf", (ldb.SOUTH_X + ldb.WALL_T, -ldb.WALL_HALF, floor_top), yaw=90.0)
    # Lanterns on a pier of each far wall, above the niches.
    lantern_z = floor_top + ldb.NICHE_Z1 + 0.2
    west_pier = ldb.niche_bays(ldb.SOUTH_X, ldb.NORTH_X)[0][1] + ldb.NICHE_PIER * 0.5
    north_pier = ldb.niche_bays(ldb.NEAR_Y, ldb.FAR_Y)[1][1] + ldb.NICHE_PIER * 0.5
    made += lr.place_asset("denLantern", (west_pier, ldb.FAR_Y, lantern_z))
    made += lr.place_asset("denLantern", (ldb.NORTH_X, north_pier, lantern_z), yaw=-90.0)
    # A child just inside the doorway (LIBRARY_DEN_DOORWAY_STAND, (−19.6, −4.3) in the room).
    made.append(standin("den-child", (0.42, 0.42, child_h), (0.3, 1.6, floor_top + child_h * 0.5),
                        values[lr.POST]))
    for o in made:
        o.hide_render = False
    shoot("den-interior", made, DEN_AZIMUTH, GAME_ELEVATION, cam, 1.0, (1300, 900))
    shoot("den-interior-plan", made, DEN_AZIMUTH, 72.0, cam, 1.0, (1100, 900))
    print(f"    den-interior.png: {books} kit books shelved in the six niches; the nest, dragon, open "
          "shelf and lanterns placed as the game will")
    lr.remove([o for o in made if o.name not in {c.name for c in bpy.data.collections["den"].objects}])

    # --- the doorway from the reading room: the shut shelf under the lintel --
    # --- between its neighbours, the pull book proud on its second row --------
    lr.hide_all()
    made = []
    lintel = bpy.data.objects["den-lintel"]
    lintel.hide_render = False
    made.append(lintel)
    span = 4.0
    # The spans are the room's wall, in the same paint as the lintel (the game
    # gives both the west wall's one material): if the lintel read as a
    # different colour here, the secret would look given away in the picture
    # and not in the game.
    for x0 in (-ldb.DEN_DOOR_HALF - span, ldb.DEN_DOOR_HALF):
        made.append(standin(f"room-wall-{x0}", (span, ldb.WALL_T, ldb.WALL_HEIGHT),
                            (x0 + span * 0.5, 0.0, floor_top + ldb.WALL_HEIGHT * 0.5), den_colours["den-lintel"]))
    made.append(standin("room-floor", (2 * span + 2 * ldb.DEN_DOOR_HALF + 2.0, 6.0, 0.1),
                        (0.0, -ldb.WALL_HALF - 3.0, floor_top - 0.05), values[lr.FLOOR]))
    # The shut leaf stands in the room against the wall's inner face; its
    # neighbours are ordinary cases a case's length either way.
    made += lr.place_asset("secretShelf", (-ldb.DEN_DOOR_HALF, -ldb.WALL_HALF - lb.SHELF_DEPTH, floor_top))
    for cx in (-ldb.DEN_DOOR_HALF - lb.SHELF_LENGTH * 0.5, ldb.DEN_DOOR_HALF + lb.SHELF_LENGTH * 0.5):
        made += lr.place_asset("shelf", (cx, -ldb.WALL_HALF - lb.SHELF_DEPTH * 0.5, floor_top))
    levels, _ = lb.m_shelf_rows("shelf")
    case_rows = [floor_top + z for z in levels]
    # A book's base-centre: the case's front (a case's depth in from the wall's
    # inner face), its boards' setback, a spine's inset, half a book.
    spine_y = -ldb.WALL_HALF - lb.SHELF_DEPTH + lb.SHELF_BOARD_SETBACK + 0.01 + lb.BOOK_DEPTH * 0.5
    n = 0
    for cx in (-ldb.DEN_DOOR_HALF - lb.SHELF_LENGTH * 0.5, 0.0, ldb.DEN_DOOR_HALF + lb.SHELF_LENGTH * 0.5):
        inner = lb.SHELF_LENGTH * 0.5 - lb.SHELF_SIDE_INSET - lb.SHELF_SIDE_T
        for row, z in enumerate(case_rows):
            # The pull book's slot on the secret shelf's second row (LIBRARY_SECRET_BOOK: shelf 1, along 0).
            halves = [(cx - inner, cx + inner)]
            if cx == 0.0 and row == 1:
                halves = [(cx - inner, cx - 0.12), (cx + 0.12, cx + inner)]
            for a, b in halves:
                n += shelve(made, a, b, [z], lambda along, zz: ((along, spine_y, zz), 0.0), n)
    _, book_hi = lb.asset_bounds("secretBook")
    made += lr.place_asset("secretBook", (0.0, spine_y - 0.03, case_rows[1]))
    made.append(standin("room-child", (0.42, 0.42, child_h), (-1.0, -2.6, floor_top + child_h * 0.5),
                        values[lr.POST]))
    for o in made:
        o.hide_render = False
    shoot("den-doorway", made, 16.0, GAME_ELEVATION, cam, 1.0, (1300, 900))
    shoot("secretBook-row", [o for o in made if "secretBook" in o.name or (o.name.startswith("book-") and abs(o.location.x) < 1.2 and abs(o.location.z - case_rows[1]) < 0.01)],
          8.0, 16.0, cam, 1.2, (1000, 600))
    print(f"    den-doorway.png: the lintel over the shut shelf, {n} kit books on three cases, the pull "
          f"book proud on the second row ({book_hi.z:.2f} m tall against {lb.TALL_BOOK:.2f} m)")
    lr.remove([o for o in made if o.name != "den-lintel"])

    # --- the lantern and the pull book in elevation against the posts --------
    lr.hide_all()
    made = []
    x = 0.0
    for i, (h, key) in enumerate(((child_h, lr.POST), (tallest_h, lr.TALL_POST))):
        made.append(standin(f"lineup-post-{i}", (0.42, 0.42, h), (x + 0.21, 0.0, h * 0.5), values[key]))
        x += 0.8
    for asset in ("denLantern", "secretBook", "book-tall-thick"):
        lo, hi = lb.asset_bounds(asset)
        x += 0.25 - lo.x
        made += lr.place_asset(asset, (x, 0.0, 0.0))
        x += hi.x + 0.25
    for h, key, tag in ((lb.CHILD_HIP, lr.RULE_HIP, "hip"), (lb.CHILD_REACH, lr.RULE_REACH, "reach")):
        made.append(standin(f"lineup-rule-{tag}", (x, 0.06, 0.03), (x * 0.5, 1.6, h), values[key]))
    made.append(standin("lineup-floor", (x + 1.0, 4.0, 0.1), (x * 0.5, 0.8, -0.05), values[lr.FLOOR]))
    for o in made:
        o.hide_render = False
    shoot("lineup", made, 0.0, 2.0, cam, 1.1, (900, 900))
    lr.remove(made)
    print(f"    lineup.png: the lantern, the pull book and the kit's tall thick book in elevation; posts "
          f"{child_h:.2f} m and {tallest_h:.2f} m; red rule = hip {lb.CHILD_HIP:.2f} m, blue rule = reach "
          f"{lb.CHILD_REACH:.2f} m")
    print(f"  renders in {OUT}\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
