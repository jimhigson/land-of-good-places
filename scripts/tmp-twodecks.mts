/** TEMP diagnostic: **two decks in one reservation.**
 *
 * `builtMasonryStaysInsideItsReservation` sweeps each proven site's own
 * `along` extent and asks how far `|across|` any built deck reaches. Seeds 5
 * and 288 fail it with a band far wider than one bridge — seed 5's site
 * (0, 36) spans across -1.40 to 14.00, seed 288's site 152 spans -14.00 to
 * -5.20. Those are two decks in one rectangle, and the question this answers
 * is *whose the second one is*.
 *
 * For every proven site it reports, per bridge:
 *   - the `across` band that bridge occupies inside this site's reservation;
 *   - whether that bridge is this site's own (it covers the site's centre);
 *   - for a foreign bridge, its own site, and whether the two sites'
 *     RESERVATION rectangles overlap while `footprintsOverlap`'s shorter
 *     rectangles do not — which is exactly the documented gap.
 *
 * CONTROLS, and they must be read before anything below.
 *
 * 1. **The frame control.** Every site's own bridge must come out centred on
 *    `across = 0` in that site's frame. A site whose OWN bridge is reported
 *    off-centre means the (along, across) arithmetic is wrong and nothing
 *    below it can be believed. This is the control that discriminates: it
 *    reads the same frame the failing rows are read in.
 *
 *    A first attempt controlled instead by sweeping a strip 40 m to the side
 *    and asserting no deck there. **That control failed on seed 5, and the
 *    instrument was right** — site railD=0 at (0, 36) genuinely has bridge #3
 *    standing 29 m away at (-27.5, 25.0), so "no deck 40 m aside" is not a
 *    property of a correct frame. The strip is still printed, but as a
 *    diagnostic naming what it found, never as a verdict.
 *
 * 2. **The discrimination control.** The same per-bridge attribution is
 *    printed for EVERY site, passing ones included. If a passing site also
 *    reports foreign deck *inside its reservation*, then "foreign deck in the
 *    reservation" is not what distinguishes a failure and the column is
 *    worthless.
 */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { DECK_HALF_LENGTH } from '../src/world/train/bridgeFootprint.ts';
import { MIN_BRIDGE_HALF_LENGTH } from '../src/world/train/bridgeFootprint.ts';
import { RAMP_SCREEN_MARGIN } from '../src/world/train/bridgeFit.ts';
import { bridgeScreenHalfAcross } from '../src/world/paths.ts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import { BRIDGE_WALL_THICKNESS } from '../src/world/train/bridgeFootprint.ts';
import type { Bridge } from '../src/world/train/bridges.ts';
import type { CrossingSite } from '../src/world/train/crossingPlan.ts';

const seed = process.env['LGP_SEED'] ?? 'canonical';
const park = quietly(() => buildHeadlessPark());
const bridges = park.world.train.bridges;

/** Which proven site does this bridge sit on? The bridge that covers a site's
 * own centre point is that site's bridge; the mapping is by the built park,
 * not by any index the planner happens to hand out. */
const siteOf = (bridge: Bridge): CrossingSite | null => {
  for (const site of CROSSING_SITES) if (bridge.covers(site.x, site.z)) return site;
  return null;
};

/** The `across` band this one bridge's walkable deck occupies over `site`'s
 * own `along` strip.
 *
 * `reach` is the half-width swept. **Two different questions live here and
 * the invariant currently asks only the first:**
 *   - `reach = 14` — the invariant's own sweep, which reaches far outside the
 *     reservation and so sees bridges the reservation has nothing to say
 *     about;
 *   - `reach = screenHalfAcross` — the reservation itself, which is the
 *     ground `paths.ts` actually kept legs off. */
const bandIn = (site: CrossingSite, bridge: Bridge, reach: number): { lo: number; hi: number } => {
  const nx = site.dirZ;
  const nz = -site.dirX;
  const alongMin = -(DECK_HALF_LENGTH + site.rampReachNeg);
  const alongMax = DECK_HALF_LENGTH + site.rampReachPos;
  let lo = Infinity;
  let hi = -Infinity;
  for (let along = alongMin; along <= alongMax; along += 0.5) {
    const bx = site.x + site.dirX * along;
    const bz = site.z + site.dirZ * along;
    for (let a = -reach; a <= reach; a += 0.05) {
      if (bridge.covers(bx + nx * a, bz + nz * a)) {
        lo = Math.min(lo, a);
        hi = Math.max(hi, a);
      }
    }
  }
  return { lo, hi };
};

/** Separating-axis overlap between two oriented rectangles, each given as
 * (half length along its own dir, half width across). The same test
 * `footprintsOverlap` runs; the extents are the parameter, so one call can ask
 * the planner's question and another the reservation's. */
