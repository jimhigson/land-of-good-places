import { Matrix4, Mesh, Raycaster, Vector2, Vector3, type BufferAttribute, type Object3D } from 'three';
import { isOutlineMesh } from './materials';

/**
 * **The hidden faces of a model's ink lines, deleted** (ART_DIRECTION.md:
 * *"Fix it by removing the hidden face, not by nudging one surface"*).
 *
 * An ink outline is its part pushed a line's width out along the part's
 * normals and drawn back-faced (`addOutline`), so every face of the part has a
 * copy a line's width off it. Two kinds of copy are hidden, and each is a
 * face a hair off another — the pair `check:coplanar` reports:
 *
 * - **the copy of a face the part rests on** — a book's underside on the book
 *   below it or on a board, a nest's covers on the floor, a lamp's back plate
 *   on its wall: a line's width *inside* whatever it rests on, parallel to
 *   that support's own face, a few millimetres off it;
 * - **one of two copies that coincide** — where two parts' faces lie in one
 *   plane looking the way the model rests (two books lying side by side whose
 *   undersides overlap at a corner), their two copies lie in one plane too,
 *   and fight: one is enough.
 *
 * This deletes those and nothing else.
 */

/** How nearly a face must look the way its model rests to count as one it rests on: within about 18°. */
const RESTING_FACE_COS = 0.95;
/**
 * Where a face is asked whether it rests on anything, as weights of its three
 * corners: its middle, each corner drawn a tenth of the way in, and each
 * edge's middle drawn the same way in.
 */
const RESTING_SAMPLES: readonly (readonly [number, number, number])[] = [
  [1 / 3, 1 / 3, 1 / 3],
  [0.8, 0.1, 0.1],
  [0.1, 0.8, 0.1],
  [0.1, 0.1, 0.8],
  [0.45, 0.45, 0.1],
  [0.1, 0.45, 0.45],
  [0.45, 0.1, 0.45],
];
/** Two faces this close along the way the model rests are in one plane: a tenth of a millimetre. */
const SAME_PLANE = 1e-4;
/** Two faces' outlines overlapping by less than this in plan are only touching: a tenth of a millimetre. */
const TOUCHING = 1e-4;

/** What {@link dropHiddenOutlineFaces} took out. */
export interface HiddenOutlineFaces {
  /** Copies of faces the model rests on, inside what they rest on. */
  readonly resting: number;
  /** Second copies of faces lying in one plane with another part's. */
  readonly doubled: number;
}

/** One face of a part that looks the way its model rests, as its outline still draws it. */
interface Underside {
  readonly level: number;
  readonly plan: readonly [Vector2, Vector2, Vector2];
}

/**
 * **Deletes the hidden copies from every ink outline under `root`** (each the
 * direct child of its part, as `addOutline` hangs it). `toward` is the way the
 * model rests, in `root`'s frame — down for one standing on the floor, into
 * the wall for one hung on it — and `restingAt` is where its resting plane is
 * (`p · toward = restingAt`): the floor under a model whose base is at `y = 0`
 * is `0`.
 *
 * A face of a part counts when it looks `toward` (within about 18°). Its copy
 * goes **if it rests on something**: within the line's width of it along
 * `toward`, under any of seven points of it (its middle, its corners and its
 * edges' middles drawn a little in), lies the resting plane or a face of
 * another of the model's parts — so a face resting on something anywhere loses
 * its copy whole, and a book lying half over the one below gives up the line's
 * sliver under its overhang, which the camera, looking down, sees at most
 * along one edge. Its copy also goes **if another part's face that still has
 * its copy lies in the same plane and overlaps it in plan** (the earlier part
 * in `root`'s order keeps its own). A face over nothing, alone in its plane,
 * keeps its line. A welded smooth outline (`addSmoothOutline`) does not match
 * its part vertex for vertex, so it is left whole.
 *
 * Call it on the model as built, at rest — before anything animates it.
 */
