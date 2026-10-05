import { Group, Mesh, MeshToonMaterial } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../style/artPalette';
import { REPTILE_NOODLE_GLB_BASE64 } from '../assets/reptileNoodleGlb';
import type { AssetHandle } from '../style/asset';
import { visibleTop } from '../style/measure';
import {
  REPTILE_ISLAND_RADIUS,
  REPTILE_NOODLE_HEAD_X,
  REPTILE_NOODLE_HEAD_Y,
  REPTILE_NOODLE_HEAD_Z,
  REPTILE_NOODLE_MOUND_HEIGHT,
  REPTILE_NURSERY_RADIUS,
} from '../../world/reptileHouse/layout';
import { assertMeasured, loadReptileKit, partBox, partRadiusXZ, partReachXZ, type PartStyle } from './reptileKit';
import { snakeFaceTextures, type SnakeExpression } from './snakeFace';

/**
 * **Noodle, the Reptile House's python, and her rock** (spec ASSET GROUPS 5):
 * the mound, three turns of coil climbing it, her head resting chin-down on
 * the kerb, the burrow her body goes underground through, and — placed
 * separately, in the nursery — the mound her tail comes back up out of.
 *
 * The island nodes are baked in hall-local metres (the island is at the hall
 * origin), so {@link createNoodleRock}'s root goes at the hall's origin and
 * nowhere else. Two nodes are pivots: `rn-head` sits at her chin's rest point
 * `(REPTILE_NOODLE_HEAD_X, _Y, _Z)` — yaw it to track a child, lift it to say
 * hello — and `rn-tongue` at the mouth, scaled 0 → 1 to flick. The head
 * wears the shared snake face (`snakeFace.ts`), so she and the babies on her
 * tail are visibly the same animal.
 */
const STYLES: Readonly<Record<string, PartStyle>> = {
  'rn-mound': { colour: PALETTE.stoneGreyMid, outline: 0.022 },
  'rn-coil': { colour: ART.snakeMint, outline: 0.02 },
  'rn-coil-belly': { colour: ART.snakeBelly },
  'rn-coil-spots': { colour: PALETTE.markerLilac },
  'rn-head': { colour: ART.snakeMint, outline: 0.016 },
  'rn-tongue': { colour: PALETTE.markerPink },
  'rn-burrow': { colour: PALETTE.barkDark },
  'rn-tail-mound': { colour: PALETTE.barkDark, outline: 0.02 },
};

let kit: ReturnType<typeof loadReptileKit> | null = null;

function noodleKit(): ReturnType<typeof loadReptileKit> {
  if (kit) return kit;
  kit = loadReptileKit('reptileNoodle.glb', REPTILE_NOODLE_GLB_BASE64, STYLES);
  const label = 'reptileNoodle.glb';
  assertMeasured(label, "the mound's peak", partBox(kit.part('rn-mound')).maxY, REPTILE_NOODLE_MOUND_HEIGHT);
  const head = kit.part('rn-head');
  assertMeasured(label, "the head's rest X", head.position.x, REPTILE_NOODLE_HEAD_X, 0.005);
  assertMeasured(label, "the head's rest Y", head.position.y, REPTILE_NOODLE_HEAD_Y, 0.005);
  assertMeasured(label, "the head's rest Z", head.position.z, REPTILE_NOODLE_HEAD_Z, 0.005);
  for (const name of ['rn-mound', 'rn-coil', 'rn-coil-belly', 'rn-coil-spots', 'rn-burrow']) {
    const reach = partRadiusXZ(kit.part(name));
    if (reach > REPTILE_ISLAND_RADIUS) {
      throw new Error(`${label}: '${name}' reaches ${reach.toFixed(2)} m, outside the island kerb at ${REPTILE_ISLAND_RADIUS}`);
    }
  }
  if (partRadiusXZ(kit.part('rn-tail-mound')) > REPTILE_NURSERY_RADIUS - 0.5) {
    throw new Error(`${label}: the tail mound does not fit inside the nursery kerb`);
  }
  return kit;
}

export interface NoodleRock extends AssetHandle {
  /** Her head, pivoted at the chin's rest point. */
  readonly head: Group;
  readonly tongue: Mesh;
  /** Her coil, scaled a hair each breath. */
  readonly coil: Group;
  setFace(expression: SnakeExpression): void;
  /** How far her snout reaches from the hall origin in plan, measured. */
  readonly snoutReach: number;
}

/** The island: mound, coil, burrow and head, in hall-local metres. */
export function createNoodleRock(): NoodleRock {
  const parts = noodleKit();
  const root = new Group();
  root.name = 'noodle.rock';
  root.add(parts.mesh('rn-mound'), parts.mesh('rn-burrow'));

  const coil = new Group();
  coil.name = 'noodle.coil';
  coil.add(parts.mesh('rn-coil'), parts.mesh('rn-coil-belly'), parts.mesh('rn-coil-spots'));
  root.add(coil);

  const head = new Group();
  head.name = 'noodle.head';
  const headMesh = parts.mesh('rn-head');
  head.position.copy(headMesh.position);
  headMesh.position.set(0, 0, 0);
  const faces = snakeFaceTextures();
  const material = headMesh.material as MeshToonMaterial;
  material.map = faces.neutral;
  material.needsUpdate = true;
  head.add(headMesh);
  const tongue = parts.mesh('rn-tongue');
  tongue.position.sub(head.position);
  tongue.scale.setScalar(0.001);
  head.add(tongue);
  root.add(head);

  const snoutReach = partReachXZ(parts.part('rn-head'));

  return {
    root,
    height: visibleTop(root),
    head,
    tongue,
    coil,
    snoutReach,
    setFace(expression) {
      material.map = faces[expression];
      material.needsUpdate = true;
    },
  };
}

/** The nursery's mound — her tail comes up out of it. Origin at its base. */
export function createNoodleTailMound(): AssetHandle {
  const root = new Group();
  root.name = 'noodle.tailMound';
  root.add(noodleKit().mesh('rn-tail-mound'));
  return { root, height: visibleTop(root) };
}
