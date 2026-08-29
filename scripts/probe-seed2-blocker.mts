/**
 * **Who put a collider at seed 2's ramp foot?**
 *
 * Throwaway diagnostic for the one remaining failure on
 * `fix/paving-follows-drawn-stone`: seed 2's bridge at (-2.2, -47.0) is not
 * standable ~-14.2 m along its own centreline.
 *
 * The scene graph was already searched and came back empty (instanced scenery
 * has no node of its own), so this interrogates the **collision world**
 * instead: `CollisionWorld.addCircle`/`addWall` are wrapped before the park is
 * built so every registered collider remembers the stack that created it.
 * Probe the centreline, find which colliders actually overlap, print their
 * birth certificates.
 *
 * Run:
 *   node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/probe-seed2-blocker.mts
 */
process.env['LGP_SEED'] = '2';

interface Origin {
  readonly kind: 'circle' | 'wall';
  readonly stack: string;
}

const { CollisionWorld } = await import('../src/world/Collision.ts');

const origins = new Map<object, Origin>();

type Registrar = (...args: unknown[]) => unknown;
const proto = CollisionWorld.prototype as unknown as Record<string, Registrar>;
const realAddCircle = proto['addCircle'] as Registrar;
const realAddWall = proto['addWall'] as Registrar;

/** The interesting frames: whoever called into the collision world. */
function trace(): string {
  const raw = new Error().stack ?? '';
  return raw
    .split('\n')
    .slice(2)
    .filter((line) => !line.includes('node:internal') && !line.includes('probe-seed2-blocker'))
    .slice(0, 10)
    .map((line) => line.trim())
    .join('\n      ');
}

proto['addCircle'] = function (this: { circles: object[] }, ...args: unknown[]) {
  const before = this.circles.length;
  const result = realAddCircle.apply(this, args);
  const stack = trace();
  for (let i = before; i < this.circles.length; i++) {
    origins.set(this.circles[i] as object, { kind: 'circle', stack });
  }
  return result;
};

proto['addWall'] = function (this: { walls: object[] }, ...args: unknown[]) {
  const before = this.walls.length;
  const result = realAddWall.apply(this, args);
  const stack = trace();
  for (let i = before; i < this.walls.length; i++) {
    origins.set(this.walls[i] as object, { kind: 'wall', stack });
  }
  return result;
};

const { buildHeadlessPark } = await import('./park-harness.mts');
const { PARK_SEED } = await import('../src/world/parkManifest.ts');
if (PARK_SEED !== 2) throw new Error(`park built with seed ${PARK_SEED}, not 2`);

const { world } = buildHeadlessPark();
const { PLAYER_RADIUS } = await import('../src/core/constants.ts');
const { frameFor } = await import('../src/world/train/bridgeSpine.ts');
const { Vector3 } = await import('three');

const collision = world.collision as unknown as {
  circles: { x: number; z: number; radius: number; baseHeight: number; topHeight: number }[];
  walls: {
    x1: number;
    z1: number;
    x2: number;
    z2: number;
    halfThickness: number;
    baseHeight: number;
    topHeight: number;
  }[];
};

console.log(
  `seed ${PARK_SEED}: ${collision.circles.length} circles, ${collision.walls.length} walls registered, ` +
    `${origins.size} with a recorded origin`,
);

// --- the bridge under test --------------------------------------------------
const crossing = world.train.crossings.find(
  (c) => Math.hypot(c.x - -2.2, c.z - -47.0) < 1.5,
);
if (!crossing) throw new Error('no crossing near (-2.2, -47.0)');
const bridge = world.train.bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
if (!bridge) throw new Error('no bridge decks over that crossing');
console.log(`crossing at (${crossing.x.toFixed(2)}, ${crossing.z.toFixed(2)}), deckY ${bridge.deckY.toFixed(2)}`);

const frame = frameFor(crossing);

const heightAt = (x: number, z: number): number | null => {
  let best: number | null = null;
  for (const b of world.train.bridges) {
    if (!b.covers(x, z)) continue;
    const h = b.heightAt(x, z);
    if (h !== null && (best === null || h > best)) best = h;
  }
  return best;
};

// --- where are this bridge's parapets, in the frame the invariant walks? ----
// Every parapet segment registered from ParkTrain's guardRails loop, projected
// back onto `frameFor(crossing)` with shift 0 -- the very line the invariant's
// probe walks. The two sides' `across` values straddle the road centre, so
// their midpoint IS the bridge's lateral `shift`, measured off the built park
// rather than read out of the planner.
const parapets = collision.walls.filter((w) =>
  (origins.get(w)?.stack ?? '').includes('ParkTrain.ts:274'),
);
console.log(`\n${parapets.length} parapet segments registered across all bridges`);

