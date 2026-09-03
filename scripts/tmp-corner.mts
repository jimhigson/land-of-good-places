/** TEMP diagnostic: for a terminal `p` and a lattice node, are BOTH elbow
 * corners clear? The second block of `computeGridConnectors` tries
 * corner A = (nx, p.z) first, unconditionally; corner B = (p.x, nz) is only
 * ever reached if A is refused. Both have the same Manhattan length, so the
 * same cost. If B is clear, A winning is a push order, not a decision.
 *
 * CONTROL: a corner reachable only through a deliberately absurd point
 * (200 m outside the park) must come back NOT clear, or the screen is not
 * discriminating and every other row is worthless. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugArrivalLegScreens } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
const [px, pz, nx, nz] = process.argv.slice(2, 6).map(Number) as [number, number, number, number];
const show = (label: string, cx: number, cz: number) => {
  const a = debugArrivalLegScreens(nx, nz, cx, cz, px, pz) as { streetClearArriving: boolean };
  const b = debugArrivalLegScreens(cx, cz, px, pz, px, pz) as { streetClearArriving: boolean };
  const nodeLeg = Math.hypot(cx - nx, cz - nz);
  const tail = Math.hypot(px - cx, pz - cz);
  console.log(
    `${label} corner(${cx.toFixed(3)},${cz.toFixed(3)})  nodeLeg=${nodeLeg.toFixed(2)} tail=${tail.toFixed(2)} ` +
      `total=${(nodeLeg + tail).toFixed(2)}  legNode=${a.streetClearArriving ? 'clear' : 'BLOCKED'} legTail=${b.streetClearArriving ? 'clear' : 'BLOCKED'}`,
  );
};
console.log(`terminal (${px},${pz})  node (${nx},${nz})`);
show('A (drawn, tail on p’s own line) ', nx, pz);
show('B (alt,   tail on node’s line)  ', px, nz);
show('CONTROL (absurd, 200 m out)     ', px + 200, nz + 200);
