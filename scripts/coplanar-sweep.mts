/**
 * **Every pair of same-facing faces that share a plane, anywhere in the game.**
 *
 * Two faces in one plane make the depth buffer strobe as the camera moves.
 * `ART_DIRECTION.md` §7 forbids it, `CLAUDE.md` records the family of bugs it
 * belongs to, and Jim has reported it three times in a week — the castle roof's
 * floor slab punching through its own curtain wall, twice (#467). His question
 * is #472, and it is the reason this file exists rather than another hand-fix:
 *
 * > *"No coplanar faces is tricky because they dominate the game's models —
 * > what strategy could be used to find them all in an automated way?"*
 *
 * `scripts/check-coplanar.mts` is the gate that runs this and ratchets it. This
 * module is only the measurement, so that the sample viewer, a probe or a
 * future per-asset check can ask the same question of any `Object3D`.
 *
 * ## What counts as a hit, and what deliberately does not
 *
 * 1. **World-space triangles, bucketed by plane.** Every mesh under the root,
 *    every instance of every `InstancedMesh`, transformed by its own
 *    `matrixWorld`. Nothing here models the geometry; it measures the
 *    triangles the renderer would be handed.
 *
 * 2. **Same-facing only.** Two coplanar faces pointing *away* from each other
 *    never fight: back-face culling draws exactly one of them, whichever way
 *    the camera is. Discarding those is what stops this drowning in noise —
 *    a throwaway sweep for #467 found the opposite-facing hits outnumbered the
 *    real ones several times over. `material.side` decides which way a face
 *    is really pointing: `BackSide` flips it, `DoubleSide` faces both ways and
 *    is therefore tested in both.
 *
 * 3. **Only faces the camera can ever see.** The rig is fixed forever
 *    (ARCHITECTURE.md, "One camera angle, forever"), so this is decidable
 *    rather than a guess: the eye is always at `cameraOffset(yaw, pitch)` from
 *    its focus, so a face is visible only where `normal · eye > 0`. That is
 *    what let #467 dismiss a pair 18 m under the floor, facing down, with
 *    confidence. The angles come from `core/constants.ts` through
 *    `core/cameraRig.ts` — the same two functions `IsoCamera` builds itself
 *    from — so if the rig ever changes, this follows it.
 *
 * 4. **Area overlap, not proximity.** Two coplanar triangles that merely share
 *    an edge are how every tiled surface in the game is built and are not a
 *    defect. The overlap polygon is clipped for real (Sutherland–Hodgman in
 *    the shared plane) and its area is the finding's size.
 *
 * 5. **Different meshes only.** A single geometry's own triangles tile their
 *    plane; that is what a subdivided floor *is*. The defect is two builders
 *    meeting, so a pair must come from two different `Object3D`s — and an
 *    `InstancedMesh` counts as one, however many instances it has, for the
 *    reason written where the ids are handed out.
 *
 * ## Two tolerances, because the tolerance decides the count
 *
 * The #467 sweep measured **31 visible pairs at 1 cm and 19 at 0.1 mm** across
 * the park. So a bare number is meaningless: every finding carries the plane
 * separation it was measured at, and {@link SweepTolerances} names the two the
 * gate reports separately — *fighting now* and *one edit away*. The second is a
 * maintained sub-centimetre stand-off, which `ART_DIRECTION.md` calls a smell
 * in its own right: it is a number somebody has to keep true, and it goes stale
 * the moment either surface moves.
 *
 * ## Why `visible` is ignored
 *
 * Most of the game is `visible = false` at build time — 3841 of 5543 meshes,
 * because the castle's interior root and the hotel's rooms are hidden until you
 * are standing in them. Honouring `visible` here would sweep the park and skip
 * every interior, which is exactly where the last two of these bugs were. So
 * the sweep looks at everything, and the per-space report says where each hit
 * lives.
 */
