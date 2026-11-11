/**
 * **A tap on an interior's way out means "walk on through and out".**
 *
 * QA on #743: in the hotel lobby and the Reptile House a tap in the framed
 * doorway walked her under the arch and stopped her there. The tap lands on
 * the floor just inside the wall line (beyond it is the void past the floor's
 * ledge, which a tap cannot land on), and `TapNavigator` calls her arrived
 * anywhere within {@link ARRIVE_RADIUS} of it — which, with the exit band's
 * inner edge 0.6 m in from the wall, is as likely as not to be just short of
 * the band. So the doorway the frame invites her to tap stranded her. The
 * library only worked because its rug happened to sit right on the wall line.
 *
 * So a tap anywhere in an exit's opening — under the arch, or in the arm's
 * reach in front of it — is moved to a point on the far side of the band's
 * inner edge by more than an arrival's slack: any stop that counts as
 * arriving there is inside the band, so crossing into it is what the walk
 * ends with, and the room's own doorway trigger (`bandCrossed`) takes her
 * out. The band, the opening and her radius are all asked of their owners.
 * `check:doorframes` §6 holds the arithmetic, and `scripts/qa-doorway-tap.mjs`
 * taps it with a real finger.
 */
import { PLAYER_RADIUS } from '../core/constants';
import type { PlacedDoorFrame } from '../art/models/doorFrames';
import type { PortalBand } from '../world/tapSpacing';
import { ARRIVE_RADIUS } from './TapNavigator';

/** An interior's way out: its frame (the opening) and its trigger band. */
export interface DoorwayExit {
  readonly placed: PlacedDoorFrame;
  readonly band: PortalBand;
}

/** How far past the band's inner edge the walk is aimed: an arrival's slack, and then some. */
export const DOORWAY_TAP_PAST_EDGE = ARRIVE_RADIUS + 0.3;

/**
 * How far in from the wall line a tap still counts as "in the doorway": the
 * lintel's own depth and then her body, so a tap under the arch or on the
 * floor right in front of it does, and a tap further into the room does not.
 */
export function doorwayTapReach(placed: PlacedDoorFrame): number {
  return placed.frame.lintelHalfZ + PLAYER_RADIUS;
}

/**
 * Where a tap at world (x, z) should walk her, if it landed in one of
 * `exits`' openings — on through the band — or null for an ordinary tap.
 */
export function doorwayTapTarget(exits: readonly DoorwayExit[], x: number, z: number): { x: number; z: number } | null {
  for (const { placed, band } of exits) {
    const o = placed.frame.opening;
    const minX = placed.originX + o.minX;
    const maxX = placed.originX + o.maxX;
    if (x < minX || x > maxX) continue;
    const wallZ = placed.originZ + o.z;
    // Out is away from the room's own middle, through its wall.
    const out = Math.sign(o.z) || 1;
    const inward = (wallZ - z) * out;
    if (inward > doorwayTapReach(placed) || inward < -Math.abs(placed.frame.lintelHalfZ)) continue;
    // Every exit band runs straight out through its wall (`yaw` 0): its inner
    // edge is the side nearer the room's middle.
    const innerEdge = band.centreZ - out * band.halfAlong;
    // Clear of each jamb by her body and a margin, so the walk is a straight one.
    const margin = PLAYER_RADIUS + 0.4;
    const tx = Math.min(maxX - margin, Math.max(minX + margin, x));
    return { x: Number.isFinite(tx) ? tx : (minX + maxX) / 2, z: innerEdge + out * DOORWAY_TAP_PAST_EDGE };
  }
  return null;
}
