import {
  Color,
  ExtrudeGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { markShared, solid, toonMaterial } from '../../art/style/materials';
import { instancedPlant, reptilePlantRadius, reptilePlantTop, type PlantInstance } from '../../art/models/reptilePlantsAssets';
import type { HallContext } from './context';
import { grottoPoolSpot } from './exhibits';
import {
  BEDS,
  EXHIBIT_PLACEMENTS,
  HIDDEN_BABY_SPOTS,
  REPTILE_BED_DISC_RADIUS,
  REPTILE_BED_TOP,
  REPTILE_HALF_Z,
  type BedSpec,
  type ExhibitShape,
  type LocalPoint,
} from './layout';
import { segmentDistance } from './props';

/**
 * **The jungle, and the solid beds it grows in.**
 *
 * The beds are the solid mass between the paths: each one a raised kerb of
 * soil whose outline is `layout.ts`'s, planted from the `plants` kit by
 * species — palms only where their shadow-cone lands on a wall, nothing tall
 * in the north two metres of the island beds so the lit cases behind stay in
 * view, ferns everywhere. Every species is one `InstancedMesh` plus one
 * outline (`instancedPlant`), so seventy ferns cost two draw calls.
 *
 * **A bed's collider is a tiling of discs inside a ring of capsules, not a
 * rectangle.** Discs of `REPTILE_BED_DISC_RADIUS` are laid wherever the bed
 * is at least that far from its own edge, close enough that no gap between
 * them is wider than a child, so the whole polygon is solid with no hollow a
 * jump could land her in (CLAUDE.md: a rectangle is four walls round a hollow
 * middle). Then one filled capsule per outline edge, inset half its own
 * thickness, puts the solid boundary **on the drawn kerb**: the discs alone
 * stop a radius short of every edge and leave every convex corner open — the
 * solidity review (2 October 2026) walked a body 0.59 m into the NW island
 * and 0.57 m into the SW bed, feet under the soil slab. Every top is
 * `REPTILE_BED_TOP`, above the jump apex, so a bed is a wall to feet on the
 * floor whatever is planted in it. Palm trunks get a disc of their own, the
 * hop-on logs and rocks their own wall or disc with a standing plate.
 *
 * **Tall planting keeps the sightlines.** The spec's raked-theatre rule is
 * applied by construction, not by discarding: the tall budget is sampled
 * only south of the island beds' north three metres, never in the near-side
 * beds, and never within {@link SIGHTLINE_CLEAR} of the line from a stand
 * spot to what it looks at — an exhibit's middle, or hidden baby #2's pool.
 */

const KERB_HEIGHT = 0.12;
/** The soil's top, standing on the kerb slab. Plants root just under it. */
const SOIL_HEIGHT = 0.16;
const PLANT_Y = SOIL_HEIGHT - 0.04;
const KERB_WIDTH = 0.18;
/** Disc centres this far apart — well under two radii, so no slot between them. */
const DISC_PITCH = 1.0;
/** The edge capsules' half-thickness; their outer face is the drawn kerb. Exported for the check's corner allowance. */
export const REPTILE_BED_EDGE_HALF = 0.3;
const EDGE_HALF = REPTILE_BED_EDGE_HALF;
/** Tall plants stay this far off a stand spot's line of sight. */
const SIGHTLINE_CLEAR = 1.2;

/** Palms, by bed, at the spots the sightline rule allows. */
const PALMS: readonly (readonly [x: number, z: number])[] = [
  [-22.5, 8],
  [-22.5, 11],
  [-22, 15],
  [-18.5, 16.5],
  [-16.8, -16.6],
  [-22.5, -11.5],
];

/** Hop-on rocks and logs out on the floor, with plates — never within 2.5 m of an enclosure wall. */
const FLOOR_ROCKS: readonly (readonly [name: string, x: number, z: number, yaw: number])[] = [
  ['rp-rock-a', 14.8, 16.3, 0.4],
  // In the foyer's south-west corner, between the stall and the banana pot —
  // the first cut put it at (-5.6, 16.6), inside the SW-E bed, buried under
  // the bed's own discs with 1.95 m of air to the nearest reachable floor
  // (the solidity review, 2 October 2026).
  ['rp-rock-b', 0.5, 17, 2.1],
];
/**
 * The hop-on log, in the strip between the foyer's sweep and the SE island's
 * kerb. It used to lie along the south wall at z 16.6, which is the Tortoise
 * Ride's parking bay now; a jump from its 0.6 m top cannot reach the bed's
 * 2.4 m collider top beside it.
 */
const FLOOR_LOG: readonly [LocalPoint, LocalPoint] = [
  { x: 7, z: 9.7 },
  { x: 11, z: 9.7 },
];

const TUFT = markShared(new SphereGeometry(1, 8, 6));

export class Planting {
  private readonly ctx: HallContext;

  constructor(ctx: HallContext) {
    this.ctx = ctx;
    const ferns: PlantInstance[] = [];
    const bananas: PlantInstance[] = [];
    const monsteraLeaves: PlantInstance[] = [];
    const heliconias: PlantInstance[] = [];
    const tufts: { x: number; z: number; scale: number; colour: number }[] = [];
    const sightlines = sightlinesToKeep();

    for (const bed of BEDS) {
      this.buildBed(bed);
      this.plantBed(bed, sightlines, ferns, bananas, monsteraLeaves, heliconias, tufts);
    }

    for (const [x, z] of PALMS) {
      ctx.root.add(...instancedPlant('rp-palm-trunk', [{ x, y: 0, z, yaw: ctx.rng.range(0, 6.28), scale: 1 }]));
      const crown = reptilePlantTop('rp-palm-trunk') - 0.1;
      const fronds: PlantInstance[] = [];
      for (let k = 0; k < 7; k += 1) fronds.push({ x, y: crown, z, yaw: (k / 7) * Math.PI * 2 + x, scale: 1, tilt: 0.45 });
      ctx.root.add(...instancedPlant('rp-palm-frond', fronds));
      ctx.props.disc(`palm at (${x}, ${z})`, x, z, 0.45, 'wall');
    }

    ctx.root.add(...instancedPlant('rp-fern-frond', ferns));
    ctx.root.add(...instancedPlant('rp-banana-leaf', bananas));
    ctx.root.add(...instancedPlant('rp-monstera-leaf', monsteraLeaves), ...instancedPlant('rp-monstera-stalk', monsteraLeaves));
    ctx.root.add(...instancedPlant('rp-heliconia', heliconias), ...instancedPlant('rp-heliconia-stalk', heliconias));
    ctx.root.add(this.tuftMesh(tufts));
    this.hangVines();
    this.buildFloorProps();
  }

  // -------------------------------------------------------------- beds

  private buildBed(bed: BedSpec): void {
    const outline = bed.outline;
    // The kerb is a stone slab the shape of the whole bed, sunk 0.03 m so its
    // bottom shares no plane with the floor (0) or the kits' own 0.05 m
    // sinks; the soil is a smaller slab stood on top of it, its top four
    // centimetres higher. No hole, no shared edge: every face of one is in a
    // different plane from every face of the other (a kerb cut as a ring
    // round the soil put the two in one plane along their seam, which the
    // coplanar sweep reported).
    const kerb = solid(new Mesh(new ExtrudeGeometry(polygonShape(outline), { depth: KERB_HEIGHT + 0.03, bevelEnabled: false }), toonMaterial(PALETTE.stonePink)));
    kerb.rotation.x = Math.PI / 2;
    kerb.position.y = KERB_HEIGHT;
    kerb.name = `bed:${bed.id}:kerb`;
    this.ctx.root.add(kerb);
    const soil = solid(new Mesh(new ExtrudeGeometry(polygonShape(insetPolygon(outline, KERB_WIDTH)), { depth: SOIL_HEIGHT - KERB_HEIGHT + 0.06, bevelEnabled: false }), toonMaterial(PALETTE.barkDark)));
    soil.rotation.x = Math.PI / 2;
    soil.position.y = SOIL_HEIGHT;
    soil.name = `bed:${bed.id}:soil`;
    this.ctx.root.add(soil);

    // The collider: every grid point at least a disc's radius inside the
    // outline, thinned to the pitch. A bed too thin for the standard disc —
    // the nook by the first case — takes the largest disc it can hold, so
    // its solid edge still runs along its drawn edge rather than a metre in.
    const bounds = polygonBounds(outline);
    const inside: { point: LocalPoint; depth: number }[] = [];
    for (let z = bounds.minZ + 0.2; z <= bounds.maxZ; z += 0.4) {
      for (let x = bounds.minX + 0.2; x <= bounds.maxX; x += 0.4) {
        const point = { x, z };
        if (!pointInPolygon(point, outline)) continue;
        inside.push({ point, depth: distanceToOutline(point, outline) });
      }
    }
    const deepest = inside.reduce((best, cell) => Math.max(best, cell.depth), 0);
    const radius = Math.min(REPTILE_BED_DISC_RADIUS, deepest);
    if (radius < 0.5) {
      throw new Error(`Reptile House: bed '${bed.id}' is too thin to be solid (deepest point ${deepest.toFixed(2)} m from its edge)`);
    }
    const pitch = DISC_PITCH * (radius / REPTILE_BED_DISC_RADIUS);
    const kept: LocalPoint[] = [];
    for (const cell of inside) {
      if (cell.depth < radius - 1e-6) continue;
      if (kept.some((other) => Math.hypot(other.x - cell.point.x, other.z - cell.point.z) < pitch)) continue;
      kept.push(cell.point);
    }
    for (const [index, point] of kept.entries()) {
      this.ctx.props.disc(`bed '${bed.id}' disc ${index}`, point.x, point.z, radius, REPTILE_BED_TOP, { stand: false });
    }

    // The edge: one capsule per outline edge, its axis `EDGE_HALF` inside the
    // kerb so its outer face is the kerb. At a **convex** corner the capsule
    // is also pulled back `EDGE_HALF` along its edge, or its round end would
    // stand that far out into the path past the corner (the first cut did,
    // and four path nodes lost 0.3–0.6 m of clearance to it); the corner then
    // rounds off 0.12 m short of a right angle's point, which a 0.62 m body
    // cannot reach into. At a reflex corner the overshoot lands inside the
    // bed, so the capsule runs to the vertex and the two overlap.
    const inward = windingInward(outline);
    const count = outline.length;
    for (let i = 0; i < count; i += 1) {
      const a = outline[i]!;
      const b = outline[(i + 1) % count]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 0.05) continue;
      const t = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
      const n = edgeNormal(a, b, inward);
      const backA = convexVertex(outline, i, inward) ? EDGE_HALF : 0;
      const backB = convexVertex(outline, (i + 1) % count, inward) ? EDGE_HALF : 0;
      if (length - backA - backB < 0.05) continue;
      this.ctx.props.wall(
        `bed '${bed.id}' edge ${i}`,
        { x: a.x + n.x * EDGE_HALF + t.x * backA, z: a.z + n.z * EDGE_HALF + t.z * backA },
        { x: b.x + n.x * EDGE_HALF - t.x * backB, z: b.z + n.z * EDGE_HALF - t.z * backB },
        EDGE_HALF,
        REPTILE_BED_TOP,
        { stand: false },
      );
    }
  }

  private plantBed(
    bed: BedSpec,
    sightlines: readonly (readonly [LocalPoint, LocalPoint])[],
    ferns: PlantInstance[],
    bananas: PlantInstance[],
    monsteras: PlantInstance[],
    heliconias: PlantInstance[],
    tufts: { x: number; z: number; scale: number; colour: number }[],
  ): void {
    const rng = this.ctx.rng;
    const outline = bed.outline;
    const bounds = polygonBounds(outline);
    const area = Math.max(1, (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ)) * 0.6;
    const nearSide = bed.id === 'seCorner' || bed.id === 'swEast';
    // The island beds' north three metres stay low so the lit cases behind
    // them stay in view (the spec's sightline rule); sampled, not discarded.
    const tallMinZ = bed.id === 'nwIsland' || bed.id === 'neIsland' ? bounds.minZ + 3 : bounds.minZ;
    const sample = (margin: number, minZ = bounds.minZ): LocalPoint | null => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const point = { x: rng.range(bounds.minX, bounds.maxX), z: rng.range(Math.max(minZ, bounds.minZ), bounds.maxZ) };
        if (!pointInPolygon(point, outline)) continue;
        if (distanceToOutline(point, outline) < margin) continue;
        return point;
      }
      return null;
    };
    const offSightlines = (point: LocalPoint): boolean =>
      sightlines.every(([from, to]) => segmentDistance(from, to, point) >= SIGHTLINE_CLEAR);

    const fernCount = Math.round(area / 9) + 2;
    for (let i = 0; i < fernCount; i += 1) {
      const at = sample(0.45);
      if (!at) continue;
      // A fern is six fronds in a whorl.
      for (let k = 0; k < 6; k += 1) ferns.push({ x: at.x, y: PLANT_Y, z: at.z, yaw: (k / 6) * Math.PI * 2 + rng.range(0, 0.5), scale: rng.range(0.8, 1.15), tilt: 0.25 });
    }
    const tuftCount = Math.round(area / 3) + 4;
    for (let i = 0; i < tuftCount; i += 1) {
      const at = sample(0.3);
      if (!at) continue;
      tufts.push({ x: at.x, z: at.z, scale: rng.range(0.14, 0.3), colour: rng.chance(0.5) ? PALETTE.leafLight : PALETTE.leafMid });
    }
    // About one tall clump per eight square metres of bed — the spec's 36
    // bananas, monsteras and heliconias across the hall — and a rejected
    // sample is retried, not dropped: the first cut dropped every rejection
    // and planted a third of the spec, so the beds read as flat brown
    // rectangles (the brief review, 2 October 2026).
    const tallCount = nearSide ? 0 : Math.round(area / 8) + 1;
    let planted = 0;
    for (let attempt = 0; attempt < tallCount * 8 && planted < tallCount; attempt += 1) {
      const at = sample(0.8, tallMinZ);
      if (!at || !offSightlines(at)) continue;
      planted += 1;
      const kind = rng.int(0, 2);
      if (kind === 0) {
        for (let k = 0; k < 3; k += 1) bananas.push({ x: at.x, y: PLANT_Y, z: at.z, yaw: (k / 3) * Math.PI * 2 + rng.range(0, 1), scale: rng.range(0.9, 1.2) });
      } else if (kind === 1) {
        for (let k = 0; k < 4; k += 1) monsteras.push({ x: at.x, y: PLANT_Y, z: at.z, yaw: (k / 4) * Math.PI * 2 + rng.range(0, 1), scale: rng.range(0.9, 1.1) });
      } else {
        heliconias.push({ x: at.x, y: PLANT_Y, z: at.z, yaw: rng.range(0, 6.28), scale: rng.range(0.9, 1.1) });
      }
    }
    // Decorative rocks inside the mass — no collider of their own, the bed is solid.
    if (bounds.maxX - bounds.minX > 6) {
      const at = sample(1.6);
      if (at) this.ctx.root.add(...instancedPlant(rng.chance(0.5) ? 'rp-rock-b' : 'rp-rock-c', [{ x: at.x, y: PLANT_Y, z: at.z, yaw: rng.range(0, 6.28), scale: 0.8 }]));
    }
  }

  private tuftMesh(tufts: readonly { x: number; z: number; scale: number; colour: number }[]): InstancedMesh {
    const mesh = new InstancedMesh(TUFT, toonMaterial(0xffffff), Math.max(1, tufts.length));
    mesh.name = 'reptile-tufts';
    mesh.count = tufts.length;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    const position = new Vector3();
    const scale = new Vector3();
    const colour = new Color();
    tufts.forEach((tuft, index) => {
      position.set(tuft.x, SOIL_HEIGHT, tuft.z);
      scale.set(tuft.scale, tuft.scale * 0.6, tuft.scale);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, colour.setHex(tuft.colour));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  /** Thirty vine strands from the three rib arches, every one clear of the tallest hat. */
  private hangVines(): void {
    const strands: PlantInstance[] = [];
    const rng = this.ctx.rng;
    for (const x of [-12, 0, 12]) {
      for (let i = 0; i < 10; i += 1) {
        const z = rng.range(-10.5, 10.5);
        const y = 7 * Math.sqrt(1 - (z / REPTILE_HALF_Z) ** 2);
        strands.push({ x: x + rng.range(-0.3, 0.3), y, z, yaw: rng.range(0, 6.28), scale: rng.range(0.8, 1.1) });
      }
    }
    this.ctx.root.add(...instancedPlant('rp-vine-strand', strands), ...instancedPlant('rp-vine-leaves', strands));
  }

  /** Two hop-on rocks and one hop-on log in the foyer, solid with a plate on top. */
  private buildFloorProps(): void {
    for (const [name, x, z, yaw] of FLOOR_ROCKS) {
      this.ctx.root.add(...instancedPlant(name, [{ x, y: 0, z, yaw, scale: 1 }]));
      this.ctx.props.disc(`floor rock ${name}`, x, z, reptilePlantRadius(name), reptilePlantTop(name));
    }
    const [a, b] = FLOOR_LOG;
    this.ctx.root.add(...instancedPlant('rp-log-small', [{ x: (a.x + b.x) / 2, y: 0, z: (a.z + b.z) / 2, yaw: 0, scale: 1 }]));
    this.ctx.props.wall('the foyer log', a, b, 0.3, reptilePlantTop('rp-log-small'));
  }
}

// ---------------------------------------------------------------- geometry

/**
 * The extrude is rotated +90° about X to lie flat, which maps the shape's
 * own y straight onto +z and the extrusion depth onto −y (the slab hangs
 * below the mesh's position). The first cut negated z here and drew every
 * bed mirrored north↔south — found by `check:coplanar`'s sweep reporting the
 * south-east corner's soil coplanar with the tortoise garden's, forty metres
 * away, and measured with `Box3` before it was believed.
 */
function polygonShape(points: readonly LocalPoint[]): Shape {
  const shape = new Shape();
  points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.z);
    else shape.lineTo(point.x, point.z);
  });
  shape.closePath();
  return shape;
}

