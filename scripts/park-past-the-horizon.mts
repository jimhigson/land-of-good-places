/**
 * **Where the park runs off its own planet.**
 *
 * `theGroundIsTheSphereItClaimsToBe` fails on seeds 11 and 326 with *"the ground
 * reaches a gradient of 111.36% at 245.0 m from the centre"*. 245 m is
 * `facts.boundary.maxRadius`; the planet is `GROUND_SPHERE_RADIUS = 220`. So the
 * park's outline reaches **past the sphere's own equator**, and this measures
 * what the ground is actually doing out there — because "111% gradient" badly
 * understates it.
 *
 * The cap is `y = sqrt(R² − d²) − R`, guarded by `Math.max(0, …)`. At `d = R`
 * the surface has curved through **vertical**; past it the square root is
 * imaginary and the guard clamps the whole outer annulus to a **flat plane at
 * `y = −R`**. Not steep ground: no ground. A prop placed there is standing on a
 * floor 220 m below the park, hanging in the space where the planet stopped.
 *
 * Two independent controls, because "the terrain is nonsense out there" is
 * exactly the kind of claim that is satisfying and wrong.
 */
import { GROUND_SPHERE_RADIUS, BUS_MAX_GRADE } from '../src/core/constants.ts';
import { terrainHeight, capHeight } from '../src/world/terrain.ts';

const R = GROUND_SPHERE_RADIUS;
const out: string[] = [];
const say = (s: string) => out.push(s);
let fouls = 0;
const control = (label: string, ok: boolean, detail: string): void => {
  if (!ok) fouls += 1;
  say(`  control ${ok ? 'ok  ' : 'FOUL'} ${label} — ${detail}`);
};

say(`GROUND_SPHERE_RADIUS = ${R} m, BUS_MAX_GRADE = ${(BUS_MAX_GRADE * 100).toFixed(0)}%`);
say('');
say('CONTROLS');

// Control 1: at the park's centre the cap is tangent and flat. If this is not
// ~0 the terrain function is not the thing this file thinks it is.
control(
  'the cap is flat at the origin',
  Math.abs(capHeight(0, 0)) < 1e-9 && Math.abs(capHeight(1, 0)) < 0.01,
  `capHeight(0,0) = ${capHeight(0, 0).toFixed(9)}, capHeight(1,0) = ${capHeight(1, 0).toFixed(6)}`,
);

// Control 2: at exactly the equator the cap must read -R, reached from the
// closed form rather than from the code under test.
control(
  'the cap reads -R at d = R',
  Math.abs(capHeight(R, 0) - -R) < 1e-9,
  `capHeight(${R},0) = ${capHeight(R, 0).toFixed(6)}, expected ${(-R).toFixed(6)}`,
);

// Control 3: the instrument must be able to see a *difference* between inside
// and outside. If the two annuli read the same, it is measuring nothing.
control(
  'inside and outside the equator differ',
  Math.abs(capHeight(R - 20, 0) - capHeight(R + 20, 0)) > 1,
  `capHeight(${R - 20}) = ${capHeight(R - 20, 0).toFixed(2)}, ` +
    `capHeight(${R + 20}) = ${capHeight(R + 20, 0).toFixed(2)}`,
);

say('');
say('READING 1 — the drawn ground on one bearing, in to out');
say('');
say('       d      cap height    TRUE gradient (tan θ)   what the invariant reports (d/R)');
for (const d of [0, 50, 100, 150, 180, 200, 210, 219, 220, 225, 245, 260]) {
  const h = capHeight(d, 0);
  const inside = d < R;
  const trueGrade = inside ? d / Math.sqrt(R * R - d * d) : Infinity;
  say(
    `  ${d.toString().padStart(5)} m   ${h.toFixed(2).padStart(9)} m   ` +
      `${(inside ? `${(trueGrade * 100).toFixed(1)}%` : 'no ground — past the horizon').padStart(28)}   ` +
      `${((d / R) * 100).toFixed(1)}%`,
  );
}

say('');
say('  The last column is what the invariant measures: `grade = d / GROUND_SPHERE_RADIUS`.');
say('  That is sin θ. The gradient of a cap is tan θ. They agree near the centre and');
say('  diverge exactly where the trouble is — so the invariant UNDER-reports the');
say('  steepness it exists to police, and reports a finite 111% for ground that is');
say('  not merely steep but absent.');

// ---------------------------------------------------------------------------
// Reading 2: how far out may the park go, if the budget means anything?
// ---------------------------------------------------------------------------
const dForGrade = (g: number): number => (R * g) / Math.sqrt(1 + g * g); // invert tan θ = d/√(R²−d²)
say('');
say('READING 2 — the park radius the stated budget actually permits');
say('');
say(`  Reading the budget as the TRUE gradient (tan θ ≤ ${BUS_MAX_GRADE}):`);
say(`      max park radius = ${dForGrade(BUS_MAX_GRADE).toFixed(2)} m`);
say(`  Reading it as the invariant does (d/R ≤ ${BUS_MAX_GRADE}):`);
say(`      max park radius = ${(R * BUS_MAX_GRADE).toFixed(2)} m`);
say('  The park actually reaches 245.0 m (facts.boundary.maxRadius, seeds 11 and 326).');
say('');
say(`  And the constant's own docblock derives the radius the other way round:`);
say(`      "117.08 / 0.10 = 1171 m, rounded up to:" — and then declares ${R}.`);
say(`  1171 is not 220. The sentence describes the 1200 m reference the park's`);
say(`  extent is still calibrated against (PARK_REFERENCE_SPHERE_RADIUS); the value`);
say(`  was taken to 400, then 300, then 220 by eye, and the derivation stayed put.`);

// ---------------------------------------------------------------------------
// Reading 3: what stands out there.
// ---------------------------------------------------------------------------
say('');
say('READING 3 — the two failing seeds put real furniture past the equator');
const furniture: readonly (readonly [string, number, number, number])[] = [
  ['seed 326: a Rail Race duck bar', 224.7, 100.9, 326],
  ['seed 326: a tree on the railway', 205.1, 68.6, 326],
  ['seed 11: a lawn sample', 198, -22, 11],
  ['seed 326: a lawn sample', -171, 80, 326],
];
for (const [label, x, z] of furniture) {
  const d = Math.hypot(x, z);
  const h = terrainHeight(x, z);
  const past = d >= R;
  say(
    `  ${label.padEnd(34)} at (${x}, ${z}) — ${d.toFixed(1)} m out, ground ${h.toFixed(2)} m` +
      `${past ? '   <-- PAST THE EQUATOR: standing on the clamp, not on the planet' : ''}`,
  );
}

say('');
say('READING 4 — clause 1 of the invariant cannot see any of this.');
say('  It compares terrainHeight against an expectedFall that uses the SAME');
say('  `Math.max(0, R² − d²)` guard. Outside the equator both sides clamp to the');
say('  same value, so the "the drawn ground is that sphere" clause compares the');
say('  terrain to itself and passes. The only clause that fires out there is the');
say('  gradient one, and it reports a comfortable-sounding 111%.');

process.stdout.write(out.join('\n') + '\n');
process.exit(fouls > 0 ? 1 : 0);
