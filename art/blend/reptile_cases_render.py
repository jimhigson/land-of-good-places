"""Renders the Reptile House's cases kit to ``art/renders/reptile-cases/``.

    pnpm run render:reptile-cases

Not part of ``pnpm run blend:reptile-cases`` — it produces review pictures,
not shipped bytes. Run it whenever the shapes change.

Workbench, as ``castle_render.py`` is, and for its reasons: flat per-object
colour with an ink outline is the nearest thing a background render gets to
the game's own toon look, so a shape that reads badly here reads badly in the
house.

## It reads the geometry, and it reads the colours. It copies neither.

* **The geometry comes from ``reptile_cases.blend``**, opened here. There is
  no second builder, so the shapes cannot drift — the picture is of the mesh
  that ships.
* **The colours come from ``src/art/models/reptileCasesAssets.ts``**, parsed,
  once the Engineer's loader lands; until then :data:`PROPOSED` is used and
  the banner says so loudly. Hex values are never written here: every entry
  names a ``PALETTE.``/``ART.`` key and ``castle_render.palette_values`` reads
  the numbers out of the palette modules.
* **The compositions are built from the build script's own constants and the
  game's** (``reptile_cases_build``, ``reptile_constants``, ``ts_const``) —
  the one thing ``bridge_stones_render.py`` got wrong. Preview placements
  only, in a scene this file never saves.

The camera, colour parsing and stand-in helpers are **imported from
``castle_render``** rather than copied: it is the one owner of "how a kit is
photographed on this project".
"""

import os
import sys
import traceback

import bpy

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import reptile_cases_build as rb  # noqa: E402  (import-safe: everything is behind main())
from blendkit import REPO, ts_const, tube  # noqa: E402
from castle_render import (  # noqa: E402
    GAME_ELEVATION,
    configure,
    frame,
    linear_rgba,
    palette_values,
    standin,
)
from reptile_constants import (  # noqa: E402
    LAYOUT,
    REPTILE_CASE_HALF_DEPTH,
    REPTILE_CASE_PLINTH_HEIGHT,
    REPTILE_CASE_SEGMENT,
    REPTILE_GLASS_TOP,
    REPTILE_JAR_BASE_HEIGHT,
    REPTILE_JAR_RADIUS,
    REPTILE_NURSERY_KERB_HEIGHT,
    REPTILE_NURSERY_RAIL_TOP,
    REPTILE_PIER_POST_RADIUS,
    REPTILE_WALL_HEIGHT,
)

BLEND = os.path.join(REPO, "art", "blend", "reptile_cases.blend")
OUT = os.path.join(REPO, "art", "renders", "reptile-cases")

ENGINEER_MODULE = "src/art/models/reptileCasesAssets.ts"

#: The Artist's proposal for the Engineer's `STYLES` table, by node name.
#: Palette keys only (ART_DIRECTION §5) — a render in an off-palette colour
#: is a render that lies about how the asset will look.
PROPOSED = {
    "rc-case-plinth": "PALETTE.stonePinkLight",
    "rc-case-rim": "PALETTE.liftFrame",
    "rc-case-backboard": "PALETTE.buildingWindowWarm",
    "rc-case-backboard-relief": "PALETTE.leafDeep",
    "rc-pier-post": "PALETTE.stonePink",
    "rc-pier-vine": "PALETTE.leafMid",
    "rc-jar-base": "PALETTE.stonePinkLight",
    "rc-jar-rim": "PALETTE.liftFrame",
    "rc-round-wall": "PALETTE.stonePink",
    "rc-lagoon-wall": "PALETTE.stonePink",
    "rc-tortoise-wall": "PALETTE.stonePink",
    "rc-nursery-kerb": "PALETTE.stonePink",
    "rc-nursery-rail": "PALETTE.liftFrame",
    "rc-island-kerb": "PALETTE.stonePinkDark",
    "rc-grotto-rock": "PALETTE.stonePinkDark",
    "rc-grotto-moss": "PALETTE.leafLight",
}

