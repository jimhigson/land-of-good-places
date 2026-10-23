import { BackSide, Matrix4, Vector3, type BufferAttribute, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three';

/**
 * **How tall a thing is as drawn, and how much of its top she could stand on**
 * — measured off its own triangles, never typed beside it.
 *
 * Jim, 17 Oct 2026: anything is jumpable, and nothing is marked to make it so —
 * so whether she can stand on a crystal is a question for its shape and her
 * feet, not for a flag (PR #722's review found one surviving as `ledge: false`
 * on 33 hotel props, with guessed tops of 1.4–1.5 m under them). This is the
 * shape's half of that question; {@link FOOT_HALF_WIDTH} is her feet's.
 *
 * - **`top`** is the highest point drawn.
 * - **`topHalf`** is the widest a foot can be centred on that top: the largest
 *   circle that fits in what is drawn {@link CREST_DEPTH} under the top. A
 *   crystal's point measures a few millimetres, a table's board its own
 *   half-width, a column's capital its inradius, a rolled arm the crown of its
 *   tube — the same quantity `roundTopHalf` gives for a tube by formula.
 *
 * It slices closed surfaces. An open one (a basin's hemisphere, a plane) has
 * no inside to fit a circle in, so it is measured by its own builder instead.
 */

/**
 * **A top narrower than this either side of its line holds nobody** — her
 * feet need 20 cm of it. A fence's rail, a post's cap, a panel's edge: she
 * can jump over them, not stand on them, which is the difference between a
 * wall and a ledge (17 Oct 2026: the census stood her on 9 cm rails and 6 cm
 * panel edges and used them as launch pads onto roofs). `CollisionWorld`'s
 * width rule (`toppedNarrow`) holds every top to it.
 */
export const FOOT_HALF_WIDTH = 0.1;

/**
 * **The part of something round in section she could stand on** — a tube, a
 * torus, a rolled rim: its crown, the middle 60 % of its width, where the
 * surface is within a fifth of its radius of the crest. A round rail under
 * a sixth of a metre thick is therefore no ledge at all.
 */
export function roundTopHalf(radius: number): number {
  return radius * 0.6;
}

/**
 * How far under its highest point a top is cut to measure it — a third of
 * {@link FOOT_HALF_WIDTH}. Chosen so a round thing measures exactly as
 * `roundTopHalf` says at the one radius where the answer changes: a tube of
 * radius 1/6 m cut 1/30 m under its crest is 0.1 m either side of it, which is
 * `roundTopHalf(1/6)` and `FOOT_HALF_WIDTH` both.
 */
export const CREST_DEPTH = FOOT_HALF_WIDTH / 3;

export interface MeasuredTop {
  /** The highest point drawn, in the measured frame. */
  readonly top: number;
  /** The widest a foot can be centred on that top — see the header. */
  readonly topHalf: number;
}

/**
 * **One solid part of a prop**, prop-local before it is turned: a box (its
 * middle and half-extents) or a disc (its middle and radius), to its own top,
 * from its own base if it is held off the floor (a mirror on a wall), and as
 * much of that top as she could stand on (`topHalf`; omitted, all of it).
 * A sofa is its seat, arms, back and pillows; a toilet its bowl and cistern.
 */
export type PropPart =
  | { readonly x: number; readonly z: number; readonly halfX: number; readonly halfZ: number; readonly top: number; readonly base?: number; readonly topHalf?: number }
  | { readonly x: number; readonly z: number; readonly radius: number; readonly top: number; readonly base?: number; readonly topHalf?: number };

/** How finely a face is sampled for its highest point inside part of the plan ({@link measureTriangleSets}). */
const TOP_SAMPLES = 8;

/** Feeds every triangle of one closed surface to `visit`, its points in the measured frame. */
export type TriangleSet = (visit: (a: Vector3, b: Vector3, c: Vector3) => void) => void;

/** Which part of the plan to measure — a chair's arm, not its back. Everything, if absent. */
export type PlanKeep = (x: number, z: number) => boolean;

interface Segment {
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
}

/**
 * **The measure itself**, over closed surfaces given triangle by triangle.
 * Each set is sliced on its own and the slices are united, so two meshes that
 * overlap (a lid over a bowl) never read each other's walls as an edge.
 */
export function measureTriangleSets(sets: readonly TriangleSet[], keep?: PlanKeep): MeasuredTop {
  let top = -Infinity;
  for (const set of sets) {
    set((a, b, c) => {
      if (!keep) {
        top = Math.max(top, a.y, b.y, c.y);
        return;
      }
      // Within part of the plan, a face can cross it with no corner inside —
      // a chair's back is one long box — so the face is sampled, not only its
      // corners.
      for (let i = 0; i <= TOP_SAMPLES; i += 1) {
        for (let j = 0; i + j <= TOP_SAMPLES; j += 1) {
          const u = i / TOP_SAMPLES;
          const v = j / TOP_SAMPLES;
          const w = 1 - u - v;
          const x = a.x * w + b.x * u + c.x * v;
          const z = a.z * w + b.z * u + c.z * v;
          if (!keep(x, z)) continue;
          top = Math.max(top, a.y * w + b.y * u + c.y * v);
        }
      }
    });
  }
  if (!Number.isFinite(top)) return { top: 0, topHalf: 0 };
  const cut = top - CREST_DEPTH;
  const slices: Segment[][] = sets.map((set) => {
    const segments: Segment[] = [];
    set((a, b, c) => {
      const points: { x: number; z: number }[] = [];
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
        const dp = p.y - cut; // flat-ok: the slice is level in the measured frame
        const dq = q.y - cut; // flat-ok: the same
        if (dp >= 0 === dq >= 0) continue;
        const t = dp / (dp - dq);
        points.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
      }
      if (points.length !== 2) return;
      const [p, q] = points as [{ x: number; z: number }, { x: number; z: number }];
      if (keep && !keep((p.x + q.x) / 2, (p.z + q.z) / 2)) return;
      segments.push({ x1: p.x, z1: p.z, x2: q.x, z2: q.z });
    });
    return segments;
  });
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const slice of slices) {
    for (const s of slice) {
      minX = Math.min(minX, s.x1, s.x2);
      maxX = Math.max(maxX, s.x1, s.x2);
      minZ = Math.min(minZ, s.z1, s.z2);
      maxZ = Math.max(maxZ, s.z1, s.z2);
    }
  }
  if (!Number.isFinite(minX)) return { top, topHalf: 0 };
  const extent = Math.max(maxX - minX, maxZ - minZ);
  const step = Math.max(extent / 64, 0.002);
  let topHalf = 0;
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) {
      if (keep && !keep(x, z)) continue;
      for (const slice of slices) {
        if (!inside(slice, x, z)) continue;
        topHalf = Math.max(topHalf, nearest(slice, x, z));
      }
    }
  }
  return { top, topHalf };
}

