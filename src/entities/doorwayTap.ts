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
 * So a tap anywhere in an exit's opening — under the arch, in the arm's
 * reach in front of it, or on the floor just past it short of the band's far
 * edge — is moved to a point on the far side of the band's
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
 * lintel's own depth and then two of her widths, so a tap under the arch or
 * on the floor in front of it does, and a tap further into the room does
 * not. Generous on purpose: a finger aimed at a doorway on a phone lands
 * most of a metre either side of it (the real-tap probe's own aim, at the
 * wall line, landed up to 0.84 m in), and a tap just short of the line that
 * strands her under the arch is the bug this exists for.
 */
export function doorwayTapReach(placed: PlacedDoorFrame): number {
  return placed.frame.lintelHalfZ + 2 * PLAYER_RADIUS;
}

/** Whether world (x, z) is over the frame's drawn plan: post to post, and as deep as its deepest part. */
function onFramePlan(placed: PlacedDoorFrame, x: number, z: number): boolean {
  const { frame } = placed;
  const left = frame.posts[0];
  const right = frame.posts[1];
  if (!left || !right) return false;
  const minZ = Math.min(left.minZ, frame.opening.z - frame.lintelHalfZ, frame.crest.minZ);
  const maxZ = Math.max(left.maxZ, frame.opening.z + frame.lintelHalfZ, frame.crest.maxZ);
  const lx = x - placed.originX;
  const lz = z - placed.originZ;
  const e = 1e-6;
  return lx >= left.minX - e && lx <= right.maxX + e && lz >= minZ - e && lz <= maxZ + e;
}

/**
 * Where a tap at world (x, y, z) should walk her, if it landed in one of
 * `exits`' openings — on through the band — or null for an ordinary tap.
 */
export function doorwayTapTarget(exits: readonly DoorwayExit[], x: number, y: number, z: number): { x: number; z: number } | null {
  for (const { placed, band } of exits) {
    const o = placed.frame.opening;
    const minX = placed.originX + o.minX;
    const maxX = placed.originX + o.maxX;
    const wallZ = placed.originZ + o.z;
    // Out is away from the room's own middle, through its wall.
    const out = Math.sign(o.z) || 1;
    const inward = (wallZ - z) * out;
    // **A tap on the frame itself** is a tap on the doorway too. The frame's
    // tops are standable (every solid is, since 17 Oct 2026), so a finger
    // aimed at the opening often lands on the lintel or the crest, high
    // over the floor and up to a crest's depth off the wall line — QA's
    // library tap landed 1.08 m in, on the open book.
    const onFrame = y > placed.originY + o.floorY + 1 && onFramePlan(placed, x, z);
    if (!onFrame) {
      if (x < minX || x > maxX) continue;
      // Outward, as far as the band's far edge: a tap on the floor just past
      // the door (the castle's porch — its band starts 1.7 m out) is a tap
      // on the way out too (QA round 2 on #743: taps 0.5-1.6 m out left her
      // standing on the porch).
      const farOut = (band.centreZ + out * band.halfAlong - wallZ) * out;
      if (inward > doorwayTapReach(placed) || inward < -farOut) continue;
    }
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
