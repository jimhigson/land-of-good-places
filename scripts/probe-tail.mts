/** How deep does a rigid bus cut into the park on the tails' turn? */
import './headless-canvas.mjs';
import { PARK_BOUNDARY, edgeRadiusAt } from '../src/world/boundary.ts';
import { CAT_BUS_LENGTH, CAT_BUS_WIDTH } from '../src/world/entrance/catBus.ts';
import { entranceRoadAt, entranceRoadBrow, entranceRoadExtent } from '../src/world/entrance/roadRoute.ts';

const halfL = CAT_BUS_LENGTH / 2;
const halfW = CAT_BUS_WIDTH / 2;
const brow = entranceRoadBrow();
let deepest = -Infinity;
let where = 0;
let tightest = Infinity;
for (let at = brow; at >= -brow; at -= 0.25) {
  const s = entranceRoadAt(at);
  for (const a of [-halfL, -halfL / 2, 0, halfL / 2, halfL]) {
    for (const c of [-halfW, 0, halfW]) {
      const x = s.x + s.headingX * a + -s.headingZ * c;
      const z = s.z + s.headingZ * a + s.headingX * c;
      const into = edgeRadiusAt(PARK_BOUNDARY, Math.atan2(z, x)) - Math.hypot(x, z);
      if (into > deepest) {
        deepest = into;
        where = at;
      }
    }
  }
  const ahead = entranceRoadAt(at - 2);
  const dot = Math.max(-1, Math.min(1, s.headingX * ahead.headingX + s.headingZ * ahead.headingZ));
  const radius = 2 / Math.max(1e-6, Math.acos(dot));
  tightest = Math.min(tightest, radius);
}
const { from, to } = entranceRoadExtent();
console.log(
  `extent ${from.toFixed(1)}..${to.toFixed(1)}, brow ${brow.toFixed(1)}, ` +
    `tightest turn radius ${tightest.toFixed(1)} m (bus is ${CAT_BUS_LENGTH.toFixed(1)} m long), ` +
    `deepest into the park ${deepest.toFixed(2)} m at at=${where.toFixed(1)}`,
);