/** Every visible, solid mesh under `model`, measured in `model`'s own frame. */
export function measureTop(model: Object3D, keep?: PlanKeep): MeasuredTop {
  model.updateMatrixWorld(true);
  const toModel = new Matrix4().copy(model.matrixWorld).invert();
  const sets: TriangleSet[] = [];
  model.traverse((object) => {
    const mesh = object as Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    for (let at: Object3D | null = mesh; at && at !== model.parent; at = at.parent) if (!at.visible) return;
    // An outline is an inverted hull a few centimetres proud of what it
    // outlines — ink, not body.
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
    if (materials.every((material) => material.side === BackSide)) return;
    const matrix = new Matrix4().multiplyMatrices(toModel, mesh.matrixWorld);
    sets.push(geometryTriangles(mesh.geometry, matrix));
  });
  return measureTriangleSets(sets, keep);
}

/** One geometry's triangles, carried by `matrix` into the measured frame. */
export function geometryTriangles(geometry: BufferGeometry, matrix: Matrix4): TriangleSet {
  return (visit) => {
    const position = geometry.getAttribute('position') as BufferAttribute | undefined;
    if (!position) return;
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const at = (i: number, target: Vector3): Vector3 => target.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix);
    for (let i = 0; i + 2 < count; i += 3) visit(at(i, a), at(i + 1, b), at(i + 2, c));
  };
}

/** Even-odd: does a ray along +x from (x, z) cross the slice an odd number of times? */
function inside(slice: readonly Segment[], x: number, z: number): boolean {
  let odd = false;
  for (const s of slice) {
    if (s.z1 > z === s.z2 > z) continue;
    const crossX = s.x1 + ((z - s.z1) * (s.x2 - s.x1)) / (s.z2 - s.z1);
    if (crossX > x) odd = !odd;
  }
  return odd;
}

/** The distance from (x, z) to the nearest edge of the slice. */
function nearest(slice: readonly Segment[], x: number, z: number): number {
  let best = Infinity;
  for (const s of slice) {
    const dx = s.x2 - s.x1;
    const dz = s.z2 - s.z1;
    const length2 = dx * dx + dz * dz;
    const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - s.x1) * dx + (z - s.z1) * dz) / length2)) : 0;
    best = Math.min(best, Math.hypot(x - (s.x1 + dx * t), z - (s.z1 + dz * t)));
  }
  return best;
}
