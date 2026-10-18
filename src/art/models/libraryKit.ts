import { Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3, type BufferAttribute, type BufferGeometry } from 'three';
import { geometryTriangles, measureTriangleSets, type MeasuredTop } from '../../world/measuredTop';
import { LIBRARY_GLB_BASE64 } from '../assets/libraryGlb';
import { base64ToArrayBuffer, readGlbParts, type GlbPart } from '../style/glb';

/**
 * **The Library kit's bare geometry, read once, and every figure the park
 * needs measured off it** (#716, the second half of #715's contract).
 *
 * `library.glb` is the 3D Artist's (`art/blend/library_build.py`, asserted
 * `CONTRACT`); this file reads it and nothing else — no colour, no outline,
 * no material (those are `libraryAssets.ts`'s, the castle's split). It is kept
 * apart from the dressing so the park's plan-time code (the manifest's plot,
 * the path router, `layout.ts`) can ask how big the building is without
 * dragging the toon materials in: the plot is solved from **the drawn shell's
 * own vertices**, so there is no typed copy of an 18 x 14 m plinth anywhere to
 * drift from the bytes. When the Artist moves a column, the colliders, the
 * plot and the router all move with it, and the parks re-solve, because this
 * file and the glb are in the park source closure.
 *
 * Node names are hyphenated (`GLTFLoader` strips full stops): game key
 * `library.shell` is nodes `shell-plinth`, `shell-steps`, ….
 */

const parts: Map<string, GlbPart> = readGlbParts(base64ToArrayBuffer(LIBRARY_GLB_BASE64));

/** One node of `library.glb`, or a throw naming every node the file has. */
export function libraryPart(name: string): GlbPart {
  const part = parts.get(name);
  if (!part) {
    throw new Error(`libraryKit: '${name}' is not a node in library.glb. The file has: ${[...parts.keys()].sort().join(', ')}.`);
  }
  return part;
}

/** Every node name in the file. */
export function libraryPartNames(): readonly string[] {
  return [...parts.keys()];
}

// ---------------------------------------------------------------------------
// Measuring bare geometry
// ---------------------------------------------------------------------------

/** An axis-aligned extent, in the asset's own frame (game axes: +Y up, the front on +Z). */
export interface KitBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Every vertex of a node, in its asset's frame (the node's own translation applied). */
function eachVertex(name: string, visit: (x: number, y: number, z: number) => void): void {
  const part = libraryPart(name);
  const position = part.geometry.getAttribute('position') as BufferAttribute;
  const p = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    p.fromBufferAttribute(position, i).multiply(part.scale).applyQuaternion(part.quaternion).add(part.position);
    visit(p.x, p.y, p.z);
  }
}

/**
 * **The named nodes' top, and how much of it she could stand on**, within the
 * part of the plan `keep` admits — `measureTop`'s slice of the kit's own
 * triangles (`world/measuredTop.ts`): a rolled arm measures the crown of its
 * tube, a cushion's top its board. In the asset's frame.
 */
export function kitTop(names: readonly string[], keep?: (x: number, z: number) => boolean): MeasuredTop {
  return measureTriangleSets(
    names.map((name) => {
      const part = libraryPart(name);
      return geometryTriangles(part.geometry, new Matrix4().compose(part.position, part.quaternion, part.scale));
    }),
    keep,
  );
}

/** The extent of the named nodes' vertices — never a bounding box of a bounding box. */
export function kitBounds(names: readonly string[], keep?: (x: number, y: number, z: number) => boolean): KitBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const name of names) {
    eachVertex(name, (x, y, z) => {
      if (keep && !keep(x, y, z)) return;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    });
  }
  if (!Number.isFinite(minX)) throw new Error(`libraryKit: nothing to measure in ${names.join(', ')}`);
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/**
 * The flat, up-facing treads of a node: every horizontal triangle's height and
 * the z it runs over, merged by height (to the millimetre). Lowest first.
 */
export function kitTreads(name: string): { readonly y: number; readonly minZ: number; readonly maxZ: number }[] {
  const part = libraryPart(name);
  const geometry: BufferGeometry = part.geometry;
  const position = geometry.getAttribute('position') as BufferAttribute;
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const byHeight = new Map<number, { y: number; minZ: number; maxZ: number }>();
  const at = (i: number, target: Vector3): Vector3 =>
    target
      .fromBufferAttribute(position, index ? index.getX(i) : i)
      .multiply(part.scale)
      .applyQuaternion(part.quaternion)
      .add(part.position);
  for (let i = 0; i + 2 < count; i += 3) {
    at(i, a);
    at(i + 1, b);
    at(i + 2, c);
    const normal = ab.subVectors(b, a).cross(ac.subVectors(c, a));
    const length = normal.length();
    if (length < 1e-9 || normal.y / length < 0.999) continue;
    const y = (a.y + b.y + c.y) / 3;
    const key = Math.round(y * 1000);
    const tread = byHeight.get(key) ?? { y, minZ: Infinity, maxZ: -Infinity };
    tread.minZ = Math.min(tread.minZ, a.z, b.z, c.z);
    tread.maxZ = Math.max(tread.maxZ, a.z, b.z, c.z);
    byHeight.set(key, tread);
  }
  return [...byHeight.values()].sort((p, q) => p.y - q.y); // flat-ok: tread heights in the glb's own asset frame, unplaced
}

