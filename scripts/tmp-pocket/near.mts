import '../headless-canvas.mjs';
import { buildHeadlessPark } from '../park-harness.mts';
const { world } = buildHeadlessPark();
for (const pt of (process.env['PTS'] ?? '5,60').split(';')) {
  const [x, z] = pt.split(',').map(Number) as [number, number];
  console.log(`== (${x}, ${z})`);
  for (const d of world.collision.describeNear(x, z, 0.62, 1.5)) console.log('  ', d);
}
for (const s of (world.train as unknown as { stations?: { x?: number; z?: number; name?: string }[] }).stations ?? []) console.log('station', JSON.stringify(s).slice(0, 200));
const sc = world.scenery as unknown as { treeColliders: { id: number; radius: number }[]; bushColliders?: { id: number }[] };
for (const id of [159, 161]) {
  const t = sc.treeColliders.findIndex((c) => c.id === id);
  const b = (sc.bushColliders ?? []).findIndex((c) => c.id === id);
  console.log('collider', id, 'tree idx', t, 'bush idx', b);
}
