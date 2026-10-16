"""Renders every Library asset to ``art/renders/library/`` so a human can eyeball it.

    pnpm run render:library

Not part of ``pnpm run blend:library`` — it produces review pictures, not
shipped bytes. Run it whenever the shapes change.

Workbench, for ``castle_render.py``'s reasons: the game's look is flat banded
colour with an ink outline, and Workbench's object colour plus outline is the
closest a background render gets to that in a second.

## It reads the geometry, and it reads the colours. It copies neither.

* **The geometry comes from ``library.blend``**, opened here — the mesh that
  ships, not a second builder.
* **Every size comes from ``library_build``**, imported: the scale post is
  ``KID_HEIGHT`` and the rules across the lineup are the hip and reach, all
  read by that module out of ``kid.ts`` with ``ts_const``. Nothing is typed
  here — the bridge kit's render script once hand-copied its build's numbers
  and five committed renders were of a bridge that was not on the branch.
* **The colours** are the Engineer's ``LIBRARY_GLB_STYLES`` table in
  ``src/art/models/libraryAssets.ts`` (read by :func:`resolve_colours`'s regex,
  whatever the table is called); without that file, :data:`PROPOSED` —
  palette *keys*, never hex — printed loudly as a proposal.
* **The eye dots** on the face shots are painted at the anchors the build
  stored on each head (``face_eyes_uv``), through the head's own UVs, so the
  picture shows where the Engineer's painted eyes will land.

Framing, colour conversion and the stand-in boxes are ``castle_render``'s
functions, imported (the reptile kits do the same).

## A run is all or nothing

The first render round on this branch died part-way, and what got committed
was one truncated picture (``exterior.png``, 80 KiB of a PNG cut mid-IDAT)
beside four compositions left over from an older version of this script. So:

* **A run starts by deleting every PNG in** ``art/renders/library/``. A run
  that dies shows up in ``git status`` as deletions, and can never pass for a
  complete set.
* **Each frame is written to a hidden** ``.<stem>.png.part`` **file, checked,
  and only then renamed onto** ``<stem>.png`` — the rename is atomic, so the
  committed path never holds a half-written file. The check reads the file
  back: the PNG signature, an ``IHDR`` of exactly the size and colour type
  this frame asked for, and the ``IEND`` trailer at the very end.
* ``check:png-integrity`` walks every committed PNG in the repo for the same
  trailer, so a corpse that got past all of that still cannot reach ``main``.
"""

import math
import os
import re
import struct
import sys
import traceback

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import library_build as lb  # noqa: E402  (import-safe: everything is behind main())
from blendkit import REPO  # noqa: E402
from castle_render import (  # noqa: E402
    GAME_ELEVATION,
    configure,
    frame,
    linear_rgba,
    palette_values,
    standin,
)

OUT = os.path.join(REPO, "art", "renders", "library")
ENGINEER_MODULE = "src/art/models/libraryAssets.ts"

