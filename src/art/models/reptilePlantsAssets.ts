import { BackSide, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { REPTILE_PLANTS_GLB_BASE64 } from '../assets/reptilePlantsGlb';
import type { GlbPart } from '../style/glb';
import { inkTint, markShared, outlineGeometry, toonMaterial } from '../style/materials';
import {
  REPTILE_BANYAN_HEIGHT,
  REPTILE_LOG_INNER_RADIUS,
  REPTILE_LOG_LENGTH,
  REPTILE_PALM_HEIGHT,
} from '../../world/reptileHouse/layout';
import { assertMeasured, loadReptileKit, partBox, partRadiusXZ, type PartStyle } from './reptileKit';

/**
 * **The Reptile House's plant kit** (spec ASSET GROUPS 3) — instancing units
 * for the jungle: palms, bananas, monsteras, ferns, heliconias, vines, lily
 * pads, three rocks, two logs, the banyan and a case branch.
 *
 * Everything stands at its own origin, base centred, bottoms sunk 0.05 m so
 * no face is coplanar with the floor plate; leaves point along +Z and logs lie
 * along X. Four nodes carry a translation and nothing else — the log's
 * knothole and the banyan's three hang points — and those are read off
 * `GlbPart.position` by {@link reptilePlantAnchor} rather than copied.
 *
 * Nothing in here is one mesh per plant. {@link instancedPlant} makes one
 * `InstancedMesh` per part (plus one for its ink outline, sharing the same
 * matrices), so seventy ferns are two draw calls — ART_DIRECTION's rule for
 * anything repeated.
 */
const STYLES: Readonly<Record<string, PartStyle>> = {
  'rp-palm-trunk': { colour: PALETTE.bark, outline: 0.02 },
  'rp-palm-frond': { colour: PALETTE.leafMid, outline: 0.014 },
  'rp-banana-leaf': { colour: PALETTE.leafLight, outline: 0.014 },
  'rp-monstera-stalk': { colour: PALETTE.leafDeep },
  'rp-monstera-leaf': { colour: PALETTE.leafDeep, outline: 0.014 },
  'rp-fern-frond': { colour: PALETTE.leafLight },
  'rp-heliconia-stalk': { colour: PALETTE.leafMid },
  'rp-heliconia': { colour: PALETTE.flowerRed, outline: 0.012 },
  'rp-vine-strand': { colour: PALETTE.barkDark },
  'rp-vine-leaves': { colour: PALETTE.leafLight },
  'rp-lily-pad': { colour: PALETTE.leafLight },
  'rp-rock-a': { colour: PALETTE.grassDark, outline: 0.02 },
  'rp-rock-b': { colour: PALETTE.grassDark, outline: 0.02 },
  'rp-rock-c': { colour: PALETTE.grassDark, outline: 0.02 },
  'rp-log-small': { colour: PALETTE.bark, outline: 0.02 },
  'rp-log-hollow': { colour: PALETTE.bark, outline: 0.022 },
  'rp-log-knothole': { colour: PALETTE.barkDark },
  'rp-banyan': { colour: PALETTE.barkDark, outline: 0.022 },
  'rp-banyan-canopy': { colour: PALETTE.leafDeep, outline: 0.02 },
  // Never drawn — hang points for the grove's snakes. See `reptilePlantAnchor`.
  'rp-banyan-anchor-a': { colour: PALETTE.markerPink },
  'rp-banyan-anchor-b': { colour: PALETTE.markerPink },
  'rp-banyan-anchor-c': { colour: PALETTE.markerPink },
  'rp-branch': { colour: PALETTE.woodDark, outline: 0.016 },
};

let kit: ReturnType<typeof loadReptileKit> | null = null;

function plantsKit(): ReturnType<typeof loadReptileKit> {
  if (kit) return kit;
  kit = loadReptileKit('reptilePlants.glb', REPTILE_PLANTS_GLB_BASE64, STYLES);
  const label = 'reptilePlants.glb';
  assertMeasured(label, 'the palm trunk', partBox(kit.part('rp-palm-trunk')).maxY, REPTILE_PALM_HEIGHT);
  assertMeasured(label, 'the banyan canopy', partBox(kit.part('rp-banyan-canopy')).maxY, REPTILE_BANYAN_HEIGHT, 0.25);
  const log = partBox(kit.part('rp-log-hollow'));
  assertMeasured(label, 'the hollow log length', log.maxX - log.minX, REPTILE_LOG_LENGTH);
  // The bore is the Log Walk's whole width: its two inner faces are what the
  // walk's two thick-wall colliders stand at.
  if (log.maxZ < REPTILE_LOG_INNER_RADIUS || -log.minZ < REPTILE_LOG_INNER_RADIUS) {
    throw new Error(`${label}: the hollow log is narrower than its ${2 * REPTILE_LOG_INNER_RADIUS} m bore`);
  }
  return kit;
}

/** The raw part, for anything that measures it. */
export function reptilePlantPart(name: string): GlbPart {
  return plantsKit().part(name);
}

/** One dressed mesh — the single banyan, the one hollow log. */
export function reptilePlantMesh(name: string): Mesh {
  return plantsKit().mesh(name);
}

/** A node's own translation — the knothole, a banyan hang point. Read, never typed. */
export function reptilePlantAnchor(name: string): Vector3 {
  return plantsKit().part(name).position.clone();
}

/** The furthest a part reaches from its origin in plan — a rock's circumradius. */
export function reptilePlantRadius(name: string): number {
  return partRadiusXZ(plantsKit().part(name));
}

/** A part's top, metres above its origin. */
export function reptilePlantTop(name: string): number {
  return partBox(plantsKit().part(name)).maxY;
}

export interface PlantInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Yaw in radians; 0 points the leaf along +Z. */
  readonly yaw: number;
  /** Uniform scale. */
  readonly scale: number;
  /** Lean in radians about the leaf's own X axis (droop), optional. */
  readonly tilt?: number;
}

