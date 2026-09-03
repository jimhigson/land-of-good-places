/**
 * **A child can walk in through the front gate. On every park she can be given.**
 *
 * ```
 * pnpm run check:gateway            # every seed in PARK_SEED_POOL
 * pnpm run check:gateway -- --map   # and print the standability map per seed
 * ```
 *
 * Issue #481. The gate is the one fixed thing in the park — `ENTRANCE_GATE_X/Z`
 * never move — and everything else is drawn afresh from the seed. So the park's
 * front door is precisely the place where "two definitions of one thing" bites:
 * whatever the generators lay down has to keep off it, and until #481 the
 * railway had never been told it existed. Measured on `main` at `bd818210`, the
 * lineside fence ran across the opening 2.3 m inside the arch on **pool seed
 * 288** — one child in sixteen — and through the arch itself on sweep seed 18.
 *
 * ## Why this is a script over the pool, not only an invariant
 *
 * `test/procgen` keeps files for the canonical seed and four sweep seeds. 288
 * is in none of them, and a sweep seed is not a park anybody is given. The
 * sixteen in `parkSeedPool.ts` are the parks a child can actually draw, so they
 * are what this asks — the same reasoning `check:coplanar` gives for fanning
 * out over the pool, and the same mechanism (one child process per seed,
 * because `parkManifest.ts` reads `LGP_SEED` once, at import).
 *
 * ## What it asserts: she can walk in, not that the forecourt is empty
 *
 * The assertion is a **connected route** at `PLAYER_RADIUS` from just inside
 * the arch to `ENTRANCE_WALK_DEPTH` inside it, staying within the arch's own
 * width. Deliberately not "every square metre of the forecourt is clear": the
 * park legitimately stands a lamp, a bollard and the welcome sign on that
 * ground, and measured across the sixteen pool seeds every single one has
 * something in that box. A check that fails on all sixteen is not describing
 * the defect it was written for. Walking in is the thing a child does; that is
 * what is measured.
 *
 * **Never probe the gate line itself.** The soft boundary holds a child
 * *inside* the park, so a `PLAYER_RADIUS` body standing on `z = 60` overlaps
 * the outside and comes back blocked whatever the gate is doing — 33 of 33
 * probes across the line on the canonical seed. A clause probing there cannot
 * fail. The route therefore starts at {@link GATE_PROBE_INSET}, the first inset
 * at which a player-sized body is honestly inside the park.
 *
 * ## The controls, without which the route means nothing
 *
 * A flood fill is the exact instrument CLAUDE.md warns about — two agents got
 * clean, decisive, entirely wrong answers from one, and only a control caught
 * it. So, asserted on every seed, not merely printed:
 *
 * - **The gate posts are solid**, one metre inside each jamb. A collision world
 *   that had registered nothing at all would otherwise flood straight through
 *   and report a lovely wide doorway.
 * - **Ground genuinely outside the park is not standable** — taken past
 *   `PARK_BOUNDARY`'s own edge radius at a bearing well off the gate, because
 *   the outline bulges past 90 m a few degrees either side of it and a point
 *   picked by eye is not reliably outside anything.
 * - **The corridor is not all open.** The fraction of it that is blocked is
 *   printed on every run: if that ever reads 0 on every seed, the probe has
 *   stopped seeing the park rather than the park having become clear.
 */
import './headless-canvas.mjs';
import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { promisify } from 'node:util';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import {
  ENTRANCE_GATE_HALF_WIDTH,
  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
  ENTRANCE_WALK_DEPTH,
  entranceGateFrame,
  isInEntranceGateOpening,
} from '../src/world/entrance/layout.ts';
import { GATE_PROBE_INSET, GATE_PROBE_STEP, measureGatewayWalk } from '../src/world/entrance/gatewayWalk.ts';
import { edgeRadiusAt, PARK_BOUNDARY } from '../src/world/boundary.ts';
import { BOUNDARY_WALL_COLLISION_HALF } from '../src/world/Garden.ts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';

const printMap = process.argv.includes('--map');
/** Set on the child processes this script spawns, one per seed. */
const isChild = process.env['LGP_GATEWAY_CHILD'] === '1';

interface Foul {
  readonly seed: number;
  readonly what: string;
}

