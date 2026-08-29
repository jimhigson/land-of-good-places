"""Assembles a whole bridge out of the kit and renders it, for the eye.

    blender --background --factory-startup --python art/blend/bridge_stones_render.py

``bridge_stones_build.py`` makes three stones. Three stones tell you nothing
about whether a *bridge* reads right, which is the only question Jim asked, so
this builds the thing they are for: a 40%-shorter humpback with a three-centred
arch, a modelled voussoir ring round the mouth and a modelled coping run over
both parapets — and looks at it from the game's own 45° camera.

It is a **preview**, not a shipped asset. The park builds this geometry itself
(`src/world/train/bridges.ts`), swept along each crossing's own curve; this
file exists so the shape could be judged before that code was written, and so
it can be re-judged when a number moves. The arch maths below is deliberately
the same derivation `bridges.ts` uses — if the two ever disagree, the render is
the one that is wrong, because the park is what a child sees.

Renders land in ``art/renders/`` as the project already does.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BLEND = os.path.join(REPO, "art", "blend", "bridgeStones.blend")
RENDERS = os.path.join(REPO, "art", "renders")

# --- the bridge this preview builds -----------------------------------------
# Measured off `main`, not invented — see HANDOFF-bridge-model.md's table.
ARCH_SPAN_HALF = 3.2       # DECK_HALF_LENGTH = FENCE_OFFSET + 1.2
ARCH_CLEAR_HALF = 1.8      # TRACK_CLEARANCE + 0.5
ARCH_CROWN_DIP = 0.35      # the chosen three-centred arch's dip at the clear span
TRAIN_CLEARANCE_Y = 3.87
BRIDGE_DECK_DEPTH = 0.16
HEIGHT_MARGIN = 0.05
ROAD_HALF = 1.6            # canonical seed's first bridge
WALL_THICKNESS = 0.3
PARAPET_HEIGHT = 0.72
HUMP_BLEND = 0.25
RAMP_RUN = 7.76            # 40% shorter than main's ~15.0 m

COPING_LENGTH = 0.86
VOUSSOIR_PITCH = 0.42
KEYSTONE_PITCH = 0.8

HALF_ACROSS = ROAD_HALF + WALL_THICKNESS
SOFFIT_CROWN = TRAIN_CLEARANCE_Y + HEIGHT_MARGIN + ARCH_CROWN_DIP  # above ground
CROWN_ROAD = SOFFIT_CROWN + BRIDGE_DECK_DEPTH


# =============================================================================
# The arch — the same three-centred derivation `bridges.ts` uses
# =============================================================================

R1 = (ARCH_CLEAR_HALF ** 2 + ARCH_CROWN_DIP ** 2) / (2 * ARCH_CROWN_DIP)
PHI1 = math.asin(ARCH_CLEAR_HALF / R1)
R2 = (ARCH_SPAN_HALF - ARCH_CLEAR_HALF) / (1 - math.sin(PHI1))
C2_ALONG = ARCH_CLEAR_HALF - R2 * math.sin(PHI1)
SPRING_Y = SOFFIT_CROWN - ARCH_CROWN_DIP - R2 * math.cos(PHI1)
ARC_CROWN = R1 * PHI1
ARC_HALF = ARC_CROWN + R2 * (math.pi / 2 - PHI1)


def arch_at(s: float):
    """The intrados point and its outward normal at signed arc length ``s``."""
    sign = 1.0 if s >= 0 else -1.0
    t = abs(s)
    if t <= ARC_CROWN:
        theta = t / R1
        along = R1 * math.sin(theta)
        y = SOFFIT_CROWN - R1 * (1 - math.cos(theta))
    else:
        theta = PHI1 + (t - ARC_CROWN) / R2
        along = C2_ALONG + R2 * math.sin(theta)
        y = SPRING_Y + R2 * math.cos(theta)
    return sign * along, y, sign * math.sin(theta), math.cos(theta)


def ring_stones():
    """(arc position, is-keystone) for every stone in one mouth's ring.

    The keystone sits on the crown; the voussoirs fill the rest at a pitch
    nudged so a whole number of them lands exactly on the springing. A ring
    that closes on the springing by construction cannot leave the half-stone
    gap a fixed pitch would.
    """
    available = ARC_HALF - KEYSTONE_PITCH / 2
    count = max(1, round(available / VOUSSOIR_PITCH))
    pitch = available / count
    stones = [(0.0, True)]
    for k in range(count):
        s = KEYSTONE_PITCH / 2 + pitch * (k + 0.5)
        stones.append((s, False))
        stones.append((-s, False))
    return stones, pitch


# =============================================================================
# The hump
# =============================================================================


def profile_drop(q: float) -> float:
    """`bridges.ts`'s `profileDrop`, verbatim: 0 at the crown, 1 at the foot."""
    u = min(1.0, max(0.0, q))
    b = HUMP_BLEND
    total = 1 - b
    if u < b:
        w = u / 2 - (b / (2 * math.pi)) * math.sin(math.pi * u / b)
    elif u <= 1 - b:
        w = b / 2 + (u - b)
    else:
        v = u - (1 - b)
        w = b / 2 + (1 - 2 * b) + v / 2 + (b / (2 * math.pi)) * math.sin(math.pi * v / b)
    return w / total