# The Artist's suggestion for the Engineer's LIBRARY_GLB_STYLES table — palette keys only.
PROPOSED = {
    "shell-plinth": "PALETTE.stoneGreyLight",
    "shell-steps": "PALETTE.stoneGrey",
    "shell-walls": "PALETTE.stonePink",
    "shell-windows": "PALETTE.buildingWindowWarm",
    "shell-door": "PALETTE.woodDark",
    "shell-columns": "ART.cream",
    "shell-entablature": "ART.cream",
    "shell-pediment": "ART.creamDark",
    "shell-pedimentBook": "PALETTE.liftFrame",
    "shell-roof": "PALETTE.buildingRoofDeep",
    "shelf-carcass": "PALETTE.woodDark",
    "shelf-shelves": "PALETTE.wood",
    "secretShelf-carcass": "PALETTE.woodDark",
    "secretShelf-shelves": "PALETTE.wood",
    "desk-body": "PALETTE.woodDark",
    "desk-top": "PALETTE.woodLight",
    "readingLamp-stem": "PALETTE.liftFrame",
    "readingLamp-shade": "PALETTE.buildingWindowWarm",
    "floorLamp-base": "PALETTE.woodDark",
    "floorLamp-stem": "PALETTE.liftFrame",
    "floorLamp-shade": "PALETTE.fairyWarm",
    "armchair-frame": "ART.jumperRed",
    "armchair-seat": "ART.heartPink",
    "armchair-feet": "PALETTE.woodDark",
    "cushion-body": "PALETTE.markerLilac",
    "book-tall-thin": "PALETTE.markerSky",
    "book-tall-thick": "PALETTE.markerPink",
    "book-mid-thin": "PALETTE.markerMint",
    "book-mid-thick": "PALETTE.markerLemon",
    "book-short-thin": "PALETTE.markerLilac",
    "book-short-thick": "ART.jumperRed",
    "bookPile-cover1": "PALETTE.markerSky",
    "bookPile-cover2": "ART.jumperRed",
    "bookPile-cover3": "PALETTE.markerMint",
    "bookPile-cover4": "PALETTE.markerLemon",
    "bookPile-cover5": "PALETTE.markerLilac",
    "bookPile-pages": "ART.cream",
    "reader-cover": "ART.jumperRed",
    "owl-body": "PALETTE.markerLilac",
    "owl-bib": "ART.biscuitMuzzle",
    "owl-buttons": "PALETTE.liftFrame",
    "owl-head": "ART.biscuitFur",
    "owl-beak": "ART.chickenBeak",
    "owl-glasses": "PALETTE.liftFrame",
    "owl-wingL": "ART.biscuitFurDark",
    "owl-wingR": "ART.biscuitFurDark",
    "owl-feet": "ART.chickenBeak",
    "owl-heldBook": "ART.jumperRed",
    "dragon-body": "ART.snakeMint",
    "dragon-belly": "ART.snakeBelly",
    "dragon-head": "ART.snakeMint",
    "dragon-horns": "ART.miniHorn",
    "dragon-spines": "ART.miniHorn",
    "dragon-wings": "PALETTE.markerPink",
    "dragon-tail": "ART.snakeMint",
    "dragonNest-pad": "ART.heartPink",
    "dragonNest-coversA": "PALETTE.markerSky",
    "dragonNest-coversB": "PALETTE.markerLemon",
    "dragonNest-coversC": "ART.jumperRed",
    "dragonNest-pages": "ART.cream",
    "cat-body": "ART.corgiTan",
    "cat-head": "ART.corgiTan",
    "cat-tail": "ART.corgiTan",
    "cat-earL": "ART.corgiTan",
    "cat-earR": "ART.corgiTan",
}

# Stand-ins (floor, walls, posts): palette keys too, so no hex appears here.
FLOOR = "PALETTE.buildingFloor"
WALL = "PALETTE.buildingWallDark"
POST = "PALETTE.markerMint"
TALL_POST = "PALETTE.buildingTrimDeep"
RULE_HIP = "PALETTE.flowerRed"
RULE_REACH = "PALETTE.markerSky"
INK = "PALETTE.ink"
BLUSH = "ART.blush"

# Spine colours for the books the composition puts on the shelves, cycled.
SPINES = ("PALETTE.markerSky", "ART.jumperRed", "PALETTE.markerMint", "PALETTE.markerLemon",
          "PALETTE.markerLilac", "PALETTE.markerPink", "PALETTE.flowerBlue", "ART.cornOrange")


def resolve_colours(values):
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
        source = ("PROPOSED in library_render.py — the Engineer's module is not on this branch "
                  "yet, so these renders show the Artist's SUGGESTED colours, not the game's")
    missing = [k for k in styles.values() if k not in values]
    assert not missing, f"colours named but not in the palette modules: {missing}"
    return {node: values[key] for node, key in styles.items()}, source, styles


def meshes():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def hide_all() -> None:
    for obj in meshes():
        obj.hide_render = True


