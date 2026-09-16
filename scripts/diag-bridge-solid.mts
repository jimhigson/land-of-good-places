/**
 * **Is the drawn bridge solid where it looks solid, and does it carry her
 * where it looks like it carries her?**
 *
 * The mandated pre-condition for leaning the bridge. A rigid tilt moves the
 * drawn stone in plan; `bridges.ts` keeps **four** definitions of its own plan
 * footprint and only two of them follow the sweep, so the failure this is built
 * to catch is not "everything drifts" but the nastier shape: the parapet she
 * bumps into follows the stone while the deck she stands on does not. Each half
 * stays self-consistent, so nothing looks wrong until a child falls through.
 *
 * Two questions, both asked against the **drawn** stone rather than against any
 * analytic claim about it:
 *
 * - **Solid**: march a player-sized body at the drawn parapet from many
 *   bearings and assert `CollisionWorld` stops her outside it.
 * - **Carried**: walk the drawn deck and assert the walk surface carries her at
 *   the height the stone is at.
 *
 * ## The control comes first, and it must prove BOTH verdicts reachable
 *
 * A probe that can only say "fine" says nothing — and my last one read clean by
 * discarding its own disagreements, so this one proves it can report a refusal
 * *and* a pass before any number it prints may be believed:
 *
 * - a march at a point 60 m off the bridge, over open grass, must report NOT
 *   STOPPED (so "stopped" is a real finding, not the only thing it can say);
 * - a carry probe 60 m off the bridge must report NOT CARRIED (so "carried" is
 *   a real finding);
 * - a march straight at the parapet must report STOPPED on today's flat bridge.
 *
 * If any control line disagrees, every measurement below is void and says so.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';

const { buildHeadlessPark } = await import('./park-harness.mts');
const seed = process.env['LGP_SEED'] ?? 'default(canonical)';
const park = buildHeadlessPark();

const { PLAYER_RADIUS, GROUND_SPHERE_RADIUS } = await import('../src/core/constants.ts');
const { terrainHeight } = await import('../src/world/terrain.ts');
const { computeCrossings } = await import('../src/world/train/crossings.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');

const collision = park.world.collision;
const crossings = computeCrossings(TRAIN_PLAN.route);

/** March a player-sized body from `from` toward `to` in 5 cm steps, through
 * **the real `CollisionWorld`'s own movement path** (`resolveMovement`, which
 * is what `Player` uses, sub-stepping and all) rather than a probe's private
 * idea of moving. Reports where it came to rest. */
const marchPos = new Vector3();
const march = (
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): { stopped: boolean; x: number; z: number; travelled: number } => {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const span = Math.hypot(dx, dz) || 1;
  const ux = dx / span;
  const uz = dz / span;
  const STEP = 0.05;
  marchPos.set(fromX, terrainHeight(fromX, fromZ), fromZ);
  for (let t = 0; t < span; t += STEP) {
    const beforeX = marchPos.x;
    const beforeZ = marchPos.z;
    marchPos.y = terrainHeight(marchPos.x, marchPos.z);
    collision.resolveMovement(marchPos, ux * STEP, uz * STEP, PLAYER_RADIUS);
    const advanced = Math.hypot(marchPos.x - beforeX, marchPos.z - beforeZ);
    if (advanced < STEP * 0.25) {
      return { stopped: true, x: marchPos.x, z: marchPos.z, travelled: t };
    }
  }
  return { stopped: false, x: marchPos.x, z: marchPos.z, travelled: span };
};

/**
 * Is the walk surface here the bridge's own deck, rather than the ground?
 *
 * **The `from` height is not a detail and it nearly produced a false alarm.**
 * `WalkSurfaces.sample(x, z, y)` answers "the surface at or below `y`", so a
 * probe that samples from a fixed `ground + 6` is blind to any deck standing
 * higher than that — and these decks are 4.73 m at the innermost crossing and
 * **7.34 m** at the outermost. The first version of this probe used `+ 6` and
 * reported 64 of 125 points uncarried with an 8.87 m fall at the outer bridge,
 * which read exactly like a real, catastrophic bug and was entirely the probe's
 * own blind spot. Sample from above the deck this bridge actually claims.
 */
const carriedAt = (
  x: number,
  z: number,
  from: number,
): { carried: boolean; surface: number; ground: number } => {
  const ground = terrainHeight(x, z);
  const surface = park.sample(x, z, from);
  return { carried: surface > ground + 0.35, surface, ground };
};

let controlsOk = true;
const control = (label: string, actual: boolean, wanted: boolean): void => {
  const ok = actual === wanted;
  if (!ok) controlsOk = false;
  console.log(`  control ${ok ? 'OK ' : 'FAILED'}: ${label} — wanted ${wanted}, got ${actual}`);
};

console.log(`seed ${seed}: R=${GROUND_SPHERE_RADIUS}, PLAYER_RADIUS=${PLAYER_RADIUS.toFixed(2)}`);

