/** TEMP diagnostic: does the band `paths.ts` screens against actually contain
 * the bridge's masonry?
 *
 * `segmentCutsABridgeRamp` forbids |across| in [site.halfWidth,
 * site.halfWidth + 0.5] in the SITE's straight frame. This measures, from the
 * real collision world, where the masonry and the walkable deck actually are,
 * and prints the two side by side.
 *
 * CONTROL: the same sweep is run at an `along` well past the ramp's end,
 * where there is no bridge at all. If that row also reports masonry, the
 * instrument is measuring something other than the bridge and nothing below
 * it can be believed. */
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { DECK_HALF_LENGTH } from '../src/world/train/bridgeFootprint.ts';
import { NPC_RADIUS } from '../src/core/constants.ts';

const park = quietly(() => buildHeadlessPark());
const world = park.world;
const probe = new Vector3();
const CLEARANCE = 0.7;

const height = (x: number, z: number): number | null =>
  bridgeHeightAt(world.train.bridges, x, z);

/** The same clearance question poiGraph's `isClear` asks, minus the paved
 * exemption (which would answer "on a path" rather than "walkable"). */
const blockedAt = (x: number, z: number): boolean => {
  probe.set(x, height(x, z) ?? 0, z);
  world.collision.resolve(probe, CLEARANCE);
  const dx = probe.x - x;
  const dz = probe.z - z;
  return dx * dx + dz * dz >= 1e-6;
};

/** Sweep across the site axis at one `along`; report the bands found. */
const sweep = (
  site: { x: number; z: number; dirX: number; dirZ: number },
  along: number,
): { deck: string; solid: string } => {
  const bx = site.x + site.dirX * along;
  const bz = site.z + site.dirZ * along;
  const nx = site.dirZ;
  const nz = -site.dirX;
  let deckMin = Infinity;
  let deckMax = -Infinity;
  let solidMin = Infinity;
  let solidMax = -Infinity;
  for (let a = -9; a <= 9; a += 0.05) {
    const x = bx + nx * a;
    const z = bz + nz * a;
    if (height(x, z) !== null) {
      deckMin = Math.min(deckMin, a);
      deckMax = Math.max(deckMax, a);
    }
    if (blockedAt(x, z)) {
      solidMin = Math.min(solidMin, a);
      solidMax = Math.max(solidMax, a);
    }
  }
  const fmt = (lo: number, hi: number): string =>
    lo === Infinity ? 'none' : `[${lo.toFixed(2)}, ${hi.toFixed(2)}]`;
  return { deck: fmt(deckMin, deckMax), solid: fmt(solidMin, solidMax) };
};

console.log(`seed ${process.env.LGP_SEED ?? '(canonical)'} — ${CROSSING_SITES.length} crossing site(s)`);
for (const site of CROSSING_SITES) {
  const screened = `[${site.halfWidth.toFixed(2)}, ${(site.halfWidth + 0.5).toFixed(2)}]`;
  console.log(
    `\nsite railD=${site.railDistance.toFixed(1)} at (${site.x.toFixed(2)},${site.z.toFixed(2)}) ` +
      `halfWidth=${site.halfWidth.toFixed(2)}  screen forbids |across| in ${screened}`,
  );
  const ends = DECK_HALF_LENGTH + site.rampReachPos;
  for (const along of [0, ends * 0.35, ends * 0.7]) {
    const s = sweep(site, along);
    console.log(`   along=${along.toFixed(1).padStart(6)}  walkable(h!=null)=${s.deck.padEnd(18)} solid=${s.solid}`);
  }
  // CONTROL: past the far end of the ramp, there is no bridge here at all.
  const outside = ends + 12;
  const c = sweep(site, outside);
  console.log(`   CONTROL along=${outside.toFixed(1)} (past the ramp): walkable=${c.deck.padEnd(18)} solid=${c.solid}`);
}