def clone(name: str, location, yaw: float = 0.0, colour=None):
    """A placed copy of a node for a composition, keeping its own origin."""
    src = bpy.data.objects[name]
    obj = src.copy()
    obj.location = Vector(location) + Vector(src.location)
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = (0.0, 0.0, math.radians(yaw))
    obj.color = src.color if colour is None else colour
    obj.hide_render = False
    bpy.context.scene.collection.objects.link(obj)
    return obj


def place_asset(asset: str, location, yaw: float = 0.0):
    """Every node of an asset, as one object would be placed: a pivoted node's
    origin is offset by its pivot *rotated with the asset*, so the parts stay
    assembled at any yaw."""
    out = []
    c, s = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    for src in bpy.data.collections[asset].objects:
        p = Vector(src.location)
        rotated = Vector((p.x * c - p.y * s, p.x * s + p.y * c, p.z))
        obj = clone(src.name, Vector(location) + rotated - p, yaw)
        out.append(obj)
    return out


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# The whole IEND chunk: zero length, the type, and its fixed CRC.
PNG_TRAILER = b"\x00\x00\x00\x00IEND\xaeB`\x82"
PNG_COLOUR_TYPE = {"BW": 0, "RGB": 2, "RGBA": 6}


def verify_png(path: str, size, colour_mode: str) -> None:
    """The file at ``path`` is a whole PNG of ``size`` in ``colour_mode``.

    A render killed mid-write leaves a file that opens as a broken picture;
    this reads it back rather than trusting that ``save_render`` returned."""
    with open(path, "rb") as handle:
        data = handle.read()
    assert data[:8] == PNG_SIGNATURE and data[12:16] == b"IHDR", f"{path}: not a PNG"
    width, height = struct.unpack(">II", data[16:24])
    colour = data[25]
    assert (width, height) == tuple(size), f"{path}: {width}×{height}, asked for {size[0]}×{size[1]}"
    assert colour == PNG_COLOUR_TYPE[colour_mode], (
        f"{path}: PNG colour type {colour}, asked for {colour_mode} ({PNG_COLOUR_TYPE[colour_mode]})"
    )
    assert data.endswith(PNG_TRAILER), f"{path}: {len(data)} bytes and no IEND at the end — truncated"


def clear_renders() -> int:
    """Delete every picture (and any leftover part-file) before a run, so the
    set on disk is only ever one run's output."""
    gone = 0
    for name in os.listdir(OUT):
        if name.endswith(".png") or name.endswith(".png.part"):
            os.remove(os.path.join(OUT, name))
            gone += 1
    return gone


def shoot(stem: str, objects, azimuth: float, elevation: float, camera, pad: float = 1.25,
          size=(900, 700)) -> None:
    """Render, framing ``objects`` (which need not be everything visible), to
    ``<stem>.png`` — via a checked part-file and an atomic rename."""
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    # RGB, not castle_render's RGBA: the background is opaque anyway and the
    # alpha channel was a quarter of 17 MB of committed pictures.
    scene.render.image_settings.color_mode = "RGB"
    bpy.context.view_layer.update()
    frame(objects, azimuth, elevation, camera, pad)
    bpy.ops.render.render(write_still=False)
    final = os.path.join(OUT, f"{stem}.png")
    part = os.path.join(OUT, f".{stem}.png.part")
    bpy.data.images["Render Result"].save_render(filepath=part, scene=scene)
    verify_png(part, size, scene.render.image_settings.color_mode)
    os.replace(part, final)
    print(f"  wrote {stem}.png ({os.path.getsize(final)} bytes, checked)")


def remove(objs) -> None:
    for obj in objs:
        bpy.data.objects.remove(obj, do_unlink=True)


