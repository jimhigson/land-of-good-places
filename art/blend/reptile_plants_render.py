"""Renders the Reptile House's plant kit to ``art/renders/reptile-plants/``.

    pnpm run render:reptile-plants
    pnpm run render:reptile-plants -- --out /some/other/dir

Not part of ``pnpm run blend:reptile-plants`` — it produces review pictures,
not shipped bytes. Run it whenever the shapes change.

**It reads the geometry, and it reads the colours. It copies neither** — the
rule ``castle_render.py`` was written to, after the bridge kit's render script
hand-copied its build script's numbers and drifted. So:

* **The geometry comes from ``reptile_plants.blend``**, opened here. There is
  no second builder, so the picture is of the mesh that ships.
* **The colours come from ``src/art/models/reptilePlantsAssets.ts``**, parsed —
  and from nowhere else: the run asserts they did.
* **The scene plumbing comes from ``castle_render.py``** — the palette reader,
  the Workbench setup, the stand-in boxes and the framing — imported, not
  re-typed. Its module-level ``ENGINEER_MODULE`` is pointed at this kit's
  before ``resolve_colours`` is called; that is the one place
  this file reaches into another, and it is so the two renderers cannot
  disagree about what a review render looks like.
* **The composition's numbers come from ``reptile_plants_build``** — the
  frond count, the heights, the log's radii — so the preview is a preview of
  the thing the build asserts, not a drawing of what someone remembered.
"""

import math
import os
import sys
import traceback

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import castle_render as cr  # noqa: E402  (import-safe: everything is behind main())
import reptile_plants_build as pb  # noqa: E402
from blendkit import REPO  # noqa: E402
from reptile_constants import KID_EYE_HEIGHT, TALLEST_CHILD_HEIGHT  # noqa: E402

BLEND = os.path.join(REPO, "art", "blend", "reptile_plants.blend")
DEFAULT_OUT = os.path.join(REPO, "art", "renders", "reptile-plants")

ENGINEER_MODULE = "src/art/models/reptilePlantsAssets.ts"


GAME_ELEVATION = cr.GAME_ELEVATION

FLOOR_COLOUR = 0xC9A27A   # a stand-in soil, not a palette colour: it is not the asset
WALL_COLOUR = 0xFFC2D8

# (stem, [(node, (x, y, z), yaw°), ...], azimuth°, elevation°, pad, floor span)
SHOTS = []


def place(name, x=0.0, y=0.0, z=0.0, yaw=0.0):
    return (name, (x, y, z), yaw)


def palm_places(x=0.0, y=0.0):
    """A whole palm: the trunk and `PALM_FRONDS` fronds fanned from its crown,
    as the Engineer will build it — the crown anchor is (0, 0, height) by the
    build's own assertion."""
    out = [place("rp-palm-trunk", x, y)]
    for k in range(7):
        out.append(place("rp-palm-frond", x, y, pb.REPTILE_PALM_HEIGHT - 0.1, k * 360.0 / 7 + 10.0))
    return out


def monstera_places(x, y, yaw):
    return [place("rp-monstera-stalk", x, y, 0.0, yaw), place("rp-monstera-leaf", x, y, 0.0, yaw)]


def heliconia_places(x, y, yaw):
    return [place("rp-heliconia-stalk", x, y, 0.0, yaw), place("rp-heliconia", x, y, 0.0, yaw)]


def vine_places(x, y, z, yaw):
    return [place("rp-vine-strand", x, y, z, yaw), place("rp-vine-leaves", x, y, z, yaw)]


def fern_ring(x, y, count=6, start=0.0):
    return [place("rp-fern-frond", x, y, 0.0, start + k * 360.0 / count) for k in range(count)]


def banana_clump(x, y, start=0.0):
    return [place("rp-banana-leaf", x, y, 0.0, start + k * 120.0) for k in range(3)]


SHOTS = [
    ("palm", palm_places(), 24.0, GAME_ELEVATION, 1.15, 5.0),
    ("leaves", banana_clump(-2.4, 0.0, 30.0) + monstera_places(-0.6, 0.6, 0.0) + heliconia_places(0.9, 0.0, 20.0)
     + fern_ring(2.4, 0.2, 6, 15.0), 18.0, GAME_ELEVATION, 1.12, 7.0),
    ("rocks-and-logs", [place("rp-rock-a", -3.2, 1.2), place("rp-rock-b", -1.6, -0.6), place("rp-rock-c", 2.8, 1.0),
                        place("rp-log-small", 0.3, -1.0, 0.0, 12.0)], 22.0, GAME_ELEVATION, 1.1, 9.0),
    ("hollow-log", [place("rp-log-hollow"), place("rp-log-knothole")], 28.0, GAME_ELEVATION, 1.12, 9.0),
    ("hollow-log-end", [place("rp-log-hollow"), place("rp-log-knothole")], 90.0, 8.0, 1.15, 9.0),
    ("banyan", [place("rp-banyan"), place("rp-banyan-canopy")] + [place(f"rp-banyan-anchor-{c}") for c in "abc"]
     + vine_places(1.6, 1.1, 5.2, 0.0) + vine_places(-1.9, 0.4, 5.3, 90.0), 20.0, GAME_ELEVATION, 1.1, 8.0),
    ("branch-and-pads", [place("rp-branch", -1.2, 0.0, 0.0, 0.0)] + [place("rp-lily-pad", 1.0 + 0.5 * k, -0.6 + 0.35 * k, 0.0, 40.0 * k) for k in range(4)],
     26.0, GAME_ELEVATION, 1.12, 4.5),
]


