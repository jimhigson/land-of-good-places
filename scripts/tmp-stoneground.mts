/** TEMP diagnostic: **is every square metre of built masonry standing on
 * ground `paths.ts` actually screened?**
 *
 * That is the property `builtMasonryStaysInsideItsReservation` is *for* —
 * "masonry may not stand on ground no ribbon was ever kept off" — and it is
 * not the property that invariant measures. It measures, per site, how far
 * across ANY deck within ±14 m of that site's strip reaches, and compares
 * that to *that* site's half-width. Two bridges 29 m apart with disjoint
 * reservations therefore prosecute each other (seed 5), while the question of
 * whether either stands on open ground is never asked.
 *
 * This asks it directly, of the one owner: `pointStandsOnABridgeRamp` is the
 * boolean face of `bridgeSiteReserving`, the single function that decides
 * which reservation a point is in — and it honours `releasedCrossingSites`,
 * so a rectangle the two-pass gave back to the routers correctly counts as
 * open ground.
 *
 * CONTROLS, read these first:
 *
 * 1. **Positive** — a bridge's own centre point must be screened. If a deck's
 *    own middle reports open ground, the query is not describing bridges and
 *    nothing below is worth reading.
 * 2. **Negative** — a point 40 m to the side of every bridge must report open
 *    ground. If that reports screened, the query answers `true` everywhere and
 *    a clean run would mean nothing.
 */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { pointStandsOnABridgeRamp, bridgeScreenHalfAcross } from '../src/world/paths.ts';
import { DECK_HALF_LENGTH } from '../src/world/train/bridgeFootprint.ts';
import { RAMP_SCREEN_MARGIN } from '../src/world/train/bridgeFit.ts';

const seed = process.env['LGP_SEED'] ?? 'canonical';
const park = quietly(() => buildHeadlessPark());
const bridges = park.world.train.bridges;

console.log(`\nseed ${seed}: ${CROSSING_SITES.length} proven site(s), ${bridges.length} built bridge(s)`);

// Which reservations are still standing at the end of the build? A released
// site answers `false` at its own centre, because nothing reserves it.
for (const site of CROSSING_SITES) {
  console.log(
    `  site railD=${site.railDistance.toFixed(0)} at (${site.x.toFixed(1)}, ${site.z.toFixed(1)}) ` +
      `-- its own centre is ${pointStandsOnABridgeRamp(site.x, site.z) ? 'SCREENED' : 'RELEASED (open ground)'}`,
  );
}

// CONTROL 1: every bridge's own centre must be screened ground.
for (const [i, bridge] of bridges.entries()) {
  let centre: [number, number] | null = null;
  for (const site of CROSSING_SITES) if (bridge.covers(site.x, site.z)) centre = [site.x, site.z];
  console.log(
    `  control 1: bridge#${i} centre ${
      centre === null
        ? 'is on no proven site at all — CANNOT CHECK'
        : pointStandsOnABridgeRamp(centre[0], centre[1])
          ? 'screened, ok'
          : 'OPEN GROUND — the bridge stands where a ribbon may be drawn'
    }`,
  );
}

// CONTROL 2: 40 m off every bridge must be open ground.
{
  const far = bridges.length > 0 ? [CROSSING_SITES[0]!.x + 400, CROSSING_SITES[0]!.z + 400] : [0, 0];
  console.log(
    `  control 2: a point 400 m outside the park is ${
      pointStandsOnABridgeRamp(far[0]!, far[1]!) ? 'SCREENED — the query says true everywhere, USELESS' : 'open ground, ok'
    }`,
  );
}

// The measurement. Sweep each bridge's walkable deck on a 0.25 m grid over the
// whole park bounding box of that bridge, and ask the screen about every point
// of it. Deck, not masonry, is what `covers` reports; the masonry's outer face
// is beyond it, so this is a LOWER bound on the trespass.
let worstOpen = 0;
for (const [i, bridge] of bridges.entries()) {
  // Find the bridge's extent by sweeping a generous box round its own site.
  let ownSite = CROSSING_SITES.find((s) => bridge.covers(s.x, s.z)) ?? null;
  if (ownSite === null) {
    console.log(`  bridge#${i}: on no proven site — skipped`);
    continue;
  }
  let open = 0;
  let total = 0;
  // Where the trespass is IN THE SITE'S OWN FRAME — an `along` overrun (the
  // built ramp running past the reserved length) and an `across` overrun (the
  // built deck wider or more shifted than the reserved band) are different
  // defects and the world coordinate cannot tell them apart.
  let alongLo = Infinity;
  let alongHi = -Infinity;
  let acrossLo = Infinity;
  let acrossHi = -Infinity;
  const resAlongPos = DECK_HALF_LENGTH + ownSite.rampReachPos + RAMP_SCREEN_MARGIN;
  const resAlongNeg = -(DECK_HALF_LENGTH + ownSite.rampReachNeg + RAMP_SCREEN_MARGIN);
  const resAcross = bridgeScreenHalfAcross(ownSite);
  for (let dx = -40; dx <= 40; dx += 0.25) {
    for (let dz = -40; dz <= 40; dz += 0.25) {
      const x = ownSite.x + dx;
      const z = ownSite.z + dz;
      if (!bridge.covers(x, z)) continue;
      total += 1;
      if (!pointStandsOnABridgeRamp(x, z)) {
        open += 1;
        const along = (x - ownSite.x) * ownSite.dirX + (z - ownSite.z) * ownSite.dirZ;
        const across = -(x - ownSite.x) * ownSite.dirZ + (z - ownSite.z) * ownSite.dirX;
        alongLo = Math.min(alongLo, along);
        alongHi = Math.max(alongHi, along);
        acrossLo = Math.min(acrossLo, across);
        acrossHi = Math.max(acrossHi, across);
      }
    }
  }
  worstOpen = Math.max(worstOpen, open);
  console.log(
    `  bridge#${i} (site railD=${ownSite.railDistance.toFixed(0)}): ${total} deck samples, ` +
      `${open} on OPEN ground` +
      (open > 0
        ? `  trespass in site frame: along [${alongLo.toFixed(2)}, ${alongHi.toFixed(2)}] ` +
          `across [${acrossLo.toFixed(2)}, ${acrossHi.toFixed(2)}]  ` +
          `vs reservation along [${resAlongNeg.toFixed(2)}, ${resAlongPos.toFixed(2)}] ` +
          `across ±${resAcross.toFixed(2)}`
        : ''),
  );
}
console.log(`  VERDICT seed ${seed}: ${worstOpen === 0 ? 'no masonry on open ground' : `${worstOpen} deck samples on open ground`}`);