/** The first hit of a ray against the named nodes, or `null` — for clear openings, measured the Artist's way. */
function firstHit(names: readonly string[], origin: Vector3, direction: Vector3): number | null {
  const ray = new Raycaster(origin, direction.clone().normalize());
  // Front faces only: a ray meets the outside of the masonry, as a child would.
  const material = new MeshBasicMaterial();
  let best: number | null = null;
  for (const name of names) {
    const part = libraryPart(name);
    const mesh = new Mesh(part.geometry, material);
    mesh.position.copy(part.position);
    mesh.quaternion.copy(part.quaternion);
    mesh.scale.copy(part.scale);
    mesh.updateMatrixWorld(true);
    for (const hit of ray.intersectObject(mesh, false)) best = best === null ? hit.distance : Math.min(best, hit.distance);
  }
  material.dispose();
  return best;
}

/**
 * **The drawn top of the named nodes over a building-local `(x, z)`**, its
 * local height, or `null` where none of them is over the point — a ray down
 * the building's own up, which in its own metres is plain `−Y`.
 */
export function libraryTopOver(names: readonly string[], x: number, z: number): number | null {
  const from = 100;
  const distance = firstHit(names, new Vector3(x, from, z), new Vector3(0, -1, 0)); // flat-ok: building-local metres, where the kit's own up is +Y
  return distance === null ? null : from - distance;
}

// ---------------------------------------------------------------------------
// The exterior's plan
// ---------------------------------------------------------------------------

/** The shell's nodes, every one of them. */
export const LIBRARY_SHELL_NODES = [
  'shell-plinth',
  'shell-steps',
  'shell-walls',
  'shell-windows',
  'shell-door',
  'shell-columns',
  'shell-entablature',
  'shell-pediment',
  'shell-pedimentBook',
  'shell-roof',
] as const;

/**
 * **The drawn exterior's plan**, building-local (origin on the ground at the
 * plot's centre, +Z out through the front door), measured off the shell's
 * bare vertices. What the plot, the router, the colliders, the walkable stone
 * and the checks are all built from.
 */
export interface LibraryExteriorPlan {
  /** The plinth's half-width across the facade, and its back. */
  readonly plinthHalfX: number;
  readonly plinthBackZ: number;
  /** The plinth's walkable top. */
  readonly plinthTop: number;
  /** The front of the bottom step — where the path arrives. */
  readonly stepFrontZ: number;
  /** The bottom step's tread: its walkable top and where it ends (the next riser). */
  readonly stepTop: number;
  readonly stepBackZ: number;
  /**
   * The cella's extent, every drawn piece of its masonry included (the side
   * and front window sills stand proud of the wall faces, at a child's chest):
   * what its collider ring holds.
   */
  readonly cellaHalfX: number;
  readonly cellaBackZ: number;
  readonly cellaFrontZ: number;
  /** The doorway's clear half-width, measured by a ray across the recess. */
  readonly doorHalf: number;
  /** The front of the door leaves at the back of the recess (knobs included): where a sprinter stops. */
  readonly recessBackZ: number;
  /** The facade's face beside the doorway: the mouth of the recess. */
  readonly facadeZ: number;
  /** Each column: its centre, and the widest it is anywhere a child can reach (its round foot). */
  readonly columns: readonly { readonly x: number; readonly z: number; readonly radius: number }[];
  /** The furthest any drawn vertex stands from the centre, in plan — bare geometry, no outline. */
  readonly reach: number;
  /** The tallest drawn point. */
  readonly height: number;
}