export function dropHiddenOutlineFaces(root: Object3D, toward: Vector3, restingAt: number): HiddenOutlineFaces {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const down = toward.clone().normalize();
  const worldDown = down.clone().transformDirection(root.matrixWorld);
  // A plan frame on the resting plane: two directions square to `down`.
  const across = Math.abs(down.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0); // flat-ok: a helper axis in the model's own unplaced frame, only to build a basis square to `toward`
  const u = new Vector3().crossVectors(across, down).normalize();
  const v = new Vector3().crossVectors(down, u).normalize();
  const parts: Mesh[] = [];
  const outlined: { part: Mesh; outline: Mesh }[] = [];
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    if (isOutlineMesh(node)) {
      if (node.parent instanceof Mesh) outlined.push({ part: node.parent, outline: node });
      return;
    }
    parts.push(node);
  });
  const raycaster = new Raycaster();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const edge = new Vector3();
  const pushed = new Vector3();
  const normal = new Vector3();
  const sample = new Vector3();
  const origin = new Vector3();
  const plan = (p: Vector3): Vector2 => new Vector2(p.dot(u), p.dot(v));
  let resting = 0;
  let doubled = 0;
  /** Every earlier part's undersides that kept their copies. */
  const kept: Underside[] = [];
  for (const { part, outline } of outlined) {
    const source = part.geometry.getAttribute('position') as BufferAttribute | undefined;
    const hull = outline.geometry.getAttribute('position') as BufferAttribute | undefined;
    if (!source || !hull || source.count !== hull.count) continue;
    const index = part.geometry.getIndex();
    const hullIndex = outline.geometry.getIndex();
    if ((index === null) !== (hullIndex === null) || (index && hullIndex && index.count !== hullIndex.count)) continue;
    const toPartRoot = new Matrix4().multiplyMatrices(toRoot, part.matrixWorld);
    const others = parts.filter((other) => other !== part);
    const triangles = (index ? index.count : source.count) / 3;
    const keep: number[] = [];
    const mine: Underside[] = [];
    for (let t = 0; t < triangles; t += 1) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(source, i0).applyMatrix4(toPartRoot);
      b.fromBufferAttribute(source, i1).applyMatrix4(toPartRoot);
      c.fromBufferAttribute(source, i2).applyMatrix4(toPartRoot);
      normal.subVectors(b, a).cross(edge.subVectors(c, a));
      if (normal.lengthSq() <= 1e-18 || normal.normalize().dot(down) < RESTING_FACE_COS) {
        keep.push(i0, i1, i2);
        continue;
      }
      // The line's width here: how far the hull's copy of this corner stands off it.
      const width = pushed.fromBufferAttribute(hull, i0).applyMatrix4(toPartRoot).distanceTo(a);
      let rests = false;
      for (const [wa, wb, wc] of RESTING_SAMPLES) {
        sample.set(0, 0, 0).addScaledVector(a, wa).addScaledVector(b, wb).addScaledVector(c, wc);
        const toPlane = restingAt - sample.dot(down);
        if (toPlane >= -SAME_PLANE && toPlane <= width + 1e-3) rests = true;
        else if (others.length > 0) {
          origin.copy(sample).addScaledVector(down, -SAME_PLANE).applyMatrix4(root.matrixWorld);
          raycaster.set(origin, worldDown);
          raycaster.near = 0;
          raycaster.far = width + 2e-3;
          rests = raycaster.intersectObjects(others, false).length > 0;
        }
        if (rests) break;
      }
      if (rests) {
        resting += 1;
        continue;
      }
      const face: Underside = { level: (a.dot(down) + b.dot(down) + c.dot(down)) / 3, plan: [plan(a), plan(b), plan(c)] };
      if (kept.some((other) => Math.abs(other.level - face.level) <= SAME_PLANE && trianglesOverlap(other.plan, face.plan))) {
        doubled += 1;
        continue;
      }
      mine.push(face);
      keep.push(i0, i1, i2);
    }
    kept.push(...mine);
    if (keep.length < triangles * 3) {
      const trimmed = outline.geometry.clone();
      trimmed.setIndex(keep);
      outline.geometry.dispose();
      outline.geometry = trimmed;
    }
  }
  return { resting, doubled };
}

/** Do two triangles in one plan overlap by more than touching? Separating axes: one of their six edges' normals separates them, or they overlap. */
function trianglesOverlap(p: readonly [Vector2, Vector2, Vector2], q: readonly [Vector2, Vector2, Vector2]): boolean {
  for (const shape of [p, q]) {
    for (let i = 0; i < 3; i += 1) {
      const from = shape[i]!;
      const to = shape[(i + 1) % 3]!;
      const nx = -(to.y - from.y); // flat-ok: a plan Vector2's second axis, not a height
      const ny = to.x - from.x;
      const length = Math.hypot(nx, ny);
      if (length < 1e-12) continue;
      const project = (point: Vector2): number => (point.x * nx + point.y * ny) / length;
      const [pMin, pMax] = span(p, project);
      const [qMin, qMax] = span(q, project);
      if (pMax <= qMin + TOUCHING || qMax <= pMin + TOUCHING) return false;
    }
  }
  return true;
}

function span(shape: readonly [Vector2, Vector2, Vector2], project: (point: Vector2) => number): [number, number] {
  const values = shape.map(project);
  return [Math.min(...values), Math.max(...values)];
}