def jungle_bed():
    """One planted bed as the house will have it, with the camera at the
    game's angle: the only shot that answers "does this read as a jungle".
    Heights come from the build so the picture tracks the asset."""
    places = []
    places += palm_places(-4.0, 2.4)
    places += banana_clump(-1.2, 1.8, 20.0)
    places += banana_clump(3.2, 2.2, 70.0)
    places += monstera_places(-2.6, -0.4, -20.0)
    places += monstera_places(1.0, 0.4, 15.0)
    places += monstera_places(4.6, -0.2, -35.0)
    places += heliconia_places(0.2, 2.6, 0.0)
    places += heliconia_places(2.0, -0.8, 30.0)
    for k, (x, y) in enumerate(((-4.6, -1.2), (-1.4, -1.6), (0.4, -1.4), (2.6, -1.8), (4.4, -1.6), (-3.0, 1.0))):
        places += fern_ring(x, y, 6, k * 23.0)
    places.append(place("rp-rock-a", -2.0, -2.6))
    places.append(place("rp-rock-b", 3.4, -2.9))
    places.append(place("rp-log-small", 1.0, -2.9, 0.0, -8.0))
    places += vine_places(-1.0, 0.0, 6.4, 0.0)
    places += vine_places(2.4, 1.0, 6.4, 50.0)
    return places


def main() -> None:
    out = DEFAULT_OUT
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
    os.makedirs(out, exist_ok=True)

    # Point castle_render's resolver at this kit (see the module docstring).
    cr.ENGINEER_MODULE = ENGINEER_MODULE
    colours, source, styles = cr.resolve_colours()
    # The game's own table, never a proposal: a render of colours the game
    # does not draw is a render of a different kit.
    assert source.startswith(ENGINEER_MODULE), f"colours did not come from {ENGINEER_MODULE}: {source}"

    bpy.ops.wm.open_mainfile(filepath=BLEND)
    cr.configure(colours)
    print("\nreptile_plants_render")
    print(f"  colours from: {source}")
    undressed = sorted(obj.name for obj in bpy.data.objects if obj.type == "MESH" and obj.name not in styles)
    assert not undressed, f"these nodes have no colour and would render magenta: {undressed}"

    camera_data = bpy.data.cameras.new("review-cam")
    camera = bpy.data.objects.new("review-cam", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    # The kit's own objects are never rendered directly: each shot clones what
    # it needs so a node can appear seven times (fronds) in one picture.
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.hide_render = True

    def shoot(stem, places, azimuth, elevation, pad, span, with_child=True):
        clones = []
        for name, location, yaw in places:
            source_obj = bpy.data.objects[name]
            clone = source_obj.copy()
            # A node placed by its origin keeps that origin, rotated with the
            # placement so the knothole and the anchors turn with their tree.
            origin = Vector(source_obj.location)
            yaw_rad = math.radians(yaw)
            turned = Vector((
                origin.x * math.cos(yaw_rad) - origin.y * math.sin(yaw_rad),
                origin.x * math.sin(yaw_rad) + origin.y * math.cos(yaw_rad),
                origin.z,
            ))
            clone.location = Vector(location) + turned
            clone.rotation_mode = "XYZ"
            clone.rotation_euler = (0.0, 0.0, yaw_rad)
            clone.color = source_obj.color
            clone.hide_render = False
            bpy.context.scene.collection.objects.link(clone)
            clones.append(clone)
        extras = []
        floor = cr.standin("preview-floor", (span * 1.6, span * 1.2, 0.2), (0.0, 0.0, -0.1), FLOOR_COLOUR)
        extras.append(floor)
        if with_child:
            # Two child-height posts, from `kid.ts` through reptile_constants:
            # a plain child's eye line, and the tallest hair-and-hat.
            extras.append(cr.standin("scale-child-eye", (0.42, 0.42, KID_EYE_HEIGHT),
                                     (span * 0.55, -span * 0.45, KID_EYE_HEIGHT * 0.5), 0x7FE3C0))
            extras.append(cr.standin("scale-child-tallest", (0.42, 0.42, TALLEST_CHILD_HEIGHT),
                                     (span * 0.55 + 0.9, -span * 0.45, TALLEST_CHILD_HEIGHT * 0.5), 0x4FBF9B))
        for extra in extras:
            extra.hide_render = False
        bpy.context.view_layer.update()
        cr.frame(clones + extras, azimuth, elevation, camera, pad)
        bpy.context.scene.render.filepath = os.path.join(out, f"{stem}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  wrote {stem}.png")
        for obj in clones + extras:
            bpy.data.objects.remove(obj, do_unlink=True)

    for stem, places, azimuth, elevation, pad, span in SHOTS:
        shoot(stem, places, azimuth, elevation, pad, span)

    # The hollow log with a tallest-child post *inside* it: the one picture of
    # the clearance the build asserts.
    child_in_log = cr.standin("child-in-log", (0.42, 0.42, TALLEST_CHILD_HEIGHT),
                              (0.0, 0.0, TALLEST_CHILD_HEIGHT * 0.5), 0x4FBF9B)
    child_in_log.hide_render = False
    shoot("hollow-log-walkthrough", [place("rp-log-hollow"), place("rp-log-knothole")],
          18.0, GAME_ELEVATION, 1.1, 9.0, with_child=False)
    bpy.data.objects.remove(child_in_log, do_unlink=True)

    shoot("jungle-bed", jungle_bed(), 16.0, GAME_ELEVATION, 1.05, 11.0)
    shoot("jungle-bed-low", jungle_bed(), 8.0, 14.0, 1.05, 11.0)
    print(f"  renders in {out}\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
