/** TEMP diagnostic: how much of a crossing site's RESERVATION does the bridge
 * that actually gets built occupy?
 *
 * `paths.ts` forbids the whole rectangle `|across| <= site.halfWidth +
 * RAMP_SCREEN_MARGIN`, `along` in `[-(DECK_HALF_LENGTH + rampReachNeg + m),
 * DECK_HALF_LENGTH + rampReachPos + m]`, to every foreign leg. This measures
 * the built bridge's own extent in that same straight site frame.
 *
 * The **walkable deck** is read from `bridgeHeightAt`, which is non-null only
 * over a bridge — so unlike a collision sweep it cannot be contaminated by the
 * railway fence standing at the crossing point. The masonry's outer face is
 * then `walkHalf + PLAYER_RADIUS + BRIDGE_WALL_THICKNESS`, the arithmetic
 * `bridgeFootprint.ts` builds the wall from.
 *
 * CONTROL: the same sweep is run at an `along` a long way past the ramp's end,
 * where no bridge exists. If that row reports a deck, the instrument is
 * reading something other than the bridge and nothing below it can be
 * believed. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { DECK_HALF_LENGTH, BRIDGE_WALL_THICKNESS } from '../src/world/train/bridgeFootprint.ts';
import { RAMP_SCREEN_MARGIN } from '../src/world/train/bridgeFit.ts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';

const park = quietly(() => buildHeadlessPark());
const world = park.world;

const deckAt = (x: number, z: number): boolean =>
  bridgeHeightAt(world.train.bridges, x, z) !== null;

/** Widest |across| at which this site's own frame finds walkable deck, swept
 * over the whole reserved `along` extent. Returns the signed band too, so a
 * lateral shift shows up rather than hiding inside an absolute value. */
const sweepSite = (site: (typeof CROSSING_SITES)[number]) => {
  const nx = site.dirZ;
  const nz = -site.dirX;
  const alongMin = -(DECK_HALF_LENGTH + site.rampReachNeg + RAMP_SCREEN_MARGIN);
  const alongMax = DECK_HALF_LENGTH + site.rampReachPos + RAMP_SCREEN_MARGIN;
  let lo = Infinity;
  let hi = -Infinity;
  for (let along = alongMin; along <= alongMax; along += 0.25) {
    const bx = site.x + site.dirX * along;
    const bz = site.z + site.dirZ * along;
    for (let a = -12; a <= 12; a += 0.05) {
      if (deckAt(bx + nx * a, bz + nz * a)) {
        lo = Math.min(lo, a);
        hi = Math.max(hi, a);
      }
    }
  }
  return { lo, hi, alongMin, alongMax };
};

const controlAt = (site: (typeof CROSSING_SITES)[number], alongMax: number): boolean => {
  const nx = site.dirZ;
  const nz = -site.dirX;
  const along = alongMax + 15;
  const bx = site.x + site.dirX * along;
  const bz = site.z + site.dirZ * along;
  for (let a = -12; a <= 12; a += 0.05) if (deckAt(bx + nx * a, bz + nz * a)) return true;
  return false;
};

const seed = process.env.LGP_SEED ?? 'canonical';
let worstUsed = 0;
for (const site of CROSSING_SITES) {
  const { lo, hi, alongMin, alongMax } = sweepSite(site);
  const forbidden = site.halfWidth + RAMP_SCREEN_MARGIN;
  if (lo === Infinity) {
    console.log(
      `${seed}\tsite railD=${site.railDistance.toFixed(0)}\tNO DECK BUILT\t` +
        `forbids |across|<=${forbidden.toFixed(2)} along [${alongMin.toFixed(1)},${alongMax.toFixed(1)}]`,
    );
    continue;
  }
  // Masonry outer face, from the same arithmetic bridgeFootprint.ts builds it by.
  const masonryLo = lo - PLAYER_RADIUS - BRIDGE_WALL_THICKNESS;
  const masonryHi = hi + PLAYER_RADIUS + BRIDGE_WALL_THICKNESS;
  const used = Math.max(Math.abs(masonryLo), Math.abs(masonryHi));
  worstUsed = Math.max(worstUsed, used);
  const control = controlAt(site, alongMax) ? 'CONTROL FAILED (deck past the ramp)' : 'control ok';
  console.log(
    `${seed}\tsite railD=${site.railDistance.toFixed(0)}\t` +
      `walk=[${lo.toFixed(2)},${hi.toFixed(2)}]\tmasonry=[${masonryLo.toFixed(2)},${masonryHi.toFixed(2)}]\t` +
      `used=${used.toFixed(2)}\tforbidden=${forbidden.toFixed(2)}\t` +
      `wasted=${(forbidden - used).toFixed(2)} m/side\t${control}`,
  );
}
console.log(`${seed}\tWORST |across| any built masonry reaches: ${worstUsed.toFixed(2)}`);
