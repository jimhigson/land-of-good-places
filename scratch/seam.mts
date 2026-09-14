import { buildHeadlessPark, quietly } from '../scripts/park-harness.mts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { standHeight } from '../src/world/up.ts';
import { terrainHeight } from '../src/world/terrain.ts';

const park = quietly(() => buildHeadlessPark());
const bridges = park.world.train.bridges;
const crossings = park.world.train.crossings;
const GRACE = 0.15;
const PLAYER_RADIUS = 0.62;

// The bridge the seed-11 invariant named was (-86.0, 26.0); on the canonical
// park take whichever crossing is on a bridge.
for (const c of crossings) {
  const bridge = bridges.find((b) => b.deckCovers(c.x, c.z));
  if (!bridge) continue;
  const deckHeight = bridgeHeightAt(bridges, c.x, c.z) ?? bridge.deckY;
  console.log(`crossing (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) d=${Math.hypot(c.x, c.z).toFixed(1)} m  deck y=${deckHeight.toFixed(2)}  terrain=${terrainHeight(c.x, c.z).toFixed(2)}`);

  // Every wall whose footprint the deck centre sits inside, and what each gate says.
  park.world.collision.forEachWall((x1, z1, x2, z2, half, top, _hop, base) => {
    if (top === Infinity) return;            // ordinary solid walls, not seams
    const ax = x2 - x1, az = z2 - z1;
    const len2 = ax * ax + az * az || 1;
    let s = ((c.x - x1) * ax + (c.z - z1) * az) / len2;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const closestX = x1 + ax * s, closestZ = z1 + az * s;
    const gap = Math.hypot(c.x - closestX, c.z - closestZ) - (half + PLAYER_RADIUS);
    if (gap >= 0) return;

    const oldClears = deckHeight + GRACE >= top;
    const newClears = standHeight(c.x, deckHeight, c.z) + GRACE >= standHeight(closestX, top, closestZ);
    console.log(
      `   wall half=${half.toFixed(2)} top=${top.toFixed(2)} overlap=${(-gap).toFixed(2)} m  ` +
        `closest (${closestX.toFixed(1)}, ${closestZ.toFixed(1)})  ` +
        `topAlt=${standHeight(closestX, top, closestZ).toFixed(2)} moverAlt=${standHeight(c.x, deckHeight, c.z).toFixed(2)}  ` +
        `old: ${oldClears ? 'clears (open)' : 'SOLID'}   new: ${newClears ? 'clears (open)' : 'SOLID'}` +
        (oldClears !== newClears ? '   <<< THE FLIP' : ''),
    );
  });
}
