/** #489 — raw ladder at a few stations along the one bridge on this seed. */
import { Raycaster, Vector3, Mesh, Box3, type Object3D } from 'three';

const ROOT = '/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/art-bridge-489';
const { buildHeadlessPark } = await import(`${ROOT}/scripts/park-harness.mts`);
const { PARK_SEED } = await import(`${ROOT}/src/world/parkManifest.ts`);
const { frameFor } = await import(`${ROOT}/src/world/train/bridgeSpine.ts`);

const { scene, world } = buildHeadlessPark();
scene.updateMatrixWorld(true);

const groups = new Map<string, Object3D>();
scene.traverse((o: Object3D) => {
  if (/^bridge-\d/.test(o.name)) groups.set(o.name, o);
});

for (const crossing of world.train.crossings) {
  const group = groups.get(`bridge-${crossing.railDistance.toFixed(1)}`);
  if (!group) continue;
  const shell = group.getObjectByName('shell') as Mesh;
  const wallTop = group.getObjectByName('wallTop') as Mesh | undefined;
  const coping = group.getObjectByName('coping') as Mesh | undefined;
  const frame = frameFor(crossing);
  console.log(`\n=== ${group.name} (seed ${PARK_SEED}) ===`);
  for (const m of [shell, wallTop, coping]) {
    if (!m) continue;
    const b = new Box3().setFromObject(m);
    console.log(`  ${m.name}: y ${b.min.y.toFixed(2)} .. ${b.max.y.toFixed(2)}`);
  }

  const caster = new Raycaster();
  caster.far = 80;
  for (const along of [0, -1, -2, -3, -4, -6, -8]) {
    const c = frame.pointAt(along);
    const across = new Vector3(c.acrossX, 0, c.acrossZ).normalize();
    const mid = new Vector3(c.x, 0, c.z);
    caster.set(new Vector3(mid.x, 80, mid.z), new Vector3(0, -1, 0));
    const road = caster.intersectObject(shell, false)[0];
    const roadY = road ? road.point.y : Number.NaN;
    // The wallTop strip directly overhead tells us where the parapet top is.
    let topY = Number.NaN;
    if (wallTop) {
      for (const s of [1, -1]) {
        const p = mid.clone().addScaledVector(across, 0.15 * s + 1.6 * s);
        caster.set(new Vector3(p.x, 80, p.z), new Vector3(0, -1, 0));
        const h = caster.intersectObject(wallTop, false)[0];
        if (h) topY = Math.max(Number.isNaN(topY) ? -1e9 : topY, h.point.y);
      }
    }
    const marks: string[] = [];
    for (let y = roadY - 0.2; y <= roadY + 2.0; y += 0.1) {
      const origin = mid.clone().addScaledVector(across, 14).setY(y);
      caster.set(origin, across.clone().negate());
      const h = caster.intersectObject(shell, false)[0];
      marks.push(h && h.distance < 14 + 1.5 ? '#' : '.');
    }
    console.log(
      `  along ${String(along).padStart(3)}  roadY ${roadY.toFixed(2)}  parapetTop ${topY.toFixed(2)} ` +
        ` (=road+${(topY - roadY).toFixed(2)})  shell near-wall from road-0.2 up: ${marks.join('')}`,
    );
  }
}
