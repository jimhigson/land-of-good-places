/**
 * **How much park is there?** — measured off the built boundary, at any
 * (sphere radius, reference radius) pair, so the question Jim asked can be
 * answered with numbers rather than with the constant that was set.
 *
 * Jim, 14 September 2026: *"the park now feels too big/sparse - I don't think
 * the area has been maintained from before, it has gotten bigger."*
 *
 * Two areas come out, and they are not the same number on a sphere:
 *
 * - **planar** — the (x, z) footprint, which is what `generateParkBoundary`
 *   targets and what `PARK_BOUNDARY.area` reports. This is the area the park
 *   was authored in, back when the ground was flat.
 * - **surface** — the area actually walked on the spherical cap. On a cap the
 *   metric stretches by `R / sqrt(R^2 - d^2)` at horizontal distance `d`, so
 *   the ground underfoot is always *more* than its footprint, and
 *   disproportionately so as the park's edge approaches the radius.
 *
 * **The instrument is controlled before it is believed.** `--control` proves
 * the parameterised chain below reproduces the real `PARK_BOUNDARY.area` that
 * the game itself builds, and proves the surface integrator returns the
 * closed-form cap area on a plain disc. Without that, a flood of confident
 * square metres means nothing — see CLAUDE.md, "a check can pass without
 * checking anything".
 */
import { generateParkBoundary } from '../src/world/boundary.ts';
import { PARK_AREA_MULTIPLIER } from '../src/world/boundary.ts';

/** The authored, unscaled numbers the derived constants are built from. */
const AUTHORED_PLAY_RADIUS = 58;
const AUTHORED_HALF_SIZE = 62;
const GATE_INSET = 2;
const GATE_BEARING = Math.PI / 2;

interface Measurement {
  readonly scale: number;
  readonly playRadius: number;
  readonly gateRadius: number;
  readonly targetArea: number;
  readonly planarArea: number;
  readonly surfaceArea: number;
  readonly maxRadius: number;
  readonly edgeDrop: number;
}

/**
 * The derivation chain out of `constants.ts`, with the scale as a parameter.
 *
 * Every line here mirrors one in the shipped code — `GARDEN_PLAY_RADIUS`,
 * `GARDEN_HALF_SIZE`, `ENTRANCE_WALL_RADIUS`, `CIRCULAR_PARK_AREA` and
 * `PARK_BOUNDARY` — and `--control` is what proves the mirror is faithful.
 */
export function measure(
  seed: number,
  scale: number,
  sphereRadius: number,
): Measurement {
  const playRadius = AUTHORED_PLAY_RADIUS * scale;
  const gateRadius = AUTHORED_HALF_SIZE * scale - GATE_INSET;
  const targetArea = Math.PI * playRadius * playRadius * PARK_AREA_MULTIPLIER;
  const boundary = generateParkBoundary({
    seed,
    targetArea,
    gateBearing: GATE_BEARING,
    gateRadius,
  });
  return {
    scale,
    playRadius,
    gateRadius,
    targetArea,
    planarArea: boundary.area,
    surfaceArea: surfaceAreaOf(boundary.outline(), sphereRadius),
    maxRadius: boundary.maxRadius,
    edgeDrop: capDrop(boundary.maxRadius, sphereRadius),
  };
}

/** How far the spherical cap has fallen at horizontal distance `d`. */
function capDrop(d: number, sphereRadius: number): number {
  const inside = sphereRadius * sphereRadius - d * d;
  if (inside <= 0) return Number.POSITIVE_INFINITY;
  return sphereRadius - Math.sqrt(inside);
}

/**
 * Area of the ground actually underfoot inside a closed (x, z) outline, on a
 * sphere of the given radius.
 *
 * Integrated on a regular lattice rather than analytically, because the outline
 * is a seeded wiggle with no closed form. The lattice is fine enough that
 * halving the step moves the answer by well under a tenth of a percent — the
 * `--control` run prints that convergence rather than asserting it blind.
 */
function surfaceAreaOf(
  outline: readonly (readonly [number, number])[],
  sphereRadius: number,
  step = 0.25,
): number {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const [x, z] of outline) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const cell = step * step;
  let total = 0;
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) {
      if (!pointInPolygon(x, z, outline)) continue;
      const d2 = x * x + z * z;
      const inside = sphereRadius * sphereRadius - d2;
      // Past the horizon there is no cap left; count the footprint and let the
      // caller's edge-drop number be the thing that screams.
      total += inside <= 0 ? cell : cell * (sphereRadius / Math.sqrt(inside));
    }
  }
  return total;
}

function pointInPolygon(
  x: number,
  z: number,
  polygon: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i] as readonly [number, number];
    const [xj, zj] = polygon[j] as readonly [number, number];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Closed-form area of a spherical cap out to horizontal radius `a`. */
export function capAreaClosedForm(a: number, sphereRadius: number): number {
  return 2 * Math.PI * sphereRadius * capDrop(a, sphereRadius);
}

// ------------------------------------------------------------------ control

