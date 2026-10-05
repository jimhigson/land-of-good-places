import { Group, type Mesh } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../style/artPalette';
import { REPTILE_STALL_GLB_BASE64 } from '../assets/reptileStallGlb';
import type { AssetHandle } from '../style/asset';
import { visibleTop } from '../style/measure';
import { REPTILE_METER_POST_HEIGHT } from '../../world/reptileHouse/layout';
import { TALLEST_CHILD_HEIGHT } from './kid';
import { assertMeasured, loadReptileKit, partBox, partRadiusXZ, type PartStyle } from './reptileKit';

/**
 * **Scales & Tails' dressing and the Noodle-o-meter** (spec ASSET GROUPS 6).
 * Two frames in one file, told apart by prefix: the stall nodes are authored
 * in `kiosk.ts`'s own frame (origin at the stall base, counter toward +Z) so
 * they drop onto the counter at the origin; the meter is authored about its
 * own base and placed on its own. The three snakes in here are static
 * decoration with geometry faces, so no canvas is spent on them. Only
 * `rs-sign` and `rs-meter-board` carry UVs, for the sign atlas.
 */
const STYLES: Readonly<Record<string, PartStyle>> = {
  'rs-awning': { colour: PALETTE.blossomPink, outline: 0.02 },
  'rs-awning-posts': { colour: PALETTE.woodLight, outline: 0.016 },
  'rs-awning-snake': { colour: ART.snakeMint, outline: 0.016 },
  'rs-finial': { colour: ART.snakeCoral, outline: 0.014 },
  'rs-sign': { colour: PALETTE.signBoard },
  'rs-stall-snake-face': { colour: ART.ink, flat: true },
  'rs-stall-snake-shine': { colour: ART.shine, flat: true },
  'rs-stall-snake-tongue': { colour: PALETTE.markerPink },
  'rs-stall-snake-spots': { colour: PALETTE.markerLilac, flat: true },
  'rs-meter-post': { colour: PALETTE.woodLight, outline: 0.018 },
  'rs-meter-bands': { colour: PALETTE.liftFrame },
  'rs-meter-board': { colour: PALETTE.signBoard },
  'rs-meter-snake': { colour: ART.cornOrange, outline: 0.014 },
  'rs-meter-snake-face': { colour: ART.ink, flat: true },
  'rs-meter-snake-shine': { colour: ART.shine, flat: true },
  'rs-meter-snake-tongue': { colour: PALETTE.markerPink },
  'rs-meter-snake-spots': { colour: PALETTE.markerLilac, flat: true },
};

let kit: ReturnType<typeof loadReptileKit> | null = null;

function stallKit(): ReturnType<typeof loadReptileKit> {
  if (kit) return kit;
  kit = loadReptileKit('reptileStall.glb', REPTILE_STALL_GLB_BASE64, STYLES);
  const label = 'reptileStall.glb';
  assertMeasured(label, 'the meter post', partBox(kit.part('rs-meter-post')).maxY, REPTILE_METER_POST_HEIGHT);
  const eave = partBox(kit.part('rs-awning')).minY;
  if (eave < TALLEST_CHILD_HEIGHT) {
    throw new Error(`${label}: the awning's eave at ${eave.toFixed(2)} m is below the tallest hat (${TALLEST_CHILD_HEIGHT} m)`);
  }
  return kit;
}

export interface StallDressing extends AssetHandle {
  /** The plank over the counter — paint it from the sign atlas. */
  readonly sign: Mesh;
}

/** The awning, its snakes and the sign, in the kiosk's own frame. */
export function createReptileStallDressing(): StallDressing {
  const parts = stallKit();
  const root = new Group();
  root.name = 'reptileStall.dressing';
  let sign: Mesh | null = null;
  for (const name of parts.names) {
    if (name.startsWith('rs-meter-')) continue;
    const mesh = parts.mesh(name);
    if (name === 'rs-sign') sign = mesh;
    root.add(mesh);
  }
  if (!sign) throw new Error('reptileStall.glb: no rs-sign');
  return { root, height: visibleTop(root), sign };
}

export interface NoodleMeter extends AssetHandle {
  /** The board at the top — paint it from the sign atlas. */
  readonly board: Mesh;
  /** The post's base radius, measured — the collider's. */
  readonly baseRadius: number;
}

/** The Noodle-o-meter, about its own base. */
export function createNoodleMeter(): NoodleMeter {
  const parts = stallKit();
  const root = new Group();
  root.name = 'reptileStall.meter';
  let board: Mesh | null = null;
  for (const name of parts.names) {
    if (!name.startsWith('rs-meter-')) continue;
    const mesh = parts.mesh(name);
    if (name === 'rs-meter-board') board = mesh;
    root.add(mesh);
  }
  if (!board) throw new Error('reptileStall.glb: no rs-meter-board');
  return { root, height: visibleTop(root), board, baseRadius: partRadiusXZ(parts.part('rs-meter-post')) };
}
