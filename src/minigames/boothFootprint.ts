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
import type { BoxCollider, CollisionWorld, WallCollider } from '../world/Collision';
import { groundRadiusAt, yAtRadius } from '../world/terrain';

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
  /** How tall each side of the booth is drawn — see {@link BoothHeights}. */
  readonly heights: BoothHeights;
}

/**
 * **How tall a booth is, side by side, as drawn** — the tops its four walls
 * stand to, above the ground at the booth's own foot, along the lean the whole
 * booth is stood on (`standOnSphere` at its root). The one owner: the booth's
 * own mesh builder reads these for the parts they describe, so the counter a
 * child jumps at and the counter she sees are one number.
 *
 * - `front`: the counter's top — low enough to jump onto, which is why the
 *   awning (below) matters.
 * - `sides`, `back`: the side panels' and the back wall's tops. A stall
 *   open at the sides (the face-paint stall) keeps a solid there so the booth
 *   stays a closed box round its painter, and stands it to the corner posts it
 *   runs between: the one solid here with nothing drawn along it, and listed
 *   as such by the solids census.
 * - `awning`: the canopy over the counter, a **banded** solid from its lowest
 *   underside to its highest top. A child stood on the counter would have her
 *   head through it, so it is what stops her getting onto the counter at all:
 *   she meets it at her shoulders on the way up.
 */
export interface BoothHeights {
  readonly front: number;
  readonly sides: number;
  readonly back: number;
  /** Solid right through, up to `front` (a cart), rather than a hollow booth closed by its four walls. */
  readonly filled?: true;
  /**
   * Where the drawn side panels stop, booth-local `z`, when they stop short of
   * the front: in front of it a side wall is the counter's own end, and stands
   * to the counter's height (`front`), not the panel's. Without it the side
   * walls' solids ran on, panel-high and undrawn, out to the counter's line —
   * a ledge in the air beside the counter, outside the awning, that a child on
   * the counter stepped up to and walked from onto the roof (the census, 17
   * Oct 2026).
   */
  readonly sideFront?: number;
  /**
   * The drawn half-thickness of the back wall and the side panels, where they
   * are panels: a top that thin is an edge she cannot put her feet on
   * (`CollisionWorld.toppedNarrow`), so the panels a booth is built of are
   * never a stair from its counter to its roof (the census, 17 Oct 2026).
   */
  readonly panelHalf?: number;
  /** A round canopy (a parasol), local-frame centre and radius, banded from `base` to `top`. */
  readonly canopy?: { readonly x: number; readonly z: number; readonly radius: number; readonly base: number; readonly top: number };
  readonly awning?: {
    /** Local-frame extent: across `±halfWidth`, through `back..front`. */
    readonly halfWidth: number;
    readonly front: number;
    readonly back: number;
    readonly base: number;
    readonly top: number;
  };
}

/**
 * The mini-game stall's parts (`stallProp.ts` builds them from these): the
 * counter's top board, the side panels, the back wall, and the striped awning
 * — its pivot height and depth, its tilt, and how far its scalloped valance
 * hangs below the cloth's front edge.
 */
/** The counter's top board: its centre's height, and half its thickness. */
export const MINI_GAME_COUNTER_BOARD_Y = 1.08;
export const MINI_GAME_COUNTER_BOARD_HALF = 0.07;
export const MINI_GAME_COUNTER_TOP = MINI_GAME_COUNTER_BOARD_Y + MINI_GAME_COUNTER_BOARD_HALF;
export const MINI_GAME_SIDE_PANEL_HEIGHT = 2.3;
/** The side panels' middle and depth, booth-local `z` — they stop 0.6 m short of the counter's line. */
export const MINI_GAME_SIDE_PANEL_Z = -0.2;
export const MINI_GAME_SIDE_PANEL_DEPTH = 1.9;
/** How thick the back wall and the side panels are drawn. */
export const MINI_GAME_PANEL_THICKNESS = 0.18;
export const MINI_GAME_BACK_WALL_HEIGHT = 2.5;
export const MINI_GAME_AWNING_Y = 2.72;
export const MINI_GAME_AWNING_Z = 0.15;
export const MINI_GAME_AWNING_DEPTH = 1.85;
export const MINI_GAME_AWNING_TILT = 0.22;
/** The cloth's thickness and the valance's lowest reach below the cloth's front edge (its drop plus its radius). */
export const MINI_GAME_AWNING_CLOTH = 0.11;
export const MINI_GAME_AWNING_VALANCE = 0.2;

/** The tilted awning's lowest underside and highest top, from the parts above. */
function tiltedAwning(halfWidth: number): NonNullable<BoothHeights['awning']> {
  const halfDepth = MINI_GAME_AWNING_DEPTH / 2;
  const sin = Math.sin(MINI_GAME_AWNING_TILT);
  const cos = Math.cos(MINI_GAME_AWNING_TILT);
  return {
    halfWidth,
    front: MINI_GAME_AWNING_Z + halfDepth * cos + 0.05,
    back: MINI_GAME_AWNING_Z - halfDepth * cos,
    base: MINI_GAME_AWNING_Y - halfDepth * sin - MINI_GAME_AWNING_CLOTH / 2 - MINI_GAME_AWNING_VALANCE,
    top: MINI_GAME_AWNING_Y + halfDepth * sin + MINI_GAME_AWNING_CLOTH / 2,
  };
}

