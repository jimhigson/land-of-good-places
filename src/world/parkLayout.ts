import { Rng, TAU } from '../core/mathUtils';
import {
  GATE_CORRIDOR_HALF_WIDTH,
  PARK_MANIFEST,
  PARK_SEED,
  PLOT_EXTENT_LIMIT,
  type ManifestEntry,
} from './parkManifest';
import type { AnchorFootprint } from './anchors';

/**
 * The layout solver — L1 of Decision 5.
 *
 * Takes the manifest and the canonical seed; produces a placed park. Runs
 * once at module load (pure arithmetic, no three.js), so every consumer —
 * `anchors.ts`, `paths.ts`, the stalls, the fountain, the map — imports a
 * plain solved object exactly as they used to import authored constants.
 *
 * **Placement is largest-first rejection sampling.** Each entry draws seeded
 * candidates in its band until one satisfies every constraint; largest-first
 * makes packing reliable (small stalls slot around big plots, never the
 * reverse). The draw sequence is fixed by the seed and the manifest order,
 * so the same inputs always build the same park — a save's positions stay
 * meaningful until PARK_SEED or the manifest deliberately changes.
 *
 * Constraints, all of which fail the *build* loudly rather than degrade:
 *  - plots stay inside {@link PLOT_EXTENT_LIMIT} (keeps the outer rail band
 *    and treeline clear by construction — see the manifest's note);
 *  - plots keep {@link CORRIDOR_GAP} of walkable ground between bounding
 *    circles, so a path can always be routed between neighbours;
 *  - nothing blocks the gate corridor: the entrance is the one pinned thing
 *    in the park, and a child must always be able to walk straight in;
 *  - `near` relations hold (the ball pit stays within the slide's reach of
 *    the building).
 */

export interface PlacedEntry {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly footprint: AnchorFootprint;
  readonly boundingRadius: number;
  /**
   * Where a visitor arrives: on the plot's edge, facing the plaza. Path
   * spurs end here, signs stand here, NPC waypoints seed here.
   */
  readonly entranceX: number;
  readonly entranceZ: number;
  /**
   * Sign yaw. Always near +45° — the one angle the fixed camera can read
   * (ARCHITECTURE.md, "One camera angle, forever") — with a little seeded
   * variation so a row of signs does not read as billboards.
   */
  readonly signYaw: number;
}

export interface ParkLayout {
  readonly seed: number;
  readonly fountain: { readonly x: number; readonly z: number; readonly radius: number };
  readonly entries: ReadonlyMap<string, PlacedEntry>;
}

/** Walkable clearance kept between any two plots' bounding circles. */
const CORRIDOR_GAP = 5;

/** Candidate draws per entry before this whole-park attempt is abandoned.
 * 3000, not 400: with per-entry streams a restart is one greedy arrangement,
 * and the difference between "unsolvable in 240 restarts" and "solved at
 * 101" was giving a squeezed entry enough draws to find its sliver. */
const MAX_TRIES = 3000;

/**
 * Whole-park restarts. Greedy placement can paint itself into a corner — an
 * unlucky big-plot arrangement leaves no sliver for a later relation — and
 * the cheap, deterministic cure is to re-roll the whole arrangement: the rng
 * stream continues, so restarts are as seeded as everything else.
 */
const PARK_RESTARTS = 240;

/** The gate sits on the boundary wall; the corridor runs from it to centre. */
const GATE_ANGLE = Math.PI / 2; // matches entrance/layout.ts ENTRANCE_ANGLE
const GATE_RADIUS = 60; //         matches ENTRANCE_WALL_RADIUS

function inGateCorridor(x: number, z: number, clearance: number): boolean {
  // The corridor is the short axis-aligned strip inside the gate (which sits
  // at bearing GATE_ANGLE, i.e. +Z on the boundary wall). Only the strip
  // itself must stay clear — from its mouth the approach *path* winds to
  // wherever the plaza was placed, around whatever stands in between, and
  // `check:park`'s routing invariant proves that walk exists.
  const gateX = Math.cos(GATE_ANGLE) * GATE_RADIUS;
  const corridorHalf = GATE_CORRIDOR_HALF_WIDTH + clearance;
  return Math.abs(x - gateX) < corridorHalf && z > 25;
}

/**
 * How far a plot's edge lies from its centre along a direction.
 *
 * Exported for `paths.ts`'s `spur()`, which needs the same answer to keep a
 * spur's "past the doormat" extension from overshooting into the plot it is
 * approaching — see the fix note there.
 */
export function edgeDistanceAlong(footprint: AnchorFootprint, dirX: number, dirZ: number): number {
  // How far the plot's edge lies from its centre along (dirX, dirZ).
  if (footprint.kind === 'circle') return footprint.radius;
  const ax = Math.abs(dirX);
  const az = Math.abs(dirZ);
  // Distance to the rectangle's boundary along the direction, in the plot's
  // own (unrotated) frame — plots are axis-aligned, as they always were.
  const tx = ax > 1e-6 ? footprint.halfX / ax : Infinity;
  const tz = az > 1e-6 ? footprint.halfZ / az : Infinity;
  return Math.min(tx, tz);
}