def road_y(along: float) -> float:
    q = min(1.0, abs(along) / RAMP_RUN_TOTAL)
    return CROWN_ROAD * (1 - profile_drop(q))


RAMP_RUN_TOTAL = ARCH_SPAN_HALF + RAMP_RUN


# =============================================================================
# Scene
# =============================================================================


# The park's own colours (`src/core/palette.ts`) — this is a preview of the
# real thing, and a preview in default grey answers a different question from
# the one being asked. sRGB hex → linear, the way Blender wants it.
PALETTE = {
    "grass": 0x86D36A,
    "pathSand": 0xF3DDB2,
    "stonePink": 0xFFC2D8,
    "stonePinkLight": 0xFFE0EC,
}


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name: str, key: str):
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    hexed = PALETTE[key]
    rgb = [srgb_to_linear(((hexed >> s) & 0xFF) / 255.0) for s in (16, 8, 0)]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Specular IOR Level"].default_value = 0.1
    return mat


def new_mesh(name, verts, faces, coll, colour="stonePink"):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    mesh.validate(verbose=False)
    mesh.materials.append(material(colour, colour))
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    return obj


def spandrel(coll):
    """One side's masonry: a slab from below ground up to the parapet top,
    following the hump, with the arch cut out of it."""
    steps = 160
    alongs = [-RAMP_RUN_TOTAL + i * (2 * RAMP_RUN_TOTAL / steps) for i in range(steps + 1)]
    verts = []
    faces = []
    for a in alongs:
        top = road_y(a) + PARAPET_HEIGHT
        verts.append((a, 0.0, -1.0))
        verts.append((a, 0.0, top))
    for i in range(steps):
        b = i * 2
        faces.append((b, b + 2, b + 3, b + 1))
    outline = new_mesh("spandrel", verts, faces, coll)

    solid = outline.modifiers.new("solid", "SOLIDIFY")
    solid.thickness = WALL_THICKNESS
    solid.offset = 0.0
    return outline


def arch_cutter(coll):
    """A prism of the tunnel void, for the boolean that opens the mouth."""
    steps = 96
    profile = []
    for i in range(steps + 1):
        s = -ARC_HALF + i * (2 * ARC_HALF / steps)
        a, y, _, _ = arch_at(s)
        profile.append((a, y))
    profile.append((ARCH_SPAN_HALF, -1.5))
    profile.append((-ARCH_SPAN_HALF, -1.5))

    depth = HALF_ACROSS * 2 + 2.0
    verts = [(a, -depth / 2, y) for a, y in profile] + [(a, depth / 2, y) for a, y in profile]
    n = len(profile)
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j + n, i + n))
    return new_mesh("archCutter", verts, faces, coll)


def place(part_name: str, coll, matrix: Matrix, name: str):
    src = bpy.data.objects[part_name]
    obj = bpy.data.objects.new(name, src.data)
    obj.matrix_world = matrix
    coll.objects.link(obj)
    return obj