/** The six mini-game booths (`minigames/stalls.ts`). */
export const MINI_GAME_BOOTH_BOX: BoothBox = {
  halfWidth: 2.1,
  front: 1.35,
  back: -1.3,
  wallHalfThickness: 0.3,
  heights: {
    front: MINI_GAME_COUNTER_TOP,
    sides: MINI_GAME_SIDE_PANEL_HEIGHT,
    back: MINI_GAME_BACK_WALL_HEIGHT,
    sideFront: MINI_GAME_SIDE_PANEL_Z + MINI_GAME_SIDE_PANEL_DEPTH / 2,
    panelHalf: MINI_GAME_PANEL_THICKNESS / 2,
    awning: tiltedAwning(2.1),
  },
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

/**
 * The face-paint stall's parts (`FacePaintStall.ts` builds them from these):
 * its counter's top, its back wall's height, and its awning — pivot height,
 * depth (a fraction of the stall's), tilt.
 */
export const FACE_PAINT_COUNTER_BOARD_Y = 0.86;
export const FACE_PAINT_COUNTER_TOP = FACE_PAINT_COUNTER_BOARD_Y + 0.05;
export const FACE_PAINT_BACK_WALL_HEIGHT = 1.9;
/** How thick the face-paint booth's back wall is drawn. */
export const FACE_PAINT_BACK_WALL_THICKNESS = 0.14;
/** The candy-striped corner posts at the front of the booth, holding up the awning. */
export const FACE_PAINT_POST_HEIGHT = 2.35;
export const FACE_PAINT_AWNING_Y = 2.28;
export const FACE_PAINT_AWNING_Z = -0.05;
export const FACE_PAINT_AWNING_TILT = 0.2;

/** The face-paint stall (`world/FacePaintStall.ts`): its own narrower body. */
export const FACE_PAINT_BOOTH_BOX: BoothBox = {
  halfWidth: FACE_PAINT_STALL_WIDTH / 2 + 0.1,
  front: 1.0,
  back: -1.0,
  wallHalfThickness: 0.25,
  heights: {
    front: FACE_PAINT_COUNTER_TOP,
    panelHalf: FACE_PAINT_BACK_WALL_THICKNESS / 2,
    // Open at the sides — posts at the front corners, nothing between them and
    // the back wall — so its side walls stand to the posts they run from.
    sides: FACE_PAINT_POST_HEIGHT,
    back: FACE_PAINT_BACK_WALL_HEIGHT,
    awning: (() => {
      const halfDepth = (FACE_PAINT_STALL_DEPTH * 0.8) / 2;
      const sin = Math.sin(FACE_PAINT_AWNING_TILT);
      const cos = Math.cos(FACE_PAINT_AWNING_TILT);
      return {
        halfWidth: FACE_PAINT_STALL_WIDTH / 2,
        front: FACE_PAINT_AWNING_Z + halfDepth * cos + 0.16,
        back: FACE_PAINT_AWNING_Z - halfDepth * cos,
        // The cloth (0.09 thick) and its scallops (0.16 radius, dropped 0.08).
        base: FACE_PAINT_AWNING_Y - halfDepth * sin - 0.045 - 0.24,
        top: FACE_PAINT_AWNING_Y + halfDepth * sin + 0.045,
      };
    })(),
  },
};

/**
 * The keychain cart's top board (`KeychainShop.ts` builds its body to it), and
 * its parasol: a disc of this radius at this height, over this point of the
 * cart's depth.
 */
export const KEYCHAIN_CART_BOARD_Y = 0.855;
export const KEYCHAIN_CART_TOP = KEYCHAIN_CART_BOARD_Y + 0.03;
export const KEYCHAIN_PARASOL_RADIUS = 0.62;
export const KEYCHAIN_PARASOL_Y = 2.18;
export const KEYCHAIN_PARASOL_Z = -KEYCHAIN_STALL_DEPTH / 2 + 0.15;

/** The keychain stall (`world/KeychainShop.ts`): the smallest of the three. */
export const KEYCHAIN_BOOTH_BOX: BoothBox = {
  halfWidth: KEYCHAIN_STALL_WIDTH / 2 + 0.08,
  front: KEYCHAIN_STALL_DEPTH / 2 + 0.08,
  back: -(KEYCHAIN_STALL_DEPTH / 2 + 0.08),
  wallHalfThickness: 0.25,
  heights: {
    front: KEYCHAIN_CART_TOP,
    sides: KEYCHAIN_CART_TOP,
    back: KEYCHAIN_CART_TOP,
    // **A cart, not a hollow booth**: its body is wood right through, so the
    // inside of its four walls is solid too (`filled`), up to its top board —
    // somewhere a jump lands, not a pit inside a cart.
    filled: true,
    canopy: { x: 0, z: KEYCHAIN_PARASOL_Z, radius: KEYCHAIN_PARASOL_RADIUS, base: KEYCHAIN_PARASOL_Y - 0.0175, top: KEYCHAIN_PARASOL_Y + 0.0175 },
  },
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
 * Register the booth's solids, and hand the colliders back so the caller can
 * remove exactly these again if the booth moves.
 *
 * Four walls, each to its own drawn top ({@link BoothHeights}): the counter
 * low enough to jump at, the panels and the back wall not. Round a hollow
 * middle where the booth is hollow — a closed box nobody can get into, because
 * the awning over the counter stops her standing on it (her head would be
 * through the cloth), and the other three sides are out of any jump's reach.
 * `check:solids`' census is what says so rather than this comment. A cart is
 * solid right through instead (`filled`). The awning or the parasol is a
 * banded solid of its own.
 *
 * Every height is measured up from the ground at the booth's own foot, along
 * the lean the booth is stood on (`standOnSphere` at its root), so it is held
 * at one radius from the planet's centre across the whole booth.
 */
export function addBoothCollision(
  collision: CollisionWorld,
  x: number,
  z: number,
  yaw: number,
  box: BoothBox,
): (WallCollider | BoxCollider)[] {
  const { frontLeft, frontRight, backLeft, backRight } = boothCorners(x, z, yaw, box);
  const t = box.wallHalfThickness;
  const foot = groundRadiusAt(x, z);
  const h = box.heights;
  const at = (a: [number, number], b: [number, number], height: number): number =>
    Number.isFinite(height) ? yAtRadius((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, foot + height) : Infinity;
  const wall = (a: [number, number], b: [number, number], height: number): WallCollider =>
    Number.isFinite(height)
      ? collision.addWall(a[0], a[1], b[0], b[1], t, at(a, b, height), false, true)
      : collision.addWall(a[0], a[1], b[0], b[1], t);
  // Local (lx, lz) to world, the booth's own convention (see `boothCorners`).
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const toWorld = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
  return collision.ownedBy('booth', () =>
    collision.kinded('stall booth', () => (h.filled ? collision.toppedNarrow(0, build) : build())),
  );
  function build(): (WallCollider | BoxCollider)[] {
      // The back wall and the side panels, narrow-topped where they are panels.
      const panel = (a: [number, number], b: [number, number], height: number): WallCollider =>
        h.panelHalf === undefined ? wall(a, b, height) : collision.toppedNarrow(h.panelHalf, () => wall(a, b, height));
      const solids: (WallCollider | BoxCollider)[] = [wall(frontLeft, frontRight, h.front), panel(backLeft, backRight, h.back)];
      if (h.sideFront === undefined) {
        solids.push(panel(frontLeft, backLeft, h.sides), panel(frontRight, backRight, h.sides));
      } else {
        // Each side's whole length is one solid to the counter's height —
        // the very wall the booth claims, end for end, which is how
        // `stallsAreDrawnClaimedAndSolidTogether` finds a booth's collider —
        // and the drawn panel stands over the back of it to its own height.
        // Split in two instead, the claim matched no collider and every
        // restart with a booth in it was rejected.
        for (const [side, front, back] of [[-1, frontLeft, backLeft], [1, frontRight, backRight]] as const) {
          solids.push(wall(front, back, h.front), panel(back, toWorld(side * box.halfWidth, h.sideFront), h.sides));
        }
      }
      // **A cart's top is its board, not its walls'**: the walls round a
      // filled cart are what she bumps, a wall's thickness outside the drawn
      // body, and as tops they stood her a third of a metre out past the
      // cart's edge, on air (seeds 6 and 12, "0.50 m over the drawn
      // keychainShop"). So they hold nobody (`toppedNarrow(0)`, round the
      // whole build) and the filled core — the cart's own outline — is the
      // top she lands on.
      if (h.filled) {
        const [cx, cz] = toWorld(0, (box.front + box.back) / 2);
        solids.push(
          collision.toppedNarrow(Number.NaN, () =>
            collision.addBox(cx, cz, box.halfWidth, (box.front - box.back) / 2, -yaw, 0, yAtRadius(cx, cz, foot + h.front), false, true),
          ),
        );
      }
      if (h.awning) {
        const a = h.awning;
        const [cx, cz] = toWorld(0, (a.front + a.back) / 2);
        solids.push(
          collision.kinded('stall awning', () =>
            collision.addBox(cx, cz, a.halfWidth, (a.front - a.back) / 2, -yaw, 0, yAtRadius(cx, cz, foot + a.top), false, true, yAtRadius(cx, cz, foot + a.base)),
          ),
        );
      }
      if (h.canopy) {
        const c = h.canopy;
        const [cx, cz] = toWorld(c.x, c.z);
        // A disc, as a zero-length wall: the one round solid a mover can be
        // handed back (`restoreWall`), should the cart ever move.
        solids.push(
          collision.kinded('stall parasol', () =>
            collision.addWall(cx, cz, cx, cz, c.radius, yAtRadius(cx, cz, foot + c.top), false, true, yAtRadius(cx, cz, foot + c.base)),
          ),
        );
      }
      return solids;
  }
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
