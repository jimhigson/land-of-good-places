import { candidateRng, hashString, Rng, TAU } from '../core/mathUtils';
import {
  BOUNDARY_CLEARANCE,
  GATE_CORRIDOR_HALF_WIDTH,
  PARK_MANIFEST,
  PARK_SEED,
  type ManifestEntry,
} from './parkManifest';
import { PARK_BOUNDARY } from './boundary';
import type { AnchorFootprint } from './anchors';

/**
 * The layout solver — L1 of Decision 5.
 *
 * Takes the manifest and the canonical seed; produces a placed park. Runs
 * once at module load (pure arithmetic beyond the boundary's own polygon, no
 * three.js), so every consumer — `anchors.ts`, `paths.ts`, the stalls, the
 * fountain, the map — imports a plain solved object exactly as they used to
 * import authored constants.
 *
 * **Placement is largest-first rejection sampling with a spread preference**
 * (issue #241). Each entry draws seeded candidates in its band, keeps every
 * candidate that satisfies every constraint, and of those takes the one
 * whose nearest neighbour is furthest away — so attractions spread across
 * the park that actually exists instead of packing the first legal pocket.
 * Two properties are load-bearing:
 *
 *  - **Every entry draws from a stream of its very own**,
 *    `candidateRng(hash(id) ^ seed, restart)` — so editing the manifest
 *    cannot move any *other* entry's candidates (the reason the old park
 *    needed 15-decimal pins is gone). See `candidateRng`'s own doc for the
 *    bug class this kills.
 *  - **The limit is the boundary, not a circle.** A plot fits wherever the
 *    spline says it fits, with {@link BOUNDARY_CLEARANCE} of lane kept to
 *    the edge, asked per candidate — `PLOT_EXTENT_LIMIT = 52` capped the
 *    park to the circle it replaced (issue #241).
 *
 * Constraints, all of which fail the *build* loudly rather than degrade:
 *  - plots fit inside the spline boundary with a walkable lane to the edge;
 *  - plots keep {@link CORRIDOR_GAP} of walkable ground between bounding
 *    circles, so a path can always be routed between neighbours;
 *  - nothing blocks the gate corridor: the entrance is the one pinned thing
 *    in the park, and a child must always be able to walk straight in;
 *  - `near` relations hold (the ball pit stays within the slide's reach of
 *    the building), and `nearEdge` bands hold against the real edge.
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

/** Candidate draws per entry before this whole-park attempt is abandoned. */
const MAX_TRIES = 3000;

/**
 * How many *valid* candidates an entry collects before choosing between
 * them. The choice is maximin — the candidate whose nearest already-placed
 * neighbour is furthest — which is what "distribute things evenly" cashes
 * out to without reserving an inch of space: a preference over legal spots,
 * never a claim on ground (Decision 6). Twelve is enough that the winner is
 * usually in a genuinely different pocket from the loser, and small enough
 * that a squeezed entry (whose valid pockets are few) still places fast.
 */
const SPREAD_CHOICES = 12;

/**
 * Whole-park restarts. Greedy placement can paint itself into a corner — an
 * unlucky big-plot arrangement leaves no sliver for a later relation — and
 * the cheap, deterministic cure is to re-roll the whole arrangement. Each
 * restart re-seeds every entry's own stream with the restart index, so
 * restart `r` is as deterministic as restart 0 and no entry ever inherits
 * another's draws.
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
  for (let restart = 0; restart < PARK_RESTARTS; restart += 1) {
    const built = buildOnce(restart);
    if (built) return built;
  }
  throw new Error(
    `park layout: unsolvable in ${PARK_RESTARTS} restarts (seed ${PARK_SEED}) — ` +
      `loosen bands, shrink the manifest, or bump the seed`,
  );
}

/**
 * The bearing a camera-facing entry's counter (and so its doormat) faces,
 * from its sign yaw. THE one owner of the formula — `stallPlacement.ts`
 * builds the booth with it and this file places the doormat with it, which
 * is exactly the pair that drifted apart before (two authorities for which
 * side of a booth is the front; reviewer finding 4 on PR #247).
 */
