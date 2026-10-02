"""Renders the Reptile House creature kit to ``art/renders/reptile-creatures/``
so a human can eyeball it.

    pnpm run render:reptile-creatures

Not part of ``pnpm run blend:reptile-creatures`` — it produces review
pictures, not shipped bytes. Run it whenever the shapes change.

Workbench, for ``castle_render.py``'s reasons: the game's look is flat banded
colour with an ink outline, and Workbench's object colour plus outline is the
closest a background render gets to that in a second.

## It reads the geometry, and it reads the colours. It copies neither.

* **The geometry comes from ``reptile_creatures.blend``**, opened here. There
  is no second builder, so the picture is of the mesh that ships.
* **The colours come from the game's palette modules**, parsed by
  ``castle_render.palette_values`` — imported, not copied — through the
  Engineer's ``reptileCreaturesAssets.ts`` ``STYLES`` table, and from nowhere
  else: the run fails without it rather than render a proposal.
* **Framing, colour conversion and the scale stand-in** are
  ``castle_render``'s functions, imported. The child-height post is sized
  from ``kid.ts``'s ``KID_HEIGHT`` through ``ts_const`` — the same owner the
  game reads.
"""

import os
import re
import sys
import traceback

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from blendkit import REPO, ts_const  # noqa: E402
from castle_render import (  # noqa: E402  (import-safe: everything is behind main())
    GAME_ELEVATION,
    frame,
    linear_rgba,
    palette_values,
    standin,
)
from reptile_creatures_build import BLEND, EXPECTED  # noqa: E402

OUT = os.path.join(REPO, "art", "renders", "reptile-creatures")
ENGINEER_MODULE = "src/art/models/reptileCreaturesAssets.ts"
CHILD_HEIGHT = ts_const("src/art/models/kid.ts", "KID_HEIGHT")



def resolve_colours():
    values = palette_values()
    styles = None
    if os.path.exists(os.path.join(REPO, ENGINEER_MODULE)):
        # The same shape `castle_render.engineer_styles` parses, pointed at this
        # kit's module (that function has the castle's path baked in).
        source_text = open(os.path.join(REPO, ENGINEER_MODULE), encoding="utf-8").read()
        found = re.findall(
            r"['\"]?([a-z][\w-]*)['\"]?:\s*\{[^}]*?colour:\s*((?:PALETTE|ART)\.\w+)",
            source_text,
            re.DOTALL,
        )
        styles = {name: key for name, key in found} or None
    assert styles, f"{ENGINEER_MODULE} has no STYLES rows — nothing to render the game's colours from"
    source = f"{ENGINEER_MODULE} — the Engineer's own table"
    missing = [key for key in styles.values() if key not in values]
    assert not missing, f"these colours are named but do not exist in the palette modules: {missing}"
    return {node: values[key] for node, key in styles.items()}, source, styles


def configure(colours) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.compression = 92
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "OBJECT"
    shading.show_object_outline = True
    shading.object_outline_color = (0.29, 0.23, 0.32)
    shading.show_cavity = False
    shading.show_shadows = True
    shading.background_type = "VIEWPORT"
    shading.background_color = (0.86, 0.91, 0.96)
    scene.display.render_aa = "16"
    for obj in bpy.data.objects:
        obj.color = linear_rgba(colours.get(obj.name, 0xFF00FF))


# (stem, collections, azimuth°, elevation°, pad, floor?)
SHOTS = [
    ("snake-head", ("snake",), 22.0, 18.0, 1.4, False),
    ("snake-head-front", ("snake",), 0.0, 6.0, 1.4, False),
    ("croc", ("croc",), 28.0, GAME_ELEVATION, 1.25, True),
    ("croc-front", ("croc",), 8.0, 12.0, 1.3, True),
    ("tortoise", ("tortoise",), 30.0, GAME_ELEVATION, 1.35, True),
    ("chameleon", ("chameleon",), 34.0, 24.0, 1.35, True),
    ("frog", ("frog",), 26.0, 30.0, 1.4, True),
    ("gecko", ("gecko",), 30.0, 50.0, 1.4, True),
    ("skink", ("skink",), 30.0, 30.0, 1.3, True),
    ("iguana", ("iguana",), 30.0, 30.0, 1.3, True),
]