import {
  BackSide,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { CAMERA_PITCH_DEGREES, CAMERA_YAW_DEGREES } from '../src/core/constants.ts';
import { cameraOffset } from '../src/core/cameraRig.ts';
import { DEG } from '../src/core/mathUtils.ts';
import { spaceAt } from '../src/world/spaces.ts';

// ----------------------------------------------------------------- the rig

/**
 * The direction of the eye from anything it is looking at — the one and only
 * camera angle, unit length.
 *
 * Derived from `cameraOffset` with the park's own pitch and yaw rather than
 * written out here, for the reason `core/cameraRig.ts` exists at all: the
 * trigonometry was copied by hand into four cameras and there was no way to
 * tell that any of them had a sign wrong.
 */
export const EYE_DIRECTION = ((): Vector3 => {
  const offset = cameraOffset(CAMERA_YAW_DEGREES * DEG, CAMERA_PITCH_DEGREES * DEG, 1);
  return new Vector3(offset.x, offset.y, offset.z).normalize();
})();

// ----------------------------------------------------------------- knobs

export interface SweepTolerances {
  /**
   * Faces this far apart or closer are **fighting now**: the depth buffer has
   * no meaningful gap to resolve and the seam strobes. 0.1 mm.
   */
  readonly fighting: number;
  /**
   * Faces this far apart or closer are **one edit away**: somebody is holding
   * them apart with a maintained stand-off, which `ART_DIRECTION.md` calls a
   * smell in itself because the number goes stale the moment either surface
   * moves. 1 cm — the looser of the two figures #467 reported.
   */
  readonly near: number;
}

export const DEFAULT_TOLERANCES: SweepTolerances = { fighting: 1e-4, near: 1e-2 };

/**
 * How nearly parallel two faces must be to count as sharing a plane: half a
 * degree.
 *
 * Not slack for its own sake. Two authored-coplanar surfaces are built by
 * different code from different numbers, and a wall whose plane is computed
 * through a rotation lands a few ten-thousandths off the floor plate it meets.
 * Half a degree over a 10 m face is 9 cm of separation at the far end, which
 * the plane-separation test then rejects anyway — the angle only decides
 * whether the pair is *considered*, and the separation decides whether it is
 * reported.
 */
const COS_ANGLE_TOLERANCE = Math.cos(0.5 * DEG);

/**
 * Triangles smaller than this are not measured. 1 cm².
 *
 * Stated rather than tuned: a face this small cannot carry a seam a person
 * sees, and the alternative is carrying a couple of hundred thousand
 * tessellation slivers through the whole pipeline for nothing. Raise it and
 * you are hiding findings; that is the one direction this must never move.
 */
const MIN_TRIANGLE_AREA = 1e-4;

/** Overlaps smaller than this are not reported. 1 cm². */
const MIN_OVERLAP_AREA = 1e-4;

/**
 * Side of the world-space hash cell, in metres.
 *
 * Only a speed knob: a triangle is inserted into **every** cell its own
 * bounding box covers, so two triangles whose boxes overlap always share at
 * least one cell and the grid can never lose a pair. Four metres keeps the
 * chains short without making a 60 m floor plate cover thousands of cells.
 */
const CELL = 4;

/**
 * Side of the normal-space hash cell.
 *
 * Two coplanar faces have near-identical normals but not identical ones, so a
 * lookup probes its own cell and all 26 neighbours; the cell is sized so that
 * two normals within {@link COS_ANGLE_TOLERANCE} of each other can never be
 * more than one cell apart in any component.
 */
const NORMAL_CELL = 2 * Math.sin(0.5 * DEG);

// ----------------------------------------------------------------- findings

/** One pair of same-facing faces sharing a plane. */
export interface CoplanarPair {
  /** Which named place it is in, from `world/spaces.ts`'s `spaceAt`. */
  readonly space: string;
  /** Scene-graph path of the first object; see {@link objectPath}. */
  readonly a: string;
  /** Scene-graph path of the second object. */
  readonly b: string;
  /** Square metres of shared plane the two faces both cover. */
  readonly area: number;
  /** How far apart the two planes are, in metres, at their furthest. */
  readonly separation: number;
  /** Middle of the overlap, in world space. */
  readonly at: Vector3;
  /** The shared plane's outward normal, as the camera sees it. */
  readonly normal: Vector3;
}

/** Everything one sweep found, plus what it cost. */
export interface SweepResult {
  readonly pairs: readonly CoplanarPair[];
  readonly trianglesConsidered: number;
  readonly trianglesTotal: number;
  readonly objects: number;
  readonly ms: number;
}

/**
 * A stable name for an object, for a ratchet key that survives the park being
 * regenerated on another seed.
 *
 * Named ancestors joined by `/`, with the geometry's own class standing in for
 * an unnamed link — 3952 of the game's 5543 meshes have no `name`, and
 * `wooden-walls/<Mesh:BoxGeometry>` at least says which of its siblings it is.
 * Never a coordinate and never an index: both move with the seed, and a
 * baseline keyed on either would be a baseline that has to be rewritten every
 * time the park is regenerated.
 */
export function objectPath(object: Object3D): string {
  const parts: string[] = [];
  let node: Object3D | null = object;
  while (node && node.parent) {
    const geometry = (node as Mesh).geometry as BufferGeometry | undefined;
    parts.unshift(node.name || `<${node.type}${geometry ? `:${geometry.type}` : ''}>`);
    node = node.parent;
  }
  return parts.join('/');
}

// ------------------------------------------------------- collecting triangles

interface Collected {
  /** `n * 9` world-space vertex coordinates. Double precision, deliberately. */
  readonly xyz: Float64Array;
  /** `n * 3` unit normals, already flipped to the side the camera sees. */
  readonly normals: Float64Array;
  /** `n` object ids, indexing {@link Collected.names}. */
  readonly owner: Int32Array;
  readonly names: string[];
  readonly count: number;
  readonly total: number;
  readonly objects: number;
}

/**
 * Every triangle in the scene that the camera could ever see the front of.
 *
 * Double precision throughout, and this is not fussiness: the hotel stands
 * 600 m from the origin and the castle's floors 300 m apart, where a 32-bit
 * float resolves about 6/100 mm — coarser than the 0.1 mm tolerance the whole
 * check turns on. In `Float32Array` the tight tolerance would silently become
 * meaningless exactly in the spaces the last two bugs were found in.
 */
function collect(root: Object3D): Collected {
  root.updateMatrixWorld(true);

  const xyz: number[] = [];
  const normals: number[] = [];
  const owner: number[] = [];
  const names: string[] = [];
  let total = 0;
  let objects = 0;

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const normal = new Vector3();
  const world = new Matrix4();
  const instance = new Matrix4();

  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const geometry = node.geometry as BufferGeometry;
    const position = geometry.getAttribute('position');
    if (!position) return;
    const index = geometry.index;
    const triangles = index ? index.count / 3 : position.count / 3;
    if (triangles < 1) return;

    const materials: Material[] = Array.isArray(node.material) ? node.material : [node.material];
    const groups = geometry.groups.length > 0 ? geometry.groups : null;
    /**
     * Which side of this triangle is drawn — or `NaN` for one that cannot take
     * part in a depth fight at all.
     *
     * `NaN` means the material never writes depth, so the face is laid over
     * whatever is already in the buffer and can neither win nor lose. Skipping
     * those is not slack: it is the one case where two faces in a plane is the
     * intended way to draw something. Asked per triangle rather than per mesh
     * because a multi-material geometry answers differently per group.
     */
    const sideOf = (triangle: number): number => {
      let material = materials[0];
      if (groups) {
        for (const group of groups) {
          if (triangle * 3 >= group.start && triangle * 3 < group.start + group.count) {
            material = materials[group.materialIndex ?? 0] ?? materials[0];
            break;
          }
        }
      }
      const record = material as unknown as { side?: number; depthWrite?: boolean } | undefined;
      if (!record || record.depthWrite === false) return Number.NaN;
      return record.side ?? 0;
    };

    const copies = node instanceof InstancedMesh ? node.count : 1;
    // One id for the whole `InstancedMesh`, so its own instances are never
    // reported against each other. Two of them *can* land in one plane — but
    // where instances are placed is animation, and this measures a world that
    // has never had a frame run on it: the ferris wheel's gondolas and the
    // hotel's disco motes are all still on top of one another at t = 0, and
    // treating those as findings buried the real ones under two hundred of
    // them. Instance placement is `check:park`'s and the procgen invariants'
    // question; this file's question is what the modeller drew.
    const id = names.length;
    names.push(objectPath(node));
    objects += 1;
    for (let copy = 0; copy < copies; copy += 1) {
      if (node instanceof InstancedMesh) {
        node.getMatrixAt(copy, instance);
        world.multiplyMatrices(node.matrixWorld, instance);
      } else {
        world.copy(node.matrixWorld);
      }
      for (let triangle = 0; triangle < triangles; triangle += 1) {
        total += 1;
        const side = sideOf(triangle);
        if (Number.isNaN(side)) continue;
        const i0 = index ? index.getX(triangle * 3) : triangle * 3;
        const i1 = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
        const i2 = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
        a.fromBufferAttribute(position, i0).applyMatrix4(world);
        b.fromBufferAttribute(position, i1).applyMatrix4(world);
        c.fromBufferAttribute(position, i2).applyMatrix4(world);
        ab.subVectors(b, a);
        ac.subVectors(c, a);
        normal.crossVectors(ab, ac);
        const twiceArea = normal.length();
        if (twiceArea / 2 < MIN_TRIANGLE_AREA) continue;
        normal.divideScalar(twiceArea);

        // Which way this face really points. `BackSide` draws the far side, so
        // that is the side a camera meets; `DoubleSide` genuinely faces both,
        // and both are recorded — a double-sided face fights a coplanar
        // neighbour whichever way round the neighbour is.
        const facings = side === DoubleSide ? [1, -1] : side === BackSide ? [-1] : [1];
        for (const facing of facings) {
          const nx = normal.x * facing;
          const ny = normal.y * facing;
          const nz = normal.z * facing;
          if (nx * EYE_DIRECTION.x + ny * EYE_DIRECTION.y + nz * EYE_DIRECTION.z <= 0) continue;
          xyz.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
          normals.push(nx, ny, nz);
          owner.push(id);
        }
      }
    }
  });

  return {
    xyz: Float64Array.from(xyz),
    normals: Float64Array.from(normals),
    owner: Int32Array.from(owner),
    names,
    count: owner.length,
    total,
    objects,
  };
}

