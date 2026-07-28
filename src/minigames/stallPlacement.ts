import { ANCHORS_BY_ID } from '../world/anchors';

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
export const STALL_STAND_DISTANCE = 2.5;

/**
 * Keyed by stall id so `stalls.ts` can spread one in by name and the two
 * cannot drift apart.
 */
export const STALL_PLACEMENTS = {
  railRacer: {
    // On the lawn just off the north-east kerb of the fountain plaza: a few
    // seconds' walk from where the game starts you, clear of every anchor plot,
    // clear of the hand-authored wall runs, and — checked in the running game —
    // with no scattered tree or bush within four metres.
    position: [9.8, -4.8],
    // A shade east of +Z: the counter, the awning stripes and the sign all face
    // the default camera, and the stand point in front of it sits between the
    // booth and the plaza, so walking up is a straight line from the fountain.
    facing: 0.3,
  },
  spookyHouse: {
    // A short walk north-east of the fountain plaza, clear of every anchor
    // plot, the Rail Racer stall and every hand-authored wall run in
    // `Scenery.ts` by several metres. The scenery scatter is seeded (see
    // `Scenery.ts`), not something a builder can predict by eye from the
    // coordinate tables alone — an earlier choice out on the open lawn at
    // [40, 0] *looked* clear on paper but turned out to have a bush planted
    // right on top of it once the seeded scatter actually ran, so this spot
    // was checked the same way, against the real instanced tree/bush
    // positions read out of the running game, and also checked that the
    // straight line tap-to-move walks from the spawn point clears the
    // fountain by a wide margin rather than grazing its collision circle.
    position: [13, 9],
    // Every anchor sign and every other stall in this park uses a yaw near
    // +0.2–0.3 regardless of where it stands, because the isometric camera
    // never rotates (GAME_DESIGN.md #16) — "face the camera" is the same
    // absolute direction everywhere on the map, not a direction relative to
    // wherever a child is walking from.
    facing: 0.25,
  },
  waterFight: {
    // The one stall that stands *inside* an anchor plot rather than clear of
    // one. That is not the exception it looks like: the water fight owns the
    // `waterFight` plot (see `waterFight/plot.ts`, which takes its "coming
    // soon" sign down and dresses it), so this booth is the doorway into the
    // ride the plot was reserved for, not a stall squatting on somebody else's
    // building site.
    // Well inside the plot, and specifically clear of where the garden path
    // stops: `world/paths.ts` runs its water-fight spur on to [-25, 20], which
    // the first placement sat almost exactly on top of. Two metres of open
    // grass now separate the path's last step from the nearest corner of the
    // booth.
    position: [-29.5, 22],
    // Turned towards the path rather than square down +Z. The counter still
    // meets the isometric camera at an angle you can read the sign from, and —
    // the number that actually mattered — the stand point ends up *between* the
    // path and the booth, so walking up is a straight line that never scrapes
    // along the side of it.
    facing: 1.35,
  },
  spaceFerrisWheel: {
    // The one stall that is not a stall: this is the ferris wheel's ticket
    // kiosk, and it stands *exactly* where the plot's "coming soon" sign stood
    // — same spot, same yaw — because that sign has now come true. Putting it
    // on the anchor's own entrance also means the path spur already leads here,
    // and the placeholder's collision post ends up inside the booth's own walls
    // instead of being left behind as an invisible obstacle on the lawn.
    position: ANCHORS_BY_ID.ferrisWheel.entrance,
    facing: ANCHORS_BY_ID.ferrisWheel.signYaw,
  },
  dodgems: {
    // The ticket kiosk for the ride standing in the `dodgems` anchor plot: just
    // outside the bumper wall, a couple of metres from the doorway in it, and
    // right where the path spur from the garden arrives. Checked against the
    // ride's own geometry (`dodgems/plot.ts`): the booth and the point a child
    // stands at are both clear of the barrier, and the walk from the end of the
    // path to the counter is a straight line across open grass.
    position: [24, 12],
    // Same rule the rail racer follows: the counter faces the default camera,
    // and the stand point in front of it ends up between the kiosk and the
    // ride's doorway rather than inside the rink.
    facing: 0.3,
  },
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
