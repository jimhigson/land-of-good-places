/**
 * **What does a crossing become when it does not get a bridge?** — #414, and
 * #396's open question asked exactly where it matters.
 *
 *   LGP_ONLY_PROVEN_BRIDGES=1 node --no-warnings \
 *     --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/measure-level-crossing-walkability.mts 20260728 2 5 11 18
 *
 * For every crossing WITHOUT a bridge, this asks the real `NavGrid` — the
 * same lattice a child's finger is routed on, built with her own radius and
 * jump apex, exactly as `check-park.mts` builds it — three questions:
 *
 *  1. can she stand on each side of the crossing at all?
 *  2. can she walk from one side to the other?
 *  3. does the walk actually go THROUGH the crossing, or all the way round
 *     the loop? A 200 m detour is "reachable" and is not a usable crossing.
 *
 * Geometry is never consulted for the answer: a level crossing that looks
 * fine and cannot be walked is precisely the defect #396 is about.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';

const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
if (seeds.length === 0) throw new Error('give me some seeds');

if (!process.env['LGP_ONE_SEED']) {
  const { execFileSync } = await import('node:child_process');
  for (const seed of seeds) {
    try {
      process.stdout.write(
        execFileSync(
          process.execPath,
          [
            '--no-warnings',
            '--import',
            './scripts/ts-extension-resolver-register.mjs',
            'scripts/measure-level-crossing-walkability.mts',
            String(seed),
          ],
          { env: { ...process.env, LGP_ONE_SEED: '1', LGP_SEED: String(seed) }, encoding: 'utf8' },
        ),
      );
    } catch (error) {
      process.stdout.write(`seed ${seed}: FAILED — ${(error as Error).message.split('\n')[0]}\n`);
    }
  }
  process.exit(0);
}

const { buildHeadlessPark } = await import('./park-harness.mts');
const { NavGrid } = await import('../src/world/NavGrid.ts');
const { PLAYER_RADIUS, JUMP_APEX_HEIGHT } = await import('../src/core/constants.ts');
const { PARK_SEED } = await import('../src/world/parkManifest.ts');

const park = buildHeadlessPark();
const world = park.world;
const collision = world.collision;

const navGrid = new NavGrid(collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT, undefined, (x, z) =>
  world.train.bridges.some((bridge) => bridge.covers(x, z)),
);
const route = new Float32Array(4096 * 2);

/** Can a child's body actually occupy this spot? `resolve` is what pushes a
 * real walker out of anything solid, so a spot it moves is a spot she cannot
 * stand on. The same test `check-park.mts` calls `isStandable`. */
const standable = (x: number, z: number): boolean => {
  const probe = new Vector3(x, 0, z);
  collision.resolve(probe, PLAYER_RADIUS);
  return Math.hypot(probe.x - x, probe.z - z) < 1e-3;
};

/** How far past the rail centre a probe stands: clear of the fence line and
 * of the crossing's own deck, so the two probes are genuinely on opposite
 * sides and genuinely on ordinary ground. */
const SIDE_STANDOFF = 8;

const gated = process.env['LGP_ONLY_PROVEN_BRIDGES'] === '1';
console.log(
  `\n=== seed ${PARK_SEED} (LGP_ONLY_PROVEN_BRIDGES=${gated ? '1' : 'unset'}) — ` +
    `${world.train.bridges.length} bridges, ${world.train.crossings.length} crossings`,
);

for (const crossing of world.train.crossings) {
  const bridged = world.train.bridges.some((b) => b.deckCovers(crossing.x, crossing.z));
  if (bridged) continue;

  const near: [number, number] = [
    crossing.x + crossing.pathDirX * SIDE_STANDOFF,
    crossing.z + crossing.pathDirZ * SIDE_STANDOFF,
  ];
  const far: [number, number] = [
    crossing.x - crossing.pathDirX * SIDE_STANDOFF,
    crossing.z - crossing.pathDirZ * SIDE_STANDOFF,
  ];

  const nearOk = standable(near[0], near[1]);
  const farOk = standable(far[0], far[1]);

  const count = navGrid.findRoute(
    near[0],
    near[1],
    park.sample(near[0], near[1], 0),
    far[0],
    far[1],
    park.sample(far[0], far[1], 0),
    park.sample,
    route,
  );
  const reached = count > 0 && navGrid.lastRouteReachedGoal;

  // **The walk is the start point plus what `NavGrid` returned**, sampled
  // ALONG its segments rather than at its corners. Two traps, both hit on
  // earlier runs of this script:
  //
  //  - `findRoute` returns a SIMPLIFIED polyline, so a clear straight walk
  //    comes back as a single point — the destination — with no corners at
  //    all. Measuring vertex distances then answered `Infinity` for exactly
  //    the crossings that work best, and reported them as detours.
  //  - the start is not included in the output, so the first (often only)
  //    segment — the one that actually goes over the rail — was invisible.
  const walk: (readonly [number, number])[] = [near];
  for (let i = 0; i < count; i += 1) {
    walk.push([route[i * 2] as number, route[i * 2 + 1] as number]);
  }
  let walked = 0;
  let closestToCrossing = Infinity;
  for (let i = 1; i < walk.length; i += 1) {
    const [px, pz] = walk[i - 1] as readonly [number, number];
    const [qx, qz] = walk[i] as readonly [number, number];
    const segment = Math.hypot(qx - px, qz - pz);
    walked += segment;
    const steps = Math.max(1, Math.ceil(segment / 0.5));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const d = Math.hypot(px + (qx - px) * t - crossing.x, pz + (qz - pz) * t - crossing.z);
      if (d < closestToCrossing) closestToCrossing = d;
    }
  }
  // Where the walk really ended: `findRoute` returns the nearest reachable
  // point when the goal is blocked, so `lastRouteReachedGoal` alone is not
  // enough — a walk that stops short is not a crossing she can use.
  const [endX, endZ] = walk[walk.length - 1] as readonly [number, number];
  const shortfall = Math.hypot(endX - far[0], endZ - far[1]);
  const direct = SIDE_STANDOFF * 2;
  const usesCrossing = closestToCrossing <= 6;

  const arrived = reached && shortfall <= 1.5;
  const verdict = !nearOk || !farOk
    ? 'A SIDE IS NOT STANDABLE'
    : !arrived
      ? `NOT REACHABLE — the walk stops ${shortfall.toFixed(1)} m short of the far side`
      : usesCrossing
        ? 'WALKABLE through the crossing'
        : `reachable only the long way round (${walked.toFixed(0)} m for a ${direct} m gap)`;

  console.log(
    `  crossing d=${crossing.railDistance.toFixed(1)} at (${crossing.x.toFixed(1)}, ${crossing.z.toFixed(1)}) ` +
      `proven=${crossing.provenBridgeSite} — ${verdict}` +
      (arrived ? `; walk ${walked.toFixed(0)} m, passes ${closestToCrossing.toFixed(1)} m from centre` : ''),
  );
}
