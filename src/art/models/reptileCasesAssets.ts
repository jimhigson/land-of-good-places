import type { Mesh } from 'three';
import { PALETTE } from '../../core/palette';
import { REPTILE_CASES_GLB_BASE64 } from '../assets/reptileCasesGlb';
import {
  REPTILE_CASE_HALF_DEPTH,
  REPTILE_CASE_PLINTH_HEIGHT,
  REPTILE_CASE_SEGMENT,
  REPTILE_ENCLOSURE_WALL_HEIGHT,
  REPTILE_GLASS_TOP,
  REPTILE_ISLAND_KERB_HEIGHT,
  REPTILE_ISLAND_RADIUS,
  REPTILE_JAR_BASE_HEIGHT,
  REPTILE_JAR_RADIUS,
  REPTILE_LAGOON_HALF,
  REPTILE_LAGOON_SEGMENT,
  REPTILE_NURSERY_KERB_HEIGHT,
  REPTILE_NURSERY_RADIUS,
  REPTILE_NURSERY_RAIL_TOP,
  REPTILE_PIER_POST_RADIUS,
  REPTILE_ROUND_WALL_RADIUS,
  REPTILE_TORTOISE_HALF,
  REPTILE_TORTOISE_SEGMENT,
} from '../../world/reptileHouse/layout';
import { assertMeasured, loadReptileKit, partBox, partRadiusXZ, type PartStyle } from './reptileKit';

/**
 * **The Reptile House's enclosure masonry** — the `cases` kit (spec ASSET
 * GROUPS 2): glass-case plinths and rims, pier posts, the frog jar, the
 * open enclosures' rounded walls, the nursery's kerb and rail, Noodle's
 * island kerb and the grotto.
 *
 * Every node is authored about its own footprint centre on the floor, a case's
 * glass front facing +Z; a west-wall case is the same nodes yawed at the root.
 * **Every footprint is `layout.ts`'s**, read by the Blender build with
 * `ts_const` and re-measured here at load, so the mesh a child leans on and
 * the collider that stops her cannot drift apart — if they do, the kit fails
 * to load rather than quietly lying. Glass panes and nameplates are TypeScript
 * (`world/reptileHouse/exhibits.ts`).
 */
const STYLES: Readonly<Record<string, PartStyle>> = {
  'rc-case-plinth': { colour: PALETTE.stonePinkLight, outline: 0.02 },
  'rc-case-rim': { colour: PALETTE.liftFrame, outline: 0.016 },
  'rc-case-backboard': {
    colour: PALETTE.buildingWindowWarm,
    flat: true,
    material: { emissive: PALETTE.buildingWindowWarm, emissiveIntensity: 0.5 },
  },
  'rc-case-backboard-relief': { colour: PALETTE.leafDeep, flat: true },
  'rc-pier-post': { colour: PALETTE.stonePink, outline: 0.02 },
  'rc-pier-vine': { colour: PALETTE.leafMid },
  'rc-jar-base': { colour: PALETTE.stonePinkLight, outline: 0.02 },
  'rc-jar-rim': { colour: PALETTE.liftFrame, outline: 0.016 },
  'rc-round-wall': { colour: PALETTE.stonePink, outline: 0.02 },
  'rc-lagoon-wall': { colour: PALETTE.stonePink, outline: 0.02 },
  'rc-tortoise-wall': { colour: PALETTE.stonePink, outline: 0.02 },
  'rc-nursery-kerb': { colour: PALETTE.stonePink, outline: 0.02 },
  'rc-nursery-rail': { colour: PALETTE.liftFrame, outline: 0.012 },
  'rc-island-kerb': { colour: PALETTE.stonePinkDark, outline: 0.02 },
  'rc-grotto-rock': { colour: PALETTE.stonePinkDark, outline: 0.022 },
  'rc-grotto-moss': { colour: PALETTE.leafLight },
};

let kit: ReturnType<typeof loadReptileKit> | null = null;

/** The nursery's glass radius: the rail's own reach, measured, never typed. */
export let REPTILE_NURSERY_GLASS_RADIUS = 0;

