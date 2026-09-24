import { TAU } from '../core/mathUtils';
/**
 * **The park boundary's profile rules** — how gentle an outline must be and how
 * gentleness is measured. A leaf module (it imports only the maths helpers) so
 * that the boundary's search in `procgen/` can use them without importing
 * `boundary.ts`, whose park is decided lazily.
 */
/**
 * How many bearings the boundary is sampled at.
 *
 * The curve is smooth and low-frequency by construction (see
 * {@link generateParkBoundary}), so this is about the accuracy of the *distance
 * query*, not about resolving detail: 512 segments round an ~80 m park is a
 * chord every ~1 m, well under the metre-scale clearances anything asks about.
 */
export const PROFILE_SAMPLES = 512;

/**
 * The sharpest the boundary may ever turn, in metres of curvature radius.
 *
 * Taken from the camera rather than from the generator: the fixed iso view
 * shows roughly 36 m of ground depth (ARCHITECTURE.md, "the park is a diorama
 * on a hilltop"), so an edge whose curvature radius is under half that turns
 * visibly inside a single screen and reads as a corner rather than as a gentle
 * park boundary. The generator does far better than this in practice — 30 m and
 * up on every test seed — and that headroom is the point: this is the floor
 * below which the shape is *wrong*, not the target it aims for.
 */
export const GENTLE_CURVATURE_RADIUS = 20;


/**
 * Smallest radius of curvature anywhere on a sampled polar profile.
 *
 * `kappa = (r^2 + 2 r'^2 - r r'') / (r^2 + r'^2)^1.5`, with the derivatives
 * taken by central difference on the samples — measured off the profile that
 * will actually be used, not from the harmonics it was built from, so it stays
 * true if the profile is ever produced some other way.
 */
export function minCurvatureRadius(radii: readonly number[]): number {
  const count = radii.length;
  const step = TAU / count;
  let smallest = Infinity;
  for (let i = 0; i < count; i += 1) {
    const previous = radii[(i - 1 + count) % count] as number;
    const r = radii[i] as number;
    const next = radii[(i + 1) % count] as number;
    const first = (next - previous) / (2 * step);
    const second = (next - 2 * r + previous) / (step * step);
    const numerator = r * r + 2 * first * first - r * second;
    if (Math.abs(numerator) < 1e-9) continue;
    const curvature = numerator / Math.pow(r * r + first * first, 1.5);
    const radius = Math.abs(1 / curvature);
    if (radius < smallest) smallest = radius;
  }
  return smallest;
}
