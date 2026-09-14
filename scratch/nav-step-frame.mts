/**
 * The nav lattice's step gate, measured in both frames, with controls.
 *
 * No park build: the only geometry involved is the planet, so this runs in
 * milliseconds and can be re-run by anyone.
 *
 * The claim under test, from the brief: `MAX_STEP` (0.62 m) is compared against
 * a world-`y` difference, and a world-`y` difference is not a height once the
 * ground leans. That is one wrong datum with two opposite symptoms —
 *
 *   - **level ground reads as a ledge** out where the lean is worst, so
 *     tap-to-move refuses to path outward at all; and
 *   - **a real ledge reads as level ground** further in, so a child is routed
 *     up something she cannot climb.
 *
 * Both should vanish when the step is asked as "how far does B rise above the
 * tangent plane at A", which is what a foot actually has to lift.
 */
import { GROUND_SPHERE_RADIUS } from '../src/core/constants.ts';
import { BUILDING_STEP_UP } from '../src/core/constants.ts';

const R = GROUND_SPHERE_RADIUS;
const CELL = 0.5;

/** The bare spherical cap — no waves, so every number here is reproducible. */
const capY = (d: number): number => Math.sqrt(R * R - d * d) - R;

/** Today's gate: a difference of world y. */
const flatStep = (ay: number, by: number): number => by - ay;

/** The honest one: B's rise above the tangent plane at the midpoint. */
const risePlanet = (
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number => {
  // Midpoint, in planet-centred coordinates (world y + R).
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2 + R;
  const mz = (az + bz) / 2;
  const r = Math.hypot(mx, my, mz);
  return ((bx - ax) * mx + (by - ay) * my + (bz - az) * mz) / r;
};

/** The same expression on a flat world — the instrument's own control. */
const riseFlat = (
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number => {
  const my = (ay + by) / 2 + 1e12;
  const r = Math.hypot(0, my, 0);
  return ((bx - ax) * 0 + (by - ay) * my + (bz - az) * 0) / r;
};

const line = (s: string): void => process.stderr.write(`${s}\n`);

line('');
line(`MAX_STEP = ${BUILDING_STEP_UP} m,  cell = ${CELL} m,  planet R = ${R} m`);
line('');

// ---------------------------------------------------------------------------
// Control on the instrument itself: on a flat world the two frames must agree
// exactly, for every case below. If they do not, nothing further is evidence.
// ---------------------------------------------------------------------------
let worstControl = 0;
for (const d of [0, 40, 80, 120, 157]) {
  for (const rise of [0, 0.7, -0.7]) {
    const a = [d, 0, 0] as const;
    const b = [d + CELL, rise, 0] as const;
    const diff = Math.abs(
      riseFlat(a[0], a[1], a[2], b[0], b[1], b[2]) - flatStep(a[1], b[1]),
    );
    worstControl = Math.max(worstControl, diff);
  }
}
line(
  `CONTROL  flat world, the two frames agree to ${worstControl.toExponential(2)} m ` +
    `— the expression is the same question, only the planet differs`,
);
line('');

// ---------------------------------------------------------------------------
// Symptom 1 — level ground read as a ledge.
// ---------------------------------------------------------------------------
line('LEVEL GROUND: one lattice step outward along the radius, on bare cap');
line('    d        lean     world-y step   true rise   old gate    new gate');
for (const d of [0, 40, 80, 120, 157, 180]) {
  const ay = capY(d);
  const by = capY(d + CELL);
  const old = flatStep(ay, by);
  const now = risePlanet(d, ay, 0, d + CELL, by, 0);
  const lean = (Math.asin(d / R) * 180) / Math.PI;
  line(
    `  ${d.toString().padStart(4)} m   ${lean.toFixed(1).padStart(5)}°   ` +
      `${old.toFixed(3).padStart(10)} m  ${now.toFixed(3).padStart(9)} m   ` +
      `${(Math.abs(old) > BUILDING_STEP_UP ? 'REFUSED' : 'ok     ').padStart(8)}   ` +
      `${Math.abs(now) > BUILDING_STEP_UP ? 'REFUSED' : 'ok'}`,
  );
}
line('');

// The diagonal is the worst case: sqrt(2) cells of chart, all of it radial.
line('LEVEL GROUND: the worst of the eight neighbours (radial diagonal)');
for (const d of [120, 157, 164.7, 180, 184.3]) {
  const step = CELL * Math.SQRT2;
  const ay = capY(d);
  const by = capY(d + step);
  const old = flatStep(ay, by);
  const now = risePlanet(d, ay, 0, d + step, by, 0);
  line(
    `  ${d.toString().padStart(6)} m   old ${old.toFixed(3).padStart(6)} m ` +
      `${Math.abs(old) > BUILDING_STEP_UP ? '(REFUSED)' : '(ok)     '}` +
      `   new ${now.toFixed(3).padStart(6)} m ` +
      `${Math.abs(now) > BUILDING_STEP_UP ? '(REFUSED)' : '(ok)'}`,
  );
}
line('');

// ---------------------------------------------------------------------------
// Symptom 2 — a real ledge read as level ground.
//
// A ledge of 0.70 m of *real height* means 0.70 m along the local up, not
// 0.70 m of world y. Building it as world y is wrong-but-clean instrument #1
// in HANDOFF-radial-collide.md; both lines are printed so the difference is
// visible rather than asserted.
// ---------------------------------------------------------------------------
line('A REAL 0.70 m LEDGE, stepping outward onto its top');
line('    d      as world y (wrong build)   as true height (right build)');
for (const d of [0, 20, 40, 60, 80, 120, 157]) {
  const ay = capY(d);
  const groundAhead = capY(d + CELL);
  // Right build: lift the far ground point by 0.70 m along ITS OWN local up.
  const rAhead = Math.hypot(d + CELL, groundAhead + R, 0);
  const scale = (rAhead + 0.7) / rAhead;
  const bx = (d + CELL) * scale;
  const by = (groundAhead + R) * scale - R;
  const oldGate = flatStep(ay, by);
  const newGate = risePlanet(d, ay, 0, bx, by, 0);
  line(
    `  ${d.toString().padStart(4)} m        old reads ${oldGate.toFixed(3)} m ` +
      `${Math.abs(oldGate) > BUILDING_STEP_UP ? '(refused)' : '(ADMITTED)'}` +
      `        new reads ${newGate.toFixed(3)} m ` +
      `${Math.abs(newGate) > BUILDING_STEP_UP ? '(refused)' : '(ADMITTED)'}`,
  );
}
line('');
