import { BoxGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { TrainRoute } from './route';
import type { LevelCrossing } from './crossings';
import { BRIDGE_RISE } from './clearance';
import {
  ACROSS_MARGIN,
  DECK_HALF_LENGTH,
  planBridgeFootprints,
  type RealWorldQuery,
} from './bridgeFootprint';
import { terrainHeight } from '../terrain';
import { PALETTE } from '../../core/palette';
import { toonMaterial } from '../../art/style/materials';
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

/** Rise per ramp tread. Comfortably under `BUILDING_STEP_UP` (0.62 m) so
 * consecutive treads always read as one connected walking level. */
const TREAD_RISE = 0.28;

/** How far below a guard rail's own local surface it starts existing —
 * mirrors `hotel/place.ts`'s landing rail exactly. */
const GUARD_RAIL_BAND = 0.5;

/**
 * Safety margin added on top of the worst (highest) ground sampled across a
 * deck's own footprint, before it counts as clearing {@link BRIDGE_RISE}.
 *
 * `check:park`'s invariant 2 measures clearance at wherever a *specific*
 * route actually crosses the rail — which, across a corridor several metres
 * wide, is not always the exact crossing centre a deck's own height is
 * derived from. The terrain wanders (~1.4 m across the whole park), so a
 * deck built to clear only its own centre point missed by hundredths of a
 * metre where a route crossed nearer the corridor's edge. Sampling several
 * points across the deck's width (below) and taking the highest closes most
 * of that gap; this covers what sampling still misses.
 */
const HEIGHT_MARGIN = 0.15;

const deckMaterial = toonMaterial(PALETTE.woodLight);
const beamMaterial = toonMaterial(PALETTE.woodDark);
const postMaterial = toonMaterial(PALETTE.woodDark);

/** How tall a visible deck-rail post stands above the deck — comfortably
 * below a walking child's eye line (never mind obscuring one riding past
 * on the train, GAME_DESIGN.md's "a small bridge does not obscure a player
 * walking on it"), and comfortably above where the real, collision guard
 * rail's own band starts (`GUARD_RAIL_BAND` below the deck). */
const VISIBLE_RAIL_HEIGHT = 0.7;

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
  /**
   * True over the deck alone — what the fence seam keys off. `margin`
   * defaults to `0`, the deck's own exact edge (what `heightAt` and every
   * ordinary caller wants); `fence.ts` is the one caller that asks with a
   * margin, because an un-seamed fence run just past that exact edge can
   * still have its own half-thickness (`TRACK_CLEARANCE`, 1.3 m for the
   * centre-line run) reach back in and touch a point nominally "on" the
   * deck — the same class of bug `bridgeKeepout.ts`'s own margin exists
   * for, found on the same tightly-boundary-capped crossing (issue #116,
   * seed 11: the un-seamed continuation of the centre-line wall, one
   * segment past where a severely narrowed deck's width ended, still
   * reached a probe standing dead centre on the deck).
   */
  deckCovers(x: number, z: number, margin?: number): boolean;
  /**
   * True over the deck or either ramp, padded `margin` past the bridge's
   * own **real, final** edge — for a caller built *after* `ParkTrain`
   * (`World.ts`'s own order) that wants a genuine keepout around this
   * specific bridge without the padding `train/bridgeKeepout.ts`'s
   * `isInBridgeFootprint` necessarily carries for callers built *before* a
   * single bridge exists (see that file's own header).
   *
   * `coaster/Coaster.ts`'s pylon search is the one caller: it used to ask
   * `isInBridgeFootprint`, whose reservation pads a crossing's own width by
   * `maxLateralShiftFor` — up to the crossing's full `halfGap`, deliberately
   * generous because the *real* pass has not run yet when the early passes
   * ask it — plus `ACROSS_MARGIN` and a further `KEEPOUT_MARGIN`. Stacked on
   * an oblique, wide-`halfGap` crossing that reservation rectangle can run
   * to several dozen metres wide, and asked *after* the real bridge is
   * built, it excludes far more ground than the bridge that actually stands
   * there occupies — found reviewing PR #330, seed 11: a 37 m stretch of the
   * Sky Cruiser with no legitimate obstacle at all, every candidate along it
   * rejected by the conservative reservation of a crossing whose *real*
   * bridge was a fraction of that width. This asks the real, already-built
   * footprint instead, which is exactly as wide as the deck and ramps this
   * bridge actually has.
   */
  footprintNear(x: number, z: number, margin: number): boolean;
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
  /**
   * Crossings the real, backtracking search (`bridgeFootprint.ts`'s
   * `planReal`) could not find any walkable, collision-clear bridge
   * configuration for at all — genuinely the last resort, not the common
   * case (issues #317, #319; `CLAUDE.md`'s "procgen backtracks on
   * collision"). `fence.ts` opens an ordinary ground-level gap for each of
   * these instead of seaming a deck over it.
   */
  readonly fallbackCrossings: readonly LevelCrossing[];
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

/**
 * The highest bridge surface over `(x, z)`, or `null` off every bridge.
 *
 * **Not** "the first bridge that covers it." Two crossings close enough
 * together (their ramps run up to `BRIDGE_RISE / BRIDGE_RAMP_GRADIENT`,
 * ~18 m, each way) can have one bridge's ramp and a neighbour's deck both
 * genuinely cover the same point, and a fence seam is built against
 * whichever is taller there (`WalkSurfaces.sample` picks the highest
 * surface everywhere else in the park; this is the one place that logic
 * lived outside `WalkSurfaces` and it must not quietly disagree). Picking
 * the first in list order instead of the tallest handed a `poiGraph` probe
 * a ramp's low height at a point a neighbour's much taller deck also
 * claimed — the deck's own fence seam sits well above that height, so the
 * probe read as blocked by a wall a walker actually standing at the height
 * the deck offers would have cleared (found live, issue #116). The single
 * owner both `World.ts` and `check-park.mts` call, so the two can never
 * repeat that disagreement independently.
 */
export function bridgeHeightAt(bridges: readonly Bridge[], x: number, z: number): number | null {
  let best: number | null = null;
  for (const bridge of bridges) {
    if (!bridge.covers(x, z)) continue;
    const height = bridge.heightAt(x, z);
    if (best === null || height > best) best = height;
  }
  return best;
}

/**
 * Builds every bridge the park's crossings need, and the group holding all
 * of their geometry. `route` is currently unused by the geometry itself
 * (every number a bridge needs comes off its own crossing), but kept in the
 * signature to match `buildRailFence`'s and stay available the day a bridge
 * wants to check its own approach against the curve.
 *
 * `real` is the actual, already-mostly-built collision world — `ParkTrain`
 * is constructed after almost everything else in `World` (see `World.ts`'s
 * own build-order comments), so by the time this runs, the boundary, every
 * garden wall and tree, every lamp post, the castle, the hotel and every
 * stall are already real, registered colliders. See `bridgeFootprint.ts`'s
 * own header for why this matters (issues #317, #319).
 */
export function buildBridges(
  _route: TrainRoute,
  crossings: readonly LevelCrossing[],
  real: RealWorldQuery,
): BuiltBridges {
  const group = new Group();
  group.name = 'railway-bridges';
  const bridges: Bridge[] = [];
  const platforms: MovingPlatform[] = [];
  const guardRails: BridgeWall[] = [];
  const fallbackCrossings: LevelCrossing[] = [];

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const position = new Vector3();
  const scale = new Vector3(1, 1, 1);

  // One footprint per crossing, same order — the single owner of every
  // ground-plane number below, shared with whatever keeps scenery off a
  // ramp before it exists (`bridgeKeepout.ts`, the early conservative pass).
  // A `null` entry is a crossing the real, backtracking search found no
  // walkable, collision-clear bridge for at all — see `BuiltBridges.
  // fallbackCrossings`'s own note.
  const footprints = planBridgeFootprints(crossings, real);

  for (let crossingIndex = 0; crossingIndex < crossings.length; crossingIndex += 1) {
    const crossing = crossings[crossingIndex] as LevelCrossing;
    const footprint = footprints[crossingIndex];
    if (!footprint) {
      fallbackCrossings.push(crossing);
      continue;
    }
    const cx = footprint.cx;
    const cz = footprint.cz;
    const dirX = footprint.dirX;
    const dirZ = footprint.dirZ;
    const acrossX = footprint.acrossX;
    const acrossZ = footprint.acrossZ;
    const halfAcross = footprint.halfAcross;
    // Guard rails stand further out again than the walkable surface's own
    // edge — a second margin on top of the first. `ACROSS_MARGIN` keeps a
    // drawn path's own waypoints off the surface's edge; this keeps them off
    // a *rail* planted right at that edge, which the surface alone never had
    // to contend with (see `ACROSS_MARGIN`'s own note).
    const railHalfAcross = halfAcross + ACROSS_MARGIN;
    const groundY = terrainHeight(cx, cz);
    // The deck's own datum is the *worst* (highest) ground sampled across
    // its full width, not just the crossing's own centre point — see
    // `HEIGHT_MARGIN`. Any real route may cross the rail anywhere within
    // this corridor, not only at the point `crossings.ts` picked to
    // represent it.
    let worstGroundY = groundY;
    for (const t of [-1, -0.5, 0, 0.5, 1]) {
      const sampleX = cx + acrossX * halfAcross * t;
      const sampleZ = cz + acrossZ * halfAcross * t;
      worstGroundY = Math.max(worstGroundY, terrainHeight(sampleX, sampleZ));
    }
    const deckY = worstGroundY + BRIDGE_RISE + HEIGHT_MARGIN;
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
    // Named so `test/procgen/invariants.ts` can find the real, built deck
    // and measure its own soffit — never `BRIDGE_DECK_DEPTH` (a claim, not
    // a derivation, by its own doc) and never this box's height literal
    // restated a second place either.
    deckMesh.name = 'deck';
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
      const railX = cx + acrossX * railHalfAcross * sign;
      const railZ = cz + acrossZ * railHalfAcross * sign;
      guardRails.push({
        x1: railX - dirX * DECK_HALF_LENGTH,
        z1: railZ - dirZ * DECK_HALF_LENGTH,
        x2: railX + dirX * DECK_HALF_LENGTH,
        z2: railZ + dirZ * DECK_HALF_LENGTH,
        baseHeight: deckY - GUARD_RAIL_BAND,
        navStamped: false, // the deck sits well above anything beside it
      });
    }

    // The same two edges, drawn — a low post-and-rail so the invisible
    // collision guard above reads as an actual bridge rail rather than an
    // unmarked ledge. Kept low on purpose (see `VISIBLE_RAIL_HEIGHT`) so it
    // cannot be what GAME_DESIGN.md's "a small bridge does not obscure a
    // player walking on it" is worried about.
    const postsPerSide = Math.max(2, Math.ceil((DECK_HALF_LENGTH * 2) / 1.6) + 1);
    const postMesh = new InstancedMesh(
      new CylinderGeometry(0.05, 0.06, VISIBLE_RAIL_HEIGHT, 6),
      postMaterial,
      postsPerSide * 2,
    );
    const railMesh = new InstancedMesh(
      new BoxGeometry(0.07, 0.06, DECK_HALF_LENGTH * 2),
      deckMaterial,
      2,
    );
    let postIndex = 0;
    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? 1 : -1;
      const railX = cx + acrossX * halfAcross * sign;
      const railZ = cz + acrossZ * halfAcross * sign;
      for (let p = 0; p < postsPerSide; p += 1) {
        const along = -DECK_HALF_LENGTH + (p / (postsPerSide - 1)) * (DECK_HALF_LENGTH * 2);
        position.set(railX + dirX * along, deckY + VISIBLE_RAIL_HEIGHT / 2, railZ + dirZ * along);
        matrix.compose(position, rotation.identity(), scale);
        postMesh.setMatrixAt(postIndex, matrix);
        postIndex += 1;
      }
      rotation.setFromAxisAngle(axis, yaw);
      position.set(railX, deckY + VISIBLE_RAIL_HEIGHT, railZ);
      matrix.compose(position, rotation, scale);
      railMesh.setMatrixAt(side, matrix);
    }
    postMesh.instanceMatrix.needsUpdate = true;
    railMesh.instanceMatrix.needsUpdate = true;
    bridgeGroup.add(postMesh, railMesh);

    // --- the two ramps -------------------------------------------------------
    const treadCount = Math.max(4, Math.ceil(BRIDGE_RISE / TREAD_RISE));

    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? 1 : -1;
      // `footprint.rampRunPos`/`rampRunNeg` already account for how close the
      // *next* crossing is, and how close the park's own boundary is, on
      // this specific side — not just the entrance ramp's own gradient. See
      // `bridgeFootprint.ts`'s own note on `rampRunCap` and on why the two
      // sides are tracked separately. Read here rather than recomputed, so
      // the mesh this builds and the ground-plane exclusion `Scenery`/
      // `LampPosts` already kept off of it (`bridgeKeepout.ts`) can never
      // disagree about how far a ramp reaches.
      const rampRun = sign > 0 ? footprint.rampRunPos : footprint.rampRunNeg;
      const treadRun = rampRun / treadCount;
      const farAlong = DECK_HALF_LENGTH + rampRun;
      const farX = cx + dirX * farAlong * sign;
      const farZ = cz + dirZ * farAlong * sign;
      const lowY = terrainHeight(farX, farZ);

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

      // No guard rail down a ramp's own flanks, deliberately, unlike the
      // deck's (above). The deck stands several metres over a moving train
      // and losing the edge there is exactly the fall a bridge exists to
      // prevent; a ramp is a gentle, ordinary slope over ordinary lawn —
      // stepping off its side is no different from stepping off any other
      // path's edge in this park, none of which carry a rail either. It is
      // also where a straight `poiGraph` chord between two waypoints
      // sampled off the *real, curved* drawn path is least likely to match
      // this bridge's own straight, fixed-width rectangle: a rail planted
      // tight to that rectangle's edge caught a live edge that curved
      // slightly wide of it (found live, issue #116). The deck does not
      // have this problem — it is short, so a crossing edge's own curvature
      // barely has room to drift before it is past the deck entirely.
    }

    const bridge: Bridge = {
      deckY,
      // Not `deck.covers(x, z)` — `RectPlatform` implements the generic
      // `MovingPlatform` interface, which has no margin parameter and
      // should not grow one just for this. The deck rectangle's own
      // geometry (`cx`, `cz`, `dirX`, `dirZ`, `acrossX`, `acrossZ`,
      // `halfAcross`, `DECK_HALF_LENGTH`) is already in scope here, so the
      // padded test is restated directly rather than routed through a
      // second object.
      deckCovers: (x: number, z: number, margin = 0): boolean => {
        const dx = x - cx;
        const dz = z - cz;
        const along = dx * dirX + dz * dirZ;
        const across = dx * acrossX + dz * acrossZ;
        return Math.abs(along) <= DECK_HALF_LENGTH + margin && Math.abs(across) <= halfAcross + margin;
      },
      covers: (x: number, z: number): boolean => footprint.covers(x, z),
      footprintNear: (x: number, z: number, margin: number): boolean => footprint.covers(x, z, margin),
      // Blends toward the **local** ground under `(x, z)` itself, not a
      // single "low end" reference sampled once at across = 0 — a ramp is
      // several metres wide, the terrain it descends onto is not flat
      // across that width, and a fixed reference disagreed with the real
      // ground by enough, right at the ramp's own low edge, to graze a
      // guard rail's `baseHeight` a `poiGraph` probe standing there had no
      // way to know about (found live: an edge stepping off a ramp exactly
      // at that seam). Blending to `terrainHeight(x, z)` itself instead
      // means the two *necessarily* agree in the limit — at `t = 1` this
      // returns exactly what `groundAt` reports one step outside `covers()`,
      // because both read the same function.
      heightAt: (x: number, z: number): number => {
        const dx = x - cx;
        const dz = z - cz;
        const along = dx * dirX + dz * dirZ;
        if (Math.abs(along) <= DECK_HALF_LENGTH) return deckY;
        const rampRun = along >= 0 ? footprint.rampRunPos : footprint.rampRunNeg;
        // `rampRun` can be `0` on a side the boundary truncation floored all
        // the way down (`bridgeFootprint.ts`'s own note on the gate-walk
        // crossing) — `covers()` then only ever admits `along` up to exactly
        // `DECK_HALF_LENGTH` on that side, so this branch should never be
        // asked about it, but a division by a real `0` here would answer
        // `NaN` rather than throw, which is a silent wrong answer instead of
        // a loud one. Guarded rather than trusted.
        const t = rampRun > 0 ? clamp01((Math.abs(along) - DECK_HALF_LENGTH) / rampRun) : 1;
        return deckY + (terrainHeight(x, z) - deckY) * t;
      },
    };
    bridges.push(bridge);
    group.add(bridgeGroup);
  }

  return { group, bridges, platforms, guardRails, fallbackCrossings };
}