export function counterFacing(signYaw: number): number {
  return signYaw * 0.35;
}

/** One candidate position, with the spread score it was chosen on. */
interface Candidate {
  readonly x: number;
  readonly z: number;
  /** Gap to the nearest placed plot's bounding circle, in metres. */
  readonly spread: number;
}

function buildOnce(restart: number): ParkLayout | null {
  const placed: PlacedEntry[] = [];
  const byId = new Map<string, PlacedEntry>();

  // Largest first: the manifest is sorted here rather than trusting file
  // order, so adding an entry never changes packing feasibility by accident.
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

    // This entry's own stream — a pure function of (seed, id, restart), so
    // no other entry's fortunes can move this one's candidates.
    const rng = candidateRng(hashString(entry.id) ^ PARK_SEED, restart);

    const candidates: Candidate[] = [];
    for (let attempt = 0; attempt < MAX_TRIES && candidates.length < SPREAD_CHOICES; attempt += 1) {
      const drawn = drawCandidate(entry, near, rng);
      const valid = validate(entry, near, drawn.x, drawn.z, placed);
      if (valid === null) continue;
      candidates.push({ x: drawn.x, z: drawn.z, spread: valid });
      if (entry.pin) break; // a pin is one candidate, validated
    }

    if (candidates.length === 0) return null; // dead end; the caller restarts

    // Maximin: of the legal spots, the one furthest from its nearest
    // neighbour. Ties keep draw order, which keeps the choice seeded.
    let best = candidates[0] as Candidate;
    for (const candidate of candidates) {
      if (candidate.spread > best.spread) best = candidate;
    }
    const { x, z } = best;

    // Entrance: on the plot edge. Camera-facing entries (the stall booths,
    // whose counters obey GAME_DESIGN #16's absolute readability rule) get
    // their doormat on the side the counter actually faces — the same
    // signYaw-derived bearing `stallPlacement.ts` builds the booth with, so
    // the doormat, the stand and the counter are one line by construction.
    // Everything else faces the park middle, the stable thing paths and the
    // camera both live by.
    const signYaw = Math.PI * rng.range(0.2, 0.3);
    let dirX: number;
    let dirZ: number;
    if (entry.cameraFacing) {
      const facing = counterFacing(signYaw);
      dirX = Math.sin(facing);
      dirZ = Math.cos(facing);
    } else {
      const towardMiddle = Math.hypot(x, z) > 1e-6 ? [-x, -z] : [0, 1];
      const length = Math.hypot(towardMiddle[0] as number, towardMiddle[1] as number);
      dirX = (towardMiddle[0] as number) / length;
      dirZ = (towardMiddle[1] as number) / length;
    }
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
      signYaw,
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

/** One seeded draw for an entry: its pin, its relation ring, or its band. */
function drawCandidate(
  entry: ManifestEntry,
  near: PlacedEntry | undefined,
  rng: Rng,
): { x: number; z: number } {
  if (entry.pin) return { x: entry.pin[0], z: entry.pin[1] };
  if (near && entry.near) {
    // Draw around the relation target; the band still applies afterwards.
    const angle = rng.range(0, TAU);
    const distance = rng.range(entry.near.min, entry.near.max);
    return { x: near.x + Math.cos(angle) * distance, z: near.z + Math.sin(angle) * distance };
  }
  // Area-uniform draw inside the band annulus, capped at the furthest the
  // boundary ever reaches — beyond that a candidate cannot possibly fit, so
  // drawing there only spends tries.
  const angle = rng.range(0, TAU);
  const max = Math.min(entry.band.max, PARK_BOUNDARY.maxRadius);
  const r2min = entry.band.min * entry.band.min;
  const r2max = max * max;
  const radius = Math.sqrt(rng.range(r2min, Math.max(r2min, r2max)));
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/**
 * Every constraint on one candidate, or `null` if any fails. On success,
 * returns the spread score (gap to the nearest placed plot) for maximin.
 * A pinned entry that fails throws instead: a pin must still make a
 * working park.
 */
function validate(
  entry: ManifestEntry,
  near: PlacedEntry | undefined,
  x: number,
  z: number,
  placed: readonly PlacedEntry[],
): number | null {
  const fail = (reason: string): null => {
    if (entry.pin) {
      throw new Error(
        `park layout: pinned entry '${entry.id}' at [${x}, ${z}] ${reason} — ` +
          `a pin must still make a working park`,
      );
    }
    return null;
  };

  const centreDistance = Math.hypot(x, z);
  if (centreDistance < entry.band.min - 1e-6 || centreDistance > entry.band.max + 1e-6) {
    return fail('leaves its band');
  }

  // The park's real edge, per bearing — the constraint that replaced the
  // 52 m circle (issue #241).
  const edgeGap = PARK_BOUNDARY.distanceToEdge(x, z) - entry.boundingRadius;
  if (edgeGap < BOUNDARY_CLEARANCE) return fail('does not fit inside the boundary');
  if (entry.nearEdge && (edgeGap < entry.nearEdge.min || edgeGap > entry.nearEdge.max)) {
    return fail('misses its nearEdge band');
  }

  if (inGateCorridor(x, z, entry.boundingRadius)) return fail('blocks the gate corridor');

  let spread = Infinity;
  for (const other of placed) {
    const gap = Math.hypot(x - other.x, z - other.z) - entry.boundingRadius - other.boundingRadius;
    // The near-target pair is deliberately close; its manifest min is the
    // rule. Everyone else keeps a walkable corridor.
    const isNearTarget = near !== undefined && other.id === near.id;
    if (!isNearTarget && gap < CORRIDOR_GAP) return fail(`crowds '${other.id}'`);
    if (gap < spread) spread = gap;
  }
  return spread;
}

/**
 * The solved park. Import this; never re-run the solver — one canonical
 * layout per build is the whole point.
 */
export const PARK_LAYOUT: ParkLayout = solve();

/** Clear of every plot's bounding circle by `radius`. Pure, for the plans
 * solved at module load (train, coaster, ferris exit) — lives here so none
 * of them has to import another ride's plan just to ask about the layout. */
export function clearOfPlots(x: number, z: number, radius: number): boolean {
  for (const entry of PARK_LAYOUT.entries.values()) {
    if (Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + radius) return false;
  }
  return true;
}

/**
 * Clear of every plot's actual FOOTPRINT (rect or circle) by `margin`.
 *
 * The bounding circle overstates a rectangular plot's corners by metres —
 * fine for spacing, wrong for a ride that deliberately flies close: the Sky
 * Cruiser's station is placed beside the castle on purpose, and testing its
 * low-altitude window against the castle's 19 m circle rejects every pose
 * the near-relation just arranged. The footprint is what is really built.
 */
export function clearOfFootprints(x: number, z: number, margin: number): boolean {
  for (const entry of PARK_LAYOUT.entries.values()) {
    if (entry.footprint.kind === 'circle') {
      if (Math.hypot(x - entry.x, z - entry.z) < entry.footprint.radius + margin) return false;
      continue;
    }
    const dx = Math.abs(x - entry.x) - entry.footprint.halfX;
    const dz = Math.abs(z - entry.z) - entry.footprint.halfZ;
    const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
    if ((dx <= 0 && dz <= 0) || outside < margin) return false;
  }
  return true;
}

/** Convenience: the placed entry, or a loud failure naming the id. */
export function placedEntry(id: string): PlacedEntry {
  const entry = PARK_LAYOUT.entries.get(id);
  if (!entry) throw new Error(`park layout: no entry '${id}' in the manifest`);
  return entry;
}