def build_preview():
    coll = bpy.data.collections.new("preview")
    bpy.context.scene.collection.children.link(coll)

    # Hide the loose authoring parts; only their copies belong in the shot.
    # Their mesh data carries the dressed-stone colour, so every placed copy
    # picks it up — the ring and the coping are one lighter stone than the
    # rubble spandrel behind them, exactly as `bridges.ts` will ship them.
    for name in ("coping", "voussoir", "keystone"):
        obj = bpy.data.objects[name]
        obj.hide_render = True
        obj.data.materials.clear()
        obj.data.materials.append(material("stonePinkLight", "stonePinkLight"))

    stones, pitch = ring_stones()
    print(f"  ring: {len(stones)} stones, voussoir pitch {pitch:.3f} m "
          f"(authored {VOUSSOIR_PITCH})")

    for side in (1, -1):
        # --- the spandrel wall, arch cut out of it
        wall = spandrel(coll)
        wall.location = (0.0, side * (ROAD_HALF + WALL_THICKNESS / 2), 0.0)
        cutter = arch_cutter(coll)
        boolean = wall.modifiers.new("arch", "BOOLEAN")
        boolean.operation = "DIFFERENCE"
        boolean.object = cutter
        cutter.hide_render = True
        cutter.hide_viewport = True

        # --- the voussoir ring at this mouth
        face_y = side * HALF_ACROSS
        for index, (s, is_key) in enumerate(stones):
            along, y, nx, ny = arch_at(s)
            # Authored: +Z radially out, X tangential, −Y out of the mouth.
            # Blender world here: X along, Y across, Z up. So the stone's local
            # Z goes to the outward normal (nx, 0, ny), its local −Y to the
            # mouth's own outward direction (0, side, 0), and X follows.
            up = Vector((nx, 0.0, ny))
            forward = Vector((0.0, float(side), 0.0))
            right = up.cross(forward)
            basis = Matrix((
                (right.x, -forward.x, up.x, along),
                (right.y, -forward.y, up.y, face_y),
                (right.z, -forward.z, up.z, y),
                (0.0, 0.0, 0.0, 1.0),
            ))
            place("keystone" if is_key else "voussoir", coll, basis,
                  f"ring{side}.{index}")

        # --- the coping run along this parapet
        length = 2 * RAMP_RUN_TOTAL
        count = max(1, int(length / COPING_LENGTH))
        step = length / count
        for i in range(count):
            a = -RAMP_RUN_TOTAL + step * (i + 0.5)
            top = road_y(a) + PARAPET_HEIGHT
            # Tilt each block onto the local grade, so the run flows over the
            # hump instead of stepping up it.
            slope = (road_y(a + 0.2) - road_y(a - 0.2)) / 0.4
            tilt = math.atan(slope)
            m = (Matrix.Translation((a, side * (ROAD_HALF + WALL_THICKNESS / 2), top))
                 @ Matrix.Rotation(math.pi / 2, 4, "Z")
                 @ Matrix.Rotation(-tilt, 4, "X"))
            place("coping", coll, m, f"coping{side}.{i}")

    # --- the road, so the hump reads as a road and not as two walls
    steps = 160
    verts = []
    faces = []
    for i in range(steps + 1):
        a = -RAMP_RUN_TOTAL + i * (2 * RAMP_RUN_TOTAL / steps)
        y = road_y(a)
        verts.append((a, -ROAD_HALF, y))
        verts.append((a, ROAD_HALF, y))
    for i in range(steps):
        b = i * 2
        faces.append((b, b + 1, b + 3, b + 2))
    new_mesh("road", verts, faces, coll, "pathSand")

    # --- the ground, for the silhouette
    g = 30.0
    new_mesh("ground", [(-g, -g, 0), (g, -g, 0), (g, g, 0), (-g, g, 0)],
             [(0, 1, 2, 3)], coll, "grass")


# =============================================================================


def look_at(obj, target: Vector) -> None:
    direction = (obj.location - target)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("preview")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.78, 0.92, 1)
    scene.world = world

    sun_data = bpy.data.lights.new("sun", type="SUN")
    sun_data.energy = 3.5
    sun_data.angle = math.radians(8)
    sun = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(52), 0, math.radians(38))

    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


SHOTS = {
    # The game's own 45° iso view, from the side a walker approaches on.
    "bridge-iso": ((15.0, -15.0, 12.0), (0.0, 0.0, 2.0), 45.0),
    # Square on the tunnel mouth: the arch and its ring.
    "bridge-arch": ((0.9, -16.0, 2.4), (0.0, 0.0, 2.6), 42.0),
    # Straight along the deck: the coping run over the hump.
    "bridge-coping": ((-14.0, -3.4, 6.4), (2.0, 0.0, 3.4), 45.0),
    # Flat side elevation: the hump silhouette and the arch together.
    "bridge-silhouette": ((0.0, -46.0, 5.2), (0.0, 0.0, 2.6), 68.0),
}


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    build_preview()
    cam = setup_render()

    print("\nbridge_stones_render")
    print(f"  soffit crown {SOFFIT_CROWN:.3f}  road crown {CROWN_ROAD:.3f}  "
          f"spring {SPRING_Y:.3f}")
    print(f"  R1 {R1:.3f}  phi1 {math.degrees(PHI1):.2f}°  R2 {R2:.3f}  "
          f"arc half {ARC_HALF:.3f}")
    print(f"  total length {2 * RAMP_RUN_TOTAL:.2f} m  "
          f"average ramp gradient {CROWN_ROAD / RAMP_RUN:.3f}")

    os.makedirs(RENDERS, exist_ok=True)
    for name, (pos, target, lens) in SHOTS.items():
        cam.location = Vector(pos)
        cam.data.lens = lens
        look_at(cam, Vector(target))
        path = os.path.join(RENDERS, f"{name}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print(f"  wrote {path}")
    print()


if __name__ == "__main__":
    main()
