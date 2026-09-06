/**
 * **How tall a wall does the jump actually carry the player over?**
 *
 * This is where `Collision.ts`'s `MAX_AUTO_HOP_HEIGHT` and
 * `measuredHopCeiling()` come from. They are measurements, not algebra: run
 * this again if `JUMP_SPEED`, `GRAVITY`, `PLAYER_RADIUS`, `PLAYER_MAX_SPEED`,
 * `PLAYER_ACCELERATION`, `AUTO_HOP_LOOKAHEAD` or `JUMP_CLEARANCE_GRACE` moves —
 * `CollisionWorld.checkHoppableColliders` shouts at boot if the apex has moved
 * and nobody did.
 *
 * ```
 * node \
 *      --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/measure-hop-clearance.mts
 * ```
 *
 * It drives the **real** `CollisionWorld` — not a model of one — through
 * `scripts/playerSim.mts`, the single shared copy of `Player.update`'s
 * movement integration. (That copy used to live here; it moved out when
 * `measure-wall-tunnelling.mts` needed the same walking girl, because two
 * copies of an integration are two copies to keep faithful.)
 *
 * Three outcomes are distinguished, and the distinction is the whole point:
 * **clean** (flew the footprint untouched), **popped** (fell back inside the
 * footprint, the wall went solid under her and ejected her out the far side —
 * she gets across, but by glitch, and a route must never plan on one) and
 * **stuck** (never released at all: pinned against the face, landing and
 * auto-hopping forever). `MAX_AUTO_HOP_HEIGHT` is set from the *clean* column.
 */
import { circleBoundary } from '../src/world/boundary.ts';
import {
  CollisionWorld,
  MAX_AUTO_HOP_HEIGHT,
  MEASURED_HOP_APEX,
  measuredHopCeiling,
} from '../src/world/Collision.ts';
import { HOPPABLE_WALL_HALF_THICKNESSES, PLAYER_RADIUS } from '../src/core/constants.ts';
import { GRAVITY, JUMP_APEX_HEIGHT, JUMP_SPEED, SimPlayer } from './playerSim.mts';

interface Options {
  topHeight: number;
  halfThickness: number;
  dt: number;
  sprint: boolean;
  phase: number;
  approachAngle: number;
}

type Outcome = 'clean' | 'popped' | 'stuck';

/** Walks a simulated player at one long wall lying along x at z = 0. */
function attempt(o: Options): Outcome {
  const collision = new CollisionWorld();
  collision.setPlayBounds(circleBoundary(100000));
  collision.addWall(-5000, 0, 5000, 0, o.halfThickness, o.topHeight, true);

  const face = o.halfThickness + PLAYER_RADIUS;

  // `CollisionWorld.wouldAutoHopClear` deliberately is *not* used here. It
  // consults `autoHopClears`, i.e. the very ceiling this script exists to
  // measure, so asking it would only confirm the policy back to us. The probe
  // below is the same lookahead geometry with the policy removed: fire at the
  // wall whatever its height, and find out where the flight fails.
  const player = new SimPlayer(collision, { hopProbe: (probe) => Math.abs(probe.z) < face });
  player.position.set(0, 0, -6);

  const angle = (o.approachAngle * Math.PI) / 180;
  const dirX = Math.sin(angle);
  const dirZ = Math.cos(angle);

  /** Set if the wall ever pushed her while she was inside its footprint. */
  let shoved = false;

  let time = 0;
  let first = true;
  while (time < 20) {
    const dt = first ? o.dt * (1 - o.phase) : o.dt;
    first = false;
    time += dt;

    player.step(dt, dirX, dirZ, o.sprint);

    // Inside the footprint (not merely resting against the near face) and
    // still being pushed: the wall went solid under her mid-flight.
    if (player.corrected && player.position.z > -face + 1e-6) shoved = true;

    if (player.position.z > face + 0.05) return shoved ? 'popped' : 'clean';
  }
  return 'stuck';
}

/**
 * How finely {@link highest} resolves a threshold. It returns `lo`, the tallest
 * wall it *proved* flyable, so a measurement is a lower bound on the truth
 * understated by up to this much — which is why the assertions below compare
 * against it. Anything finer is quantisation, not the game: at half=0.15 the
 * fitted `measuredHopCeiling()` line sits 0.4 mm *above* the measurement —
 * both read 1.112 m to 3 dp — which is less than one bisection step, so a
 * strict `>` comparison there would fail on the grid the measurement is
 * quantised to rather than on anything about the jump.
 */
const BISECTION_RESOLUTION = 0.001;