// --------------------------------------------------------------- the overlap

/**
 * Area the two triangles both cover, in their shared plane.
 *
 * Sutherland–Hodgman: clip triangle B against triangle A's three edges in a
 * 2D frame built on A's own normal, then take the shoelace area of what is
 * left. Two triangles that merely share an edge clip to a degenerate sliver of
 * zero area, which is the whole point — a tiled floor is not a defect, and a
 * proximity test would have called every tile in the game one.
 */
function overlapArea(
  xyz: Float64Array,
  i: number,
  j: number,
  nx: number,
  ny: number,
  nz: number,
  out: { x: number; y: number; z: number },
): number {
  // A 2D frame on the shared plane, origin at A's first vertex.
  const ox = xyz[i * 9] as number;
  const oy = (xyz[i * 9 + 1] as number);
  const oz = (xyz[i * 9 + 2] as number);
  // Any vector not parallel to the normal will do for the first axis.
  let ux = 0;
  let uy = 0;
  let uz = 0;
  if (Math.abs(nx) < 0.9) {
    ux = 1;
  } else {
    uy = 1;
  }
  const dot = ux * nx + uy * ny + uz * nz;
  ux -= nx * dot;
  uy -= ny * dot;
  uz -= nz * dot;
  const ulen = Math.hypot(ux, uy, uz);
  ux /= ulen;
  uy /= ulen;
  uz /= ulen;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;

  const flatten = (index: number, corner: number): [number, number] => {
    const px = (xyz[index * 9 + corner * 3] as number) - ox;
    const py = (xyz[index * 9 + corner * 3 + 1] as number) - oy;
    const pz = (xyz[index * 9 + corner * 3 + 2] as number) - oz;
    return [px * ux + py * uy + pz * uz, px * vx + py * vy + pz * vz];
  };

  const clip: [number, number][] = [flatten(i, 0), flatten(i, 1), flatten(i, 2)];
  // Sutherland–Hodgman needs the clipping triangle wound consistently.
  const clipArea =
    (clip[1]![0] - clip[0]![0]) * (clip[2]![1] - clip[0]![1]) -
    (clip[2]![0] - clip[0]![0]) * (clip[1]![1] - clip[0]![1]);
  if (clipArea < 0) clip.reverse();

  let polygon: [number, number][] = [flatten(j, 0), flatten(j, 1), flatten(j, 2)];
  for (let edge = 0; edge < 3 && polygon.length > 0; edge += 1) {
    const from = clip[edge]!;
    const to = clip[(edge + 1) % 3]!;
    const ex = to[0] - from[0];
    const ey = to[1] - from[1];
    const inside = (point: [number, number]): number =>
      ex * (point[1] - from[1]) - ey * (point[0] - from[0]);
    const next: [number, number][] = [];
    for (let k = 0; k < polygon.length; k += 1) {
      const current = polygon[k]!;
      const previous = polygon[(k + polygon.length - 1) % polygon.length]!;
      const currentIn = inside(current) >= 0;
      const previousIn = inside(previous) >= 0;
      if (currentIn !== previousIn) {
        const t = inside(previous) / (inside(previous) - inside(current));
        next.push([
          previous[0] + t * (current[0] - previous[0]),
          previous[1] + t * (current[1] - previous[1]),
        ]);
      }
      if (currentIn) next.push(current);
    }
    polygon = next;
  }
  if (polygon.length < 3) return 0;

  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let k = 0; k < polygon.length; k += 1) {
    const p = polygon[k]!;
    const q = polygon[(k + 1) % polygon.length]!;
    const cross = p[0] * q[1] - q[0] * p[1];
    area += cross;
    cx += (p[0] + q[0]) * cross;
    cy += (p[1] + q[1]) * cross;
  }
  area /= 2;
  if (Math.abs(area) < MIN_OVERLAP_AREA) return 0;
  cx /= 6 * area;
  cy /= 6 * area;
  out.x = ox + cx * ux + cy * vx;
  out.y = oy + cx * uy + cy * vy;
  out.z = oz + cx * uz + cy * vz;
  return Math.abs(area);
}

