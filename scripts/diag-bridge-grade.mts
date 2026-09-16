/**
 * **How steep is a bridge, to the child walking it?**
 *
 * Jim, 14 September 2026: *"whatever 'down' is in the mesh of the bridge needs
 * to be adjusted so that down is variable along the length of the bridge,
 * effectively it needs to be bent to cover the curvature of the earth."*
 *
 * This is the measurement that says whether that is done. It marches each
 * bridge's own drawn centreline, foot to foot, and reports the grade **twice**:
 *
 * - **world-y grade** — `Δy / Δ(plan distance)`, what every existing check in
 *   this repo measures. On a 220 m planet this is not a grade at all: it is the
 *   grade *plus the planet*, because the park's own dome falls away in world `y`
 *   at up to `tan(45.5°)` = 1.02 at the boundary. A perfectly flat lawn out
 *   there reads 1.02 against a budget of 0.512.
 * - **local grade** — the rise of the step along the **local up at its start**,
 *   over the part of it that lies in that point's own horizontal plane. In
 *   other words `((B−A)·up(A)) / |(B−A) − ((B−A)·up(A))·up(A)|`. That is the
 *   steepness a child's legs feel, and it is the number
 *   `SPRINT_LOCAL_GRADE_CEILING` is about (#636).
 *
 * **`altitude()` is NOT the local rise, and reaching for it is the trap this
 * instrument fell into first.** `geo/ground.ts`'s `altitude()` is height *above
 * the ground*, so a march along the ground itself has `Δaltitude = 0` at every
 * step — over a terrain wave as much as over flat grass. The first version of
 * this script measured exactly that and printed a decisive, clean `local 0.000`
 * for the park's own hillsides. Control 2 (below) is what caught it: it reads
 * 0.053 in world `y` at the park's centre, where the lean is nil and the two
 * measures are obliged to agree, and the local one said zero.
 *
 * ## The control runs first, and the run is void without it
 *
 * Two of this week's instruments read clean and decisively wrong, so nothing
 * printed below may be believed until these three lines agree:
 *
 * 1. **Flat-ground control, far out.** March ordinary park grass at a large
 *    radius — no bridge, no path, nothing built. The *world-y* grade there must
 *    be **large** (the dome), and the *local* grade must be **near zero**. If
 *    the local grade is large too, the local measure is not cancelling the
 *    planet and every bridge number here is noise.
 * 2. **Flat-ground control, at the origin.** The same march near the park's
 *    centre, where the lean is nil. **Both** measures must be near zero and
 *    must agree with each other — that is the sanity check that the local
 *    measure has not simply been zeroed by a bug.
 * 3. **A known slope.** March a synthetic ramp of a declared grade built in the
 *    local frame at a large radius, and assert the local measure recovers the
 *    grade it was built with. A measure that only ever says "flat" is the same
 *    disease as a check that cannot fail.
 *
 * Control 1 proves the two measures *disagree* where they should; control 2
 * proves they *agree* where they should; control 3 proves the local one can
 * report a real slope rather than only ever reporting zero. All three are
 * needed: the first two together still pass for a measure that returns a
 * constant zero.
 *
 * `LGP_SEED=<n> node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs
 * scripts/diag-bridge-grade.mts`, or with no seed for the canonical park. (Plain
 * `node scripts/diag-bridge-grade.mts` dies with `ERR_MODULE_NOT_FOUND` on the
 * extensionless imports — the resolver hook is required.) **There is no `sweep-bridge-grade.mts`** — this line
 * used to claim there was; loop `LGP_SEED` over `PARK_SEED_POOL` instead. The
 * assertion itself lives in `test/procgen/invariants.ts` now (#636), which runs
 * on every CI seed and carries these same four controls, so this script is a
 * per-seed magnifying glass rather than the gate.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';

const { buildHeadlessPark } = await import('./park-harness.mts');
const park = buildHeadlessPark();

const { SPRINT_LOCAL_GRADE_CEILING, PLAYER_LONGEST_STEP } = await import('../src/core/constants.ts');
const { terrainHeight } = await import('../src/world/terrain.ts');
const { computeCrossings } = await import('../src/world/train/crossings.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const { frameFor } = await import('../src/world/train/bridgeSpine.ts');
const { Geo } = await import('../src/world/geo/Geo.ts');
const { groundRadiusToward } = await import('../src/world/geo/ground.ts');

const seedLabel = process.env['LGP_SEED'] ?? 'canonical';

/**
 * Sampling step along the centreline. Deliberately a fraction of
 * {@link PLAYER_LONGEST_STEP} rather than a round survey number: a grade
 * sampled coarser than the stride she takes can straddle the steep stretch and
 * miss it, which is `invariants.ts`'s own lesson from #352.
 */
const STEP = PLAYER_LONGEST_STEP / 8;

interface Sample {
  readonly x: number;
  readonly z: number;
  /** World `y` of the walked surface. */
  readonly y: number;
  /** The same point as a position from the planet's centre. */
  readonly geo: InstanceType<typeof Geo>;
  /** The local up there — a world-space unit vector. */
  readonly up: Vector3;
}