function measureThisSeed(): { fouls: Foul[]; open: number; total: number; map: string[]; masonrySegments: number } {
  const park = quietly(() => buildHeadlessPark());
  const collision = park.world.collision;
  const probe = new Vector3();
  const standable = (x: number, z: number): boolean => {
    probe.set(x, 0, z);
    collision.resolve(probe, PLAYER_RADIUS);
    return Math.hypot(probe.x - x, probe.z - z) < 1e-3;
  };

  const fouls: Foul[] = [];
  const foul = (what: string): void => fouls.push({ seed: PARK_SEED, what });

  // The registered colliders, so the masonry clause below can ask about the
  // segments the wall actually built rather than about where a body ends up.
  //
  // **This reaches through `unknown` into a private field, and the count below
  // is what makes that safe.** `CollisionWorld.walls` is private; nothing stops
  // it being renamed, and if it is, this cast yields `undefined`, the loop runs
  // zero times, and the clause reports a clear doorway with stone standing in
  // it — proved, not supposed: with the masonry fix reverted *and* the field
  // renamed, `tsc` is happy and this said `all 16 seed(s) open at the front
  // door` while counting that very stone in its own corridor map. The matched
  // count and its foul at zero are the control for exactly that.
  const inner = collision as unknown as {
    walls?: { x1: number; z1: number; x2: number; z2: number; halfThickness: number }[];
  };

  // The walk runs inward along the gate's own radial; across it is the
  // perpendicular. Derived from the gate rather than assumed to be the x axis,
  // so this still measures the doorway if the entrance is ever moved.
  const length = Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z) || 1;
  const inX = -ENTRANCE_GATE_X / length;
  const inZ = -ENTRANCE_GATE_Z / length;
  const acrossX = -inZ;
  const acrossZ = inX;
  const at = (inset: number, across: number): [number, number] => [
    ENTRANCE_GATE_X + inX * inset + acrossX * across,
    ENTRANCE_GATE_Z + inZ * inset + acrossZ * across,
  ];

  // --- the assertion: a route from the arch into the park ------------------
  // `measureGatewayWalk` is the one owner of this question — the procgen
  // invariant asks it too, of the sweep seeds this script never sees.
  const walk = measureGatewayWalk(standable);
  if (walk.standableCells === 0) {
    foul(`nowhere to stand ${GATE_PROBE_INSET} m inside the arch — the doorway is shut on its threshold`);
  } else if (!walk.open) {
    foul(
      `the walk in from the arch stops ${walk.reachedDepth.toFixed(1)} m inside it — ` +
        `nothing connects that to the ${ENTRANCE_WALK_DEPTH} m mark within the arch's own ` +
        `${(2 * ENTRANCE_GATE_HALF_WIDTH).toFixed(1)} m width`,
    );
  }

  // --- the second assertion: no masonry stands in the opening --------------
  //
  // **Walkability alone cannot see this, which is why it is here.** The clause
  // above asks whether a child can get *through*; a wall reaching a metre into
  // an 8.6 m doorway leaves her a way past and passes it. Measured on `main`,
  // boundary masonry overlapped a player-sized body inside the arch on **nine
  // of the sixteen pool seeds** — 0.87 m on 451, 0.76 m on 128, and 0.05 m on
  // the canonical seed — and every one of them walked in fine.
  //
  // So this asks the thing the fix actually changed: does any boundary
  // collision segment come inside the aperture at all? It is stated over the
  // **whole segment**, not its midpoint, because the midpoint was the bug —
  // a 2 m chord whose middle clears the gap still reaches a metre into it.
  //
  // Reverting `Garden.ts` to the midpoint-only test turns this red on nine
  // seeds. Nothing else on this branch does, and a silent revert of the
  // headline fix on a `--ours` rebase is exactly what CLAUDE.md's rebase
  // section exists to stop.
  let masonryMatched = 0;
  for (const wall of inner.walls ?? []) {
    if (wall.halfThickness !== BOUNDARY_WALL_COLLISION_HALF) continue;
    masonryMatched += 1;
    // Closest approach of the segment to the gate, sampled along it: the
    // aperture test is cheap and a wall is at most a couple of metres long.
    const steps = 8;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = wall.x1 + (wall.x2 - wall.x1) * t;
      const z = wall.z1 + (wall.z2 - wall.z1) * t;
      if (!isInEntranceGateOpening(x, z, wall.halfThickness)) continue;
      const { across, along } = entranceGateFrame(x, z);
      foul(
        `boundary masonry reaches into the gateway at (${x.toFixed(2)}, ${z.toFixed(2)}) — ` +
          `${Math.abs(across).toFixed(2)} m off the axis of an opening that is ` +
          `${ENTRANCE_GATE_HALF_WIDTH} m wide either side, ${along.toFixed(2)} m along the way in. ` +
          `Segment (${wall.x1.toFixed(2)}, ${wall.z1.toFixed(2)}) -> ` +
          `(${wall.x2.toFixed(2)}, ${wall.z2.toFixed(2)}), halfThickness ${wall.halfThickness}`,
      );
      break;
    }
  }

  // **The control for the clause above, and it is not optional.** A boundary
  // wall is hundreds of segments on every park in the pool, so matching none of
  // them means the cast found nothing — a renamed field, a changed
  // `halfThickness`, a wall that stopped registering — and the clause was about
  // to report a clear doorway without having looked at any stone.
  if (masonryMatched === 0) {
    foul(
      'CONTROL: the masonry clause matched 0 boundary wall segments. Every park in the ' +
        `pool builds hundreds at halfThickness ${BOUNDARY_WALL_COLLISION_HALF}, so this is ` +
        "not a park without a wall — it is this clause reading nothing (CollisionWorld's " +
        'private `walls` field renamed, most likely) and passing because it can no longer fail',
    );
  }
  // --- control 1: the posts are solid --------------------------------------
  // A collision world that had registered nothing at all would flood straight
  // through the grid above and report a lovely wide doorway. These say the
  // probe can see solid ground when there is some, one metre inside each jamb
  // where the arch's own feet stand.
  for (const side of [-1, 1] as const) {
    const [x, z] = at(1, side * ENTRANCE_GATE_HALF_WIDTH);
    if (standable(x, z)) {
      foul(
        `CONTROL: the gate post at (${x.toFixed(2)}, ${z.toFixed(2)}) is not solid — ` +
          'this probe is measuring nothing, so the route above proves nothing either',
      );
    }
  }

  // --- control 2: outside the park is not standable ------------------------
  // The other end of the same question, and it has to ask `PARK_BOUNDARY`
  // where outside *is*: the outline bulges past 90 m a few degrees either side
  // of the gate (#115), so a point picked by eye at 30 m across and 6 m out is
  // comfortably inside the park on half the pool. It was, and this control
  // duly "failed" on six seeds that were perfectly fine.
  const bearing = Math.atan2(ENTRANCE_GATE_Z, ENTRANCE_GATE_X) + 1.2;
  const outsideRadius = edgeRadiusAt(PARK_BOUNDARY, bearing) + 5;
  const outsideX = Math.cos(bearing) * outsideRadius;
  const outsideZ = Math.sin(bearing) * outsideRadius;
  if (standable(outsideX, outsideZ)) {
    foul(
      `CONTROL: (${outsideX.toFixed(2)}, ${outsideZ.toFixed(2)}) is ${outsideRadius.toFixed(1)} m out ` +
        `on bearing ${bearing.toFixed(2)}, 5 m past the park's own edge, and reads standable — ` +
        'the boundary is not in this collision world',
    );
  }

  return {
    fouls,
    open: walk.standableCells,
    total: walk.cells,
    map: walk.map,
    masonrySegments: masonryMatched,
  };
}