function measureExterior(): LibraryExteriorPlan {
  const plinth = kitBounds(['shell-plinth']);
  const steps = kitBounds(['shell-steps']);
  const treadsOfSteps = kitTreads('shell-steps');
  const bottom = treadsOfSteps[0];
  const top = treadsOfSteps[treadsOfSteps.length - 1];
  if (!bottom || !top || treadsOfSteps.length < 2) throw new Error(`libraryKit: shell-steps has ${treadsOfSteps.length} treads, wanted at least two`);
  if (Math.abs(top.y - plinth.maxY) > 0.005) {
    throw new Error(`libraryKit: the top step (${top.y.toFixed(3)}) does not meet the plinth's top (${plinth.maxY.toFixed(3)})`);
  }
  const cella = kitBounds(['shell-walls', 'shell-windows', 'shell-door']);
  const door = kitBounds(['shell-door']);
  const plinthTop = plinth.maxY;

  // The doorway's clear width: a ray each way across the recess at a child's
  // chest, just in front of the door leaves — the Artist's own "measured by ray".
  const chest = plinthTop + 1;
  const acrossZ = door.maxZ + 0.05;
  const right = firstHit(['shell-walls'], new Vector3(0, chest, acrossZ), new Vector3(1, 0, 0));
  const left = firstHit(['shell-walls'], new Vector3(0, chest, acrossZ), new Vector3(-1, 0, 0));
  if (right === null || left === null) throw new Error('libraryKit: a ray across the doorway hit no jamb');
  const doorHalf = Math.min(right, left);
  // The facade beside the doorway, a hand's breadth outside the jamb.
  const toFacade = firstHit(['shell-walls'], new Vector3(doorHalf + 0.2, chest, cella.maxZ + 5), new Vector3(0, 0, -1));
  if (toFacade === null) throw new Error('libraryKit: a ray at the facade beside the door hit nothing');
  const facadeZ = cella.maxZ + 5 - toFacade;

  // The columns: one node of six turned shafts, told apart by the gaps between
  // them across the facade; each one's widest below its own middle (the round
  // foot, not the square abacus a child's head never reaches).
  const columnPoints: { x: number; y: number; z: number }[] = [];
  eachVertex('shell-columns', (x, y, z) => columnPoints.push({ x, y, z }));
  columnPoints.sort((p, q) => p.x - q.x);
  const clusters: { x: number; y: number; z: number }[][] = [];
  for (const point of columnPoints) {
    const last = clusters[clusters.length - 1];
    const previous = last?.[last.length - 1];
    if (last && previous && point.x - previous.x < 0.25) last.push(point);
    else clusters.push([point]);
  }
  const columns = clusters.map((cluster) => {
    const lowY = Math.min(...cluster.map((p) => p.y));
    const highY = Math.max(...cluster.map((p) => p.y));
    const middle = (lowY + highY) / 2;
    const foot = cluster.filter((p) => p.y <= lowY + 1e-3);
    const x = (Math.min(...foot.map((p) => p.x)) + Math.max(...foot.map((p) => p.x))) / 2;
    const z = (Math.min(...foot.map((p) => p.z)) + Math.max(...foot.map((p) => p.z))) / 2;
    let radius = 0;
    for (const p of cluster) if (p.y <= middle) radius = Math.max(radius, Math.hypot(p.x - x, p.z - z));
    return { x, z, radius };
  });

  let reach = 0;
  let height = 0;
  for (const name of LIBRARY_SHELL_NODES) {
    eachVertex(name, (x, y, z) => {
      reach = Math.max(reach, Math.hypot(x, z));
      height = Math.max(height, y);
    });
  }

  return {
    plinthHalfX: Math.max(-plinth.minX, plinth.maxX, -steps.minX, steps.maxX),
    plinthBackZ: plinth.minZ,
    plinthTop,
    stepFrontZ: steps.maxZ,
    stepTop: bottom.y,
    stepBackZ: bottom.minZ,
    cellaHalfX: Math.max(-cella.minX, cella.maxX),
    cellaBackZ: cella.minZ,
    cellaFrontZ: cella.maxZ,
    doorHalf,
    recessBackZ: door.maxZ,
    facadeZ,
    columns,
    reach,
    height,
  };
}

/** The exterior's plan, measured once at load. */
export const LIBRARY_EXTERIOR_PLAN: LibraryExteriorPlan = measureExterior();

// ---------------------------------------------------------------------------
// The bookcase's footprint
// ---------------------------------------------------------------------------

/**
 * The bookcase unit's footprint, off `shelf-carcass`: how long, deep and tall.
 * `layout.ts` reads it to stand a child clear of a case's front; the dressed
 * case's books are `libraryAssets.ts`'s.
 */
export const LIBRARY_SHELF_FOOTPRINT: { readonly length: number; readonly depth: number; readonly height: number } = (() => {
  const carcass = kitBounds(['shelf-carcass', 'shelf-shelves']);
  return { length: carcass.maxX - carcass.minX, depth: carcass.maxZ - carcass.minZ, height: carcass.maxY - carcass.minY };
})();