# The gallery: every creature in a row at its authored size beside a
# child-height post, from the game's own camera angle — the one picture that
# answers "are these the right sizes next to each other".
GALLERY_X = {
    "snake": -4.6,
    "croc": -2.4,
    "tortoise": 0.6,
    "iguana": 2.0,
    "chameleon": 3.1,
    "skink": 4.0,
    "frog": 4.9,
    "gecko": 5.5,
}
# The snake head is authored about its neck joint on the body axis; in the
# gallery it rests on the floor with its underside at the slab, as a head on
# a resting snake would.
SNAKE_HEAD_LIFT = 0.16


def main() -> None:
    colours, source, styles = resolve_colours()
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    names = {o.name for o in bpy.data.objects if o.type == "MESH"}
    assert names == EXPECTED, f"rerun reptile_creatures_build.py: {sorted(names ^ EXPECTED)}"
    configure(colours)
    os.makedirs(OUT, exist_ok=True)

    print("\nreptile_creatures_render")
    print(f"  colours from: {source}")
    undressed = sorted(n for n in names if n not in styles)
    assert not undressed, f"these nodes have no colour and would render magenta: {undressed}"

    camera_data = bpy.data.cameras.new("review-cam")
    camera = bpy.data.objects.new("review-cam", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    home = {obj.name: tuple(obj.location) for obj in bpy.data.objects if obj.type == "MESH"}

    for stem, coll_names, azimuth, elevation, pad, wants_floor in SHOTS:
        shown = []
        for coll_name in coll_names:
            coll = bpy.data.collections.get(coll_name)
            assert coll is not None, f"no collection '{coll_name}'"
            shown.extend(coll.objects)
        for obj in bpy.data.objects:
            if obj.type == "MESH":
                obj.hide_render = obj not in shown
                obj.location = home[obj.name]
        floor = None
        if wants_floor:
            span = max(1.0, max(o.dimensions.x for o in shown) * 1.6, max(o.dimensions.y for o in shown) * 1.6)
            floor = standin("preview-floor", (span, span, 0.1), (0.0, 0.0, -0.05), 0xF0A3C1)
            floor.hide_render = False
            shown = shown + [floor]
        bpy.context.view_layer.update()
        frame(shown, azimuth, elevation, camera, pad)
        bpy.context.scene.render.filepath = os.path.join(OUT, f"{stem}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  wrote {stem}.png")
        if floor is not None:
            bpy.data.objects.remove(floor, do_unlink=True)

    # --- the gallery ------------------------------------------------------
    shown = []
    for coll_name, x in GALLERY_X.items():
        for obj in bpy.data.collections[coll_name].objects:
            lift = SNAKE_HEAD_LIFT if coll_name == "snake" else 0.0
            obj.location = Vector(home[obj.name]) + Vector((x, 0.0, lift))
            obj.hide_render = False
            shown.append(obj)
    floor = standin("gallery-floor", (12.6, 2.4, 0.1), (0.5, 0.0, -0.05), 0xF0A3C1)
    post = standin("child-post", (0.5, 0.5, CHILD_HEIGHT), (-6.2, 0.0, CHILD_HEIGHT * 0.5), 0xFFC2D8)
    shown += [floor, post]
    bpy.context.view_layer.update()
    frame(shown, 10.0, GAME_ELEVATION, camera, 1.02)
    bpy.context.scene.render.filepath = os.path.join(OUT, "gallery.png")
    bpy.ops.render.render(write_still=True)
    print(f"  wrote gallery.png (child post {CHILD_HEIGHT} m from kid.ts)")
    print()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
