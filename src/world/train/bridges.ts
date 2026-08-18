import { BoxGeometry, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { TrainRoute } from './route';
import type { LevelCrossing } from './crossings';
import { BRIDGE_RISE, FENCE_OFFSET } from './clearance';
import { terrainHeight } from '../terrain';
import { PALETTE } from '../../core/palette';
import { toonMaterial } from '../../art/style/materials';
import { ENTRANCE_RAMP } from '../building/layout';
import type { MovingPlatform } from '../building/surfaces';

/**
 * Hump-back wooden bridges over the railway (issue #116, Decision 8).
 *
 * The family's ruling of 28 July is that a path crosses the railway on a
 * bridge, never a level crossing. `world/train/crossings.ts` already finds
 * every place a drawn path meets the solved rail loop — this module is only
 * about what gets *built* there: a flat deck standing {@link BRIDGE_RISE}
 * above the ground under the track (so the train clears underneath — air
 * rules inverted from a ride crossing a ride), a walkable ramp up to it on
 * each side, and a fence seam that stays solid at the ground the deck is
 * *not* touching and stands aside only for someone actually up on the deck.
 *
 * ## Why the deck and ramps are `MovingPlatform`s, not a new surface kind
 *
 * `WalkSurfaces` already asks any registered `MovingPlatform` where its top
 * is — the lift, the bubble, the trampoline, every station platform and
 * carriage floor. The deck is flat, so it *is* one, directly. A ramp is not
 * flat, but `hotel/Hotel.ts`'s spiral stair already solved "a walkable slope
 * that is not axis-aligned" the same way a real flight of stairs does: many
 * small flat treads, non-overlapping, tiling the run exactly (`ArcTread`,
 * and its header's warning about what an overlap costs — a step you can
 * climb but never come back down, because `WalkSurfaces.sample` always
 * answers with the *highest* surface within a step). A ramp here is the
 * straight-line version of the same idea: flat strips climbing from the
 * ground to the deck, adjacent, never overlapping.
 *
 * `building/surfaces.ts`'s `RampDefinition` was Decision 8's other candidate
 * and was rejected there: its footprint is an axis-aligned rectangle and its
 * heights are measured from the building's own local origin, and a bridge
 * sits out in the park at whatever oblique angle procgen's path happened to
 * cross the railway at. Treads rotate with the crossing; a `RampDefinition`
 * cannot.
 *
 * ## The fence seam
 *
 * Decision 4 §6 keeps the rail fence's collision `topHeight` at `Infinity`
 * everywhere, on purpose — a *finite, relative* top is exactly what would let
 * a jump clear it (Decision 8's own correction records the near miss). This
 * module never touches that scheme. What it does instead, only for the short
 * run of fence posts that fall directly under a deck, is give that one run
 * an `topIsAbsolute` top pinned just under the deck's own surface — the same
 * mechanism `hotel/place.ts`'s standable props already use to be "solid from
 * the floor, standable from above" at one absolute world height. A walker at
 * ground level, however she got there, is nowhere near that height and stays
 * blocked, exactly as the fence has always blocked her; a walker who climbed
 * the ramp is standing *at* the deck's own Y and clears it. No jump reaches
 * either height from the ground, so the safety rule this exists to protect
 * (Decision 4 §6, keeping feet off the track) is untouched. `ParkTrain`
 * builds the fence with this module's {@link Bridge.deckCovers} in hand, and
 * `fence.ts` is the one place that turns it into the actual wall segments.
 *
 * ## Guard rails: `baseHeight`, the lobby's own idiom
 *
 * The deck and every ramp tread carry a rail along their outer edges so a
 * child cannot step off the side. Each is a banded collider — `baseHeight`
 * pinned a half-step below the local walking surface, exactly the imperial
 * lobby's overhanging landing rail — so it exists for someone standing near
 * that edge and is simply absent for the ground far below. The ramp's own
 * rails are additionally `navStamped`: Decision 8 names this exact hazard —
 * a ramp's edge levels run within a step of the ground beside it for most of
 * its low end, so an un-stamped rail there would leave the lattice free to
 * route sideways through the ramp's own flank onto the lawn it flanks.
 */

/**
 * Bridge ramps climb at the same steepness the park's own front steps do —
 * derived from `ENTRANCE_RAMP`, never a separately chosen number, so a
 * retune of the entrance moves the bridges with it rather than leaving two
 * "how steep is a ramp here" answers to drift apart.
 */
export const BRIDGE_RAMP_GRADIENT =
  Math.abs(ENTRANCE_RAMP.yTo - ENTRANCE_RAMP.yFrom) / Math.abs(ENTRANCE_RAMP.to - ENTRANCE_RAMP.from);

/**
 * Half-length of the deck along the crossing direction — has to clear both
 * fence lines (each {@link FENCE_OFFSET} out from the rail centre) with a
 * little margin so the deck's own edge does not sit flush on a fence post.
 */
const DECK_HALF_LENGTH = FENCE_OFFSET + 1.2;

/** Rise per ramp tread. Comfortably under `BUILDING_STEP_UP` (0.62 m) so
 * consecutive treads always read as one connected walking level. */
const TREAD_RISE = 0.28;

/** How far below a guard rail's own local surface it starts existing —
 * mirrors `hotel/place.ts`'s landing rail exactly. */
const GUARD_RAIL_BAND = 0.5;

const deckMaterial = toonMaterial(PALETTE.woodLight);
const beamMaterial = toonMaterial(PALETTE.woodDark);

/** A wall this module wants registered with `CollisionWorld`, deferred so the
 * caller (`ParkTrain`) controls exactly when colliders are added. */
export interface BridgeWall {
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
  readonly baseHeight: number;
  readonly navStamped: boolean;
}

export interface Bridge {
  /** World height of the deck's own walking surface. */
  readonly deckY: number;
  /** True over the deck or either ramp — everything this bridge makes walkable. */
  covers(x: number, z: number): boolean;
  /** True over the deck alone — what the fence seam keys off. */
  deckCovers(x: number, z: number): boolean;
  /** The continuous (unstepped) height of the bridge's own surface at this
   * point, for callers that want a smooth answer rather than the discrete
   * `MovingPlatform` treads a walker actually stands on — `poiGraph`'s
   * height-aware line-of-sight probe, primarily. Callers must check
   * {@link covers} first; this is only meaningful there. */
  heightAt(x: number, z: number): number;
}

export interface BuiltBridges {
  readonly group: Group;
  readonly bridges: readonly Bridge[];
  /** Every deck and tread, ready for `WalkSurfaces.addPlatform`. */
  readonly platforms: readonly MovingPlatform[];
  /** Every guard rail, ready for `collision.addWall`. */
  readonly guardRails: readonly BridgeWall[];
}

/** A flat, oriented rectangle of walking surface — the deck is one of these;
 * so is every ramp tread. */
class RectPlatform implements MovingPlatform {
  private readonly cx: number;
  private readonly cz: number;
  private readonly dirX: number;
  private readonly dirZ: number;
  private readonly acrossX: number;
  private readonly acrossZ: number;
  private readonly alongFrom: number;
  private readonly alongTo: number;
  private readonly halfAcross: number;
  readonly surfaceY: number;

  constructor(
    cx: number,
    cz: number,
    dirX: number,
    dirZ: number,
    acrossX: number,
    acrossZ: number,
    alongFrom: number,
    alongTo: number,
    halfAcross: number,
    surfaceY: number,
  ) {
    this.cx = cx;
    this.cz = cz;
    this.dirX = dirX;
    this.dirZ = dirZ;
    this.acrossX = acrossX;
    this.acrossZ = acrossZ;
    this.alongFrom = alongFrom;
    this.alongTo = alongTo;
    this.halfAcross = halfAcross;
    this.surfaceY = surfaceY;
  }

  covers(x: number, z: number): boolean {
    const dx = x - this.cx;
    const dz = z - this.cz;
    const along = dx * this.dirX + dz * this.dirZ;
    if (along < this.alongFrom || along >= this.alongTo) return false;
    const across = dx * this.acrossX + dz * this.acrossZ;
    return across >= -this.halfAcross && across <= this.halfAcross;
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Builds every bridge the park's crossings need, and the group holding all
 * of their geometry. `route` is currently unused by the geometry itself
 * (every number a bridge needs comes off its own crossing), but kept in the
 * signature to match `buildRailFence`'s and stay available the day a bridge
 * wants to check its own approach against the curve. */
export function buildBridges(_route: TrainRoute, crossings: readonly LevelCrossing[]): BuiltBridges {
  const group = new Group();
  group.name = 'railway-bridges';
  const bridges: Bridge[] = [];
  const platforms: MovingPlatform[] = [];
  const guardRails: BridgeWall[] = [];

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const position = new Vector3();
  const scale = new Vector3(1, 1, 1);

  for (const crossing of crossings) {
    const cx = crossing.x;
    const cz = crossing.z;
    const dirX = crossing.pathDirX;
    const dirZ = crossing.pathDirZ;
    // Perpendicular to the crossing direction — the rail's own tangent,
    // recovered by undoing the rotation `crossings.ts` built `pathDir` with
    // (`pathDirX = tangent.z, pathDirZ = -tangent.x`).
    const acrossX = -dirZ;
    const acrossZ = dirX;
    const halfAcross = crossing.halfGap;
    const groundY = terrainHeight(cx, cz);
    const deckY = groundY + BRIDGE_RISE;
    const yaw = Math.atan2(dirX, dirZ);
    const deckWidth = halfAcross * 2;

    const bridgeGroup = new Group();
    bridgeGroup.name = `bridge-${crossing.railDistance.toFixed(1)}`;

    // --- the deck ----------------------------------------------------------
    const deck = new RectPlatform(
      cx, cz, dirX, dirZ, acrossX, acrossZ,
      -DECK_HALF_LENGTH, DECK_HALF_LENGTH, halfAcross, deckY,
    );
    platforms.push(deck);

    const deckMesh = new InstancedMesh(new BoxGeometry(deckWidth, 0.16, DECK_HALF_LENGTH * 2), deckMaterial, 1);
    deckMesh.castShadow = true;
    deckMesh.receiveShadow = true;
    rotation.setFromAxisAngle(axis, yaw);
    position.set(cx, deckY - 0.08, cz);
    matrix.compose(position, rotation, scale);
    deckMesh.setMatrixAt(0, matrix);
    deckMesh.instanceMatrix.needsUpdate = true;
    bridgeGroup.add(deckMesh);

    // Two support beams under the deck's long edges — the truss a hump-back
    // bridge reads as standing on.
    const beamHeight = Math.max(0.4, BRIDGE_RISE - 0.3);
    const beamMesh = new InstancedMesh(new BoxGeometry(0.22, beamHeight, DECK_HALF_LENGTH * 2), beamMaterial, 2);
    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? 1 : -1;
      const bx = cx + acrossX * (halfAcross - 0.15) * sign;
      const bz = cz + acrossZ * (halfAcross - 0.15) * sign;
      position.set(bx, groundY + beamHeight / 2, bz);
      matrix.compose(position, rotation, scale);
      beamMesh.setMatrixAt(side, matrix);
    }
    beamMesh.instanceMatrix.needsUpdate = true;
    beamMesh.castShadow = true;
    bridgeGroup.add(beamMesh);

    // Guard rails along the deck's two long edges.
    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? 1 : -1;
      const railX = cx + acrossX * halfAcross * sign;
      const railZ = cz + acrossZ * halfAcross * sign;
      guardRails.push({
        x1: railX - dirX * DECK_HALF_LENGTH,
        z1: railZ - dirZ * DECK_HALF_LENGTH,
        x2: railX + dirX * DECK_HALF_LENGTH,
        z2: railZ + dirZ * DECK_HALF_LENGTH,
        baseHeight: deckY - GUARD_RAIL_BAND,
        navStamped: false, // the deck sits well above anything beside it
      });
    }

    // --- the two ramps -------------------------------------------------------
    const treadCount = Math.max(4, Math.ceil(BRIDGE_RISE / TREAD_RISE));
    const rampRun = BRIDGE_RISE / BRIDGE_RAMP_GRADIENT;
    const treadRun = rampRun / treadCount;
    const rampLowY: [number, number] = [groundY, groundY];

    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? 1 : -1;
      const farAlong = DECK_HALF_LENGTH + rampRun;
      const farX = cx + dirX * farAlong * sign;
      const farZ = cz + dirZ * farAlong * sign;
      const lowY = terrainHeight(farX, farZ);
      rampLowY[side] = lowY;

      const rampMesh = new InstancedMesh(new BoxGeometry(deckWidth, 0.16, treadRun + 0.04), deckMaterial, treadCount);
      for (let i = 0; i < treadCount; i += 1) {
        const fromAlong = DECK_HALF_LENGTH + i * treadRun;
        const toAlong = i === treadCount - 1 ? farAlong : DECK_HALF_LENGTH + (i + 1) * treadRun;
        const t = (i + 0.5) / treadCount;
        const y = deckY + (lowY - deckY) * t;

        const platformAlongFrom = sign > 0 ? fromAlong : -toAlong;
        const platformAlongTo = sign > 0 ? toAlong : -fromAlong;
        platforms.push(
          new RectPlatform(cx, cz, dirX, dirZ, acrossX, acrossZ, platformAlongFrom, platformAlongTo, halfAcross, y),
        );

        const midAlong = ((fromAlong + toAlong) / 2) * sign;
        position.set(cx + dirX * midAlong, y - 0.08, cz + dirZ * midAlong);
        matrix.compose(position, rotation, scale);
        rampMesh.setMatrixAt(i, matrix);
      }
      rampMesh.instanceMatrix.needsUpdate = true;
      rampMesh.castShadow = true;
      rampMesh.receiveShadow = true;
      bridgeGroup.add(rampMesh);

      // Guard rails down each ramp's flanks, banded in shorter runs so one
      // absolute `baseHeight` tracks the local tread height reasonably
      // closely along the whole slope, and `navStamped` throughout — see
      // the file header.
      const bandCount = Math.max(2, Math.ceil(treadCount / 3));
      for (let acrossSide = 0; acrossSide < 2; acrossSide += 1) {
        const acrossSign = acrossSide === 0 ? 1 : -1;
        for (let b = 0; b < bandCount; b += 1) {
          const fromAlong = DECK_HALF_LENGTH + (b / bandCount) * rampRun;
          const toAlong = DECK_HALF_LENGTH + ((b + 1) / bandCount) * rampRun;
          const midT = (fromAlong + toAlong) / 2 - DECK_HALF_LENGTH;
          const midY = deckY + (lowY - deckY) * (midT / rampRun);
          const fromX = cx + dirX * fromAlong * sign + acrossX * halfAcross * acrossSign;
          const fromZ = cz + dirZ * fromAlong * sign + acrossZ * halfAcross * acrossSign;
          const toX = cx + dirX * toAlong * sign + acrossX * halfAcross * acrossSign;
          const toZ = cz + dirZ * toAlong * sign + acrossZ * halfAcross * acrossSign;
          guardRails.push({
            x1: fromX, z1: fromZ, x2: toX, z2: toZ,
            baseHeight: midY - GUARD_RAIL_BAND,
            navStamped: true,
          });
        }
      }
    }

    const bridge: Bridge = {
      deckY,
      deckCovers: (x: number, z: number): boolean => deck.covers(x, z),
      covers: (x: number, z: number): boolean => {
        const dx = x - cx;
        const dz = z - cz;
        const along = dx * dirX + dz * dirZ;
        const across = dx * acrossX + dz * acrossZ;
        if (Math.abs(across) > halfAcross) return false;
        return Math.abs(along) <= DECK_HALF_LENGTH + rampRun;
      },
      heightAt: (x: number, z: number): number => {
        const dx = x - cx;
        const dz = z - cz;
        const along = dx * dirX + dz * dirZ;
        if (Math.abs(along) <= DECK_HALF_LENGTH) return deckY;
        const side = along > 0 ? 0 : 1;
        const t = clamp01((Math.abs(along) - DECK_HALF_LENGTH) / rampRun);
        return deckY + ((rampLowY[side] ?? groundY) - deckY) * t;
      },
    };
    bridges.push(bridge);
    group.add(bridgeGroup);
  }

  return { group, bridges, platforms, guardRails };
}
