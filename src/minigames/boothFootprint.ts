/**
 * **One owner of the ground a booth stands on.**
 *
 * Three classes build a stall — `minigames/stalls.ts` (the six mini-game
 * booths), `world/FacePaintStall.ts` and `world/KeychainShop.ts` — and each
 * had its own copy of the same twelve lines: four corners rotated by hand,
 * four walls registered with the `CollisionWorld`, three different boxes
 * written as literals beside three identically-named `STALL_WIDTH`s. Nothing
 * else in the park could ask where a booth stood, because the answer existed
 * only as four already-registered wall colliders.
 *
 * It matters now because stalls are a {@link FeatureBuilder} (`worldPhase.ts`):
 * the booth's ground is a **claim**, so a lamp refused by a booth names
 * `stalls` instead of silently losing its slot, and the stall's own builder
 * can decide to shift. A claim derived from one place and a collider built
 * from another is CLAUDE.md's most-repeated bug — "two definitions of one
 * thing, kept in step by hand" — and here it would mean a booth a child can
 * see in one place and bump into in another. So the box is declared once,
 * the corners are computed once, and both the collider and the claim are
 * built from that one answer.
 */

import type { Claim } from '../boot/groundClaims';
import type { CollisionWorld, WallCollider } from '../world/Collision';

/**
 * A booth's body in its own local frame, before rotation: `±halfWidth` across
 * the counter, `back..front` through it. `wallHalfThickness` is what the four
 * wall colliders are registered with, and so the half-width of the four
 * capsule claims that describe the same ground.
 */
export interface BoothBox {
  readonly halfWidth: number;
  readonly front: number;
  readonly back: number;
  readonly wallHalfThickness: number;
}

/** The six mini-game booths (`minigames/stalls.ts`). */
export const MINI_GAME_BOOTH_BOX: BoothBox = {
  halfWidth: 2.1,
  front: 1.35,
  back: -1.3,
  wallHalfThickness: 0.3,
};

/**
 * The face-paint stall's and the keychain stall's body sizes live here rather
 * than in those two classes, because the box below is derived from them and a
 * derivation that reads a copy is the bug this file exists to close. Both
 * classes import these for their own geometry.
 */
export const FACE_PAINT_STALL_WIDTH = 3.1;
export const FACE_PAINT_STALL_DEPTH = 2.1;
export const KEYCHAIN_STALL_WIDTH = 2.1;
export const KEYCHAIN_STALL_DEPTH = 1.5;

/** The face-paint stall (`world/FacePaintStall.ts`): its own narrower body. */
export const FACE_PAINT_BOOTH_BOX: BoothBox = {
  halfWidth: FACE_PAINT_STALL_WIDTH / 2 + 0.1,
  front: 1.0,
  back: -1.0,
  wallHalfThickness: 0.25,
};

/** The keychain stall (`world/KeychainShop.ts`): the smallest of the three. */
export const KEYCHAIN_BOOTH_BOX: BoothBox = {
  halfWidth: KEYCHAIN_STALL_WIDTH / 2 + 0.08,
  front: KEYCHAIN_STALL_DEPTH / 2 + 0.08,
  back: -(KEYCHAIN_STALL_DEPTH / 2 + 0.08),
  wallHalfThickness: 0.25,
};

/**
 * Which box each stall id in {@link STALL_PLACEMENTS} uses. Keyed by the same
 * ids, so a stall added to the placement table with no box here fails loudly
 * at the one call site rather than claiming nothing.
 */
const BOX_BY_ID: Readonly<Record<string, BoothBox>> = {
  railRacer: MINI_GAME_BOOTH_BOX,
  skyCruiser: MINI_GAME_BOOTH_BOX,
  spookyHouse: MINI_GAME_BOOTH_BOX,
  waterFight: MINI_GAME_BOOTH_BOX,
  spaceFerrisWheel: MINI_GAME_BOOTH_BOX,
  dodgems: MINI_GAME_BOOTH_BOX,
  facePaint: FACE_PAINT_BOOTH_BOX,
  keychain: KEYCHAIN_BOOTH_BOX,
};

export function boothBoxFor(id: string): BoothBox {
  const box = BOX_BY_ID[id];
  if (!box) throw new Error(`booth footprint: no box declared for stall '${id}' — add one to boothFootprint.ts`);
  return box;
}

/**
 * The four corners in world space, front-left, front-right, back-left,
 * back-right. The rotation convention is the booths' own and is deliberately
 * not restated anywhere else: `+localX` runs left along the counter and
 * `+localZ` runs out of it, with yaw measured as `Player.facing` is.
 */
export function boothCorners(
  x: number,
  z: number,
  yaw: number,
  box: BoothBox,
): { frontLeft: [number, number]; frontRight: [number, number]; backLeft: [number, number]; backRight: [number, number] } {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const toWorld = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
  return {
    frontLeft: toWorld(-box.halfWidth, box.front),
    frontRight: toWorld(box.halfWidth, box.front),
    backLeft: toWorld(-box.halfWidth, box.back),
    backRight: toWorld(box.halfWidth, box.back),
  };
}

/**
 * Register the booth's four walls, and hand the colliders back so the caller
 * can remove exactly these again if the booth moves.
 *
 * Four walls round a hollow middle, which is what CLAUDE.md warns about — but
 * a booth is a closed box with no way in, so nothing can be trapped inside
 * one. That was already true of all three copies this replaces; it is written
 * down here because this is now the only place it is decided.
 */
export function addBoothCollision(
  collision: CollisionWorld,
  x: number,
  z: number,
  yaw: number,
  box: BoothBox,
): WallCollider[] {
  const { frontLeft, frontRight, backLeft, backRight } = boothCorners(x, z, yaw, box);
  const t = box.wallHalfThickness;
  return [
    collision.addWall(frontLeft[0], frontLeft[1], frontRight[0], frontRight[1], t),
    collision.addWall(backLeft[0], backLeft[1], backRight[0], backRight[1], t),
    collision.addWall(frontLeft[0], frontLeft[1], backLeft[0], backLeft[1], t),
    collision.addWall(frontRight[0], frontRight[1], backRight[0], backRight[1], t),
  ];
}

/**
 * The same four walls as **claims** — the ground the booth occupies, in the
 * registry's own language. Exactly the colliders' geometry, not an
 * approximation of it: a capsule per wall, at the wall's own half-thickness,
 * so a claim refuses precisely where a collider stops a child and the two can
 * never disagree about where the booth is.
 */
export function boothClaims(x: number, z: number, yaw: number, box: BoothBox): Claim[] {
  const { frontLeft, frontRight, backLeft, backRight } = boothCorners(x, z, yaw, box);
  const wall = (a: [number, number], b: [number, number]): Claim => ({
    kind: 'footprint',
    shape: { shape: 'capsule', x1: a[0], z1: a[1], x2: b[0], z2: b[1], halfWidth: box.wallHalfThickness },
  });
  return [
    wall(frontLeft, frontRight),
    wall(backLeft, backRight),
    wall(frontLeft, backLeft),
    wall(frontRight, backRight),
  ];
}
