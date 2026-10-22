"""Renders every story-props asset to ``art/renders/story-props/`` so a human
can eyeball it.

    pnpm run render:story-props

Not part of ``pnpm run blend:story-props`` — it produces review pictures, not
shipped bytes. Run it whenever the shapes change.

Workbench, for ``castle_render.py``'s reasons: the game's look is flat banded
colour with an ink outline, and Workbench's object colour plus outline is the
closest a background render gets to that in a second.

## It reads the geometry, and it reads the colours. It copies neither.

* **The geometry comes from ``story_props.blend``**, opened here — the mesh
  that ships, not a second builder.
* **Every size comes from ``story_props_build``**, imported: the scale post is
  ``KID_HEIGHT``, read by that module out of ``kid.ts`` with ``ts_const``.
  Nothing is typed here — the bridge kit's render script once hand-copied its
  build's numbers and five committed renders were of a bridge that was not on
  the branch.
* **The colours** are the loader's ``STORY_PROPS_STYLES`` table in
  ``src/world/library/reader/storyProps.ts`` (read by :func:`resolve_colours`'s
  regex, the same one ``library_render`` uses), and the rainbow bands are
  ``ART.rainbow``'s array read from the palette module, inner band first, the
  way the loader colours them; without the loader, :data:`PROPOSED` — palette
  *keys*, never hex — printed loudly as a proposal.
* **The eye dots** on the two face shots are painted at the anchors the build
  stored on each faced node (``face_eyes_uv``), through the node's own UVs, so
  the picture shows where the loader's painted eyes will land.

Framing, colour conversion and the stand-in boxes are ``castle_render``'s
functions, imported; the checked part-file write, the clone and the
placement helpers are ``library_render``'s (the reptile kits do the same).

## A run is all or nothing

A run starts by deleting every PNG in the folder, and every frame goes through
``library_render``'s checked part-file and atomic rename, so the committed set
is only ever one whole run's (``check:png-integrity`` guards the commit).
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

import library_build as lb  # noqa: E402  (import-safe: everything is behind main())
import story_props_build as sp  # noqa: E402
from blendkit import REPO  # noqa: E402
from castle_render import (  # noqa: E402
    GAME_ELEVATION,
    configure,
    frame,
    linear_rgba,
    palette_values,
    standin,
)
from library_render import clone, face_texture, place_asset, verify_png  # noqa: E402

OUT = os.path.join(REPO, "art", "renders", "story-props")
LOADER_MODULE = "src/world/library/reader/storyProps.ts"

# The Artist's suggestion for the loader's STORY_PROPS_STYLES table — palette keys only.
PROPOSED = {
    "storm-cloud-face": "PALETTE.stoneGreyMid",
    "storm-cloud-puffs": "PALETTE.stoneGreyMid",
    "fluffy-cloud": "ART.wingWhite",
    "queue-posts-posts": "PALETTE.liftFrame",
    "queue-posts-rope": "ART.jumperRed",
    "rubber-duck-body": "PALETTE.flowerYellow",
    "rubber-duck-head": "PALETTE.flowerYellow",
    "rubber-duck-beak": "ART.chickenBeak",
    "park-bench-seat": "PALETTE.woodLight",
    "park-bench-legs": "PALETTE.woodDark",
    "magnifying-glass-frame": "PALETTE.liftFrame",
    "magnifying-glass-lens": "PALETTE.glassTint",
    "pancake-footprint": "PALETTE.pathSandDark",
    "giant-footprint": "PALETTE.pathSandDark",
    "spoon": "PALETTE.stoneGreyLight",
    "flat-stone": "PALETTE.stoneGreyLight",
    "stick": "PALETTE.bark",
    "open-book-cover": "PALETTE.markerSky",
    "open-book-pages": "PALETTE.signBoard",
    "loose-page": "PALETTE.signBoard",
    "closed-book-cover": "PALETTE.markerPink",
    "closed-book-pages": "PALETTE.signBoard",
    "flower-stem": "PALETTE.leafMid",
    "flower-petals": "PALETTE.blossomPink",
    "flower-centre": "PALETTE.flowerYellow",
    "petal": "PALETTE.flowerYellow",
    "picnic-blanket-cloth": "ART.jumperRed",
    "picnic-blanket-checks": "ART.cream",
    "sandwich-bread": "ART.cream",
    "sandwich-filling": "PALETTE.leafLight",
    "sandwich-tower-bread": "ART.cream",
    "sandwich-tower-filling": "PALETTE.leafLight",
    "sandwich-heap-bread": "ART.cream",
    "sandwich-heap-filling": "PALETTE.leafLight",
    "jam-tart-pastry": "ART.biscuitFur",
    "jam-tart-jam": "ART.jumperRedDark",
    "cake-sponge": "ART.creamDark",
    "cake-icing": "PALETTE.blossomPink",
    "cake-cherry": "ART.jumperRed",
    "puddle": "PALETTE.waterTop",
    "window-frame": "PALETTE.wood",
    "umbrella-inside-out-canopy": "ART.jumperRed",
    "umbrella-inside-out-handle": "PALETTE.woodDark",
    "battlement": "PALETTE.buildingWall",
    "story-wheel-rim": "PALETTE.markerPink",
    "story-wheel-spokes": "PALETTE.liftFrame",
    "story-wheel-cars": "PALETTE.markerSky",
    "story-wheel-legs": "PALETTE.buildingTrimDeep",
    "story-wheel-bracket": "PALETTE.liftFrame",
    "story-wheel-lights": "PALETTE.flowerYellow",
    "feather": "ART.chickenWhite",
    "twig-nest-bowl": "PALETTE.barkDark",
    "twig-nest-twigs": "PALETTE.bark",
    "biscuit-treat-body": "ART.biscuitFur",
    "biscuit-treat-chips": "ART.biscuitNose",
}

# Stand-ins and composition colours: palette keys too, so no hex appears here.
GRASS = "PALETTE.grassLight"
SAND = "PALETTE.pathSand"
FLOOR = "PALETTE.woodLight"
ROOF = "PALETTE.glassTint"
POST = "PALETTE.markerMint"
BEAR_POST = "ART.biscuitFur"
RULE_HIP = "PALETTE.flowerRed"
INK = "PALETTE.ink"
BLUSH = "ART.blush"
NIMBUS_WHITE = "ART.wingWhite"
RED_FEATHER = "ART.chickenComb"
YELLOW_PETALS = "PALETTE.flowerYellow"
BLUE_PETALS = "PALETTE.flowerBlue"
PILE_COVERS = ("PALETTE.markerMint", "PALETTE.markerLilac", "PALETTE.markerPink")


def rainbow_bands(values) -> list:
    """``ART.rainbow``'s colours, inner band first — read off the palette
    module's array literal, the same one the build counted its bands from."""
    source = open(os.path.join(REPO, sp.PALETTE_ART), encoding="utf-8").read()
    found = re.findall(r"^\s{2}rainbow: \[([^\]]*)\],", source, flags=re.MULTILINE)
    assert len(found) == 1, "artPalette.ts must declare `rainbow: [...]` exactly once"
    colours = [int(item.strip(), 16) for item in found[0].split(",") if item.strip()]
    assert len(colours) == sp.RAINBOW_BANDS, (colours, sp.RAINBOW_BANDS)
    return colours