async function control(): Promise<number> {
  let failures = 0;
  const say = (line: string): void => {
    process.stderr.write(`${line}\n`);
  };

  say('--- control: does the instrument measure what it claims? ---');

  // 1. The parameterised chain must reproduce the boundary the game builds.
  const [{ PARK_BOUNDARY }, constants, { PARK_SEED }] = await Promise.all([
    import('../src/world/boundary.ts'),
    import('../src/core/constants.ts'),
    import('../src/world/parkManifest.ts'),
  ]);
  const scale = constants.PARK_SURFACE_SCALE;
  const seed = PARK_SEED ?? 0;
  const mirrored = measure(seed as number, scale, constants.GROUND_SPHERE_RADIUS);

  const playDelta = Math.abs(mirrored.playRadius - constants.GARDEN_PLAY_RADIUS);
  if (playDelta > 1e-9) {
    say(`FAIL play radius: mirror ${mirrored.playRadius} vs real ${constants.GARDEN_PLAY_RADIUS}`);
    failures += 1;
  } else {
    say(`ok   play radius mirrors constants.ts exactly (${mirrored.playRadius.toFixed(3)} m)`);
  }

  const areaDelta = Math.abs(mirrored.planarArea - PARK_BOUNDARY.area);
  if (areaDelta > 1e-6) {
    say(
      `FAIL planar area: mirror ${mirrored.planarArea.toFixed(2)} vs the park the ` +
        `game actually built ${PARK_BOUNDARY.area.toFixed(2)} (seed ${seed})`,
    );
    failures += 1;
  } else {
    say(
      `ok   planar area mirrors the built PARK_BOUNDARY exactly ` +
        `(${mirrored.planarArea.toFixed(1)} m2, seed ${seed})`,
    );
  }

  // 2. The surface integrator must return the closed form on a shape that has
  //    one. A plain disc of radius 60 on a 220 m sphere.
  const discRadius = 60;
  const sphere = 220;
  const disc: (readonly [number, number])[] = [];
  for (let i = 0; i < 2048; i += 1) {
    const angle = (i / 2048) * Math.PI * 2;
    disc.push([Math.cos(angle) * discRadius, Math.sin(angle) * discRadius]);
  }
  const integrated = surfaceAreaOf(disc, sphere, 0.25);
  const closed = capAreaClosedForm(discRadius, sphere);
  const error = Math.abs(integrated - closed) / closed;
  if (error > 0.002) {
    say(`FAIL surface integrator: ${integrated.toFixed(0)} vs closed form ${closed.toFixed(0)} (${(error * 100).toFixed(3)}%)`);
    failures += 1;
  } else {
    say(
      `ok   surface integrator agrees with the closed-form cap to ` +
        `${(error * 100).toFixed(3)}% (${integrated.toFixed(0)} vs ${closed.toFixed(0)} m2)`,
    );
  }

  // 3. Convergence: halving the step must not move the answer materially.
  const fine = surfaceAreaOf(disc, sphere, 0.125);
  const drift = Math.abs(fine - integrated) / integrated;
  say(`ok   halving the lattice step moves the answer ${(drift * 100).toFixed(4)}%`);

  // 4. The instrument must be *able* to see a difference. A park at scale 1
  //    and a park at scale 2 must not report the same area.
  const one = measure(seed as number, 1, sphere);
  const two = measure(seed as number, 2, sphere);
  if (Math.abs(one.planarArea - two.planarArea) < 1) {
    say('FAIL the instrument reports the same area for a 1x and a 2x park — it is blind');
    failures += 1;
  } else {
    say(
      `ok   the instrument can tell parks apart: scale 1 = ${one.planarArea.toFixed(0)} m2, ` +
        `scale 2 = ${two.planarArea.toFixed(0)} m2`,
    );
  }

  say(failures === 0 ? '--- control passed ---\n' : `--- control FAILED (${failures}) ---\n`);
  return failures;
}

// --------------------------------------------------------------------- main

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const failures = await control();
  if (failures > 0) process.exit(1);
  if (args.includes('--control')) return;

  const constants = await import('../src/core/constants.ts');
  const sphere = constants.GROUND_SPHERE_RADIUS;
  const seedArg = args.find((a) => a.startsWith('--seed='));
  const seed = seedArg ? Number(seedArg.slice('--seed='.length)) : 0;

  console.log(`seed ${seed}, GROUND_SPHERE_RADIUS ${sphere} m\n`);
  console.log(
    'reference   scale   play r    gate r     planar m2    surface m2   max r   edge drop',
  );
  const references = [sphere, 300, 400, 600, 1200];
  for (const reference of references) {
    const scale = Math.sqrt(reference / sphere);
    try {
      const m = measure(seed, scale, sphere);
      console.log(
        `${String(reference).padStart(9)}  ${scale.toFixed(4)}  ` +
          `${m.playRadius.toFixed(1).padStart(6)}  ${m.gateRadius.toFixed(1).padStart(7)}  ` +
          `${m.planarArea.toFixed(0).padStart(11)}  ${m.surfaceArea.toFixed(0).padStart(11)}  ` +
          `${m.maxRadius.toFixed(1).padStart(6)}  ${m.edgeDrop.toFixed(1).padStart(8)}`,
      );
    } catch (error) {
      console.log(`${String(reference).padStart(9)}  ${scale.toFixed(4)}  threw: ${(error as Error).message.slice(0, 80)}`);
    }
  }
}

await main();
