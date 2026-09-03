/** TEMP diagnostic: **does any drawn ribbon enter the statue ring?**
 *
 * One number per seed: the closest any drawn path centreline comes to
 * `PLAZA`, measured segment-wise (not vertex-wise — a ribbon can cross the
 * ring cleanly between two vertices, which is exactly what seed 267 did).
 *
 * Run it twice, with the gateway rescue's `segmentClearOfRing` calls out and
 * then in. A seed whose figure rises from **below** `RING_RADIUS` to at or
 * above it is a seed that really showed the defect. That turns "nine seeds
 * carry a rescued tap so nine seeds probably look different" into a measured
 * list, which is the difference between a claim and an assumption.
 *
 * **Measure the TAP ribbons, not every ribbon.** The first cut of this took
 * the minimum over all routes and reported seed 267 as "INSIDE THE RING by
 * 6.50 m" *after* the fix — because `fountain-approach` legitimately runs to
 * the fountain, which stands at the plaza centre. Routes that are *supposed*
 * to enter cannot be evidence that something entered wrongly. The gateway
 * taps are the routes this fix governs and the ones that must never enter.
 *
 * CONTROLS, all printed every run:
 *
 * 1. **The ring itself.** `main-loop` runs *on* the ring, so its own distance
 *    must come out at about `RING_RADIUS`. If it does not, the distance
 *    measure is wrong and no other row means anything.
 * 2. **The nearest approach, named.** The route achieving the minimum is
 *    printed, so a suspicious figure can be traced to a ribbon rather than
 *    taken on trust.
 */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PLAZA } from '../src/world/paths.ts';
import { RING_RADIUS } from '../src/world/parkLayout.ts';

const seed = process.env['LGP_SEED'] ?? 'canonical';
quietly(() => buildHeadlessPark());
const { ROUTES } = await import('../src/world/pathGraph.ts');

/** Distance from PLAZA to the segment a-b — segment-wise, because a ribbon
 * that crosses the ring between two vertices has both vertices outside it. */
const distToSegment = (
  a: readonly [number, number],
  b: readonly [number, number],
): number => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq > 1e-9
      ? Math.max(0, Math.min(1, ((PLAZA.x - a[0]) * dx + (PLAZA.z - a[1]) * dz) / lengthSq))
      : 0;
  return Math.hypot(PLAZA.x - (a[0] + dx * t), PLAZA.z - (a[1] + dz * t));
};

const nearest = (name: string): number => {
  let best = Infinity;
  for (const route of ROUTES) {
    if (route.name !== name) continue;
    for (let i = 1; i < route.points.length; i += 1) {
      best = Math.min(
        best,
        distToSegment(
          route.points[i - 1] as readonly [number, number],
          route.points[i] as readonly [number, number],
        ),
      );
    }
  }
  return best;
};

let worstTap = Infinity;
let worstTapName = '(no tap ribbon on this seed)';
let taps = 0;
for (const route of ROUTES) {
  if (!route.name.startsWith('street-tap')) continue;
  taps += 1;
  const d = nearest(route.name);
  if (d < worstTap) {
    worstTap = d;
    worstTapName = route.name;
  }
}

// CONTROL 1: the ring's own ribbon must measure about RING_RADIUS. If it does
// not, the distance measure is wrong and no row below means anything.
const ringOwn = nearest('main-loop');
// CONTROL 2: a route that is SUPPOSED to enter the ring must read as inside.
// If `fountain-approach` reads as clear of the ring, this instrument cannot
// see an entering ribbon at all and a clean run would prove nothing.
const fountain = nearest('fountain-approach');

/** A tap that touches the rim sits at **exactly** `RING_RADIUS`, and in
 * floating point that lands a hair under it. The first run of this reported
 * seeds 274, 326 and 428 as `TAP INSIDE THE RING by 0.00 m` — and **"by
 * 0.00 m" is the tell**: a violation whose magnitude rounds to zero is not a
 * violation, it is the comparison. Touching the rim is what a gateway is for,
 * so the epsilon is the instrument admitting that, not a threshold being
 * tuned to make seeds pass. Anything genuinely inside is inside by metres —
 * seed 267's was 13.74 m. */
const RIM_EPSILON = 0.01;

const verdict =
  taps === 0
    ? 'no gateway tap — ASSERTS NOTHING on this seed'
    : worstTap < RING_RADIUS - RIM_EPSILON
      ? `TAP INSIDE THE RING by ${(RING_RADIUS - worstTap).toFixed(2)} m`
      : 'every tap clear of the ring';
console.log(
  `${seed}\ttaps=${taps}\tnearest tap approach to PLAZA: ` +
    `${worstTap === Infinity ? 'n/a' : `${worstTap.toFixed(2)} m via ${worstTapName}`}` +
    `\tRING_RADIUS=${RING_RADIUS.toFixed(2)}\t${verdict}` +
    `\tcontrol1(main-loop)=${ringOwn === Infinity ? 'ABSENT — CONTROL CANNOT RUN' : ringOwn.toFixed(2)}` +
    `\tcontrol2(fountain-approach)=${fountain === Infinity ? 'absent' : fountain.toFixed(2)}`,
);