#: Where she stands to greet a north-wall case, relative to its centreline —
#: both numbers the layout's, read, so the stand-in child is at the real spot.
NORTH_STAND_OFFSET = ts_const(LAYOUT, "REPTILE_NORTH_STAND_Z") - ts_const(LAYOUT, "REPTILE_NORTH_CASE_Z")
#: The plinth's back face stands this far off the room wall (the spec's 0.2).
CASE_WALL_GAP = 0.2
KID_HEIGHT = ts_const("src/art/models/kid.ts", "KID_HEIGHT")


def engineer_styles():
    """``{node name: palette key}`` from the Engineer's module, or ``None``."""
    path = os.path.join(REPO, ENGINEER_MODULE)
    if not os.path.exists(path):
        return None
    import re

    source = open(path, encoding="utf-8").read()
    found = re.findall(
        r"['\"]?(rc-[\w-]*)['\"]?:\s*\{[^}]*?colour:\s*((?:PALETTE|ART)\.\w+)",
        source,
        re.DOTALL,
    )
    return {name: key for name, key in found} or None


def resolve_colours():
    values = palette_values()
    styles = engineer_styles()
    if styles:
        source = f"{ENGINEER_MODULE} — the Engineer's own table"
    else:
        styles = PROPOSED
        source = (
            "PROPOSED in reptile_cases_render.py — the Engineer's module is not on "
            "this branch yet, so these renders show the Artist's SUGGESTED colours"
        )
    missing = [key for key in styles.values() if key not in values]
    assert not missing, f"these colours are named but do not exist in the palette modules: {missing}"
    return {node: values[key] for node, key in styles.items()}, source, values


# =============================================================================
# Compositions — preview placements only, never saved
# =============================================================================


def duplicate(name: str, location, suffix: str, rotation_z: float = 0.0):
    src = bpy.data.objects[name]
    obj = bpy.data.objects.new(f"{name}{suffix}", src.data)
    obj.location = location
    obj.rotation_euler = (0.0, 0.0, rotation_z)
    obj.color = src.color
    bpy.context.scene.collection.objects.link(obj)
    return obj


def see_through(obj):
    r, g, b, _ = obj.color
    obj.color = (r, g, b, 0.3)
    return obj


def glass(name: str, size, centre, values):
    """A see-through stand-in for a pane the Engineer draws in TypeScript."""
    return see_through(standin(name, size, centre, values["PALETTE.waterTop"]))


def glass_drum(name: str, radius: float, z0: float, z1: float, centre, values):
    """A see-through stand-in for a round glass pane."""
    verts, faces = tube(radius, z1 - z0, sides=32, z0=z0)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate(verbose=False)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (centre[0], centre[1], 0.0)
    obj.color = linear_rgba(values["PALETTE.waterTop"])
    bpy.context.scene.collection.objects.link(obj)
    return see_through(obj)


def kid(location, values):
    return standin("kid-standin", (KID_HEIGHT * 0.34, KID_HEIGHT * 0.3, KID_HEIGHT),
                   (location[0], location[1], KID_HEIGHT * 0.5), values["PALETTE.markerPink"])


def hide_all():
    for obj in bpy.data.objects:
        obj.hide_render = True


def show(*names):
    for name in names:
        bpy.data.objects[name].hide_render = False


def composition_case(values):
    """One north-wall case between its two pier posts, with its glass, the
    wall behind it and a child at the stand spot."""
    show("rc-case-plinth", "rc-case-rim", "rc-case-backboard", "rc-case-backboard-relief")
    post_x = REPTILE_CASE_SEGMENT * 0.5 + REPTILE_CASE_HALF_DEPTH + REPTILE_PIER_POST_RADIUS
    extras = [
        duplicate("rc-pier-post", (-post_x, 0.0, 0.0), ".L"),
        duplicate("rc-pier-vine", (-post_x, 0.0, 0.0), ".L"),
        duplicate("rc-pier-post", (post_x, 0.0, 0.0), ".R"),
        duplicate("rc-pier-vine", (post_x, 0.0, 0.0), ".R", rotation_z=2.1),
    ]
    pane_y = -(REPTILE_CASE_HALF_DEPTH - rb.CASE_GLASS_RECESS)
    pane_h = REPTILE_GLASS_TOP - REPTILE_CASE_PLINTH_HEIGHT
    extras.append(glass("glass-front", (REPTILE_CASE_SEGMENT, 0.02, pane_h),
                        (0.0, pane_y, REPTILE_CASE_PLINTH_HEIGHT + pane_h * 0.5), values))
    wall_y = REPTILE_CASE_HALF_DEPTH + CASE_WALL_GAP
    extras.append(standin("wall-standin", (post_x * 2 + 4.0, 0.5, REPTILE_WALL_HEIGHT),
                          (0.0, wall_y + 0.25, REPTILE_WALL_HEIGHT * 0.5), values["PALETTE.stonePinkLight"]))
    extras.append(standin("floor-standin", (post_x * 2 + 4.0, 8.0, 0.02),
                          (0.0, -2.0, -0.01), values["PALETTE.pathSand"]))
    extras.append(kid((1.6, -NORTH_STAND_OFFSET), values))
    return extras


