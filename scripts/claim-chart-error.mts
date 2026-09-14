/**
 * **What the ground-claims registry's flat arithmetic costs on a 220 m planet.**
 *
 * `boot/groundClaims.ts` measures every distance with `Math.hypot` over world
 * `(x, z)`. That is not a neutral choice of units: `terrain.ts` puts the ground
 * for world `(x, z)` at `y = sqrt(R² - x² - z²) - R`, so **world `(x, z)` is an
 * orthographic projection of the planet** — the shadow the sphere casts on the
 * plane tangent at the park's origin. Its radial axis compresses by `cos θ`
 * while its tangential axis is exact, so `Math.hypot` under-reads how far apart
 * two things really are, by a factor that depends on where they are and which
 * way round they lie.
 *
 * This instrument prints that factor rather than asserting anything, so the
 * decision about what a claim should *be* rests on measured numbers.
 *
 * **Every reading is paired with a control** that must come out at a value
 * known in advance from a different route, because a projection error is
 * exactly the kind of thing that produces clean, decisive, wrong numbers.
 */
import { GROUND_SPHERE_RADIUS } from '../src/core/constants.ts';

const R = GROUND_SPHERE_RADIUS;

/** The ground point for a world `(x, z)`, as a planet-centred vector on the cap. */
const capPoint = (x: number, z: number): [number, number, number] => {
  const d2 = x * x + z * z;
  if (d2 > R * R) throw new Error(`(${x}, ${z}) is past the horizon on R = ${R}`);
  return [x, Math.sqrt(R * R - d2), z];
};

/** The true distance along the ground between two world `(x, z)` points. */
const arc = (ax: number, az: number, bx: number, bz: number): number => {
  const a = capPoint(ax, az);
  const b = capPoint(bx, bz);
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (R * R);
  return R * Math.acos(Math.min(1, Math.max(-1, dot)));
};

const flat = (ax: number, az: number, bx: number, bz: number): number =>
  Math.hypot(ax - bx, az - bz);

const lines: string[] = [];
const say = (s: string) => lines.push(s);
let controlFouls = 0;
const control = (label: string, got: number, want: number, tol: number): void => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) controlFouls += 1;
  say(
    `  control ${ok ? 'ok  ' : 'FOUL'} ${label}: got ${got.toFixed(6)}, ` +
      `expected ${want.toFixed(6)} (tol ${tol})`,
  );
};

say(`planet radius R = ${R} m`);
say('');

// ---------------------------------------------------------------------------
// Controls first. Each is a number reachable by a second, independent route.
// ---------------------------------------------------------------------------
say('CONTROLS — these must hold before any reading below means anything');

// 1. At the park's origin a tiny pair must agree to many decimals, because the
//    cap is tangent there. If this fouls, `arc` and `flat` are not comparable
//    quantities at all and every difference printed below is an artefact.
//
//    **This control caught its own first draft.** It was written expecting
//    exactly 1.000000 and it FOULED at 1.000003 — and the code was right and
//    the expectation was wrong. A pair running from the origin OUT to 1 m is
//    not "at the origin": it spans a lean of 0 to 0.26°, and the radial stretch
//    already applies across it. The exact answer is `R·asin(1/R)`, which is what
//    this now asks for, and the naive `1` is kept beside it as the thing that
//    would have been reported as agreement.
control('1 m out from the origin: arc == R·asin(1/R)', arc(0, 0, 1, 0), R * Math.asin(1 / R), 1e-12);
say(`    (the naive expectation of exactly 1 m is out by ${((arc(0, 0, 1, 0) - 1) * 1000).toFixed(4)} mm — small, and not zero)`);

// 1b. A pair that genuinely straddles the origin symmetrically, so the stretch
//     cancels to first order, and a tangential pair AT the origin, which has no
//     radial component at all. These are the two that really must read flat.
//     This one fouled on its SECOND draft too, at 4 nm tolerance against a flat
//     1 m — because straddling the origin cancels the stretch only to FIRST
//     order. The residual is the cubic term of the arcsine, 0.86 µm, which is
//     200x the tolerance a careless hand writes. Exact form, again:
control(
  'a 1 m pair straddling the origin: arc == 2R·asin(1/2R)',
  arc(-0.5, 0, 0.5, 0),
  2 * R * Math.asin(1 / (2 * R)),
  1e-12,
);
say(
  `    (straddling cancels the stretch only to first order — the residual is ` +
    `${((arc(-0.5, 0, 0.5, 0) - 1) * 1e6).toFixed(3)} µm, not zero)`,
);
control('a 1 m tangential step at the origin: arc == flat', arc(0, 0, 0, 1), R * Math.asin(1 / R), 1e-12);

// 2. A purely RADIAL pair out at distance d must stretch by exactly the ratio
//    of the two arcsines — a closed form that shares no code with `arc`.
{
  const d1 = 100;
  const d2 = 101;
  const want = R * (Math.asin(d2 / R) - Math.asin(d1 / R));
  control('radial pair at 100 m == R·Δasin', arc(d1, 0, d2, 0), want, 1e-9);
}

