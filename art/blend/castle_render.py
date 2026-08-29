"""Renders each castle asset to ``art/renders/castle/`` so a human can eyeball it.

    npm run render:castle

Not part of ``npm run blend:castle`` — it produces review pictures, not shipped
bytes. Run it whenever the shapes change; Jim asked to see assets arriving
rather than one batch at the end (#363).

Workbench, not Eevee or Cycles, deliberately. The game's own look is flat banded
colour with an ink outline (ART_DIRECTION §2), and Workbench's
``color_type='OBJECT'`` plus object outline is the closest thing to that a
background render can produce in a second: what comes out is close enough to the
shipped material that a shape reading badly here reads badly in the park.

## It reads the geometry, and it reads the colours. It copies neither.

**The bridge kit's review found exactly this and it is the reason this file is
shaped the way it is.** ``bridge_stones_build.py`` read its constants out of the
game's TypeScript, properly; ``bridge_stones_render.py`` hand-copied the same
numbers, the two drifted, and five committed renders were of a bridge that was
not the one on the branch. Nobody noticed, because a picture of the wrong thing
looks exactly as convincing as a picture of the right thing.

So:

* **The geometry comes from ``castle.blend``**, opened here. There is no second
  builder, so the shapes cannot drift — the picture is of the mesh that ships.
* **The colours come from ``src/art/models/castleAssets.ts``**, parsed. That is
  the Engineer's file and the owner of every colour in this asset (their
  contract §4.1). When it lands, these renders start tracking it automatically.
* **Until it lands**, :data:`PROPOSED` below is used instead — the Artist's
  suggestion for the Engineer, stated once, in this file, and printed loudly on
  every run so a render made from proposals is never mistaken for a render made
  from the game.

Hex values are never written here either: :data:`PROPOSED` names
``PALETTE.``/``ART.`` keys and :func:`palette_values` reads the numbers out of
``src/core/palette.ts`` and ``src/art/style/artPalette.ts``.
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

import castle_build as cb  # noqa: E402  (import-safe: everything is behind main())
from blendkit import REPO  # noqa: E402

BLEND = os.path.join(REPO, "art", "blend", "castle.blend")
OUT = os.path.join(REPO, "art", "renders", "castle")

ENGINEER_MODULE = "src/art/models/castleAssets.ts"

# The Artist's proposal for the Engineer's `STYLES` table, by node name. Every
# value is a **palette key**, never a hex literal — ART_DIRECTION §5 allows no
# colour outside `PALETTE` and `ART`, and that applies to a review render as
# much as to the game, because a render in an off-palette colour is a render
# that lies about how the asset will look.
PROPOSED = {
    "armour-plate": "ART.castleSteel",
    "armour-trim": "PALETTE.liftFrame",
    "armour-visor": "ART.castleIron",
    "armour-plume": "ART.jumperRed",
    "plinth-block": "PALETTE.stonePinkDark",
    "tapestry-cloth": "ART.castleTapestry",
    "tapestry-fringe": "PALETTE.liftFrame",
    "tapestryrail-pole": "PALETTE.woodDark",
    "sconce-bracket": "ART.castleIron",
    "sconce-cup": "ART.castleIron",
    "throne-frame": "PALETTE.wood",
    "throne-gold": "PALETTE.liftFrame",
    "throne-cushion": "ART.jumperRed",
    "table-top": "PALETTE.woodLight",
    "table-legs": "PALETTE.wood",
    "bench-plank": "PALETTE.woodLight",
    "feast-goblet": "PALETTE.liftFrame",
    "feast-roast": "ART.biscuitFur",
    "feast-loaf": "ART.creamDark",
    "feast-pie": "ART.cream",
    "chest-body": "PALETTE.wood",
    "chest-bands": "ART.castleIron",
    "chest-lid": "PALETTE.woodDark",
}


# =============================================================================
# Reading the game's colours
# =============================================================================


def palette_values() -> dict:
    """Every ``PALETTE.x`` and ``ART.x`` in the game, as ``{name: hex}``.

    A regex over two source files, for :func:`blendkit.ts_const`'s reasons: it
    cannot silently return a default, it drags no import graph into Blender, and
    a rename becomes a loud failure rather than a grey object.

    ``ART`` entries that alias a palette colour (``ink: PALETTE.ink``) are
    resolved rather than skipped, because several of them are the ones this
    asset would actually use.
    """
    values = {}
    for module, prefix in (
        ("src/core/palette.ts", "PALETTE"),
        ("src/art/style/artPalette.ts", "ART"),
    ):
        source = open(os.path.join(REPO, module), encoding="utf-8").read()
        for name, hexval in re.findall(r"^\s{2}(\w+): (0x[0-9a-fA-F]{6}),", source, re.MULTILINE):
            values[f"{prefix}.{name}"] = int(hexval, 16)
        for name, target in re.findall(r"^\s{2}(\w+): PALETTE\.(\w+),", source, re.MULTILINE):
            alias = values.get(f"PALETTE.{target}")
            if alias is not None:
                values[f"{prefix}.{name}"] = alias
    assert len(values) > 100, (
        f"only {len(values)} colours parsed out of the palette modules — the format has "
        "changed and this render would silently use grey for everything"
    )
    return values


def engineer_styles():
    """The Engineer's ``STYLES`` table, if their module is on this branch yet.

    Returns ``{node name: palette key}`` or ``None``. Parsed rather than
    imported, because Blender has no TypeScript — and parsed rather than
    *copied*, which is the whole point of this file.
    """
    path = os.path.join(REPO, ENGINEER_MODULE)
    if not os.path.exists(path):
        return None
    source = open(path, encoding="utf-8").read()
    found = re.findall(
        r"['\"]?([a-z][\w-]*)['\"]?:\s*\{[^}]*?colour:\s*((?:PALETTE|ART)\.\w+)",
        source,
        re.DOTALL,
    )
    return {name: key for name, key in found} or None


def resolve_colours():
    """``{node name: hex}``, and where it came from, for the banner."""
    values = palette_values()
    styles = engineer_styles()
    if styles:
        source = f"{ENGINEER_MODULE} — the Engineer's own table"
    else:
        styles = PROPOSED
        source = (
            "PROPOSED in castle_render.py — the Engineer's module is not on this "
            "branch yet, so these renders show the Artist's SUGGESTED colours, not "
            "the game's"
        )
    missing = [key for key in styles.values() if key not in values]
    assert not missing, (
        f"these colours are named but do not exist in the palette modules: {missing}"
    )
    return {node: values[key] for node, key in styles.items()}, source, styles


# =============================================================================
# Scene
# =============================================================================


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_rgba(hex_value: int):
    parts = [((hex_value >> shift) & 0xFF) / 255.0 for shift in (16, 8, 0)]
    return tuple(srgb_to_linear(p) for p in parts) + (1.0,)


def configure(colours) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 820
    scene.render.resolution_y = 820
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.compression = 92
    # **Standard, never AgX.** Blender's default view transform crushes and
    # desaturates exactly the pale pastels this park is made of, and the game
    # tone-maps with `NeutralToneMapping` (ART_DIRECTION §6) precisely because
    # ACES-alikes do this. A review render must not lie about the colour.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "OBJECT"
    shading.show_object_outline = True
    shading.object_outline_color = (0.29, 0.23, 0.32)  # PALETTE.ink
    shading.show_cavity = False
    shading.show_shadows = True
    shading.background_type = "VIEWPORT"
    shading.background_color = (0.86, 0.91, 0.96)
    scene.display.render_aa = "16"
    for obj in bpy.data.objects:
        # Magenta for anything undressed, not grey: an undressed node has to be
        # impossible to mistake for a design choice.
        obj.color = linear_rgba(colours.get(obj.name, 0xFF00FF))


def standin(name: str, size, centre, colour: int):
    """A plain box for something this asset does not own — a floor, a wall, a
    child-sized figure to judge scale against.

    Wound outward by hand: nothing recalculates normals here, and a slab whose
    top face points at the floor renders as a sheet of mid grey, which reads as
    a lighting choice rather than as the mistake it is.
    """
    hx, hy, hz = (s * 0.5 for s in size)
    verts = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate(verbose=False)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = centre
    obj.color = linear_rgba(colour)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def frame(objects, azimuth_deg: float, elevation_deg: float, camera, pad: float = 1.25) -> None:
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], world[i]) for i in range(3)))
            hi = Vector((max(hi[i], world[i]) for i in range(3)))
    centre = (lo + hi) * 0.5
    size = max((hi - lo).x, (hi - lo).y, (hi - lo).z)

    azimuth = math.radians(azimuth_deg)
    elevation = math.radians(elevation_deg)
    # Away from the asset's front (−Y, the game's +Z) and up.
    direction = Vector((
        math.sin(azimuth) * math.cos(elevation),
        -math.cos(azimuth) * math.cos(elevation),
        math.sin(elevation),
    ))
    camera.location = centre + direction * (size * 3.0 + 3.0)
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = direction.to_track_quat("Z", "Y")
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = size * pad


# =============================================================================
# The shots
# =============================================================================
#
# **The game's camera looks down at about 38°**, which is the only angle that
# matters for "does this read as a suit of armour". Every per-asset shot is
# taken there, and the one straight-on elevation is for the tapestry, whose
# whole job is a picture.

GAME_ELEVATION = 38.0

# (stem, collections, azimuth°, elevation°, pad)
SHOTS = [
    ("armour", ("armour", "plinth"), 22.0, GAME_ELEVATION, 1.35),
    ("armour-front", ("armour",), 0.0, 12.0, 1.30),
    ("tapestry", ("tapestry", "tapestryrail"), 18.0, GAME_ELEVATION, 1.25),
    ("tapestry-elevation", ("tapestry", "tapestryrail"), 0.0, 2.0, 1.20),
    ("sconce", ("sconce",), 34.0, 24.0, 1.45),
    ("throne", ("throne",), 24.0, GAME_ELEVATION, 1.30),
    ("chest", ("chest",), 30.0, GAME_ELEVATION, 1.35),
    ("feast", ("feast",), 26.0, GAME_ELEVATION, 1.30),
]

# Assets are all authored about the world origin, so a shot with more than one
# in it has to lay them out. These are **preview placements only**, applied to a
# scene this file never saves. Where an asset has a natural place — an armour on
# its plinth, a goblet on a table — the preview uses it, because that is the
# arrangement the shapes have to work in.
LAYOUTS = {
    "armour": {"plinth-block": (0.0, 0.0, 0.0)},
    "tapestry": {},
    "feast": {
        "feast-goblet": (-0.55, 0.15, 0.0),
        "feast-roast": (0.0, -0.30, 0.0),
        "feast-loaf": (0.50, 0.20, 0.0),
        "feast-pie": (0.95, -0.25, 0.0),
    },
}

# An armour stands *on* its plinth, so the suit lifts by the plinth's own
# height. Taken from `castle_build`'s constant rather than typed: the preview
# has to be a preview of the composition the Engineer will actually build.
ARMOUR_LIFT = ("armour", 0.25)


def hall_composition():
    """The great hall, assembled from `castle_build`'s own numbers.

    Ten assets in isolation say nothing about whether a *hall* reads right,
    which is the only question Jim asked. This puts the table down the middle
    with its benches and its feast, a throne at the head, armours along the
    wall on their plinths, a tapestry and a sconce on the wall behind — at the
    heights the Engineer's contract states — and looks at the lot from the
    game's own camera.

    Every position below is derived from a constant in `castle_build`, so a
    size that moves moves the preview with it instead of quietly rendering a
    composition that no longer exists.
    """
    rail_y = 2.90       # the Engineer's, contract §4.4
    sconce_y = 2.10     # the Engineer's, contract §4.4
    wall_y = 2.4        # where the preview's stand-in wall sits (Blender +Y)
    half_table = cb.TABLE_LENGTH * 0.5

    places = [
        # (object, location, yaw°)
        ("table-top", (0.0, 0.0, 0.0), 0.0),
        ("table-legs", (0.0, 0.0, 0.0), 0.0),
        ("throne-frame", (0.0, -half_table - 1.9, 0.30), 180.0),
        ("throne-gold", (0.0, -half_table - 1.9, 0.30), 180.0),
        ("throne-cushion", (0.0, -half_table - 1.9, 0.30), 180.0),
    ]
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            places.append(("bench-plank", (sx * 1.85, sy * 1.55, 0.0), 0.0))
    for (x, y), name in zip(
        ((-0.75, 1.9), (0.15, 0.4), (0.85, -1.6), (-0.35, -2.4)),
        ("goblet", "roast", "loaf", "pie"),
    ):
        places.append((f"feast-{name}", (x, y, cb.TABLE_TOP), 0.0))
    for x in (-4.6, 4.6):
        places.append(("plinth-block", (x, wall_y - 0.7, 0.0), 0.0))
        for part in ("armour-plate", "armour-trim", "armour-visor", "armour-plume"):
            places.append((part, (x, wall_y - 0.7, 0.25), 0.0))
    places.append(("tapestry-cloth", (0.0, wall_y, rail_y), 0.0))
    places.append(("tapestry-fringe", (0.0, wall_y, rail_y), 0.0))
    places.append(("tapestryrail-pole", (0.0, wall_y, rail_y), 0.0))
    for x in (-2.6, 2.6):
        places.append(("sconce-bracket", (x, wall_y, sconce_y), 0.0))
        places.append(("sconce-cup", (x, wall_y, sconce_y), 0.0))
    places.append(("chest-body", (-6.6, -1.0, 0.0), 24.0))
    places.append(("chest-bands", (-6.6, -1.0, 0.0), 24.0))
    places.append(("chest-lid", (-6.6, -1.0, 0.0), 24.0))
    return places


def main() -> None:
    colours, source, styles = resolve_colours()
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    configure(colours)
    os.makedirs(OUT, exist_ok=True)

    print("\ncastle_render")
    print(f"  colours from: {source}")
    undressed = sorted(
        obj.name for obj in bpy.data.objects if obj.type == "MESH" and obj.name not in styles
    )
    assert not undressed, (
        f"these nodes have no colour and would render magenta: {undressed}. Add them to "
        "PROPOSED here, or to the Engineer's STYLES table."
    )

    camera_data = bpy.data.cameras.new("review-cam")
    camera = bpy.data.objects.new("review-cam", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    home = {obj.name: tuple(obj.location) for obj in bpy.data.objects if obj.type == "MESH"}

    for stem, coll_names, azimuth, elevation, pad in SHOTS:
        shown = []
        for coll_name in coll_names:
            coll = bpy.data.collections.get(coll_name)
            if coll is None:
                raise SystemExit(f"castle_render: no collection '{coll_name}' — rerun castle_build")
            shown.extend(coll.objects)
        layout = LAYOUTS.get(stem, {})
        for obj in bpy.data.objects:
            if obj.type != "MESH":
                continue
            obj.hide_render = obj not in shown
            obj.location = layout.get(obj.name, home[obj.name])
        if stem == "armour":
            # The suit stands on its plinth, lifted by the plinth's own height.
            for obj in bpy.data.collections["armour"].objects:
                obj.location = (0.0, 0.0, ARMOUR_LIFT[1])
        floor = None
        if stem in ("armour", "throne", "chest", "feast"):
            floor = standin("preview-floor", (7.0, 7.0, 0.2), (0.0, 0.0, -0.1), 0xF0A3C1)
            floor.hide_render = False
            shown = shown + [floor]
        if stem == "feast":
            floor.location = (0.0, 0.0, cb.TABLE_TOP - 0.1)
        bpy.context.view_layer.update()
        frame(shown, azimuth, elevation, camera, pad)
        bpy.context.scene.render.filepath = os.path.join(OUT, f"{stem}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  wrote {stem}.png")
        if floor is not None:
            bpy.data.objects.remove(floor, do_unlink=True)

    # --- the hall ---------------------------------------------------------
    clones = []
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.hide_render = True
    for name, location, yaw in hall_composition():
        source_obj = bpy.data.objects[name]
        clone = source_obj.copy()
        clone.location = Vector(location) + Vector(source_obj.location)
        clone.rotation_mode = "XYZ"
        clone.rotation_euler = (0.0, 0.0, math.radians(yaw))
        clone.color = source_obj.color
        clone.hide_render = False
        bpy.context.scene.collection.objects.link(clone)
        clones.append(clone)
    floor = standin("hall-floor", (20.0, 16.0, 0.3), (0.0, 0.0, -0.15), 0xF0A3C1)
    wall = standin("hall-wall", (20.0, 0.45, 3.3), (0.0, 2.65, 1.65), 0xFFC2D8)
    # A child-height post, so the scale rule can be judged rather than asserted.
    # `TALLEST_CHILD` is `kid.ts`'s and comes through `castle_build`.
    child = standin("scale-child", (0.42, 0.42, 1.86), (2.2, -4.6, 0.93), 0x7FE3C0)
    for extra in (floor, wall, child):
        extra.hide_render = False
    bpy.context.view_layer.update()
    for stem, azimuth, elevation, pad in (
        ("hall", 16.0, GAME_ELEVATION, 1.06),
        ("hall-low", 8.0, 16.0, 1.06),
    ):
        frame(clones + [floor, wall, child], azimuth, elevation, camera, pad)
        bpy.context.scene.render.filepath = os.path.join(OUT, f"{stem}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  wrote {stem}.png")

    print(f"  the green post in the hall shots is 1.86 m — a child, for scale")
    print(f"  renders in {OUT}\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