def face_texture(name: str, base: int, eyes, ink: int, blush: int, eye_r: float):
    """A canvas for a head: plain base colour, an ink dot at each eye anchor and
    a blush below-outboard of it — painted at the anchors' (u, v) exactly as
    the build stored them, through the head's own UVs. Blender's image rows
    count from the bottom, which is the same sense its UVs were written in, so
    within Blender (u, v) lands where the build meant it."""
    size = 256
    img = bpy.data.images.new(name, size, size)
    px = [0.0] * (size * size * 4)

    # The image is an sRGB image, so it is filled with sRGB values; filling it
    # with linear ones darkens the head (they get converted twice).
    def rgba(hex_value):
        return tuple(((hex_value >> sh) & 0xFF) / 255.0 for sh in (16, 8, 0)) + (1.0,)

    b = rgba(base)
    for i in range(size * size):
        px[i * 4:i * 4 + 4] = b
    for k in range(0, len(eyes), 2):
        u, v = eyes[k], eyes[k + 1]
        for (cu, cv, r, colour, sx) in ((u + (0.09 if u > 0.5 else -0.09), v + 0.13, eye_r * 0.8,
                                         rgba(blush), 1.4),
                                        (u, v, eye_r, rgba(ink), 0.78)):
            for y in range(size):
                for x in range(size):
                    du = ((x + 0.5) / size - cu) / sx
                    dv = (y + 0.5) / size - cv
                    if du * du + dv * dv <= r * r:
                        px[(y * size + x) * 4:(y * size + x) * 4 + 4] = colour
    img.pixels = px
    mat = bpy.data.materials.new(f"{name}-mat")
    mat.use_nodes = True
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    mat.node_tree.nodes.active = tex
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def main() -> None:
    values = palette_values()
    colours, source, styles = resolve_colours(values)
    bpy.ops.wm.open_mainfile(filepath=lb.BLEND)
    configure(colours)
    os.makedirs(OUT, exist_ok=True)
    print("\nlibrary_render")
    print(f"  cleared {clear_renders()} old file(s) from {OUT}")
    print(f"  colours from: {source}")
    undressed = sorted(o.name for o in meshes() if o.name not in styles)
    assert not undressed, f"nodes with no colour (would render magenta): {undressed}"

    cam = bpy.data.objects.new("review-cam", bpy.data.cameras.new("review-cam"))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    child_h, tallest_h = lb.CHILD_HEIGHT, lb.TALLEST_CHILD

    # --- one render per asset, each beside a child-height post --------------
    assets = sorted(c.name for c in bpy.data.collections)
    for asset in assets:
        hide_all()
        shown = list(bpy.data.collections[asset].objects)
        for obj in shown:
            obj.hide_render = False
        lo, hi = lb.asset_bounds(asset)
        span = max(hi.x - lo.x, hi.y - lo.y)
        post_x = hi.x + max(0.5, span * 0.15)
        post = standin(f"post-{asset}", (0.42, 0.42, child_h), (post_x, 0.0, child_h * 0.5),
                       values[POST])
        floor_w = (post_x + 0.6 - lo.x) + 1.2
        floor = standin(f"floor-{asset}", (floor_w, (hi.y - lo.y) + 1.6, 0.1),
                        ((lo.x + post_x + 0.6) * 0.5, (lo.y + hi.y) * 0.5, -0.05), values[FLOOR])
        shoot(asset, shown + [post, floor], 24.0, GAME_ELEVATION, cam, 1.12)
        remove([post, floor])
    print(f"    each beside a {child_h:.2f} m post (KID_HEIGHT, kid.ts via library_build)")

    # --- the secret shelf swung fully open, seen from behind ----------------
    # Its back panel and its hinge end are what a child walking into the den
    # sees, and no other picture shows them square on. The game's
    # `rotation.y` −π/2 is −90° about Blender Z, about the asset's origin —
    # which is the hinge.
    hide_all()
    made = place_asset("secretShelf", (0.0, 0.0, 0.0), yaw=-90.0)
    made.append(standin("open-floor", (6.0, 6.0, 0.1), (0.3, -2.0, -0.05), values[FLOOR]))
    made.append(standin("open-child", (0.42, 0.42, child_h), (1.6, -1.0, child_h * 0.5), values[POST]))
    for o in made:
        o.hide_render = False
    shoot("secretShelf-open", made, 115.0, GAME_ELEVATION, cam, 1.1)
    remove(made)

    # --- faces: eye dots at the stored anchors, through the head's UVs -------
    scene = bpy.context.scene
    scene.display.shading.color_type = "TEXTURE"
    for obj in meshes():
        mat = bpy.data.materials.new(f"{obj.name}-flat")
        mat.diffuse_color = tuple(obj.color)
        mat.use_nodes = True
        mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = tuple(obj.color)
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    for asset, head, eye_r in (("owl", "owl-head", 0.075), ("dragon", "dragon-head", 0.07),
                               ("cat", "cat-head", 0.06)):
        hide_all()
        obj = bpy.data.objects[head]
        eyes = list(obj["face_eyes_uv"])
        obj.data.materials.clear()
        obj.data.materials.append(face_texture(f"{head}-face", colours[head], eyes,
                                               values[INK], values[BLUSH], eye_r))
        shown = list(bpy.data.collections[asset].objects)
        for o in shown:
            o.hide_render = False
        shoot(f"{asset}-face", shown, 0.0, 12.0, cam, 1.15, (800, 800))
        shoot(f"{asset}-face-iso", shown, 24.0, GAME_ELEVATION, cam, 1.15, (800, 800))
    scene.display.shading.color_type = "OBJECT"
    print("    *-face.png: ink dots and blush painted at the build's stored eye anchors")

    # --- the exterior with children at the door ----------------------------
    hide_all()
    made = place_asset("shell", (0.0, 0.0, 0.0))
    for x, h, key in ((-1.0, child_h, POST), (1.0, tallest_h, TALL_POST)):
        made.append(standin(f"door-child-{h}", (0.42, 0.42, h),
                            (x, lb.DOOR_BACK_Y - 1.4, lb.PLINTH_TOP + h * 0.5), values[key]))
    made.append(standin("lawn", (30.0, 26.0, 0.1), (0.0, -2.0, -0.05), values["PALETTE.grass"]))
    for o in made:
        o.hide_render = False
    shoot("exterior", made, 28.0, GAME_ELEVATION, cam, 1.05, (1200, 900))
    shoot("exterior-front", made, 0.0, 6.0, cam, 1.05, (1200, 800))
    remove(made)

    # --- a corner of the reading room ---------------------------------------
    made = []
    made.append(standin("room-floor", (14.0, 10.0, 0.1), (0.0, 0.5, -0.05), values[FLOOR]))
    made.append(standin("room-wall", (14.0, 0.3, 3.6), (0.0, 5.65, 1.8), values[WALL]))
    # Two bookcases against the back wall, filled with the instancing books.
    levels, _ = lb.m_shelf_rows("shelf")
    book_names = [f"book-{h}-{t}" for h, _ in lb.BOOK_HEIGHTS for t, _ in lb.BOOK_THICKNESSES]
    n = 0
    for cx in (-4.2, 0.0):
        made += place_asset("shelf", (cx, 5.2, 0.0))
        for z in levels:
            x = cx - 1.80
            while True:
                name = book_names[(n * 7 + int(z * 10)) % len(book_names)]
                t = bpy.data.objects[name].dimensions.x
                if x + t > cx + 1.80:
                    break
                made.append(clone(name, (x + t * 0.5, 5.2 - 0.12, z),
                                  colour=linear_rgba(values[SPINES[n % len(SPINES)]])))
                x += t + 0.004
                n += 1
                if n % 9 == 0:
                    x += 0.25
    made += place_asset("desk", (3.6, 1.2, 0.0))
    # Behind the desk, 5 cm clear of its back edge — both read off the built
    # geometry, so a bigger beak or fatter glasses move her back on their own.
    _, desk_hi = lb.asset_bounds("desk")
    owl_lo, _ = lb.asset_bounds("owl")
    made += place_asset("owl", (3.6, 1.2 + desk_hi.y - owl_lo.y + 0.05, 0.0))
    made += place_asset("readingLamp", (2.6, 1.2, lb.COUNTER_TOP))
    made += place_asset("floorLamp", (-5.6, 1.6, 0.0))
    made += place_asset("armchair", (-4.4, 1.2, 0.0), yaw=-20.0)
    made += place_asset("cushion", (-2.4, 0.2, 0.0))
    made += place_asset("cushion", (-1.3, -0.6, 0.0))
    made += place_asset("bookPile", (0.6, 2.4, 0.0), yaw=10.0)
    _, pile_hi = lb.asset_bounds("bookPile")
    made += place_asset("cat", (0.6, 2.4, pile_hi.z), yaw=10.0)
    made += place_asset("reader-cover", (2.0, -1.2, 0.0), yaw=0.0)
    made.append(standin("room-child", (0.42, 0.42, child_h), (1.0, -1.6, child_h * 0.5),
                        values[POST]))
    for o in made:
        o.hide_render = False
    shoot("reading-room", made, 18.0, GAME_ELEVATION, cam, 0.92, (1300, 900))
    remove(made)

    # --- the secret den: the shelf swung open onto the dragon ---------------
    made = []
    made.append(standin("den-floor", (10.0, 10.0, 0.1), (0.0, 1.0, -0.05), values[FLOOR]))
    # The wall the secret shelf stands against, with the opening behind it.
    for x0, x1 in ((-5.0, -2.0), (2.0, 5.0)):
        made.append(standin(f"den-wall-{x0}", (x1 - x0, 0.3, 3.6), ((x0 + x1) * 0.5, 0.75, 1.8),
                            values[WALL]))
    made.append(standin("den-lintel", (4.0, 0.3, 0.4), (0.0, 0.75, 3.4), values[WALL]))
    shelf = place_asset("secretShelf", (-2.0, 0.0, 0.0), yaw=-62.0)
    made += shelf
    nest = place_asset("dragonNest", (0.3, 2.0, 0.0))
    _, pad_hi = lb.node_bounds("dragonNest-pad")
    dragon = place_asset("dragon", (0.3, 2.0, pad_hi.z), yaw=8.0)
    kid = standin("den-child", (0.42, 0.42, child_h), (2.6, 0.0, child_h * 0.5), values[POST])
    made += nest + dragon + [kid]
    for o in made:
        o.hide_render = False
    shoot("secret-den", shelf + nest + dragon + [kid], 20.0, GAME_ELEVATION, cam, 1.2, (1200, 900))
    remove(made)

    # --- everything in elevation, against the posts and the rig's lines -----
    made = []
    x = 0.0
    order = ["owl", "desk", "armchair", "cushion", "readingLamp", "floorLamp", "bookPile",
             "cat", "dragon", "dragonNest", "reader-cover"] + book_names + ["shelf"]
    for i, (h, key) in enumerate(((child_h, POST), (tallest_h, TALL_POST))):
        made.append(standin(f"lineup-post-{i}", (0.42, 0.42, h), (x + 0.21, 0.0, h * 0.5),
                            values[key]))
        x += 0.8
    for asset in order:
        lo, hi = lb.asset_bounds(asset)
        x += 0.25 - lo.x
        made += place_asset(asset, (x, 0.0, 0.0))
        x += hi.x + 0.25
    for h, key, tag in ((lb.CHILD_HIP, RULE_HIP, "hip"), (lb.CHILD_REACH, RULE_REACH, "reach")):
        made.append(standin(f"lineup-rule-{tag}", (x, 0.06, 0.03), (x * 0.5, 1.6, h),
                            values[key]))
    made.append(standin("lineup-floor", (x + 1.0, 4.0, 0.1), (x * 0.5, 0.8, -0.05), values[FLOOR]))
    for o in made:
        o.hide_render = False
    shoot("lineup", made, 0.0, 2.0, cam, 1.02, (2200, 520))
    remove(made)
    print(f"    lineup.png: every interior asset in elevation; posts {child_h:.2f} m and "
          f"{tallest_h:.2f} m; red rule = hip {lb.CHILD_HIP:.2f} m (a seat belongs on it), "
          f"blue rule = reach {lb.CHILD_REACH:.2f} m")
    print(f"  renders in {OUT}\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