// Which bridge owns each segment? `footprintNear` is the bridge's own answer
// about its real, final masonry edge -- so attribution comes off the built
// object, never off a re-derivation of the planner.
const bridgeIndex = new Map<unknown, number>();
world.train.bridges.forEach((b, i) => bridgeIndex.set(b, i));
const ours = bridgeIndex.get(bridge);
console.log(`this crossing's bridge is index ${ours} of ${world.train.bridges.length}`);
for (const [i, b] of world.train.bridges.entries()) {
  const c = world.train.crossings.find((cr) => b.deckCovers(cr.x, cr.z));
  console.log(
    `  bridge ${i}: deckY ${b.deckY.toFixed(2)}` +
      (c ? ` over crossing (${c.x.toFixed(2)}, ${c.z.toFixed(2)})` : ' (no crossing on its deck)'),
  );
}

const ownerOf = (mx: number, mz: number): string => {
  const owners: number[] = [];
  for (const [i, b] of world.train.bridges.entries()) {
    if (b.footprintNear(mx, mz, 0.5)) owners.push(i);
  }
  return owners.length ? owners.join('+') : '-';
};

// The neighbour, so authorship can be proved rather than inferred: a segment
// sitting at +-wallLine in ITS frame was built by it.
const other = world.train.crossings.find((c) => Math.hypot(c.x - 15.35, c.z - -35.74) < 1.5);
const otherFrame = other ? frameFor(other) : null;

console.log('\nparapet segments near this ramp, projected onto the walked centreline:');
console.log(' along   across   top   owner   (neighbour frame: along / across)');
const nearby: {
  along: number;
  across: number;
  top: number;
  owner: string;
  nAlong: number;
  nAcross: number;
}[] = [];
for (const w of parapets) {
  const mx = (w.x1 + w.x2) / 2;
  const mz = (w.z1 + w.z2) / 2;
  const { along, across } = frame.project(mx, mz, 0);
  if (along < -20 || along > 20) continue;
  if (Math.hypot(mx - 12.4, mz - -44.0) > 12) continue;
  const n = otherFrame ? otherFrame.project(mx, mz, 0) : { along: NaN, across: NaN };
  nearby.push({
    along,
    across,
    top: w.topHeight,
    owner: ownerOf(mx, mz),
    nAlong: n.along,
    nAcross: n.across,
  });
}
nearby.sort((a, b) => a.along - b.along || a.across - b.across);
for (const n of nearby) {
  console.log(
    `${n.along.toFixed(2).padStart(6)} ${n.across.toFixed(2).padStart(8)} ${n.top.toFixed(2).padStart(6)}` +
      `   ${n.owner.padEnd(4)}    ${n.nAlong.toFixed(2).padStart(7)} / ${n.nAcross.toFixed(2).padStart(6)}`,
  );
}

// --- walk the centreline, and name whatever pushes --------------------------
const probe = new Vector3();
const seen = new Set<string>();

console.log('\nalong   x       z       height  pushed  covers  blockers');
for (let along = -18; along <= -8; along += 0.25) {
  const p = frame.pointAt(along);
  const h = heightAt(p.x, p.z);
  const y = h ?? bridge.deckY;
  probe.set(p.x, y, p.z);
  world.collision.resolve(probe, PLAYER_RADIUS);
  const pushed = Math.hypot(probe.x - p.x, probe.z - p.z);

  // Which colliders is that circle actually inside, at this height?
  const hits: string[] = [];
  for (const c of collision.circles) {
    const gap = Math.hypot(p.x - c.x, p.z - c.z) - (PLAYER_RADIUS + c.radius);
    if (gap >= 0) continue;
    hits.push(
      `circle r=${c.radius.toFixed(2)} at (${c.x.toFixed(2)}, ${c.z.toFixed(2)}) ` +
        `base=${c.baseHeight.toFixed(2)} top=${c.topHeight.toFixed(2)} overlap=${(-gap).toFixed(2)}\n      ` +
        (origins.get(c)?.stack ?? '(no recorded origin)'),
    );
  }
  for (const w of collision.walls) {
    const abx = w.x2 - w.x1;
    const abz = w.z2 - w.z1;
    const lenSq = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - w.x1) * abx + (p.z - w.z1) * abz) / lenSq));
    const gap =
      Math.hypot(p.x - (w.x1 + abx * t), p.z - (w.z1 + abz * t)) - (PLAYER_RADIUS + w.halfThickness);
    if (gap >= 0) continue;
    hits.push(
      `wall half=${w.halfThickness.toFixed(2)} (${w.x1.toFixed(2)}, ${w.z1.toFixed(2)})->` +
        `(${w.x2.toFixed(2)}, ${w.z2.toFixed(2)}) base=${w.baseHeight.toFixed(2)} ` +
        `top=${w.topHeight.toFixed(2)} overlap=${(-gap).toFixed(2)}\n      ` +
        (origins.get(w)?.stack ?? '(no recorded origin)'),
    );
  }

  console.log(
    `${along.toFixed(2).padStart(6)} ${p.x.toFixed(2).padStart(7)} ${p.z.toFixed(2).padStart(7)} ` +
      `${(h === null ? 'none' : h.toFixed(2)).padStart(7)} ${pushed.toFixed(3).padStart(6)} ` +
      `${bridge.covers(p.x, p.z) ? 'yes' : ' no'}     ${hits.length}`,
  );
  for (const hit of hits) {
    if (seen.has(hit)) continue;
    seen.add(hit);
    console.log(`    ${hit}`);
  }
}