function solve(): ParkLayout {
  const rng = new Rng(PARK_SEED);
  for (let restart = 0; restart < PARK_RESTARTS; restart += 1) {
    const built = buildOnce(rng);
    if (built) return built;
  }
  throw new Error(
    `park layout: unsolvable in ${PARK_RESTARTS} restarts (seed ${PARK_SEED}) — ` +
      `loosen bands, shrink the manifest, or bump the seed`,
  );
}

function buildOnce(rng: Rng): ParkLayout | null {
  const placed: PlacedEntry[] = [];
  const byId = new Map<string, PlacedEntry>();

  // Largest first: the manifest is sorted here rather than trusting file
  // order, so adding an entry never changes packing feasibility by accident.
  // Ties (and everything after them) keep manifest order, which is what
  // pins the draw sequence to the seed.
  const order: ManifestEntry[] = [...PARK_MANIFEST].sort(
    (a, b) => (a.solveOrder ?? 50) - (b.solveOrder ?? 50) || b.boundingRadius - a.boundingRadius,
  );

  for (const entry of order) {
    const near = entry.near ? byId.get(entry.near.id) : undefined;
    if (entry.near && !near) {
      throw new Error(
        `park layout: '${entry.id}' is near '${entry.near.id}', which is not placed yet — ` +
          `the near target must have the larger boundingRadius (it places first)`,
      );
    }

    let x = 0;
    let z = 0;
    let ok = false;

    for (let attempt = 0; attempt < MAX_TRIES && !ok; attempt += 1) {
      if (entry.pin) {
        [x, z] = entry.pin;
      } else if (near && entry.near) {
        // Draw around the relation target, then check the band too.
        const angle = rng.range(0, TAU);
        const distance = rng.range(entry.near.min, entry.near.max);
        x = near.x + Math.cos(angle) * distance;
        z = near.z + Math.sin(angle) * distance;
      } else {
        // Area-uniform draw inside the band annulus.
        const angle = rng.range(0, TAU);
        const r2min = entry.band.min * entry.band.min;
        const r2max = entry.band.max * entry.band.max;
        const radius = Math.sqrt(rng.range(r2min, r2max));
        x = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
      }

      const centreDistance = Math.hypot(x, z);
      ok =
        centreDistance + entry.boundingRadius <= PLOT_EXTENT_LIMIT &&
        centreDistance >= entry.band.min - 1e-6 &&
        centreDistance <= entry.band.max + 1e-6 &&
        !inGateCorridor(x, z, entry.boundingRadius) &&
        placed.every((other) => {
          // The near-target pair is deliberately close; its manifest min is
          // the rule. Everyone else keeps a walkable corridor.
          const isNearTarget = entry.near && other.id === entry.near.id;
          const floor = isNearTarget
            ? (entry.near as { min: number }).min
            : entry.boundingRadius + other.boundingRadius + CORRIDOR_GAP;
          return Math.hypot(x - other.x, z - other.z) >= floor;
        });
      if (entry.pin && !ok) {
        throw new Error(
          `park layout: pinned entry '${entry.id}' at [${x}, ${z}] violates a constraint — ` +
            `a pin must still make a working park`,
        );
      }
    }

    if (!ok) return null; // this arrangement dead-ended; the caller restarts

    // Entrance: on the plot edge, facing the park middle (the plaza is
    // placed first among big plots in practice, but the middle is the
    // stable thing to face — paths and the camera both live that way).
    const towardMiddle = Math.hypot(x, z) > 1e-6 ? [-x, -z] : [0, 1];
    const length = Math.hypot(towardMiddle[0] as number, towardMiddle[1] as number);
    const dirX = (towardMiddle[0] as number) / length;
    const dirZ = (towardMiddle[1] as number) / length;
    const edge = edgeDistanceAlong(entry.footprint, dirX, dirZ);
    const standOff = 1.4; // the sign and the doormat, just clear of the plot
    const entranceX = x + dirX * (edge + standOff);
    const entranceZ = z + dirZ * (edge + standOff);

    const item: PlacedEntry = {
      id: entry.id,
      x,
      z,
      footprint: entry.footprint,
      boundingRadius: entry.boundingRadius,
      entranceX,
      entranceZ,
      signYaw: Math.PI * rng.range(0.2, 0.3),
    };
    placed.push(item);
    byId.set(entry.id, item);
  }

  const fountain = byId.get('fountain');
  if (!fountain || fountain.footprint.kind !== 'circle') {
    throw new Error(`park layout: the manifest must contain a circular 'fountain'`);
  }


  return {
    seed: PARK_SEED,
    fountain: { x: fountain.x, z: fountain.z, radius: fountain.footprint.radius },
    entries: byId,
  };
}

/**
 * The solved park. Import this; never re-run the solver — one canonical
 * layout per build is the whole point.
 */
export const PARK_LAYOUT: ParkLayout = solve();

/** Convenience: the placed entry, or a loud failure naming the id. */
export function placedEntry(id: string): PlacedEntry {
  const entry = PARK_LAYOUT.entries.get(id);
  if (!entry) throw new Error(`park layout: no entry '${id}' in the manifest`);
  return entry;
}