def resolve_colours(values):
    path = os.path.join(REPO, LOADER_MODULE)
    styles = None
    if os.path.exists(path):
        found = re.findall(
            r"['\"]?([a-z][\w-]*)['\"]?:\s*\{[^}]*?colour:\s*((?:PALETTE|ART)\.\w+)",
            open(path, encoding="utf-8").read(), re.DOTALL)
        styles = {name: key for name, key in found} or None
    if styles:
        source = f"{LOADER_MODULE} — the loader's own table"
    else:
        styles = PROPOSED
        source = ("PROPOSED in story_props_render.py — the loader module is not on this branch "
                  "yet, so these renders show the Artist's SUGGESTED colours, not the game's")
    missing = [k for k in styles.values() if k not in values]
    assert not missing, f"colours named but not in the palette modules: {missing}"
    colours = {node: values[key] for node, key in styles.items()}
    for index, colour in enumerate(rainbow_bands(values)):
        colours[f"rainbow-arch-band{index + 1}"] = colour
    return colours, source


def meshes():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def hide_all() -> None:
    for obj in meshes():
        obj.hide_render = True


def clear_renders() -> int:
    gone = 0
    for name in os.listdir(OUT):
        if name.endswith(".png") or name.endswith(".png.part"):
            os.remove(os.path.join(OUT, name))
            gone += 1
    return gone