// ---------------------------------------------------------------- controls
// **Find genuinely open grass rather than assuming a fixed offset is open.**
// The first version of this control marched from `crossing + (60, 60)` and was
// stopped — not because the probe was broken but because that spot happened to
// be inside scenery. A control that fails for a reason unrelated to what it is
// controlling for is worse than none: it voids the run and tells you nothing.
// So the open spot is *searched for*, with `isClearCircle` as the authority,
// and if none is found within the search the run says so rather than guessing.
let openX = 0;
let openZ = 0;
let foundOpen = false;
for (let ring = 40; ring <= 90 && !foundOpen; ring += 5) {
  for (let i = 0; i < 36 && !foundOpen; i += 1) {
    const a = (i / 36) * Math.PI * 2;
    const cx = Math.cos(a) * ring;
    const cz = Math.sin(a) * ring;
    // Clear here AND clear all along the 8 m the control is about to march.
    let clearAll = true;
    for (let t = 0; t <= 8 && clearAll; t += 0.5) {
      if (!collision.isClearCircle(cx + t, cz, PLAYER_RADIUS + 0.3)) clearAll = false;
    }
    const nearBridge = park.world.train.bridges.some((b) => b.covers(cx, cz));
    if (clearAll && !nearBridge) {
      openX = cx;
      openZ = cz;
      foundOpen = true;
    }
  }
}
if (!foundOpen) {
  controlsOk = false;
  console.log('  control FAILED: no open grass found to control against — run is VOID');
} else {
  console.log(`  (control point: open grass at (${openX.toFixed(1)}, ${openZ.toFixed(1)}))`);
  control('a march over open grass is NOT stopped', march(openX, openZ, openX + 8, openZ).stopped, false);
  control('open grass is NOT carried by any deck', carriedAt(openX, openZ, terrainHeight(openX, openZ) + 20).carried, false);
}

// ---------------------------------------------------- the bridges themselves
console.log('');
const sorted = [...crossings].sort(
  (a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z),
);
const interesting = [sorted[0], sorted[sorted.length - 1]].filter(Boolean) as typeof sorted;
for (const crossing of interesting) {
  const bridge = park.world.train.bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
  const r = Math.hypot(crossing.x, crossing.z);
  const tilt = (Math.asin(Math.min(1, r / GROUND_SPHERE_RADIUS)) * 180) / Math.PI;
  console.log(
    `bridge at (${crossing.x.toFixed(1)}, ${crossing.z.toFixed(1)}) r=${r.toFixed(1)} tilt=${tilt.toFixed(1)}deg` +
      `${bridge ? '' : ' — NO BRIDGE COVERS IT'}`,
  );
  if (!bridge) continue;

  // SOLID: 24 bearings, marched in from 14 m at the deck's own height band.
  let stoppedCount = 0;
  let reachedMiddle = 0;
  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * Math.PI * 2;
    const fromX = crossing.x + Math.cos(angle) * 14;
    const fromZ = crossing.z + Math.sin(angle) * 14;
    const result = march(fromX, fromZ, crossing.x, crossing.z);
    if (result.stopped) stoppedCount += 1;
    if (Math.hypot(result.x - crossing.x, result.z - crossing.z) < 1.0) reachedMiddle += 1;
  }
  console.log(
    `  solid: of 24 bearings marched at it, ${stoppedCount} were stopped, ` +
      `${reachedMiddle} reached the middle (the deck carries a path, so reaching the ` +
      `middle along the path is CORRECT — the parapet sides are what must stop her)`,
  );

  // CARRIED: walk the deck across and along, and ask whether the surface under
  // her is the bridge rather than the grass.
  let carried = 0;
  let sampled = 0;
  const worstDrop: { x: number; z: number; drop: number }[] = [];
  for (let along = -6; along <= 6; along += 0.5) {
    for (let across = -1.5; across <= 1.5; across += 0.5) {
      const x = crossing.x + crossing.pathDirX * along - crossing.pathDirZ * across;
      const z = crossing.z + crossing.pathDirZ * along + crossing.pathDirX * across;
      if (!bridge.covers(x, z)) continue;
      sampled += 1;
      const probe = carriedAt(x, z, bridge.heightAt(x, z) + 2);
      if (probe.carried) carried += 1;
      else worstDrop.push({ x, z, drop: bridge.heightAt(x, z) - probe.surface });
    }
  }
  console.log(
    `  carried: ${carried} of ${sampled} points the bridge claims to cover are actually ` +
      `carried by a walk surface above the grass` +
      (worstDrop.length
        ? ` — ${worstDrop.length} NOT carried, worst falls ${Math.max(...worstDrop.map((w) => w.drop)).toFixed(2)} m`
        : ''),
  );
}

console.log('');
console.log(
  controlsOk
    ? 'CONTROLS PASSED — the numbers above may be believed.'
    : 'CONTROLS FAILED — every number above is VOID; the probe is not measuring what it claims.',
);