// 3. A purely TANGENTIAL pair — two points the same distance d from the
//    origin — lies on a circle of Euclidean radius d that is a SMALL circle on
//    the sphere. Its great-circle separation has its own closed form via the
//    chord, again sharing no code with `arc`.
{
  const d = 100;
  const phi = 0.2;
  const ax = d;
  const az = 0;
  const bx = d * Math.cos(phi);
  const bz = d * Math.sin(phi);
  // Chord length in 3-space: the two points have identical height, so the
  // chord is the flat chord, and arc = 2R·asin(chord / 2R).
  const chord = Math.hypot(ax - bx, az - bz);
  control(
    'tangential pair at 100 m == 2R·asin(chord/2R)',
    arc(ax, az, bx, bz),
    2 * R * Math.asin(chord / (2 * R)),
    1e-9,
  );
}

// 4. The instrument must be CAPABLE of reporting a large error. A pair straddling
//    the park's whole width should be out by metres, not millimetres. If this
//    came out near zero the comparison would be measuring nothing.
{
  const got = arc(-150, 0, 150, 0) - flat(-150, 0, 150, 0);
  control('a 300 m radial span is out by more than 30 m', got > 30 ? 1 : 0, 1, 0);
  say(`    (that span: flat ${flat(-150, 0, 150, 0).toFixed(2)} m, arc ${arc(-150, 0, 150, 0).toFixed(2)} m)`);
}

say('');
if (controlFouls > 0) {
  say(`${controlFouls} control(s) FOULED — readings below are not to be trusted.`);
}

// ---------------------------------------------------------------------------
// Reading 1: how far a claim thinks things are, against how far they are.
// ---------------------------------------------------------------------------
say('READING 1 — a 1 m separation, as the registry measures it vs as a child walks it');
say('');
say('    d from    lean     radial pair          tangential pair');
say('    origin             flat -> arc          flat -> arc');
for (const d of [0, 25, 50, 75, 100, 125, 150, 157, 175, 200]) {
  if (d >= R) break;
  const theta = Math.asin(d / R);
  const radial = arc(d, 0, d + 1, 0);
  const tphi = 1 / d;
  const tang = d === 0 ? 1 : arc(d, 0, d * Math.cos(tphi), d * Math.sin(tphi));
  const tangFlat = d === 0 ? 1 : flat(d, 0, d * Math.cos(tphi), d * Math.sin(tphi));
  say(
    `    ${d.toString().padStart(4)} m   ${((theta * 180) / Math.PI).toFixed(1).padStart(5)}°   ` +
      `1.000 -> ${radial.toFixed(4)} (x${radial.toFixed(4)})   ` +
      `${tangFlat.toFixed(3)} -> ${tang.toFixed(4)}`,
  );
}

say('');
say('  The radial column is the one that matters. It is 1/cos θ exactly, so the');
say('  registry under-reads radial separation by cos θ — and every overlap test,');
say('  every demand-serving test and every clearance in the park is that number.');

// ---------------------------------------------------------------------------
// Reading 2: a demand disc. The failure this actually causes.
// ---------------------------------------------------------------------------
say('');
say('READING 2 — a demand of radius r is served when a corridor END lands in it.');
say('  How much real ground does a flat disc of radius r cover, out at distance d?');
say('  (radially: the disc reaches r/cos θ metres of walking outward, r inward is');
say('   the same by symmetry of the chart — so the served region is an ELLIPSE');
say('   on the ground, stretched along the radial axis.)');
say('');
say('    d from origin   r = 2 m disc really reaches (radially, along the ground)');
for (const d of [0, 50, 100, 142.8, 157, 175]) {
  const r = 2;
  const outward = arc(d, 0, Math.min(d + r, R - 1e-6), 0);
  say(`    ${d.toFixed(1).padStart(6)} m        ${outward.toFixed(3)} m   (asked for ${r.toFixed(3)} m)`);
}

// ---------------------------------------------------------------------------
// Reading 3: the flat-chart budget from Chart.ts, restated for a claim.
// ---------------------------------------------------------------------------
say('');
say('READING 3 — where a claim could legitimately be treated as flat.');
say('  A flat patch on R = 220 departs from the sphere by 5 cm at 4.69 m radius.');
say('  So a claim SHAPE (a bench disc, a 2 m capsule) is flat-safe; the CHART the');
say('  claims all share is not, because the park spans hundreds of metres.');
say('  The fix is therefore not "make claims curved shapes" but "measure the');
say('  distance BETWEEN claims on the sphere". A claim stays a disc or a capsule;');
say('  what changes is that its centre is a bearing, not an (x, z) pair, and the');
say('  distance between two of them is an arc.');

process.stdout.write(lines.join('\n') + '\n');
process.exit(controlFouls > 0 ? 1 : 0);
