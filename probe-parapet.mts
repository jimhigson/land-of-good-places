/**
 * #489 diagnostic — can you see through the near parapet above the arch?
 *
 * Marches a horizontal ray across the bridge at a ladder of heights and of
 * `along` stations, from outside the near parapet inward. A solid parapet
 * stops every ray inside its own thickness. Reported twice: against the
 * swept masonry shell alone (is the *wall* there?) and against everything
 * drawn (can a child actually see through, once the proud arch ring and the
 * modelled coping are in front of it?).
 */
import { Raycaster, Vector3, Mesh, type Object3D } from 'three';

const ROOT = '/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/art-bridge-489';
const { buildHeadlessPark } = await import(`${ROOT}/scripts/park-harness.mts`);
const { PARK_SEED } = await import(`${ROOT}/src/world/parkManifest.ts`);
const { frameFor } = await import(`${ROOT}/src/world/train/bridgeSpine.ts`);
const { ARCH_SPAN_HALF, PARAPET_HEIGHT, PARAPET_CROWN_LIFT } = await import(
  `${ROOT}/src/world/train/bridges.ts`
);

const { scene, world } = buildHeadlessPark();
scene.updateMatrixWorld(true);

const bridgeGroups = new Map<string, Object3D>();
scene.traverse((o: Object3D) => {
  if (/^bridge-\d/.test(o.name)) bridgeGroups.set(o.name, o);
});

console.log(
  `seed ${PARK_SEED}: ${bridgeGroups.size} bridges; ARCH_SPAN_HALF ${ARCH_SPAN_HALF}, ` +
    `PARAPET_HEIGHT ${PARAPET_HEIGHT}, PARAPET_CROWN_LIFT ${PARAPET_CROWN_LIFT}`,
);

let worstShell = 0;
let worstVisible = 0;
const perBridge: string[] = [];

for (const crossing of world.train.crossings) {
  const group = bridgeGroups.get(`bridge-${crossing.railDistance.toFixed(1)}`);
  if (!group) continue;
  const shell = group.getObjectByName('shell') as Mesh | undefined;
  if (!shell) continue;
  const drawn: Mesh[] = [];
  group.traverse((o: Object3D) => {
    const m = o as Mesh;
    if (m.isMesh && m.name !== 'deck') drawn.push(m);
  });

  const frame = frameFor(crossing);
  const caster = new Raycaster();
  caster.far = 60;

  let shellGap = 0;
  let visibleGap = 0;
  let worstAlong = 0;
  let bandLo = 0;
  let bandHi = 0;

  for (let along = -6; along <= 6; along += 0.5) {
    const centre = frame.pointAt(along);
    const across = new Vector3(centre.acrossX, 0, centre.acrossZ).normalize();
    const mid = new Vector3(centre.x, 0, centre.z);
    // The road surface here is whatever the shell's own road quad is: find it
    // by casting straight down from well above.
    caster.set(new Vector3(mid.x, 60, mid.z), new Vector3(0, -1, 0));
    const down = caster.intersectObject(shell, false)[0];
    if (!down) continue;
    const roadY = down.point.y;

    let lo = Number.NaN;
    let hi = Number.NaN;
    let vlo = Number.NaN;
    let vhi = Number.NaN;
    for (let dy = 0.02; dy <= 2.2; dy += 0.02) {
      const y = roadY + dy;
      const origin = mid.clone().addScaledVector(across, 12).setY(y);
      caster.set(origin, across.clone().negate());
      const hitShell = caster.intersectObject(shell, false)[0];
      const hitAny = caster.intersectObjects(drawn, false)[0];
      // "Through the near parapet" = the first hit is more than 2 m in,
      // i.e. past the near wall entirely (walls are 0.30 m thick).
      const throughShell = !hitShell || hitShell.distance > 12 + 2;
      const throughAny = !hitAny || hitAny.distance > 12 + 2;
      if (throughShell) {
        if (Number.isNaN(lo)) lo = dy;
        hi = dy;
      }
      if (throughAny) {
        if (Number.isNaN(vlo)) vlo = dy;
        vhi = dy;
      }
    }
    const s = Number.isNaN(lo) ? 0 : hi - lo;
    const v = Number.isNaN(vlo) ? 0 : vhi - vlo;
    if (s > shellGap) {
      shellGap = s;
      worstAlong = along;
      bandLo = lo;
      bandHi = hi;
    }
    visibleGap = Math.max(visibleGap, v);
  }

  if (shellGap > 0.05) {
    perBridge.push(
      `  ${group.name}: shell missing ${shellGap.toFixed(2)} m of wall ` +
        `(${bandLo.toFixed(2)}–${bandHi.toFixed(2)} m over the road) at along ${worstAlong.toFixed(1)} m; ` +
        `daylight through everything drawn: ${visibleGap.toFixed(2)} m`,
    );
  }
  worstShell = Math.max(worstShell, shellGap);
  worstVisible = Math.max(worstVisible, visibleGap);
}

console.log(perBridge.slice(0, 12).join('\n'));
console.log(
  `\nseed ${PARK_SEED}: ${perBridge.length} of ${bridgeGroups.size} bridges have a gap in the swept wall; ` +
    `worst ${worstShell.toFixed(2)} m of missing wall, worst visible daylight ${worstVisible.toFixed(2)} m`,
);