def shoot(stem: str, objects, azimuth: float, elevation: float, camera, pad: float = 1.25,
          size=(900, 700)) -> None:
    """Render, framing ``objects``, to ``<stem>.png`` — via a checked
    part-file and an atomic rename (library_render's `verify_png`)."""
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
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


def show(objs):
    for o in objs:
        o.hide_render = False
    return objs


def recolour(objs, node: str, colour) -> None:
    """Paint one node of a placed asset a composition's own colour."""
    for o in objs:
        if o.name.startswith(node):
            o.color = linear_rgba(colour)


def main() -> None:
    values = palette_values()
    colours, source = resolve_colours(values)
    bpy.ops.wm.open_mainfile(filepath=sp.BLEND)
    configure(colours)
    os.makedirs(OUT, exist_ok=True)
    print("\nstory_props_render")
    print(f"  cleared {clear_renders()} old file(s) from {OUT}")
    print(f"  colours from: {source}")
    undressed = sorted(o.name for o in meshes() if o.name not in colours)
    assert not undressed, f"nodes with no colour (would render magenta): {undressed}"

    cam = bpy.data.objects.new("review-cam", bpy.data.cameras.new("review-cam"))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    child_h = sp.CHILD_HEIGHT

    # --- one render per asset, each beside a child-height post --------------
    assets = sorted(c.name for c in bpy.data.collections)
    for asset in assets:
        hide_all()
        shown = show(list(bpy.data.collections[asset].objects))
        lo, hi = lb.asset_bounds(asset)
        span = max(hi.x - lo.x, hi.y - lo.y)
        post_x = hi.x + max(0.5, span * 0.15)
        post = standin(f"post-{asset}", (0.42, 0.42, child_h), (post_x, 0.0, child_h * 0.5), values[POST])
        floor_w = (post_x + 0.6 - lo.x) + 1.2
        floor = standin(f"floor-{asset}", (floor_w, (hi.y - lo.y) + 1.6, 0.1),
                        ((lo.x + post_x + 0.6) * 0.5, (lo.y + hi.y) * 0.5, -0.05), values[GRASS])
        shoot(asset, shown + [post, floor], 24.0, GAME_ELEVATION, cam, 1.12)
        remove([post, floor])
    print(f"    each beside a {child_h:.2f} m post (KID_HEIGHT, kid.ts via story_props_build)")

    # --- faces: eye dots at the stored anchors, through the node's UVs -------
    scene = bpy.context.scene
    scene.display.shading.color_type = "TEXTURE"
    for obj in meshes():
        mat = bpy.data.materials.new(f"{obj.name}-flat")
        mat.diffuse_color = tuple(obj.color)
        mat.use_nodes = True
        mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = tuple(obj.color)
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    for asset, node, eye_r in (("storm-cloud", "storm-cloud-face", 0.07), ("rubber-duck", "rubber-duck-head", 0.075)):
        hide_all()
        obj = bpy.data.objects[node]
        eyes = list(obj["face_eyes_uv"])
        obj.data.materials.clear()
        obj.data.materials.append(face_texture(f"{node}-face", colours[node], eyes, values[INK], values[BLUSH], eye_r))
        shown = show(list(bpy.data.collections[asset].objects))
        shoot(f"{asset}-face", shown, 0.0, 10.0, cam, 1.15, (800, 800))
        shoot(f"{asset}-face-iso", shown, 24.0, GAME_ELEVATION, cam, 1.15, (800, 800))
    scene.display.shading.color_type = "OBJECT"
    print("    *-face.png: ink dots and blush painted at the build's stored eye anchors")

    # --- the Grand Fountain Picnic: blanket, tower, tarts, cake, Nimbus scowling ---
    hide_all()
    made = [standin("picnic-lawn", (7.0, 6.0, 0.1), (0.0, 0.0, -0.05), values[GRASS])]
    made += place_asset("picnic-blanket", (0.0, 0.0, 0.0))
    _, cloth_hi = lb.node_bounds("picnic-blanket-cloth")
    made += place_asset("sandwich-tower", (-0.45, 0.1, cloth_hi.z), yaw=15.0)
    made += place_asset("cake", (0.45, -0.25, cloth_hi.z))
    for i in range(9):
        made += place_asset("jam-tart", (0.05 + 0.26 * (i % 3), 0.25 + 0.26 * (i // 3) - 0.05, cloth_hi.z), yaw=20.0 * i)
    made += place_asset("sandwich", (-0.3, -0.5, cloth_hi.z), yaw=-30.0)
    made += place_asset("storm-cloud", (0.4, 1.4, 2.2))
    made.append(standin("picnic-bear", (0.42, 0.42, child_h * 0.45), (-1.4, -0.4, child_h * 0.225), values[BEAR_POST]))
    show(made)
    shoot("picnic", made, 22.0, GAME_ELEVATION, cam, 1.08, (1200, 900))
    remove(made)

    # --- the same picnic, saved: Nimbus white and the heap in front of her -------
    made = [standin("picnic2-lawn", (7.0, 6.0, 0.1), (0.0, 0.0, -0.05), values[GRASS])]
    made += place_asset("picnic-blanket", (0.0, 0.0, 0.0))
    made += place_asset("sandwich-heap", (0.0, 0.2, cloth_hi.z))
    nimbus = place_asset("storm-cloud", (0.0, 1.5, 1.6))
    recolour(nimbus, "storm-cloud", values[NIMBUS_WHITE])
    made += nimbus
    made += place_asset("sandwich", (-0.9, -0.5, 0.0), yaw=40.0)
    made.append(standin("picnic2-bear", (0.42, 0.42, child_h * 0.45), (-1.5, -0.3, child_h * 0.225), values[BEAR_POST]))
    show(made)
    shoot("picnic-saved", made, 22.0, GAME_ELEVATION, cam, 1.08, (1200, 900))
    remove(made)

    # --- the Rail Race finish: the rainbow, the queue, the duck -------------
    made = [standin("finish-lawn", (12.0, 7.0, 0.1), (0.0, 0.0, -0.05), values[GRASS])]
    made += place_asset("rainbow-arch", (0.0, 1.0, 0.0))
    made += place_asset("queue-posts", (-1.6, -1.6, 0.0), yaw=20.0)
    made += place_asset("queue-posts", (1.4, -1.8, 0.0), yaw=-15.0)
    made += place_asset("rubber-duck", (0.0, -1.4, 0.0), yaw=30.0)
    made.append(standin("finish-child", (0.42, 0.42, child_h), (-0.9, -0.6, child_h * 0.5), values[POST]))
    show(made)
    shoot("finish-line", made, 18.0, GAME_ELEVATION, cam, 1.05, (1200, 900))
    remove(made)

    # --- the library floor: Mrs Crumpet's pile, the song book, loose pages, the window ---
    made = [standin("library-floor", (6.0, 5.0, 0.1), (0.0, 0.3, -0.05), values[FLOOR])]
    z = 0.0
    for i, key in enumerate(PILE_COVERS):
        book = place_asset("closed-book", (0.9, 0.4 + 0.02 * i, z), yaw=(0.0, 15.0, -10.0)[i])
        recolour(book, "closed-book-cover", values[key])
        made += book
        z += sp.CLOSED_BOOK_THICK
    made += place_asset("open-book", (-0.6, -0.4, 0.0), yaw=-12.0)
    made += place_asset("loose-page", (-0.2, 0.3, 0.0), yaw=35.0)
    made += place_asset("loose-page", (0.1, -0.9, 0.0), yaw=-50.0)
    made += place_asset("window-frame", (-0.2, 1.9, 0.6))
    made += place_asset("puddle", (1.2, -0.8, 0.0))
    made.append(standin("library-child", (0.42, 0.42, child_h), (-1.8, 0.6, child_h * 0.5), values[POST]))
    show(made)
    shoot("library-floor", made, 20.0, GAME_ELEVATION, cam, 1.06, (1200, 900))
    remove(made)

    # --- the footprint trail: giant prints, pancake prints, the glass, the bench, the bed ---
    made = [standin("trail-sand", (8.0, 6.0, 0.1), (0.0, 0.0, -0.05), values[SAND])]
    for i in range(6):
        made += place_asset("giant-footprint", (-2.6 + 0.9 * i, -0.9 + 0.35 * math.sin(i * 1.3), 0.0),
                            yaw=-80.0 + 14.0 * math.sin(i * 2.1))
    for i in range(8):
        made += place_asset("pancake-footprint", (-1.4 + 0.33 * i, 1.2 + 0.1 * (i % 2), 0.0), yaw=-90.0)
    made += place_asset("magnifying-glass", (0.6, 0.6, 0.0), yaw=20.0)
    made += place_asset("park-bench", (1.9, 1.9, 0.0), yaw=-20.0)
    flowers = ((-2.4, 1.9, YELLOW_PETALS, True), (-1.9, 2.2, BLUE_PETALS, False), (-1.4, 1.9, None, False),
               (-0.9, 2.2, YELLOW_PETALS, True), (-0.4, 1.95, BLUE_PETALS, False))
    for x, y, key, nibbled in flowers:
        flower = place_asset("flower", (x, y, 0.0), yaw=20.0 * x)
        if nibbled:
            # The stem alone, as the loader draws a nibbled flower: pick the
            # keepers first, then remove the rest (a removed object cannot be
            # asked its name).
            keep = [o for o in flower if o.name.startswith("flower-stem")]
            remove([o for o in flower if o not in keep])
            flower = keep
        elif key is not None:
            recolour(flower, "flower-petals", values[key])
        made += flower
    made += place_asset("petal", (-0.8, 0.9, 0.0), yaw=30.0)
    made += place_asset("flat-stone", (2.2, -1.4, 0.0), yaw=15.0)
    made += place_asset("stick", (2.7, -0.9, 0.0))
    made += place_asset("spoon", (1.6, -1.7, 0.0), yaw=60.0)
    made.append(standin("trail-child", (0.42, 0.42, child_h), (-3.2, 0.4, child_h * 0.5), values[POST]))
    show(made)
    shoot("footprint-trail", made, 16.0, GAME_ELEVATION, cam, 1.04, (1300, 900))
    remove(made)

    # --- the hotel roof: Chicken-looter's nest and hoard, the fluffy cloud behind ---
    made = [standin("roof", (6.0, 5.0, 0.1), (0.0, 0.3, -0.05), values[ROOF])]
    made += place_asset("twig-nest", (0.0, 0.0, 0.0))
    _, bowl_hi = lb.node_bounds("twig-nest-bowl")
    nest_floor = bowl_hi.z * 0.3
    made += place_asset("biscuit-treat", (0.2, -0.15, nest_floor), yaw=20.0)
    for i in range(3):
        made += place_asset("spoon", (-0.3 + 0.12 * i, 0.15 + 0.05 * i, nest_floor), yaw=-40.0 + 25.0 * i)
    white = place_asset("feather", (-1.3, -0.9, 0.0), yaw=40.0)
    red = place_asset("feather", (1.4, -1.2, 0.0), yaw=-30.0)
    recolour(red, "feather", values[RED_FEATHER])
    made += white + red
    made += place_asset("fluffy-cloud", (-0.6, 2.6, 1.3))
    made.append(standin("roof-child", (0.42, 0.42, child_h), (1.9, 0.6, child_h * 0.5), values[POST]))
    show(made)
    shoot("hotel-roof-nest", made, 20.0, GAME_ELEVATION, cam, 1.06, (1200, 900))
    remove(made)

    # --- the castle roof in the storm: battlement, Nimbus burping a rainbow, the umbrella ---
    made = [standin("castle-roof", (7.0, 5.0, 0.1), (0.0, 0.6, -0.05), values[GRASS])]
    made += place_asset("battlement", (0.0, 2.2, 0.0))
    made += place_asset("storm-cloud", (-0.6, 1.0, 1.7))
    made += place_asset("rainbow-arch", (1.2, 0.2, 1.0), yaw=90.0)
    made += place_asset("umbrella-inside-out", (-1.6, -0.9, 0.0))
    made.append(standin("castle-bear", (0.42, 0.42, child_h * 0.45), (-0.4, -1.0, child_h * 0.225), values[BEAR_POST]))
    show(made)
    shoot("castle-roof-storm", made, 24.0, GAME_ELEVATION, cam, 1.06, (1200, 900))
    remove(made)

    # --- the wheel at night: lights on, the duck-sized child looking up ---------
    made = [standin("wheel-lawn", (8.0, 6.0, 0.1), (0.0, 0.3, -0.05), values[GRASS])]
    made += place_asset("story-wheel", (0.0, 0.4, 0.0))
    made.append(standin("wheel-child", (0.42, 0.42, child_h), (-1.0, -1.6, child_h * 0.5), values[POST]))
    show(made)
    shoot("wheel-lit", made, 14.0, GAME_ELEVATION, cam, 1.04, (1200, 1000))
    for o in made:
        if o.name.startswith("story-wheel-lights"):
            o.hide_render = True
    shoot("wheel-dark", made, 14.0, GAME_ELEVATION, cam, 1.04, (1200, 1000))
    remove(made)

    # --- everything in elevation, against the post and the rig's hip line -----
    made = []
    x = 0.0
    made.append(standin("lineup-post", (0.42, 0.42, child_h), (x + 0.21, 0.0, child_h * 0.5), values[POST]))
    x += 0.8
    order = [a for a in assets if a not in ("rainbow-arch", "story-wheel")]
    for asset in order:
        lo, hi = lb.asset_bounds(asset)
        x += 0.25 - lo.x
        made += place_asset(asset, (x, 0.0, 0.0))
        x += hi.x + 0.25
    made.append(standin("lineup-rule-hip", (x, 0.06, 0.03), (x * 0.5, 1.6, sp.CHILD_HIP), values[RULE_HIP]))
    made.append(standin("lineup-floor", (x + 1.0, 5.0, 0.1), (x * 0.5, 0.8, -0.05), values[GRASS]))
    show(made)
    shoot("lineup", made, 0.0, 2.0, cam, 1.02, (2600, 520))
    remove(made)
    print(f"    lineup.png: every asset but the arch and the wheel in elevation; post {child_h:.2f} m; "
          f"red rule = hip {sp.CHILD_HIP:.2f} m (the bench's seat belongs on it)")
    print(f"  renders in {OUT}\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