function polygonBounds(points: readonly LocalPoint[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { minX, maxX, minZ, maxZ };
}

export function pointInPolygon(point: LocalPoint, polygon: readonly LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.z > point.z !== b.z > point.z && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function distanceToOutline(point: LocalPoint, polygon: readonly LocalPoint[]): number {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    best = Math.min(best, segmentDistance(polygon[i]!, polygon[(i + 1) % polygon.length]!, point));
  }
  return best;
}

/**
 * The polygon moved `by` metres towards its own inside, vertex by mitred
 * vertex — for the soil inside the kerb. Only ever asked for a few
 * centimetres, where a mitre cannot misbehave.
 */
function insetPolygon(points: readonly LocalPoint[], by: number): LocalPoint[] {
  const n = points.length;
  const inward = windingInward(points);
  return points.map((p, i) => {
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;
    const n1 = edgeNormal(prev, p, inward);
    const n2 = edgeNormal(p, next, inward);
    const dot = n1.x * n2.x + n1.z * n2.z;
    const scale = by / Math.max(0.3, 1 + dot);
    return { x: p.x + (n1.x + n2.x) * scale, z: p.z + (n1.z + n2.z) * scale };
  });
}

function signedArea(points: readonly LocalPoint[]): number {
  const n = points.length;
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % n]!;
    return sum + (p.x * q.z - q.x * p.z);
  }, 0);
}