/**
 * One part, instanced `items.length` times, with its ink outline as a second
 * `InstancedMesh` **sharing the first one's `instanceMatrix`** — so the two
 * can never disagree about where a frond is, and the outline costs no matrix
 * writes of its own. Returns both; add both to the scene. No shadows: every
 * one of these is an interior fitting (ARCHITECTURE.md's shadow-pass rule).
 */
export function instancedPlant(name: string, items: readonly PlantInstance[]): InstancedMesh[] {
  const parts = plantsKit();
  const style = STYLES[name];
  if (!style) throw new Error(`reptilePlants.glb: no style for '${name}'`);
  const part = parts.part(name);
  const count = Math.max(1, items.length);
  const mesh = new InstancedMesh(part.geometry, toonMaterial(style.colour), count);
  mesh.name = name;
  mesh.count = items.length;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const tilt = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);
  const right = new Vector3(1, 0, 0);
  items.forEach((item, index) => {
    quaternion.setFromAxisAngle(up, item.yaw);
    if (item.tilt) quaternion.multiply(tilt.setFromAxisAngle(right, item.tilt));
    position.set(item.x, item.y, item.z);
    scale.setScalar(item.scale);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;

  const out: InstancedMesh[] = [mesh];
  if (style.outline !== undefined) {
    const hull = markShared(outlineGeometry(part.geometry, style.outline));
    const outline = new InstancedMesh(
      hull,
      new MeshBasicMaterial({ color: inkTint(style.colour), side: BackSide }),
      count,
    );
    outline.name = `${name}:outline`;
    outline.count = items.length;
    outline.instanceMatrix = mesh.instanceMatrix;
    outline.renderOrder = -1;
    outline.castShadow = false;
    outline.receiveShadow = false;
    out.push(outline);
  }
  return out;
}