function casesKit(): ReturnType<typeof loadReptileKit> {
  if (kit) return kit;
  kit = loadReptileKit('reptileCases.glb', REPTILE_CASES_GLB_BASE64, STYLES);
  const label = 'reptileCases.glb';
  const plinth = partBox(kit.part('rc-case-plinth'));
  assertMeasured(label, 'the case plinth length', plinth.maxX - plinth.minX, REPTILE_CASE_SEGMENT + 2 * REPTILE_CASE_HALF_DEPTH);
  assertMeasured(label, 'the case plinth depth', plinth.maxZ - plinth.minZ, 2 * REPTILE_CASE_HALF_DEPTH);
  assertMeasured(label, 'the case plinth top', plinth.maxY, REPTILE_CASE_PLINTH_HEIGHT);
  assertMeasured(label, 'the case rim base', partBox(kit.part('rc-case-rim')).minY, REPTILE_GLASS_TOP);
  assertMeasured(label, 'the pier post reach', partRadiusXZ(kit.part('rc-pier-vine')), REPTILE_PIER_POST_RADIUS, 0.03);
  for (const wall of ['rc-round-wall', 'rc-lagoon-wall', 'rc-tortoise-wall']) {
    assertMeasured(label, `${wall}'s top`, partBox(kit.part(wall)).maxY, REPTILE_ENCLOSURE_WALL_HEIGHT);
  }
  assertMeasured(label, 'the round wall reach', partRadiusXZ(kit.part('rc-round-wall')), REPTILE_ROUND_WALL_RADIUS);
  const lagoon = partBox(kit.part('rc-lagoon-wall'));
  assertMeasured(label, 'the lagoon length', lagoon.maxX - lagoon.minX, REPTILE_LAGOON_SEGMENT + 2 * REPTILE_LAGOON_HALF);
  assertMeasured(label, 'the lagoon depth', lagoon.maxZ - lagoon.minZ, 2 * REPTILE_LAGOON_HALF);
  const tortoise = partBox(kit.part('rc-tortoise-wall'));
  assertMeasured(label, 'the tortoise garden length', tortoise.maxX - tortoise.minX, REPTILE_TORTOISE_SEGMENT + 2 * REPTILE_TORTOISE_HALF);
  assertMeasured(label, 'the tortoise garden depth', tortoise.maxZ - tortoise.minZ, 2 * REPTILE_TORTOISE_HALF);
  assertMeasured(label, 'the nursery kerb reach', partRadiusXZ(kit.part('rc-nursery-kerb')), REPTILE_NURSERY_RADIUS);
  assertMeasured(label, 'the nursery kerb top', partBox(kit.part('rc-nursery-kerb')).maxY, REPTILE_NURSERY_KERB_HEIGHT);
  assertMeasured(label, 'the nursery rail top', partBox(kit.part('rc-nursery-rail')).maxY, REPTILE_NURSERY_RAIL_TOP);
  assertMeasured(label, 'the island kerb reach', partRadiusXZ(kit.part('rc-island-kerb')), REPTILE_ISLAND_RADIUS);
  assertMeasured(label, 'the island kerb top', partBox(kit.part('rc-island-kerb')).maxY, REPTILE_ISLAND_KERB_HEIGHT);
  assertMeasured(label, 'the jar base top', partBox(kit.part('rc-jar-base')).maxY, REPTILE_JAR_BASE_HEIGHT);
  assertMeasured(label, 'the jar rim base', partBox(kit.part('rc-jar-rim')).minY, REPTILE_GLASS_TOP);
  if (partRadiusXZ(kit.part('rc-jar-rim')) < REPTILE_JAR_RADIUS) {
    throw new Error(`${label}: the jar rim is narrower than REPTILE_JAR_RADIUS ${REPTILE_JAR_RADIUS}`);
  }
  REPTILE_NURSERY_GLASS_RADIUS = partRadiusXZ(kit.part('rc-nursery-rail'));
  return kit;
}

/** One dressed masonry part, positioned by the caller. */
export function reptileCaseMesh(name: string): Mesh {
  return casesKit().mesh(name);
}

/** The grotto rock's own box, for standing its pool and waterfall on it. */
export function reptileGrottoBox(): ReturnType<typeof partBox> {
  return partBox(casesKit().part('rc-grotto-rock'));
}