/** +1 or −1: which side of each edge the polygon's inside is on, from its signed area. */
function windingInward(points: readonly LocalPoint[]): number {
  return signedArea(points) > 0 ? -1 : 1;
}

/** Whether vertex `i` turns the polygon's own way (interior angle under 180°). */
function convexVertex(points: readonly LocalPoint[], i: number, inward: number): boolean {
  const n = points.length;
  const p = points[(i - 1 + n) % n]!;
  const c = points[i]!;
  const q = points[(i + 1) % n]!;
  const cross = (c.x - p.x) * (q.z - c.z) - (c.z - p.z) * (q.x - c.x);
  // `inward` is −1 for a positive signed area, so a positive cross is convex there.
  return cross * -inward > 0;
}

/**
 * Every line of sight tall planting must stay off: each exhibit's stand spot
 * to the middle of what it looks at, and hidden baby #2's stand to the grotto
 * pool. The other hidden babies' lines cross no bed.
 */
function sightlinesToKeep(): (readonly [LocalPoint, LocalPoint])[] {
  const centre = (shape: ExhibitShape): LocalPoint =>
    shape.kind === 'disc' ? shape.centre : { x: (shape.a.x + shape.b.x) / 2, z: (shape.a.z + shape.b.z) / 2 };
  const lines: (readonly [LocalPoint, LocalPoint])[] = EXHIBIT_PLACEMENTS.map((exhibit) => [exhibit.stand, centre(exhibit.shape)] as const);
  lines.push([HIDDEN_BABY_SPOTS[1]!, grottoPoolSpot()]);
  return lines;
}

function edgeNormal(a: LocalPoint, b: LocalPoint, inward: number): LocalPoint {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: (dz / length) * inward, z: (-dx / length) * inward };
}
