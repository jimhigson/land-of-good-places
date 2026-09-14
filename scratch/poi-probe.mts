import { GARDEN_PLAY_BOUNDARY } from '../src/world/boundary';
import { GARDEN_PLAY_RADIUS } from '../src/core/constants';
import { terrainHeight } from '../src/world/terrain';

const STRANDED = [
  [-49.7, -177.4], [-46.0, -158.1], [-46.0, -162.3],
  [-46.0, -166.4], [-46.0, -170.6], [-46.7, -174.5],
] as const;

console.log(`GARDEN_PLAY_RADIUS = ${GARDEN_PLAY_RADIUS.toFixed(1)} m`);
console.log('');
console.log('the six stranded waypoints, against the play boundary:');
for (const [x, z] of STRANDED) {
  const d = Math.hypot(x, z);
  const edge = GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z);
  console.log(
    `  (${x.toFixed(1)}, ${z.toFixed(1)})  d=${d.toFixed(1)} m  ` +
      `distanceToEdge=${edge.toFixed(2)} m  ${edge > 0 ? 'inside the park' : 'OUTSIDE THE PARK'}  ` +
      `ground y=${terrainHeight(x, z).toFixed(1)}`,
  );
}
console.log('');
// CONTROL: a point we know is inside, and one we know is outside.
for (const [label, x, z] of [['park origin', 0, 0], ['far out', 0, -300]] as const) {
  const edge = GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z);
  console.log(`CONTROL ${label} (${x}, ${z}): distanceToEdge=${edge.toFixed(2)} — ${edge > 0 ? 'inside' : 'outside'}`);
}
console.log('');
// How far does the boundary actually reach on that bearing?
const bearing = Math.atan2(-166, -46);
let reach = 0;
for (let r = 1; r < 400; r += 0.5) {
  if (GARDEN_PLAY_BOUNDARY.distanceToEdge(Math.cos(bearing) * r, Math.sin(bearing) * r) <= 0) break;
  reach = r;
}
console.log(`the boundary on that bearing reaches ${reach.toFixed(1)} m; the waypoints sit at 164.6-184.2 m.`);