// ---------------------------------------------------------------- the child

if (isChild) {
  const { fouls, open, total, map, masonrySegments } = measureThisSeed();
  process.stdout.write(
    `${JSON.stringify({ seed: PARK_SEED, fouls, open, total, map, masonrySegments })}\n`,
  );
  process.exit(0);
}

// ------------------------------------------------------------- across the pool

/**
 * **Every park a child can actually be given**, plus whatever seed this process
 * resolved to — asking `parkSeedPool.ts` rather than listing seeds here, so a
 * seventeenth vetted seed is covered on the day somebody adds it.
 */
const seeds = [...new Set([PARK_SEED, ...PARK_SEED_POOL])].sort((a, b) => a - b);

interface SeedResult {
  readonly seed: number;
  readonly fouls: Foul[];
  readonly open: number;
  readonly total: number;
  readonly map: string[];
  readonly masonrySegments: number;
}

const results: SeedResult[] = [];
{
  const { fouls, open, total, map, masonrySegments } = measureThisSeed();
  results.push({ seed: PARK_SEED, fouls, open, total, map, masonrySegments });
}

const lanes = Math.max(2, Math.min(6, cpus().length));
const queue = seeds.filter((seed) => seed !== PARK_SEED);
const run = promisify(execFile);
await Promise.all(
  Array.from({ length: lanes }, async () => {
    for (let seed = queue.pop(); seed !== undefined; seed = queue.pop()) {
      const { stdout } = await run(
        process.execPath,
        ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', 'scripts/check-gateway.mts'],
        {
          env: { ...process.env, LGP_SEED: String(seed), LGP_GATEWAY_CHILD: '1' },
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      results.push(JSON.parse(stdout.trim().split('\n').at(-1) as string) as SeedResult);
    }
  }),
);

results.sort((a, b) => a.seed - b.seed);

console.log(
  `check:gateway: the walk in from the arch, ${GATE_PROBE_INSET} to ${ENTRANCE_WALK_DEPTH} m inside, ` +
    `${(2 * ENTRANCE_GATE_HALF_WIDTH).toFixed(2)} m across, ` +
    `probed at PLAYER_RADIUS (${PLAYER_RADIUS}) every ${GATE_PROBE_STEP} m — ${results.length} seed(s)\n`,
);

let failed = 0;
let everBlocked = 0;
for (const result of results) {
  const verdict = result.fouls.length === 0 ? 'PASS' : 'FAIL';
  everBlocked += result.total - result.open;
  console.log(
    `  seed ${String(result.seed).padStart(8)}: ${result.total - result.open}/${result.total} of the ` +
      `corridor blocked, controls ${
        result.fouls.some((f) => f.what.startsWith('CONTROL')) ? 'FAILED' : 'held'
      } — ${verdict}`,
  );
  if (result.fouls.length) {
    failed += 1;
    // A failing seed always prints its map, whether or not --map was asked
    // for: "blocked at (0.00, 58.50)" is a coordinate, and the map is what
    // says whether that is one stone or the whole doorway.
    for (const row of result.map) console.log(row);
    for (const f of result.fouls.slice(0, 12)) console.log(`    ${f.what}`);
    if (result.fouls.length > 12) console.log(`    ... and ${result.fouls.length - 12} more`);
  } else if (printMap) {
    for (const row of result.map) console.log(row);
  }
}

/**
 * **What this check does not cover**, said on every run rather than only when
 * it fails — a green line that implies cover it does not give is how the next
 * agent inherits a false belief.
 *
 * On `process.stderr` deliberately: this is a script rather than a Vitest
 * case, so `console.log` would in fact be seen — but the note belongs with the
 * verdict on the same stream a failure uses, and writing it the same way the
 * invariants do keeps one habit rather than two.
 */
process.stderr.write(
  `check:gateway covers the ground from the arch to ${ENTRANCE_WALK_DEPTH} m inside it, and nothing else:\n` +
    `  - it does not prove she can reach the plaza. Past ${ENTRANCE_WALK_DEPTH} m the railway may\n` +
    '    legitimately ring the park, and the walk crosses it at a level crossing or a bridge;\n' +
    "    whether that walk connects is `check:park`'s routing invariant, not this.\n" +
    '  - it is a standability map at PLAYER_RADIUS, not a swept walk. A gap she cannot step\n' +
    `    into at ${GATE_PROBE_STEP} m a probe she might still tunnel through at PLAYER_LONGEST_STEP.\n` +
    '  - it says nothing about headroom under the arch, or about the arch being drawn at all.\n' +
    `  - only the ${seeds.length} seed(s) in PARK_SEED_POOL are asked. A park from any other\n` +
    '    seed is unmeasured here.\n' +
    `  - the masonry clause measured ${results.reduce((n, r) => n + r.masonrySegments, 0)} boundary ` +
    `wall segment(s) across the pool, ${Math.min(...results.map((r) => r.masonrySegments))} on the\n` +
    '    thinnest seed. It reaches a private field through a cast, so that count IS the coverage:\n' +
    '    at zero it has stopped seeing the wall and says so rather than passing.\n',
);

// The third control, and the one that would catch this probe quietly ceasing
// to see the park at all: a corridor nothing ever blocks, on any of sixteen
// different parks, is a corridor being measured somewhere the park is not.
if (everBlocked === 0) {
  console.error(
    '\ncheck:gateway: not one cell of the corridor was blocked on any seed. The gate posts ' +
      'stand in it on every park, so this probe is not measuring the park.',
  );
  process.exit(1);
}

if (failed) {
  // **Two different fouls, named separately.** They used to share one summary
  // line reading "N of 16 seed(s) cannot be walked into", which was wrong for
  // the masonry clause in the most misleading direction available: on every
  // seed it fires, a child walks in perfectly well — the complaint is that she
  // is squeezing past stone standing in an 8.6 m doorway. Reporting that as
  // "cannot be walked into" sends the next reader looking for a sealed gate.
  const shut = results.filter((r) =>
    r.fouls.some((f) => !f.what.startsWith('CONTROL') && !f.what.startsWith('boundary masonry')),
  ).length;
  const encroached = results.filter((r) =>
    r.fouls.some((f) => f.what.startsWith('boundary masonry')),
  ).length;
  const controls = results.filter((r) => r.fouls.some((f) => f.what.startsWith('CONTROL'))).length;
  if (shut) console.error(`\ncheck:gateway: ${shut} of ${results.length} seed(s) cannot be walked into.`);
  if (encroached) {
    console.error(
      `check:gateway: ${encroached} of ${results.length} seed(s) have masonry standing inside the ` +
        'arch\'s opening — walkable, and still stone in the doorway.',
    );
  }
  if (controls) {
    console.error(
      `check:gateway: ${controls} of ${results.length} seed(s) failed a CONTROL — the probe is ` +
        'not measuring the park, so nothing above it means anything.',
    );
  }
  process.exit(1);
}
console.log(
  `\ncheck:gateway: all ${results.length} seed(s) open at the front door ` +
    `(${everBlocked} corridor cells blocked across the pool, so the probe can see solid ground).`,
);
