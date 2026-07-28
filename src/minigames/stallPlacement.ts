import { ANCHORS_BY_ID } from '../world/anchors';
import { placedEntry } from '../world/parkLayout';

/**
 * Where each stall stands, and where a child stands to be served.
 *
 * **Data only.** This is `stalls.ts` minus the games: no `three`, no textures,
 * no mini-game factories, nothing that needs a browser. That is the whole
 * reason it is a file of its own — two things want to know where the stalls are
 * without wanting to build one:
 *
 * - `entities/npc/poiGraph.ts` seeds a waypoint at every stand point, so a
 *   child can walk up to a booth. It is imported by `scripts/check-waypoints.mts`
 *   under `node --experimental-strip-types`, where importing `stalls.ts` would
 *   drag in five mini-games and fail on the first construct the type stripper
 *   does not support.
 * - Anything else that needs the *layout* rather than the content.
 *
 * ARCHITECTURE-DECISIONS **Decision 5** makes the park generated: the manifest
 * plus `PARK_SEED` decide where things go, and a solver places them. When that
 * lands, this table is one of the things it feeds — which is another reason the
 * coordinates want to be separable from the games standing on them.
 *
 * Placement rules (learned the hard way; `stalls.ts` has the long version):
 * clear of every anchor plot in `world/anchors.ts`, counter facing roughly down
 * +Z so the fixed isometric camera can read it, and a straight walkable line
 * from the paving to the stand point.
 */

export interface StallPlacement {
  /** Centre of the booth on the ground plane, [x, z]. */
  readonly position: readonly [number, number];
  /** Yaw in radians the counter faces. 0 looks down +Z. */
  readonly facing: number;
}

/** How far in front of the centre a child stands to be served. */
// 3.1, not 2.5: the doormat must stay walkable after the nav lattice
// inflates the booth's walls by the walker radius. At 2.5 the stand point
// sat two centimetres inside the inflated wall - reachable on the old park
// by luck, pocketed on the generated one by the same luck running out.
export const STALL_STAND_DISTANCE = 3.1;

/**
 * Keyed by stall id so `stalls.ts` can spread one in by name and the two
 * cannot drift apart.
 */
/**
 * A stall's spot, from the layout solver. Facing stays near +0.25 rad — the
 * one absolute direction the fixed isometric camera can read a counter from
 * (GAME_DESIGN.md #16) — with the solver's own small per-stall variation.
 */
function placedStall(layoutId: string): StallPlacement {
  const p = placedEntry(layoutId);
  return { position: [p.x, p.z], facing: p.signYaw * 0.35 };
}

/**
 * The ferris kiosk is the one placement with a *relation*, not a free spot:
 * it belongs beside the ride's entrance. Beside, not on — the kiosk's four
 * walls used to stand exactly on the anchor's entrance, which walled the
 * stand point in and made the ride unreachable (`check:park` found it on the
 * hand-authored park too; it was the recorded `route.unreachable`). It now
 * sits to the side of the doormat, its collision clear of the spur's end.
 */
function ferrisKiosk(): StallPlacement {
  const wheel = ANCHORS_BY_ID.ferrisWheel;
  const [ex, ez] = wheel.entrance;
  // Perpendicular to the entrance-to-middle direction, a booth-width away.
  const towardMiddleX = -ex;
  const towardMiddleZ = -ez;
  const length = Math.hypot(towardMiddleX, towardMiddleZ) || 1;
  const sideX = -towardMiddleZ / length;
  const sideZ = towardMiddleX / length;
  return { position: [ex + sideX * 5, ez + sideZ * 5], facing: wheel.signYaw };
}

export const STALL_PLACEMENTS = {
  railRacer: placedStall('stall.railRacer'),
  spookyHouse: placedStall('stall.spookyHouse'),
  waterFight: placedStall('stall.waterFight'),
  spaceFerrisWheel: ferrisKiosk(),
  dodgems: placedStall('stall.dodgems'),
} as const satisfies Record<string, StallPlacement>;

/** Where a child stands to be served at a stall. */
export interface StallStand {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/**
 * The stand points, derived rather than typed.
 *
 * `MiniGameStalls` computes exactly this for each booth it builds; deriving it
 * here as well from the same two numbers is what lets a waypoint be seeded at a
 * counter without the waypoint table hard-coding a coordinate that would go
 * stale the moment a stall moved — and, after Decision 5, the moment the park
 * regenerated.
 */
export const STALL_STANDS: readonly StallStand[] = Object.entries(STALL_PLACEMENTS).map(
  ([id, placement]) => ({
    id,
    x: placement.position[0] + Math.sin(placement.facing) * STALL_STAND_DISTANCE,
    z: placement.position[1] + Math.cos(placement.facing) * STALL_STAND_DISTANCE,
  }),
);
