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
    # The four feast props are each authored about the origin, so a shot of
    # them together has to spread them out. A row, not a huddle: the question
    # this picture answers is "are these four things telling each other
    # apart", and overlapping silhouettes are exactly what stops it doing so.
    "feast": {
        "feast-goblet": (-0.72, 0.0, 0.0),
        "feast-roast": (-0.24, 0.0, 0.0),
        "feast-loaf": (0.24, 0.0, 0.0),
        "feast-pie": (0.72, 0.0, 0.0),
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
    # Both from `castle_build`, which owns every number this file draws with.
    # `SCONCE_MOUNT_Y` it *reads* out of the Engineer's `castleFabric.ts` the
    # day that module lands; the rail height they do not export, so it is typed
    # once, there, and flagged. Neither is typed here any more — they were, and
    # a render script with its own copy of a build script's constant is the one
    # mistake this file's own docstring is about.
    rail_y = cb.TAPESTRY_RAIL_Y
    sconce_y = cb.SCONCE_MOUNT_Y
    wall_y = 6.4        # the preview wall's inner face (Blender +Y)
    half_table = cb.TABLE_LENGTH * 0.5

    places = [
        # (object, location, yaw°)
        ("table-top", (0.0, 0.0, 0.0), 0.0),
        ("table-legs", (0.0, 0.0, 0.0), 0.0),
    ]
    # **The throne goes at the head of the table, looking down it.** The first
    # composition put it at the near end yawed away from the camera, which
    # showed the one asset whose whole point is its front from behind. It sits
    # on the Engineer's own 0.30 m dais.
    for part in ("throne-frame", "throne-gold", "throne-cushion"):
        places.append((part, (0.0, half_table + 1.5, 0.30), 180.0))
    places.append(("plinth-block", (0.0, half_table + 1.5, 0.0), 0.0))

    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            places.append(("bench-plank", (sx * 1.85, sy * 1.55, 0.0), 0.0))
    for (x, y), name in zip(
        ((-0.75, 1.9), (0.15, 0.4), (0.85, -1.6), (-0.35, -2.4)),
        ("goblet", "roast", "loaf", "pie"),
    ):
        places.append((f"feast-{name}", (x, y, cb.TABLE_TOP), 0.0))

    # Armours against the back wall, on their plinths, facing into the room.
    for x in (-8.0, 8.0):
        places.append(("plinth-block", (x, wall_y - 0.7, 0.0), 0.0))
        for part in ("armour-plate", "armour-trim", "armour-visor", "armour-plume"):
            places.append((part, (x, wall_y - 0.7, 0.25), 0.0))

    # Two tapestries flanking the throne, on the wall, at the contracted rail
    # height — and the sconces on the **bare wall between them**.
    #
    # **The previous composition hid every sconce inside a tapestry**, and it
    # took a review to notice. Tapestries centred on ±2.6 are 3.20 m wide, so
    # they covered x −4.2..−1.0 and +1.0..+4.2; the sconces were at ±1.2 and
    # ±4.0, i.e. all four inside that cloth, at a height (2.10 m) inside its
    # 0.50–2.90 m drop. The hall shots have therefore been showing **no
    # sconces at all** while appearing to show four, which is a large part of
    # why they read as "dark smudges you have to look for" — a preview that
    # answers a question about an asset it is not actually displaying is the
    # picture-shaped version of a check that passes without checking anything.
    #
    # So the wall is now laid out so nothing is behind anything: tapestries on
    # ±3.6 (covering ±2.0..±5.2), armours moved out to ±8.0, and the sconces
    # in the two clear bands — ±1.2 between the throne and the tapestries, and
    # ±6.4 between the tapestries and the armours.
    tapestry_x = 3.6
    for x in (-tapestry_x, tapestry_x):
        for part in ("tapestry-cloth", "tapestry-fringe", "tapestryrail-pole"):
            places.append((part, (x, wall_y, rail_y), 0.0))
    for x in (-6.4, -1.2, 1.2, 6.4):
        for part in ("sconce-bracket", "sconce-cup"):
            places.append((part, (x, wall_y, sconce_y), 0.0))

    for part in ("chest-body", "chest-bands", "chest-lid"):
        places.append((part, (-6.8, 0.4, 0.0), 24.0))
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
            # Sized to the asset, not a fixed slab. A 7 m floor under a 1.6 m
            # throne made the throne look like a dining chair in a hall, which
            # is a fact about the preview rather than about the asset — and
            # the whole job of these pictures is to not mislead about scale.
            span = max(2.6, max(o.dimensions.x for o in shown) * 2.2)
            floor = standin("preview-floor", (span, span, 0.2), (0.0, 0.0, -0.1), 0xF0A3C1)
            floor.hide_render = False
            shown = shown + [floor]
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
    floor = standin("hall-floor", (22.0, 18.0, 0.3), (0.0, 0.0, -0.15), 0xF0A3C1)
    wall = standin("hall-wall", (22.0, 0.45, 3.3), (0.0, 6.625, 1.65), 0xFFC2D8)
    # Child-height posts, so the scale rule can be judged rather than asserted.
    #
    # **There are two, and the number used to be typed and wrong.** The comment
    # here said the post came from `TALLEST_CHILD` via `castle_build` and then
    # typed `1.86` — the exact "comment promising two numbers agree" that this
    # repo hits more than any other bug, sitting in the one file whose job is to
    # not mislead about scale. A child in this game is **2.12 m** plain
    # (`KID_HEIGHT`) and **2.97 m** in the tallest hair-and-hat combination
    # (`TALLEST_CHILD_HEIGHT`). Both now come from `kid.ts` through
    # `castle_build`, and both are drawn, because the honest answer to "how big
    # is this next to a child" in a game with hats this big is a range.
    #
    # It matters for more than tidiness: the armour was sized "2.60 m beside a
    # 1.86 m child", i.e. believed to tower. Against the real figures it is
    # shorter than a child in a tall hat. Flagged in the handoff — the sizes are
    # the Engineer's contract and not mine to change unilaterally, but nobody
    # should re-judge that silhouette against a post that is a quarter short.
    child = standin("scale-child", (0.42, 0.42, cb.CHILD_HEIGHT),
                    (3.0, -4.4, cb.CHILD_HEIGHT * 0.5), 0x7FE3C0)
    tall_child = standin("scale-child-tallest", (0.42, 0.42, cb.TALLEST_CHILD),
                         (3.9, -4.4, cb.TALLEST_CHILD * 0.5), 0x4FBF9B)
    for extra in (floor, wall, child, tall_child):
        extra.hide_render = False
    bpy.context.view_layer.update()
    # **The wall-plate, at the height the build asserts against.** Without it
    # there was no picture anywhere of the constraint that actually governs the
    # tallest asset in the room, and the throne stood 2 cm through it for a week
    # with every assertion green. `cb.CEILING_CLEAR` is the same value
    # `check_contract` uses, so this cannot drift from the number being checked
    # — and if the Engineer's module lands with a different one, the beam in the
    # picture moves with it.
    plate = standin("hall-wall-plate", (22.0, 0.70, 0.22),
                    (0.0, 6.4 - 0.9, cb.CEILING_CLEAR + 0.11), 0xB5836A)
    plate.hide_render = False
    for stem, azimuth, elevation, pad in (
        ("hall", 16.0, GAME_ELEVATION, 1.06),
        ("hall-low", 8.0, 16.0, 1.06),
    ):
        frame(clones + [floor, wall, child, tall_child, plate],
              azimuth, elevation, camera, pad)
        bpy.context.scene.render.filepath = os.path.join(OUT, f"{stem}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  wrote {stem}.png")

    # --- the throne under the beam, in elevation --------------------------
    #
    # The one shot that answers the question the build now asserts: does the
    # throne, on the Engineer's dais, clear the wall-plate? Straight on and
    # square, because a 3 cm gap judged from a 38° camera is a guess. The dais
    # is the Engineer's and drawn as a stand-in at the height `CONTRACT` uses.
    for obj in clones:
        obj.hide_render = True
    dais = standin("throne-dais", (2.6, 2.2, cb.DAIS_HEIGHT),
                   (0.0, 0.0, cb.DAIS_HEIGHT * 0.5), 0xC2708F)
    beam = standin("throne-beam", (4.0, 0.70, 0.22),
                   (0.0, 0.0, cb.CEILING_CLEAR + 0.11), 0xB5836A)
    throne_parts = []
    for part in ("throne-frame", "throne-gold", "throne-cushion"):
        obj = bpy.data.objects[part]
        obj.hide_render = False
        obj.location = (0.0, 0.0, cb.DAIS_HEIGHT)
        throne_parts.append(obj)
    elevation_child = standin("scale-child-elevation", (0.42, 0.42, cb.TALLEST_CHILD),
                              (1.9, 0.0, cb.TALLEST_CHILD * 0.5), 0x4FBF9B)
    for extra in (dais, beam, elevation_child):
        extra.hide_render = False
    bpy.context.view_layer.update()
    frame(throne_parts + [dais, beam, elevation_child], 0.0, 2.0, camera, 1.18)
    bpy.context.scene.render.filepath = os.path.join(OUT, "throne-beam.png")
    bpy.ops.render.render(write_still=True)
    print("  wrote throne-beam.png")

    # --- every asset in a row, in elevation, against both posts -----------
    #
    # **The shot that answers "is this the right size", which nothing here
    # answered before.** Three separate things were wrong with judging scale
    # off the shots above, and they compound:
    #
    # 1. The posts were **typed at 1.86 m** and believed to come from
    #    `TALLEST_CHILD`. A child is 2.12 m, or 2.97 m hatted, so every
    #    silhouette in batch 1 was sized against a post a quarter short. That
    #    is fixed, but fixing the number does not re-do the judgements made
    #    against the old one — this shot is how they get re-done.
    # 2. The per-asset shots have **no post at all**, and they are the shots
    #    each asset is actually judged from.
    # 3. The hall shots have both posts but at 38°, where **height is
    #    foreshortened and depth reads as height**. An armour 8 m upstage of a
    #    post cannot be compared with it by eye at that angle, whatever the
    #    ortho camera guarantees about scale.
    #
    # So: a flat elevation, everything at the same depth, standing on one
    # floor, with the two posts at the left where the eye starts. Elevation
    # because it is the only projection in which two heights side by side can
    # be read off against each other; ortho because a perspective one would
    # reintroduce the problem it is here to remove.
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.hide_render = True
    for obj in (dais, beam, elevation_child, floor, wall, child, tall_child, plate):
        obj.hide_render = True

    # **A wide shot gets a wide frame.** Every other render here is square,
    # which is right for one object; a 20 m row of them in a square frame is a
    # letterbox strip with 60% of the image empty and each asset a thumbnail —
    # a picture too small to judge from is the same failure as a picture of the
    # wrong thing, just less obvious. Restored afterwards so the frame size
    # cannot leak into a later shot.
    lineup_aspect = (1800, 500)
    was = (bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y)
    bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = lineup_aspect

    # **The backdrop goes behind everything, and that took two goes.** The
    # first version put the wall slab at y +0.5, and the throne — whose back
    # leans back to y +0.55 — had its spire *inside the wall*. The render came
    # out with a red armchair and a gold finial floating on its own above it,
    # i.e. a picture of the exact fault the throne was reshaped to fix, caused
    # entirely by the preview. That is fault 5 of the handoff happening again
    # with a wall in place of a tapestry, in the shot written to stop it: a
    # preview is scenery plus assets, and the scenery can hide the asset no
    # matter which prop it is made of. So the backdrop is now behind the
    # deepest thing in the row (the 6 m table), and in an ortho elevation that
    # costs nothing — depth is not visible, only height is, which is the whole
    # reason this projection was chosen.
    BACKDROP_Y = 3.6

    # Long things are yawed to lie **along** the row. The table is 6 m deep and
    # the bench 2.8 m, so end-on they are a trestle and a stub — a silhouette
    # review that shows two assets end-on is not reviewing their silhouettes.
    YAWED = {"table-top", "table-legs", "bench-plank"}

    lineup_floor = standin("lineup-floor", (25.0, 8.0, 0.2), (-2.4, 1.2, -0.1), 0xF0A3C1)
    lineup = [lineup_floor]
    # The two posts first, because a reader scans left to right and the
    # reference belongs before the things it is a reference for.
    for x, height, colour in (
        (-13.8, cb.CHILD_HEIGHT, 0x7FE3C0),
        (-12.8, cb.TALLEST_CHILD, 0x4FBF9B),
    ):
        lineup.append(standin(f"lineup-post-{height:.2f}", (0.42, 0.42, height),
                              (x, 0.0, height * 0.5), colour))

    # (x, parts, lift) — `lift` is what the asset stands on, and every value
    # comes from the same constant `check_contract` adds to the mesh before
    # asserting it against the headroom. So this picture cannot show a throne
    # at a height the build is not checking. Wall assets hang at their mount.
    for x, parts, lift in (
        (-11.0, ("plinth-block",), 0.0),
        (-11.0, ("armour-plate", "armour-trim", "armour-visor", "armour-plume"), 0.25),
        (-8.6, ("throne-frame", "throne-gold", "throne-cushion"), cb.DAIS_HEIGHT),
        (-6.2, ("bench-plank",), 0.0),
        (-2.0, ("table-top", "table-legs"), 0.0),
        (-3.0, ("feast-goblet",), cb.TABLE_TOP),
        (-1.9, ("feast-roast",), cb.TABLE_TOP),
        (-1.0, ("feast-pie",), cb.TABLE_TOP),
        (2.0, ("chest-body", "chest-bands", "chest-lid"), 0.0),
        (3.2, ("feast-loaf",), 0.0),
        (5.8, ("tapestry-cloth", "tapestry-fringe", "tapestryrail-pole"), cb.TAPESTRY_RAIL_Y),
        (8.8, ("sconce-bracket", "sconce-cup"), cb.SCONCE_MOUNT_Y),
    ):
        for part in parts:
            obj = bpy.data.objects[part]
            obj.hide_render = False
            # **Add to the authored origin, never assign over it.** `chest-lid`
            # is the one node in this file with a deliberate non-identity
            # origin — it *is* the hinge axis, which is why no offset formula
            # exists to drift. Assigning `location` outright throws that away,
            # and the first render of this shot had the lid sunk 0.52 m into
            # the chest, reading as a slightly odd box. `hall_composition`
            # already adds rather than assigns, for exactly this reason.
            base = Vector(home[part])
            obj.location = Vector((x, 0.0, lift)) + base
            if part in YAWED:
                obj.rotation_mode = "XYZ"
                obj.rotation_euler = (0.0, 0.0, math.radians(90.0))
            lineup.append(obj)
    # The throne's dais is the Engineer's, not this asset's, so it is a
    # stand-in — at the height `check_contract` adds to the throne's own.
    lineup.append(standin("lineup-dais", (2.2, 1.4, cb.DAIS_HEIGHT),
                          (-8.6, 0.0, cb.DAIS_HEIGHT * 0.5), 0xC2708F))
    # The wall the two wall-assets hang on, and the wall-plate above it — so
    # the sconce's headroom, which the build now asserts, is a thing you can
    # see rather than only a number in the log.
    lineup.append(standin("lineup-wall", (25.0, 0.3, cb.CEILING_CLEAR),
                          (-2.4, BACKDROP_Y, cb.CEILING_CLEAR * 0.5), 0xFFC2D8))
    lineup.append(standin("lineup-plate", (25.0, 0.5, 0.22),
                          (-2.4, BACKDROP_Y - 0.3, cb.CEILING_CLEAR + 0.11), 0xB5836A))
    for obj in lineup:
        obj.hide_render = False
    bpy.context.view_layer.update()
    frame(lineup, 0.0, 2.0, camera, 1.04)
    bpy.context.scene.render.filepath = os.path.join(OUT, "lineup.png")
    bpy.ops.render.render(write_still=True)
    bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = was
    print(f"  wrote lineup.png ({lineup_aspect[0]}x{lineup_aspect[1]}) — every batch-1 asset "
          f"in elevation against a {cb.CHILD_HEIGHT:.2f} m child and a {cb.TALLEST_CHILD:.2f} m "
          "one in the tallest hat")

    print(f"  the pale post in the hall shots is {cb.CHILD_HEIGHT:.2f} m — a child, "
          f"for scale; the darker one is {cb.TALLEST_CHILD:.2f} m, a child in the "
          "tallest hat")
    print(f"  throne-beam.png: the throne on the Engineer's {cb.DAIS_HEIGHT:.2f} m "
          f"dais under the {cb.CEILING_CLEAR:.2f} m wall-plate")
    print(f"  renders in {OUT}\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