const sampleAt = (x: number, z: number, y: number): Sample => {
  const geo = Geo.fromWorld(x, y, z);
  return { x, z, y, geo, up: geo.up(new Vector3()) };
};

interface Grades {
  /** Steepest `Δy / Δplan` over one stride anywhere on the run. */
  readonly world: number;
  /** Steepest local rise-over-local-run over one stride anywhere on the run. */
  readonly local: number;
  readonly samples: number;
}

const _step = /* @__PURE__ */ new Vector3();

/**
 * Peak grade over a sliding one-stride window, both ways. A window rather than
 * consecutive samples for the same reason the invariant scans one: the answer
 * must not depend on where the march happened to start.
 */
function gradesOf(run: readonly Sample[]): Grades {
  if (run.length < 2) return { world: 0, local: 0, samples: run.length };
  const strideSamples = Math.max(1, Math.round(PLAYER_LONGEST_STEP / STEP));
  let world = 0;
  let local = 0;
  for (let i = 0; i + strideSamples < run.length; i += 1) {
    const a = run[i] as Sample;
    const b = run[i + strideSamples] as Sample;
    const plan = Math.hypot(b.x - a.x, b.z - a.z);
    if (plan > 1e-6) world = Math.max(world, Math.abs(b.y - a.y) / plan);
    // Split the step into the part along `a`'s own up and the part in `a`'s own
    // horizontal plane. No `y` is subtracted anywhere, and no chart is assumed.
    _step.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const rise = _step.dot(a.up);
    const run2 = Math.sqrt(Math.max(0, _step.lengthSq() - rise * rise));
    if (run2 > 1e-6) local = Math.max(local, Math.abs(rise) / run2);
  }
  return { world, local, samples: run.length };
}

// ---------------------------------------------------------------------------
// Controls. Nothing below them is believable until all three agree.
// ---------------------------------------------------------------------------

const groundRun = (fromX: number, fromZ: number, dirX: number, dirZ: number, span: number): Sample[] => {
  const run: Sample[] = [];
  const len = Math.hypot(dirX, dirZ) || 1;
  for (let d = 0; d <= span + 1e-6; d += STEP) {
    const x = fromX + (dirX / len) * d;
    const z = fromZ + (dirZ / len) * d;
    run.push(sampleAt(x, z, terrainHeight(x, z)));
  }
  return run;
};

/**
 * A ramp of a declared local grade, built the way a bent bridge must be: a
 * height above the ground, added along the **local up** at each foot.
 *
 * **The rise is `grade × the distance walked along the ground`, accumulated
 * step by step — not `grade × plan distance`.** Those are different numbers out
 * here and the difference is the whole subject: the orthographic `(x, z)` chart
 * compresses radially by `cos θ`, so at r = 140 (θ = 39.5°) a 25 m plan march
 * is a 32 m walk. The first version of this control declared its grade against
 * plan distance and read back a uniform 0.774 of what it asked for, which is
 * `cos(39.5°)` exactly — the *control* was wrong, and the measure it was
 * doubting was right. Recorded here because a constant-ratio miss reads like a
 * broken instrument and is very often a broken expectation.
 */
const syntheticRamp = (fromX: number, fromZ: number, grade: number, span: number): Sample[] => {
  const run: Sample[] = [];
  const len = Math.hypot(fromX, fromZ) || 1;
  // March outward along the radius, which is the worst case for the lean.
  const dirX = fromX / len;
  const dirZ = fromZ / len;
  const world = new Vector3();
  const here = new Vector3();
  const previous = new Vector3();
  let walked = 0;
  for (let d = 0; d <= span + 1e-6; d += STEP) {
    const x = fromX + dirX * d;
    const z = fromZ + dirZ * d;
    const foot = Geo.fromWorld(x, terrainHeight(x, z), z);
    foot.toWorld(here);
    if (d > 0) walked += here.distanceTo(previous);
    previous.copy(here);
    // Raised along the **local up**, which is what setting the radius on the
    // foot's own bearing means.
    foot.setRadius(foot.radius() + grade * walked).toWorld(world);
    run.push(sampleAt(world.x, world.z, world.y));
  }
  return run;
};

const CONTROL_SPAN = 25;
let controlsPass = true;
const controlLine = (name: string, ok: boolean, detail: string): void => {
  if (!ok) controlsPass = false;
  process.stderr.write(`  ${ok ? 'ok  ' : 'FAIL'} ${name} — ${detail}\n`);
};

process.stderr.write(`\ndiag-bridge-grade — seed ${seedLabel}\n\ncontrols:\n`);

// Control 1 — flat grass, far out. World-y large, local near zero.
{
  const far = groundRun(140, 0, 1, 0, CONTROL_SPAN);
  const g = gradesOf(far);
  controlLine(
    'flat grass at r=140 disagrees as it must',
    g.world > 0.5 && g.local < 0.1,
    `world ${g.world.toFixed(3)} (want > 0.5, the dome), local ${g.local.toFixed(3)} (want < 0.1)`,
  );
}