// ------------------------------------------------------------------ the sweep

/**
 * Finds every same-facing coplanar overlap under `root`.
 *
 * Hashes each triangle into the world cells its bounding box covers **and** a
 * cell in normal space, then probes the 26 neighbouring normal cells as well —
 * two authored-coplanar faces agree to a few ten-thousandths, not exactly, and
 * a lookup that only ever read its own cell would lose whichever pairs happened
 * to straddle a boundary. Silently. The world cells need no such probing,
 * because a triangle is inserted into all of them.
 */
export function sweepCoplanar(
  root: Object3D,
  tolerances: SweepTolerances = DEFAULT_TOLERANCES,
): SweepResult {
  const started = performance.now();
  const collected = collect(root);
  const { xyz, normals, owner, count } = collected;

  // Open hashing: `head[bucket]` is the newest entry, `next[entry]` the one
  // before it, `entryTriangle[entry]` which triangle it is. Hash collisions
  // only cost an extra exact test, never a wrong answer.
  const BUCKETS = 1 << 22;
  const head = new Int32Array(BUCKETS).fill(-1);
  const entryTriangle: number[] = [];
  const entryNext: number[] = [];

  const hash = (cx: number, cy: number, cz: number, nx: number, ny: number, nz: number): number => {
    let h = 2166136261;
    for (const value of [cx, cy, cz, nx, ny, nz]) {
      h ^= value & 0xffff;
      h = Math.imul(h, 16777619);
      h ^= (value >> 16) & 0xffff;
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % BUCKETS;
  };

  const cellsOf = (index: number): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } => {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let corner = 0; corner < 3; corner += 1) {
      const x = xyz[index * 9 + corner * 3] as number;
      const y = xyz[index * 9 + corner * 3 + 1] as number;
      const z = xyz[index * 9 + corner * 3 + 2] as number;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    return {
      x0: Math.floor(minX / CELL),
      x1: Math.floor(maxX / CELL),
      y0: Math.floor(minY / CELL),
      y1: Math.floor(maxY / CELL),
      z0: Math.floor(minZ / CELL),
      z1: Math.floor(maxZ / CELL),
    };
  };

  const normalCell = (index: number): [number, number, number] => [
    Math.round((normals[index * 3] as number) / NORMAL_CELL),
    Math.round((normals[index * 3 + 1] as number) / NORMAL_CELL),
    Math.round((normals[index * 3 + 2] as number) / NORMAL_CELL),
  ];

  const seen = new Set<number>();
  const centre = { x: 0, y: 0, z: 0 };
  /**
   * Aggregated by object pair and plane, because one seam is hundreds of
   * triangle pairs and a list of those is not a finding a person can act on.
   * `area` is the whole seam; `at` and `normal` are the single biggest
   * triangle overlap in it, which is the place to go and look.
   */
  interface Seam {
    space: string;
    a: string;
    b: string;
    area: number;
    biggest: number;
    separation: number;
    at: Vector3;
    normal: Vector3;
  }
  const byPair = new Map<string, Seam>();

  for (let i = 0; i < count; i += 1) {
    const box = cellsOf(i);
    const [ncx, ncy, ncz] = normalCell(i);
    const nx = normals[i * 3] as number;
    const ny = normals[i * 3 + 1] as number;
    const nz = normals[i * 3 + 2] as number;
    const ax = xyz[i * 9] as number;
    const ay = xyz[i * 9 + 1] as number;
    const az = xyz[i * 9 + 2] as number;

    // --- look for partners already in the table
    seen.clear();
    for (let cx = box.x0; cx <= box.x1; cx += 1) {
      for (let cy = box.y0; cy <= box.y1; cy += 1) {
        for (let cz = box.z0; cz <= box.z1; cz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
              for (let dz = -1; dz <= 1; dz += 1) {
                const bucket = hash(cx, cy, cz, ncx + dx, ncy + dy, ncz + dz);
                for (let entry = head[bucket] as number; entry !== -1; entry = entryNext[entry] as number) {
                  const j = entryTriangle[entry] as number;
                  if (j >= i || seen.has(j)) continue;
                  seen.add(j);
                  if (owner[j] === owner[i]) continue;

                  const mx = normals[j * 3] as number;
                  const my = normals[j * 3 + 1] as number;
                  const mz = normals[j * 3 + 2] as number;
                  if (nx * mx + ny * my + nz * mz < COS_ANGLE_TOLERANCE) continue;

                  // How far apart the planes are, measured from each triangle's
                  // own vertex rather than from a world-space plane offset:
                  // 600 m out at the hotel, an offset taken against the origin
                  // turns a 0.001 difference in normal into 0.6 m of phantom
                  // separation.
                  const bx = xyz[j * 9] as number;
                  const by = xyz[j * 9 + 1] as number;
                  const bz = xyz[j * 9 + 2] as number;
                  let separation = 0;
                  for (let corner = 0; corner < 3; corner += 1) {
                    const px = (xyz[j * 9 + corner * 3] as number) - ax;
                    const py = (xyz[j * 9 + corner * 3 + 1] as number) - ay;
                    const pz = (xyz[j * 9 + corner * 3 + 2] as number) - az;
                    separation = Math.max(separation, Math.abs(px * nx + py * ny + pz * nz));
                    const qx = (xyz[i * 9 + corner * 3] as number) - bx;
                    const qy = (xyz[i * 9 + corner * 3 + 1] as number) - by;
                    const qz = (xyz[i * 9 + corner * 3 + 2] as number) - bz;
                    separation = Math.max(separation, Math.abs(qx * mx + qy * my + qz * mz));
                  }
                  if (separation > tolerances.near) continue;

                  const area = overlapArea(xyz, i, j, nx, ny, nz, centre);
                  if (area <= 0) continue;

                  const nameA = collected.names[owner[i] as number] as string;
                  const nameB = collected.names[owner[j] as number] as string;
                  const [first, second] = nameA <= nameB ? [nameA, nameB] : [nameB, nameA];
                  const plane = `${Math.round(nx * 100)},${Math.round(ny * 100)},${Math.round(nz * 100)}`;
                  const key = `${first} ${second} ${plane}`;
                  const seam = byPair.get(key);
                  if (!seam) {
                    byPair.set(key, {
                      space: spaceAt(centre.x, centre.z),
                      a: first,
                      b: second,
                      area,
                      biggest: area,
                      separation,
                      at: new Vector3(centre.x, centre.y, centre.z),
                      normal: new Vector3(nx, ny, nz),
                    });
                    continue;
                  }
                  seam.area += area;
                  if (separation < seam.separation) seam.separation = separation;
                  if (area > seam.biggest) {
                    seam.biggest = area;
                    seam.at.set(centre.x, centre.y, centre.z);
                    seam.normal.set(nx, ny, nz);
                    seam.space = spaceAt(centre.x, centre.z);
                  }
                }
              }
            }
          }
        }
      }
    }

    // --- and add this one for the triangles still to come
    for (let cx = box.x0; cx <= box.x1; cx += 1) {
      for (let cy = box.y0; cy <= box.y1; cy += 1) {
        for (let cz = box.z0; cz <= box.z1; cz += 1) {
          const bucket = hash(cx, cy, cz, ncx, ncy, ncz);
          entryTriangle.push(i);
          entryNext.push(head[bucket] as number);
          head[bucket] = entryTriangle.length - 1;
        }
      }
    }
  }

  const found: CoplanarPair[] = [...byPair.values()].map((seam) => ({
    space: seam.space,
    a: seam.a,
    b: seam.b,
    area: seam.area,
    separation: seam.separation,
    at: seam.at,
    normal: seam.normal,
  }));
  found.sort((x, y) => y.area - x.area);

  return {
    pairs: found,
    trianglesConsidered: count,
    trianglesTotal: collected.total,
    objects: collected.objects,
    ms: performance.now() - started,
  };
}