def composition_enclosures(values):
    """Every open enclosure and the two glass drums, laid out in two rows."""
    extras = []
    back, front = 5.0, -4.0
    placements = {
        "rc-lagoon-wall": (-8.0, back),
        "rc-tortoise-wall": (4.5, back),
        "rc-round-wall": (-11.0, front),
        "rc-island-kerb": (-4.0, front),
        "rc-nursery-kerb": (3.0, front),
        "rc-nursery-rail": (3.0, front),
        "rc-jar-base": (9.0, front),
        "rc-jar-rim": (9.0, front),
    }
    for name, (x, y) in placements.items():
        extras.append(duplicate(name, (x, y, 0.0), ".preview"))
    nx, ny = placements["rc-nursery-kerb"]
    extras.append(glass_drum("glass-nursery", rb.NURSERY_GLASS_RADIUS, REPTILE_NURSERY_KERB_HEIGHT,
                             REPTILE_NURSERY_RAIL_TOP, (nx, ny), values))
    jx, jy = placements["rc-jar-base"]
    extras.append(glass_drum("glass-jar", REPTILE_JAR_RADIUS, REPTILE_JAR_BASE_HEIGHT,
                             REPTILE_GLASS_TOP, (jx, jy), values))
    extras.append(standin("floor-standin", (30.0, 20.0, 0.02), (0.0, 0.5, -0.01), values["PALETTE.pathSand"]))
    extras.append(kid((-0.5, -8.5), values))
    return extras


def composition_grotto(values):
    show("rc-grotto-rock", "rc-grotto-moss")
    extras = [
        standin("floor-standin", (12.0, 10.0, 0.02), (0.0, -1.0, -0.01), values["PALETTE.pathSand"]),
        glass("pool-water", (rb.GROTTO_POOL_RADIUS * 2 - 0.5, rb.GROTTO_POOL_RADIUS * 2 - 0.5, 0.02),
              (rb.GROTTO_POOL_CENTRE[0], rb.GROTTO_POOL_CENTRE[1], rb.GROTTO_POOL_LIP - 0.1), values),
        kid((3.2, -3.4), values),
    ]
    return extras


# (stem, composition, azimuth°, elevation°, pad)
SHOTS = [
    ("case", composition_case, 28.0, GAME_ELEVATION, 1.15),
    ("case-front", composition_case, 0.0, 10.0, 1.1),
    ("enclosures", composition_enclosures, 24.0, GAME_ELEVATION, 1.05),
    ("grotto", composition_grotto, 30.0, GAME_ELEVATION, 1.2),
    ("grotto-front", composition_grotto, 0.0, 14.0, 1.15),
]


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    colours, source, values = resolve_colours()
    configure(colours)
    os.makedirs(OUT, exist_ok=True)
    scene = bpy.context.scene
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 900
    camera_data = bpy.data.cameras.new("review-camera")
    camera = bpy.data.objects.new("review-camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    print("\nreptile_cases_render")
    print(f"  colours from: {source}")
    for stem, composition, azimuth, elevation, pad in SHOTS:
        hide_all()
        extras = composition(values)
        bpy.context.view_layer.update()
        subjects = [o for o in bpy.data.objects if o.type == "MESH" and not o.hide_render
                    and not o.name.startswith(("floor-", "wall-"))]
        frame(subjects, azimuth, elevation, camera, pad)
        scene.render.filepath = os.path.join(OUT, f"{stem}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  wrote {scene.render.filepath}")
        for obj in extras:
            bpy.data.objects.remove(obj, do_unlink=True)
    print()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