// Control 2 — flat grass at the origin. Both near zero, and agreeing.
{
  const near = groundRun(-10, 0, 1, 0, CONTROL_SPAN);
  const g = gradesOf(near);
  controlLine(
    'flat grass at the park centre agrees as it must',
    g.world < 0.1 && g.local < 0.1 && Math.abs(g.world - g.local) < 0.05,
    `world ${g.world.toFixed(3)}, local ${g.local.toFixed(3)} (want both < 0.1 and within 0.05)`,
  );
}

// Control 3 — a declared slope, far out. The local measure must find it.
for (const want of [0.2, 0.5]) {
  const g = gradesOf(syntheticRamp(140, 0, want, CONTROL_SPAN));
  controlLine(
    `a ${want.toFixed(2)} local ramp at r=140 reads back`,
    Math.abs(g.local - want) < 0.05,
    `local ${g.local.toFixed(3)} (want ${want.toFixed(2)} ± 0.05), world ${g.world.toFixed(3)}`,
  );
}

if (!controlsPass) {
  process.stderr.write(
    '\nCONTROLS FAILED — every measurement below is VOID and must not be quoted.\n\n',
  );
}

// ---------------------------------------------------------------------------
// The measurement.
// ---------------------------------------------------------------------------

const crossings = computeCrossings(TRAIN_PLAN.route);
const bridges = park.world.train.bridges;

interface Row {
  readonly label: string;
  readonly r: number;
  readonly grades: Grades;
  readonly reachNeg: number;
  readonly reachPos: number;
}

const rows: Row[] = [];

for (const crossing of crossings) {
  const bridge = bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
  if (!bridge) continue;
  const frame = frameFor(crossing);

  const reachOf = (sign: 1 | -1): number => {
    let edge = 0;
    for (let d = 0; d <= 40; d += STEP) {
      const p = frame.pointAt(d * sign);
      if (!bridge.covers(p.x, p.z)) break;
      edge = d;
    }
    return edge;
  };
  const reachNeg = reachOf(-1);
  const reachPos = reachOf(1);
  if (reachNeg <= 0 && reachPos <= 0) continue;

  const run: Sample[] = [];
  for (let along = -reachNeg; along <= reachPos + 1e-6; along += STEP) {
    const p = frame.pointAt(along);
    const h = bridge.covers(p.x, p.z) ? bridge.heightAt(p.x, p.z) : terrainHeight(p.x, p.z);
    run.push(sampleAt(p.x, p.z, h));
  }

  rows.push({
    label: `railD ${crossing.railDistance.toFixed(1)} at (${crossing.x.toFixed(1)}, ${crossing.z.toFixed(1)})`,
    r: Math.hypot(crossing.x, crossing.z),
    grades: gradesOf(run),
    reachNeg,
    reachPos,
  });
}

// One owner for the ceiling: the same constant `test/procgen/invariants.ts`
// asserts against (#636). This script must never carry its own copy — a
// diagnostic that disagrees with the check it diagnoses is worse than none.
process.stderr.write(`\nceiling: SPRINT_LOCAL_GRADE_CEILING = ${SPRINT_LOCAL_GRADE_CEILING.toFixed(4)}\n`);
process.stderr.write(`bridges measured: ${rows.length} of ${crossings.length} crossings\n`);
if (rows.length === 0) {
  process.stderr.write('  (asserts nothing — this seed built no bridge this instrument could march)\n');
}
process.stderr.write(
  '\n  r      ramp-       ramp+   world grade   LOCAL grade   verdict   crossing\n',
);
let worstLocal = 0;
let overBudget = 0;
for (const row of rows.sort((a, b) => a.r - b.r)) {
  const over = row.grades.local > SPRINT_LOCAL_GRADE_CEILING;
  if (over) overBudget += 1;
  worstLocal = Math.max(worstLocal, row.grades.local);
  process.stderr.write(
    `  ${row.r.toFixed(1).padStart(5)}  ${row.reachNeg.toFixed(1).padStart(6)}  ` +
      `${row.reachPos.toFixed(1).padStart(6)}  ${row.grades.world.toFixed(3).padStart(11)}  ` +
      `${row.grades.local.toFixed(3).padStart(11)}   ${over ? 'OVER   ' : 'ok     '}  ${row.label}\n`,
  );
}
process.stderr.write(
  `\nworst local grade ${worstLocal.toFixed(3)} against ceiling ` +
    `${SPRINT_LOCAL_GRADE_CEILING.toFixed(3)} — ${overBudget} of ${rows.length} over\n`,
);
process.stderr.write(
  `planet: ground radius straight up = ${groundRadiusToward(new Vector3(0, 1, 0)).toFixed(2)} m\n\n`,
);

if (!controlsPass) process.exit(2);
process.exit(overBudget > 0 ? 1 : 0);