const rectsOverlap = (
  a: CrossingSite,
  aAlong: number,
  aAcross: number,
  b: CrossingSite,
  bAlong: number,
  bAcross: number,
): boolean => {
  const axes = [
    [a.dirX, a.dirZ],
    [-a.dirZ, a.dirX],
    [b.dirX, b.dirZ],
    [-b.dirZ, b.dirX],
  ] as const;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [axX, axZ] of axes) {
    const ea =
      Math.abs((a.dirX * axX + a.dirZ * axZ) * aAlong) +
      Math.abs((-a.dirZ * axX + a.dirX * axZ) * aAcross);
    const eb =
      Math.abs((b.dirX * axX + b.dirZ * axZ) * bAlong) +
      Math.abs((-b.dirZ * axX + b.dirX * axZ) * bAcross);
    if (Math.abs(dx * axX + dz * axZ) >= ea + eb) return false;
  }
  return true;
};

/** The reservation's own half-extents — the rectangle `bridgeSiteReserving`
 * walks, asked of the same owners rather than restated. */
const resAlong = (s: CrossingSite): number =>
  DECK_HALF_LENGTH + Math.max(s.rampReachPos, s.rampReachNeg) + RAMP_SCREEN_MARGIN;

console.log(`seed ${seed}: ${CROSSING_SITES.length} proven site(s), ${bridges.length} built bridge(s)`);

for (const site of CROSSING_SITES) {
  const screen = bridgeScreenHalfAcross(site);
  const rows: string[] = [];
  let worst = 0;
  let frameControl = 'no own bridge built here';
  let foreignInsideReservation = false;
  for (const [i, bridge] of bridges.entries()) {
    const wide = bandIn(site, bridge, 14);
    if (wide.lo === Infinity) continue;
    const inRes = bandIn(site, bridge, screen);
    const own = siteOf(bridge);
    const isOwn = own === site;
    const face = Math.max(Math.abs(wide.lo), Math.abs(wide.hi)) + PLAYER_RADIUS + BRIDGE_WALL_THICKNESS;
    worst = Math.max(worst, face);
    // CONTROL 1: a site's own bridge must be centred on across = 0.
    if (isOwn) {
      const centre = (wide.lo + wide.hi) / 2;
      frameControl =
        Math.abs(centre) <= 1
          ? `own bridge centred at across ${centre.toFixed(2)} — frame ok`
          : `OWN BRIDGE OFF-CENTRE at across ${centre.toFixed(2)} — FRAME SUSPECT`;
    }
    if (!isOwn && inRes.lo !== Infinity) foreignInsideReservation = true;
    let note = isOwn ? 'OWN' : 'FOREIGN';
    if (!isOwn) {
      note += own
        ? ` (its site railD=${own.railDistance.toFixed(0)} at ${own.x.toFixed(1)},${own.z.toFixed(1)}` +
          `; planner-rects overlap=${rectsOverlap(site, MIN_BRIDGE_HALF_LENGTH, site.halfWidth, own, MIN_BRIDGE_HALF_LENGTH, own.halfWidth)}` +
          `, reservation-rects overlap=${rectsOverlap(site, resAlong(site), screen, own, resAlong(own), bridgeScreenHalfAcross(own))})`
        : ' (on NO proven site)';
    }
    rows.push(
      `    bridge#${i} across[±14] [${wide.lo.toFixed(2)}, ${wide.hi.toFixed(2)}] outerFace=${face.toFixed(2)}  ` +
        `INSIDE RESERVATION: ${inRes.lo === Infinity ? 'none' : `[${inRes.lo.toFixed(2)}, ${inRes.hi.toFixed(2)}]`}  ${note}`,
    );
  }
  const verdict = rows.length === 0 ? 'no deck — asserts nothing' : worst > screen ? 'FAILS TODAY' : 'passes today';
  console.log(
    `  site railD=${site.railDistance.toFixed(0)} at (${site.x.toFixed(1)}, ${site.z.toFixed(1)}) ` +
      `screen=${screen.toFixed(2)} worstFace[±14]=${worst.toFixed(2)} -> ${verdict}` +
      `   foreignDeckInsideReservation=${foreignInsideReservation}`,
  );
  for (const r of rows) console.log(r);
  console.log(`    control 1 (frame): ${frameControl}`);

  // Diagnostic only, deliberately NOT a verdict: what stands 40 m to the side.
  const nx = site.dirZ;
  const nz = -site.dirX;
  const aside = new Set<number>();
  for (let along = -20; along <= 20; along += 0.5) {
    const bx = site.x + site.dirX * along + nx * 40;
    const bz = site.z + site.dirZ * along + nz * 40;
    for (const [i, b] of bridges.entries()) if (b.covers(bx, bz)) aside.add(i);
  }
  console.log(
    `    (diagnostic, 40 m aside — outside every reservation, so a hit here is a neighbour, not a fault): ` +
      `${aside.size === 0 ? 'nothing' : `bridge#${[...aside].join(',#')}`}`,
  );
}
