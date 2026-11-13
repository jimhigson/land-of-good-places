/**
 * **Where a built park puts things, as one hash** — the *placement* digest of a
 * checked-in park (`parks/manifest.json`'s `layout`; `docs/design/PREBUILT-PARKS.md`,
 * "Checked in").
 *
 * It exists so the same decisions cannot quietly become a different park: a
 * checked-in park file is never re-solved when the code changes, only hydrated
 * again, and `pnpm run validate:parks` requires the park the **current** code
 * hydrates from it to digest as it did when the line was stamped.
 *
 * ## What it covers
 *
 * - every claim in the built `World`'s ground-claims registry
 *   (`World.groundClaims`: the footprints, corridors, walkable ground and
 *   surfaces every feature holds), by feature, kind and shape;
 * - the park boundary the game built, sampled at {@link BOUNDARY_BEARINGS}
 *   bearings, and its area.
 *
 * Canonical: one line per claim, the lines sorted, numbers at
 * {@link DECIMALS} decimals — so neither commit order nor float noise below a
 * tenth of a millimetre can change it.
 *
 * ## What it deliberately does not cover — said on stderr by every validation
 *
 * **Meshes and colliders.** The whole-scene digest (`parkDigest.mts`) hashes
 * every vertex, so it changes on any art edit: measured on 13 Nov 2026, it took
 * four values on one Mac across eleven solves whose decisions were
 * byte-identical. Checked in, it would turn every render-only change red and
 * make every pair of such branches conflict. So an edit that reshapes a mesh
 * or a collider without moving a claim or the boundary does **not** move this
 * digest; what stands between such an edit and a broken park is the acceptance
 * measures, which `validate:parks` asks of the hydrated park on every run.
 *
 * And on a hydrated park most claims are the file's own, committed again by
 * the hydrating code — so the digest is chiefly a witness that the current
 * code still *reads the file into the same placements*, plus whatever the
 * `World`'s own builders claim.
 */
import { createHash } from 'node:crypto';

import type { GroundClaims } from '../../src/boot/groundClaims.ts';
import type { ParkBoundary } from '../../src/world/boundary.ts';

/** Decimals a coordinate is rounded to: 0.1 mm. */
const DECIMALS = 4;
/** Bearings the boundary is sampled at. */
const BOUNDARY_BEARINGS = 96;

export interface LayoutDigest {
  /** sha256 of the canonical lines, first 16 hex digits. */
  readonly layout: string;
  /** How many claims were digested — a digest over none is no digest. */
  readonly claims: number;
  readonly features: number;
}

const fixed = (value: number): string => {
  const text = value.toFixed(DECIMALS);
  return Number(text) === 0 ? (0).toFixed(DECIMALS) : text;
};

const canonical = (value: unknown): string => {
  if (typeof value === 'number') return fixed(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => `${key}:${canonical(inner)}`)
      .join(',')}}`;
  }
  return String(value);
};

/**
 * The placement digest of a built park. `edgeRadiusAt` is handed in rather
 * than imported: `boundary.ts` decides the park's boundary at import, and this
 * module must be importable before a park file has been offered.
 */
export function digestParkLayout(
  claims: GroundClaims,
  boundary: ParkBoundary,
  edgeRadiusAt: (boundary: ParkBoundary, bearing: number) => number,
): LayoutDigest {
  const lines: string[] = [];
  const features = [...claims.committedFeatures()].sort();
  for (const feature of features) {
    for (const claim of claims.claimsOf(feature)) lines.push(`${feature}|${claim.kind}|${canonical(claim.shape)}`);
  }
  const claimCount = lines.length;
  lines.sort();
  lines.push(`boundary|area|${fixed(boundary.area)}`);
  for (let i = 0; i < BOUNDARY_BEARINGS; i += 1) {
    lines.push(`boundary|${i}|${fixed(edgeRadiusAt(boundary, (i / BOUNDARY_BEARINGS) * Math.PI * 2))}`);
  }
  return {
    layout: createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16),
    claims: claimCount,
    features: features.length,
  };
}

/** {@link digestParkLayout} of the park this process built — the one both the probe and the attempt call. */
export async function digestBuiltPark(world: { readonly groundClaims: GroundClaims }): Promise<LayoutDigest> {
  const { PARK_BOUNDARY, edgeRadiusAt } = await import('../../src/world/boundary.ts');
  return digestParkLayout(world.groundClaims, PARK_BOUNDARY, edgeRadiusAt);
}
