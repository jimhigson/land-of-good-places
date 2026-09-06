/**
 * **Which region of the park is each station's stand in, and does any proven
 * bridge site open into it?**
 *
 * The instrument behind the seed 267/288 finding. A path may only cross the
 * railway at a proven site, so a station whose stand sits in a region no site
 * opens into cannot be reached legally by any router, at any effort — and the
 * router then does the illegal thing, which is what `crossings.ts` throws about
 * three systems later.
 *
 * ## Read the controls before the answer
 *
 * A flood fill that measures the wrong thing gives a clean, decisive, wrong
 * answer — this repo has been caught by exactly that twice — so two control
 * legs run first and the script exits non-zero if either misbehaves: a fill
 * started on the rail centre line must be refused, and a fill from the park's
 * middle must reach a large region.
 *
 * **The third leg was wrong the first time it ran, and the controls are what
 * showed it.** Asked at `RAIL_CORRIDOR_CLEARANCE` (4.2 m — a *routing* rule),
 * every station stand on every seed came back "inside the corridor", including
 * on seeds that build perfectly: a station stand is deliberately about 2 m from
 * its own platform edge. The corridor clearance is what a *path* must keep off
 * the rail, not what a stand does. Hence `CLEAR`, which the caller sets to a
 * physical body width instead.
 *
 * ```
 * CLEAR=0.9 LGP_SEED=288 node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/probe-station-pockets.mts
 * ```
 *
 * A "sealed pocket" is **not** by itself a fault: a station on the far side of
 * the loop is in one on nearly every seed, and that is exactly what bridges are
 * for. The fault is a sealed pocket with **no site foot in it**.
 */
/**
 * Is a station's stand reachable from the park without crossing the railway?
 *
 * A flood fill on a fine grid of "not inside the rail corridor", started at the
 * park's ring, asking whether it arrives at each station stand. Three control
 * legs, run FIRST, because a flood fill that measures the wrong thing gives a
 * clean decisive wrong answer (CLAUDE.md).
 */
import { TRAIN_PLAN, RAIL_CORRIDOR_CLEARANCE } from '../src/world/train/plan.ts';
import { Vector3 } from 'three';

const route = TRAIN_PLAN.route;
const CLEAR = Number(process.env['CLEAR'] ?? RAIL_CORRIDOR_CLEARANCE);
const STEP = 0.5;
const EXTENT = 140;
const N = Math.ceil((EXTENT * 2) / STEP);
const p = new Vector3();

const railDist = (x: number, z: number): number => {
  route.pointAt(route.distanceNear(x, z), p);
  return Math.hypot(p.x - x, p.z - z);
};

const idx = (i: number, j: number) => i * N + j;
const toWorld = (i: number, j: number) => [-EXTENT + i * STEP, -EXTENT + j * STEP] as const;
const toCell = (x: number, z: number) =>
  [Math.round((x + EXTENT) / STEP), Math.round((z + EXTENT) / STEP)] as const;

// open = a player-sized body can stand here without being in the rail corridor
const open = new Uint8Array(N * N);
let openCells = 0;
for (let i = 0; i < N; i += 1)
  for (let j = 0; j < N; j += 1) {
    const [x, z] = toWorld(i, j);
    if (railDist(x, z) >= CLEAR) { open[idx(i, j)] = 1; openCells += 1; }
  }

function fillFrom(sx: number, sz: number): Uint8Array | null {
  const [si, sj] = toCell(sx, sz);
  if (si < 0 || sj < 0 || si >= N || sj >= N || !open[idx(si, sj)]) return null;
  const seen = new Uint8Array(N * N);
  const stack = [idx(si, sj)];
  seen[idx(si, sj)] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const i = Math.floor(c / N), j = c % N;
    for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nc = idx(ni, nj);
      if (seen[nc] || !open[nc]) continue;
      seen[nc] = 1; stack.push(nc);
    }
  }
  return seen;
}

const count = (a: Uint8Array) => a.reduce((n, v) => n + v, 0);
const seed = process.env['LGP_SEED'] ?? '(default)';
console.log(`seed ${seed}: grid ${N}x${N} at ${STEP} m, corridor clearance ${CLEAR}, ${openCells} open cells of ${N * N}`);
if (openCells === 0) { console.log('VOID: no open cells — the instrument is measuring nothing'); process.exit(2); }

// ---- CONTROL 1: a point deliberately ON the rail centre line must not fill.
route.pointAt(0, p);
const onRail = fillFrom(p.x, p.z);
console.log(`CONTROL 1 (start on the rail centre line): ${onRail === null ? 'refused, as it must' : `FILLED ${count(onRail)} cells -- INSTRUMENT IS WRONG`}`);
if (onRail !== null) process.exit(2);

// ---- CONTROL 2: the park's own middle must fill a large region.
const mid = fillFrom(0, 0) ?? fillFrom(2, 2);
console.log(`CONTROL 2 (start at the park centre): ${mid ? `${count(mid)} cells reached` : 'REFUSED -- INSTRUMENT IS WRONG'}`);
if (!mid || count(mid) < 100) process.exit(2);

// ---- Do the proven crossing sites open into each station's region?
const { CROSSING_SITES } = await import('../src/world/train/crossingPlan.ts');
// A site's two feet, derived here the way the router derives them: march out
// along the crossing direction until clear of the corridor. Approximate, but it
// only has to land in the right REGION, which is a much coarser question.
const siteFeet = (site: { x: number; z: number; dirX: number; dirZ: number }) => {
  const out: (readonly [number, number])[] = [];
  for (const sign of [1, -1] as const) {
    for (let r = 1; r <= 30; r += 0.5) {
      const fx = site.x + site.dirX * sign * r;
      const fz = site.z + site.dirZ * sign * r;
      if (railDist(fx, fz) >= CLEAR) { out.push([fx, fz] as const); break; }
    }
  }
  return out;
};

for (const s of TRAIN_PLAN.stations) {
  const [ci, cj] = toCell(s.standX, s.standZ);
  const inCorridor = !open[idx(ci, cj)];
  const region = fillFrom(s.standX, s.standZ);
  const size = region ? count(region) : 0;
  const sameAsMain = region ? region[idx(...toCell(0, 0))] === 1 : false;
  const feet: string[] = [];
  if (region) {
    for (const site of CROSSING_SITES) {
      for (const [label, pt] of siteFeet(site).map((q, k) => [k === 0 ? '+' : '-', q] as const)) {
        const [fi, fj] = toCell(pt[0], pt[1]);
        if (fi<0||fj<0||fi>=N||fj>=N) continue;
        if (region[idx(fi, fj)]) feet.push(`site railD ${site.railDistance.toFixed(0)} foot${label}`);
      }
    }
  }
  console.log(
    `station #${s.index} stand (${s.standX.toFixed(1)}, ${s.standZ.toFixed(1)}): ` +
      (inCorridor
        ? `blocked at clearance ${CLEAR}`
        : `region ${size} cells; connected to park centre: ${sameAsMain ? 'YES' : 'NO -- SEALED POCKET'}` +
          `; crossing-site feet landing in this region: ${feet.length ? feet.join(', ') : 'NONE'}`),
  );
}