/** Highest wall (to 1 mm) cleanly flown over under every timing phase swept. */
function highest(base: Omit<Options, 'topHeight' | 'phase'>, accept: Outcome[]): number {
  const phases = [0, 0.13, 0.29, 0.41, 0.57, 0.71, 0.89];
  const ok = (h: number): boolean =>
    phases.every((phase) => accept.includes(attempt({ ...base, topHeight: h, phase })));
  let lo = 0.05;
  let hi = 2.0;
  if (!ok(lo)) return NaN;
  if (ok(hi)) return hi;
  while (hi - lo > BISECTION_RESOLUTION) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

console.log(`JUMP_APEX_HEIGHT (algebraic) = ${JUMP_APEX_HEIGHT.toFixed(4)} m`);
console.log(`Collision.ts believes it was measured at ${MEASURED_HOP_APEX.toFixed(4)} m`);
console.log(`Collision.ts currently permits topHeight <= ${MAX_AUTO_HOP_HEIGHT.toFixed(2)} m`);
console.log('The "clean" column below is what that number must stay under.');

for (const dt of [1 / 30, 1 / 60, 1 / 90, 1 / 120, 1 / 144]) {
  let v = JUMP_SPEED;
  let y = 0;
  let peak = 0;
  for (let i = 0; i < 400; i += 1) {
    v -= GRAVITY * dt;
    y += v * dt;
    peak = Math.max(peak, y);
    if (y <= 0) break;
  }
  console.log(`  discrete apex at ${Math.round(1 / dt)} fps: ${peak.toFixed(4)} m`);
}

/**
 * The half-thicknesses the park actually gives a hoppable wall, straight from
 * their single owner. The headline "worst clean crossing" is the minimum over
 * exactly these.
 *
 * This used to be the literal window `halfThickness >= 0.2 && <= 0.4` applied
 * to the illustrative sweep below, which was wrong in two ways at once: it
 * never sampled 0.32 (the fountain rim) at all, so the headline *interpolated*
 * over one of the three real walls; and widening a hoppable wall past 0.4
 * would have dropped it silently out of the headline with nothing going red.
 */
const PARK_HALF_THICKNESSES: readonly number[] = HOPPABLE_WALL_HALF_THICKNESSES;

/**
 * Every thickness measured: the park's own, plus thinner and fatter ones that
 * bracket them, so the shape of the curve `measuredHopCeiling()` is fitted to
 * stays visible (and asserted against) either side of the walls we build.
 */
const SWEPT_HALF_THICKNESSES = [
  ...new Set([...[0.15, 0.22, 0.28, 0.34, 0.45, 0.6], ...PARK_HALF_THICKNESSES]),
].sort((a, b) => a - b);

console.log(
  `Park's hoppable wall half-thicknesses: ${PARK_HALF_THICKNESSES.map((h) => h.toFixed(2)).join(', ')} m`,
);
console.log('\nhalf   fps  gait    angle   clean   clean-or-pop');

interface Row {
  halfThickness: number;
  dt: number;
  sprint: boolean;
  approachAngle: number;
  clean: number;
  either: number;
}

const rows: Row[] = [];
let worstClean = Infinity;
for (const halfThickness of SWEPT_HALF_THICKNESSES) {
  for (const dt of [1 / 20, 1 / 30, 1 / 60, 1 / 90, 1 / 120]) {
    for (const sprint of [false, true]) {
      for (const approachAngle of [0, 20, 40]) {
        const base = { halfThickness, dt, sprint, approachAngle };
        const clean = highest(base, ['clean']);
        const either = highest(base, ['clean', 'popped']);
        rows.push({ halfThickness, dt, sprint, approachAngle, clean, either });
        if (PARK_HALF_THICKNESSES.some((h) => Math.abs(h - halfThickness) < 1e-9)) {
          worstClean = Math.min(worstClean, clean);
        }
        console.log(
          `${halfThickness.toFixed(2)}  ${String(Math.round(1 / dt)).padStart(3)}  ` +
            `${sprint ? 'sprint' : 'walk  '}  ${String(approachAngle).padStart(3)}     ` +
            `${clean.toFixed(3)}   ${either.toFixed(3)}`,
        );
      }
    }
  }
}
console.log(`\nWorst clean crossing over the park's own wall thicknesses: ${worstClean.toFixed(3)} m`);

/**
 * Everything above is a measurement; everything below is the part that can
 * fail. Until #539 this script printed the numbers and exited 0 whatever they
 * said, which made it a 1-second no-op sitting in the *required* chain: retune
 * `JUMP_SPEED`, thicken a wall, or refit the ceiling line, and the numbers
 * `Collision.ts` hard-codes would quietly become fiction while this printed a
 * fresh table and went green.
 *
 * Every threshold below is taken from the game, never from what this sweep
 * happens to produce today.
 */
const problems: string[] = [];
const describe = (r: Row): string =>
  `half=${r.halfThickness.toFixed(2)} ${Math.round(1 / r.dt)}fps ` +
  `${r.sprint ? 'sprint' : 'walk'} angle=${r.approachAngle}`;

// 1. A cell that failed to measure. `highest()` returns NaN when even a 0.05 m
//    kerb is not cleanly flown, and `Math.min(worstClean, NaN)` is NaN — so a
//    wholly broken sim used to reach the summary line as a quiet `NaN` rather
//    than as a failure.
for (const r of rows) {
  if (!Number.isFinite(r.clean)) problems.push(`${describe(r)}: clean is ${r.clean}, not a number`);
  if (!Number.isFinite(r.either))
    problems.push(`${describe(r)}: clean-or-pop is ${r.either}, not a number`);
}
if (!Number.isFinite(worstClean)) {
  problems.push(`the worst clean crossing came out ${worstClean}, so nothing below was measured`);
}

// 2. The measurement `Collision.ts` believes it was given must still be the one
//    this jump produces. Tolerance is the game's own: `checkHoppableColliders`
//    compares against MEASURED_HOP_APEX with exactly this 0.001 m at boot.
const APEX_TOLERANCE = 0.001;
if (Math.abs(JUMP_APEX_HEIGHT - MEASURED_HOP_APEX) > APEX_TOLERANCE) {
  problems.push(
    `the jump apex is now ${JUMP_APEX_HEIGHT.toFixed(4)} m but Collision.ts's ` +
      `MEASURED_HOP_APEX says ${MEASURED_HOP_APEX.toFixed(4)} m ` +
      `(difference ${Math.abs(JUMP_APEX_HEIGHT - MEASURED_HOP_APEX).toFixed(4)} m > ` +
      `${APEX_TOLERANCE} m) — MAX_AUTO_HOP_HEIGHT and measuredHopCeiling() are stale`,
  );
}

// 3. `measuredHopCeiling()` documents itself as "a straight line fitted
//    *underneath* every measured point ... a lower bound on the truth
//    everywhere, not a best fit through it". That was a comment, and it is the
//    correctness precondition of the boot check: `checkHoppableColliders` uses
//    the line to demote a collider too fat for the flat ceiling, so if the line
//    ever rises *above* the truth it waves through a wall that stranded her.
//    Non-strict, deliberately: on the park as measured the line touches the
//    measurement exactly at half=0.15 (1.112 vs 1.112), and touching is still
//    underneath. A safety margin here would be a number invented to look
//    prudent.
for (const r of rows) {
  if (!Number.isFinite(r.clean)) continue;
  const crossing = 2 * (r.halfThickness + PLAYER_RADIUS);
  const ceiling = measuredHopCeiling(crossing);
  if (ceiling - r.clean > BISECTION_RESOLUTION) {
    problems.push(
      `${describe(r)}: measuredHopCeiling(${crossing.toFixed(2)} m) promises ` +
        `${ceiling.toFixed(3)} m but the flight only cleanly carried her over ` +
        `${r.clean.toFixed(3)} m — the fitted line is above the measurement by ` +
        `${(ceiling - r.clean).toFixed(3)} m, so it is no longer a lower bound`,
    );
  }
}

// 4. The flat ceiling the router plans on must sit under the worst wall the
//    flight actually clears cleanly, across the thicknesses the park builds.
//    "Cleanly" is the whole point: a *popped* crossing gets her over by the
//    wall going solid underneath her and ejecting her out the far side, and a
//    route must never plan on a glitch.
if (Number.isFinite(worstClean) && MAX_AUTO_HOP_HEIGHT > worstClean) {
  problems.push(
    `MAX_AUTO_HOP_HEIGHT is ${MAX_AUTO_HOP_HEIGHT.toFixed(3)} m but the worst clean crossing ` +
      `over the park's wall thicknesses is ${worstClean.toFixed(3)} m — the router plans hops ` +
      `by ${(MAX_AUTO_HOP_HEIGHT - worstClean).toFixed(3)} m more than the jump delivers, ` +
      `so a child is stranded against a wall it calls hoppable`,
  );
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) with the auto-hop ceiling:\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nThese numbers are load-bearing: MAX_AUTO_HOP_HEIGHT and measuredHopCeiling() in ' +
      'src/world/Collision.ts are measurements taken from this script, and NavGrid routes ' +
      'children over walls on their word.',
  );
  process.exitCode = 1;
} else {
  const tightest = Math.min(
    ...rows.map((r) => r.clean - measuredHopCeiling(2 * (r.halfThickness + PLAYER_RADIUS))),
  );
  console.log(
    `\nOK, and what that covers:\n` +
      `  - all ${rows.length} points measured a real number (none NaN)\n` +
      `  - the jump apex ${JUMP_APEX_HEIGHT.toFixed(4)} m still matches MEASURED_HOP_APEX ` +
      `to within ${APEX_TOLERANCE} m\n` +
      `  - measuredHopCeiling() is a lower bound at every point; tightest margin ` +
      `${(tightest * 1000).toFixed(1)} mm, against a ${BISECTION_RESOLUTION * 1000} mm ` +
      `measurement resolution (it touches the measurement exactly at half=0.15)\n` +
      `  - MAX_AUTO_HOP_HEIGHT ${MAX_AUTO_HOP_HEIGHT.toFixed(2)} m sits under the worst clean ` +
      `crossing ${worstClean.toFixed(3)} m by ${((worstClean - MAX_AUTO_HOP_HEIGHT) * 1000).toFixed(1)} mm\n` +
      `  - NOT covered: whether the park's actual colliders obey these numbers — that is ` +
      `check:park, via CollisionWorld.checkHoppableColliders`,
  );
}
