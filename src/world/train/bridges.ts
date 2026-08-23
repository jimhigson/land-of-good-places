import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import type { TrainRoute } from './route';
import type { LevelCrossing } from './crossings';
import { BRIDGE_DECK_DEPTH, BRIDGE_RISE } from './clearance';
import {
  BRIDGE_WALL_THICKNESS,
  DECK_HALF_LENGTH,
  planBridgeFootprints,
  type BridgeFootprint,
  type RealWorldQuery,
} from './bridgeFootprint';
import { TRACK_CLEARANCE } from './route';
import { terrainHeight } from '../terrain';
import { PALETTE } from '../../core/palette';
import { pinkStoneTexture } from '../../core/textures';
import { toonMaterial } from '../../art/style/materials';
import type { MovingPlatform } from '../building/surfaces';

/**
 * Hump-back masonry bridges over the railway (issue #116, Decision 8;
 * reworked to Jim's 2026-08-23 feedback against a reference photo of a real
 * model-railway humpback bridge kit).
 *
 * The family's ruling of 28 July is that a path crosses the railway on a
 * bridge, never a level crossing. `world/train/crossings.ts` finds every
 * place a drawn path meets the solved rail loop — this module is only about
 * what gets *built* there, and what gets built is now a genuine humpback
 * bridge:
 *
 * - **The road surface is one smooth, continuous hump** — no flat deck, no
 *   stepped ramp treads. The path's own surface rises into a gentle hill
 *   and comes back down ({@link surfaceProfile}, a smootherstep curve with
 *   zero slope at the crown and both feet), so walking it reads as "the
 *   path goes up and over", never "stairs, platform, stairs".
 * - **Exactly as wide as the path it carries** — `roadHalf` is the drawn
 *   path's own `pathHalfWidth` (`crossings.ts` reads it off the paving
 *   samples), with only the masonry parapet walls outside it. The old
 *   geometry keyed its width off `halfGap` (a fence-gap length measured
 *   along the *rail*) and shipped 12.9–15.8 m decks over ~4 m paths.
 * - **It follows the path's own curve** — every mesh, collider and height
 *   answer goes through the crossing's `SpineFrame`
 *   (`bridgeSpine.ts`), which walks the drawn centreline instead of
 *   forcing a straight line.
 * - **A real arched stone tunnel underneath** — the masonry mass carries a
 *   genuine opening over the rail corridor: short abutment walls, curved
 *   haunches, and a crown span whose soffit clears the train and its
 *   riders by the same `TRAIN_CLEARANCE_Y` everything else respects. The
 *   crown-span soffit is its own mesh named `deck`, which is what
 *   `test/procgen/invariants.ts` measures the built clearance off — the
 *   lowest visible vertex of the thing that actually stands over the
 *   train. Nothing else of the bridge enters the swept rail corridor: the
 *   old geometry stood two support beams *across the track* (they ran the
 *   deck's full length at its outer edges — i.e. down the rail line either
 *   side of the crossing), which is the "walls covering the train track"
 *   bug of the same feedback round.
 * - **Pink stone, the park's own** — `pinkStoneTexture`/`PALETTE.stonePink`
 *   exactly as the garden walls and the rail fence already use, never a
 *   new colour.
 *
 * ## Walkability: one height-varying platform, not stacked treads
 *
 * `WalkSurfaces` asks a registered `MovingPlatform` where its top is; the
 * old ramps were dozens of small flat platforms (the hotel-stair idiom).
 * The hump is instead ONE platform per bridge whose `surfaceYAt` answers
 * the smooth profile — `building/surfaces.ts` grew that optional method
 * for exactly this. `NavGrid` needs nothing new: a bridge cell already
 * takes its single level from the sampler, which now reads the smooth
 * height.
 *
 * ## The fence seam
 *
 * Unchanged in mechanism (see `fence.ts`): the rail fence runs on beneath
 * the bridge, `topIsAbsolute`-pinned just under the *local* road surface
 * (not one flat deck height — the hump's surface at the fence line is what
 * a walker's feet are actually at there).
 *
 * ## Parapets are walls, and walls are solid
 *
 * Each side wall (spandrel + parapet, one visual piece) gets real collision
 * for its whole length: full-height walls with an absolute top at the local
 * road surface plus the parapet, so nobody walks through the masonry from
 * the lawn and nobody steps off the hump into the air over the train —
 * CLAUDE.md's "anything that looks solid must be solid".
 */

/** How high the parapet stands above the local road surface. Low enough
 * never to hide a walking child (GAME_DESIGN.md's "a small bridge does not
 * obscure a player walking on it"), high enough to read as a real stone
 * parapet rather than a kerb. */
const PARAPET_HEIGHT = 0.72;

/**
 * Half-span (along the path) of the arch's flat crown — the stretch of
 * soffit that must clear the train at full height, and the extent of the
 * mesh named `deck` the invariants measure. The train's own swept
 * half-width (`TRACK_CLEARANCE`) plus a stride, so a slightly oblique or
 * gently curving rail line under the bridge still keeps every part of the
 * train under the full-height crown.
 */
const ARCH_CLEAR_HALF = TRACK_CLEARANCE + 0.5;

/** Half-span (along the path) of the whole arch opening — abutment inner
 * faces stand here. `DECK_HALF_LENGTH` clears both fence lines with margin
 * (its own doc), so the tunnel swallows the entire fenced corridor and the
 * masonry only ever stands on ground the fence already forbids to feet. */
const ARCH_SPAN_HALF = DECK_HALF_LENGTH;

/** Minimum masonry left between the road surface and the crown soffit —
 * the shell can pinch to this where the hump's surface dips toward the
 * arch's edge, and {@link crownHeightFor} raises the crown if the profile
 * would pinch it thinner. */
const MIN_SHELL_DEPTH = 0.05;

/**
 * Safety margin added on top of the worst (highest) ground sampled across
 * the crown's own footprint, before it counts as clearing
 * {@link BRIDGE_RISE} — see the old geometry's note of the same name: a
 * route can cross the rail anywhere across the corridor, and the terrain
 * wanders (~1.4 m park-wide), so the crown is derived from the worst
 * sampled ground, plus this.
 */
const HEIGHT_MARGIN = 0.15;

/** Along-axis sampling pitch of the built shell, metres. */
const SHELL_STEP = 0.6;

/** Pitch of the parapet collision-wall segments, metres. */
const WALL_SEGMENT = 2.0;

const stoneMaterial = toonMaterial(0xffffff, { map: pinkStoneTexture(1, 1) });
const copingMaterial = toonMaterial(PALETTE.stonePinkLight);

/** Metres of masonry per texture tile — sized so a stone course reads at
 * about half a metre, the same chunkiness the garden walls carry. */
const TEXTURE_METRES = 2.4;

/** A wall this module wants registered with `CollisionWorld`, deferred so
 * the caller (`ParkTrain`) controls exactly when colliders are added.
 * Solid from the ground with an ABSOLUTE top: the masonry blocks anyone
 * beside the bridge at ground level, and its top — local road surface plus
 * parapet — stops anyone on the hump stepping over the side. */
export interface BridgeWall {
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
  /** Absolute world height of the parapet's top over this segment. */
  readonly topHeight: number;
}

export interface Bridge {
  /** World height of the hump's crown — the highest point of the road. */
  readonly deckY: number;
  /** True over the whole hump — everything this bridge makes walkable. */
  covers(x: number, z: number): boolean;
  /**
   * True over the central span alone (the stretch standing over the rail
   * corridor) — what the fence seam keys off. `margin` pads outward;
   * `fence.ts` is the caller that needs one (its walls have their own
   * half-thickness — see that file).
   */
  deckCovers(x: number, z: number, margin?: number): boolean;
  /**
   * True over the hump padded `margin` past the bridge's own real, final
   * masonry edge — for a caller built *after* `ParkTrain` (`World.ts`'s own
   * order) that wants a genuine keepout around this specific bridge.
   * `coaster/Coaster.ts`'s pylon search is the one caller — see PR #330's
   * finding on the over-wide early reservation.
   */
  footprintNear(x: number, z: number, margin: number): boolean;
  /** The smooth, continuous height of the hump's own surface at this point
   * — the single owner of the profile. Callers must check {@link covers}
   * first; beyond the hump it clamps to the local terrain. */
  heightAt(x: number, z: number): number;
}

export interface BuiltBridges {
  readonly group: Group;
  readonly bridges: readonly Bridge[];
  /** One height-varying platform per bridge, for `WalkSurfaces.addPlatform`. */
  readonly platforms: readonly MovingPlatform[];
  /** Every parapet/spandrel wall, ready for `collision.addWall`. */
  readonly guardRails: readonly BridgeWall[];
  /**
   * Crossings the real, backtracking search (`bridgeFootprint.ts`'s
   * `planReal`) could not find any walkable, collision-clear bridge
   * configuration for at all — genuinely the last resort (issues #317,
   * #319). `fence.ts` opens an ordinary ground-level gap for each of these
   * instead of seaming a hump over it.
   */
  readonly fallbackCrossings: readonly LevelCrossing[];
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Smootherstep — zero first AND second derivative at both ends, so the
 * hump's crown and both feet blend with no visible crease, and the peak
 * slope stays a mild 1.875× the average grade (comfortably inside what
 * `NavGrid` links as one walking level at its cell pitch). */
function smootherstep(q: number): number {
  const t = clamp01(q);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * The highest bridge surface over `(x, z)`, or `null` off every bridge.
 * See the old geometry's note (issue #116): two close crossings can both
 * cover a point, and every consumer must agree with `WalkSurfaces.sample`'s
 * "highest surface wins". The single owner both `World.ts` and
 * `check-park.mts` call.
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
 * of their geometry. `real` is the actual, already-mostly-built collision
 * world — see `bridgeFootprint.ts`'s header (issues #317, #319).
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

  // One footprint per crossing, same order — the single owner of every
  // ground-plane number below, shared with whatever keeps scenery off the
  // hump before it exists (`bridgeKeepout.ts`, the early conservative
  // pass). A `null` entry is a crossing the real, backtracking search found
  // no walkable, collision-clear bridge for at all.
  const footprints = planBridgeFootprints(crossings, real);

  for (let crossingIndex = 0; crossingIndex < crossings.length; crossingIndex += 1) {
    const crossing = crossings[crossingIndex] as LevelCrossing;
    const footprint = footprints[crossingIndex];
    if (!footprint) {
      fallbackCrossings.push(crossing);
      continue;
    }
    const built = buildOneBridge(crossing, footprint);
    bridges.push(built.bridge);
    platforms.push(built.platform);
    guardRails.push(...built.walls);
    group.add(built.group);
  }

  return { group, bridges, platforms, guardRails, fallbackCrossings };
}

interface OneBridge {
  readonly bridge: Bridge;
  readonly platform: MovingPlatform;
  readonly walls: BridgeWall[];
  readonly group: Group;
}

function buildOneBridge(crossing: LevelCrossing, footprint: BridgeFootprint): OneBridge {
  const { frame, shift, halfAcross, roadHalf, walkHalf, rampRunPos, rampRunNeg } = footprint;
  const lengthPos = DECK_HALF_LENGTH + rampRunPos;
  const lengthNeg = DECK_HALF_LENGTH + rampRunNeg;

  // --- the crown height ----------------------------------------------------
  // The worst (highest) ground sampled across the crown's own footprint —
  // any real route may cross the rail anywhere within this corridor, so
  // every point of the crown span has to clear `BRIDGE_RISE` over the worst
  // of it, not just the crossing's own centre point.
  let worstGroundY = -Infinity;
  let lowestCrownEdgeGroundY = Infinity;
  for (let along = -ARCH_CLEAR_HALF; along <= ARCH_CLEAR_HALF + 1e-6; along += ARCH_CLEAR_HALF / 2) {
    for (const t of [-1, -0.5, 0, 0.5, 1]) {
      const { x, z } = frame.worldAt(along, halfAcross * t, shift);
      const ground = terrainHeight(x, z);
      worstGroundY = Math.max(worstGroundY, ground);
      if (Math.abs(Math.abs(along) - ARCH_CLEAR_HALF) < 1e-6) {
        lowestCrownEdgeGroundY = Math.min(lowestCrownEdgeGroundY, ground);
      }
    }
  }
  const crownBase = worstGroundY + BRIDGE_RISE + HEIGHT_MARGIN;
  // The hump's surface dips a little between the crown (along = 0) and the
  // arch's clear edge (±ARCH_CLEAR_HALF); the flat crown soffit sits
  // `BRIDGE_DECK_DEPTH` under the crown, so the surface at that edge must
  // still leave `MIN_SHELL_DEPTH` of masonry over it. Solve the profile for
  // the crown height that guarantees it — see `surfaceProfile`.
  const shorterLength = Math.min(lengthPos, lengthNeg);
  const dipFraction = smootherstep(ARCH_CLEAR_HALF / Math.max(shorterLength, ARCH_CLEAR_HALF + 0.1));
  // surface(edge) = crown − (crown − ground)·dip ≥ crownBase − BRIDGE_DECK_DEPTH + MIN_SHELL_DEPTH
  const needed =
    (crownBase - BRIDGE_DECK_DEPTH + MIN_SHELL_DEPTH - lowestCrownEdgeGroundY * dipFraction) /
    (1 - dipFraction);
  const crownY = Math.max(crownBase, needed);
  const soffitCrownY = crownBase - BRIDGE_DECK_DEPTH;

  // --- the surface profile — the ONE owner of the hump's shape -------------
  const surfaceProfile = (x: number, z: number, along: number): number => {
    const length = along >= 0 ? lengthPos : lengthNeg;
    const q = length > 0 ? clamp01(Math.abs(along) / length) : 1;
    const ground = terrainHeight(x, z);
    // Blends to the *local* ground at the feet by construction (q = 1 →
    // ground exactly), the same guarantee the old ramp geometry made — see
    // its note on why blending to a single "low end" reference misled a
    // poiGraph probe at the ramp's own low edge.
    return ground + (crownY - ground) * (1 - smootherstep(q));
  };
  const heightAt = (x: number, z: number): number => {
    const projected = frame.project(x, z, shift);
    return surfaceProfile(x, z, projected.along);
  };

  // --- the arch soffit -----------------------------------------------------
  // Flat full-height crown over |along| ≤ ARCH_CLEAR_HALF; a quarter-round
  // haunch curving down to the springing at |along| = ARCH_SPAN_HALF; solid
  // masonry (to the ground) beyond. Radius = span difference, so the
  // haunch meets both neighbours tangent-free but visually round — a
  // slightly stilted arch, which is what lets a tunnel only 6.4 m wide
  // still clear a train nearly 4 m tall (a true semicircle of that span
  // could not).
  const haunchRadius = ARCH_SPAN_HALF - ARCH_CLEAR_HALF;
  const springY = soffitCrownY - haunchRadius;
  const soffitAt = (alongAbs: number): number => {
    if (alongAbs <= ARCH_CLEAR_HALF) return soffitCrownY;
    if (alongAbs >= ARCH_SPAN_HALF) return springY;
    const u = (alongAbs - ARCH_CLEAR_HALF) / haunchRadius;
    return springY + haunchRadius * Math.sqrt(Math.max(0, 1 - u * u));
  };

  // --- meshes ---------------------------------------------------------------
  const bridgeGroup = new Group();
  // The same name the invariants find this crossing's own group under —
  // one owner (the crossing's `railDistance`) for both.
  bridgeGroup.name = `bridge-${crossing.railDistance.toFixed(1)}`;

  // The crown-span soffit — the thing that actually stands over the train,
  // named `deck` so `test/procgen/invariants.ts` measures the real, built
  // clearance off its own lowest visible vertex.
  const at0 = frame.pointAt(0);
  const origin0 = frame.worldAt(0, 0, shift);
  const deckMesh = new Mesh(
    new BoxGeometry(halfAcross * 2, 0.12, ARCH_CLEAR_HALF * 2),
    stoneMaterial,
  );
  deckMesh.name = 'deck';
  deckMesh.castShadow = true;
  deckMesh.receiveShadow = true;
  const yaw = Math.atan2(at0.dirX, at0.dirZ);
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const matrix = new Matrix4().compose(
    new Vector3(origin0.x, soffitCrownY + 0.06, origin0.z),
    rotation,
    new Vector3(1, 1, 1),
  );
  deckMesh.applyMatrix4(matrix);
  bridgeGroup.add(deckMesh);

  // The masonry shell — road surface, spandrel/parapet walls, coping, the
  // arch haunches and the abutment faces — one BufferGeometry swept along
  // the frame so the whole thing follows the path's own curve.
  const shell = buildShellGeometry(
    frame,
    shift,
    lengthNeg,
    lengthPos,
    roadHalf,
    halfAcross,
    surfaceProfile,
    soffitAt,
    springY,
  );
  const shellMesh = new Mesh(shell.stone, stoneMaterial);
  shellMesh.castShadow = true;
  shellMesh.receiveShadow = true;
  const copingMesh = new Mesh(shell.coping, copingMaterial);
  copingMesh.castShadow = true;
  bridgeGroup.add(shellMesh, copingMesh);

  // --- collision: the parapet/spandrel walls -------------------------------
  const walls: BridgeWall[] = [];
  const wallLine = roadHalf + BRIDGE_WALL_THICKNESS / 2;
  for (const side of [1, -1] as const) {
    let previous = frame.worldAt(-lengthNeg, wallLine * side, shift);
    let previousAlong = -lengthNeg;
    for (let along = -lengthNeg + WALL_SEGMENT; along <= lengthPos + WALL_SEGMENT - 1e-6; along += WALL_SEGMENT) {
      const clamped = Math.min(along, lengthPos);
      const point = frame.worldAt(clamped, wallLine * side, shift);
      const topA = surfaceProfile(previous.x, previous.z, previousAlong);
      const topB = surfaceProfile(point.x, point.z, clamped);
      walls.push({
        x1: previous.x,
        z1: previous.z,
        x2: point.x,
        z2: point.z,
        topHeight: Math.max(topA, topB) + PARAPET_HEIGHT,
      });
      previous = point;
      previousAlong = clamped;
      if (clamped >= lengthPos) break;
    }
  }

  // --- the walkable surface -------------------------------------------------
  // One height-varying platform for the whole hump. Its own footprint is
  // the paved road (parapet inner faces), a little wider than the
  // *standable* extent `covers()` reports — a walker pressed against the
  // parapet still has floor under her feet.
  const platform: MovingPlatform = {
    surfaceY: crownY,
    covers: (x: number, z: number): boolean => {
      const projected = frame.project(x, z, shift);
      if (Math.abs(projected.across) > roadHalf) return false;
      const length = projected.along >= 0 ? lengthPos : lengthNeg;
      return Math.abs(projected.along) <= length;
    },
    surfaceYAt: heightAt,
  };

  const bridge: Bridge = {
    deckY: crownY,
    covers: (x: number, z: number): boolean => footprint.covers(x, z),
    deckCovers: (x: number, z: number, margin = 0): boolean => {
      const projected = frame.project(x, z, shift);
      return (
        Math.abs(projected.along) <= DECK_HALF_LENGTH + margin &&
        Math.abs(projected.across) <= walkHalf + margin
      );
    },
    // Pads from the real masonry edge, not the standable extent `covers`
    // reports — the difference is the parapet's own width plus the body
    // margin `walkHalf` already subtracted.
    footprintNear: (x: number, z: number, margin: number): boolean =>
      footprint.covers(x, z, margin + (halfAcross - walkHalf)),
    heightAt,
  };

  return { bridge, platform, walls, group: bridgeGroup };
}

interface ShellGeometry {
  readonly stone: BufferGeometry;
  readonly coping: BufferGeometry;
}

/**
 * Sweeps the masonry shell along the frame: road top, both spandrel/parapet
 * walls (outer and inner faces), the arch haunch soffits, and the abutment
 * faces at the tunnel mouths. Indexed quads; normals computed at the end
 * (toon shading forgives averaged normals on near-planar strips).
 */
function buildShellGeometry(
  frame: import('./bridgeSpine').SpineFrame,
  shift: number,
  lengthNeg: number,
  lengthPos: number,
  roadHalf: number,
  halfAcross: number,
  surfaceProfile: (x: number, z: number, along: number) => number,
  soffitAt: (alongAbs: number) => number,
  springY: number,
): ShellGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const copingPositions: number[] = [];
  const copingUvs: number[] = [];
  const copingIndices: number[] = [];

  const vertex = (x: number, y: number, z: number, u: number, v: number): number => {
    positions.push(x, y, z);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };
  const copingVertex = (x: number, y: number, z: number, u: number, v: number): number => {
    copingPositions.push(x, y, z);
    copingUvs.push(u, v);
    return copingPositions.length / 3 - 1;
  };
  const quad = (into: number[], a: number, b: number, c: number, d: number): void => {
    into.push(a, b, c, a, c, d);
  };

  // Ring samples along the hump. Each ring carries the indices of the
  // previous ring's vertices per strip, so strips join into quads.
  interface Ring {
    readonly outerBottom: [number, number]; // [side +1, side -1]
    readonly outerTop: [number, number];
    readonly innerBottom: [number, number]; // parapet inner face, at road
    readonly innerTop: [number, number];
    readonly roadA: number; // road edge, side +1
    readonly roadB: number; // road edge, side -1
    readonly soffitA: number | null; // arch soffit edge, side +1 (across)
    readonly soffitB: number | null;
    readonly copingOuter: [number, number];
    readonly copingInner: [number, number];
  }

  const alongs: number[] = [];
  for (let along = -lengthNeg; along < lengthPos; along += SHELL_STEP) alongs.push(along);
  alongs.push(lengthPos);

  let previous: Ring | null = null;
  let previousAlong = 0;
  for (const along of alongs) {
    const centre = frame.pointAt(along);
    const world = (across: number): { x: number; z: number } => ({
      x: centre.x + centre.acrossX * (across + shift),
      z: centre.z + centre.acrossZ * (across + shift),
    });
    const roadPlus = world(roadHalf);
    const roadMinus = world(-roadHalf);
    const outerPlus = world(halfAcross);
    const outerMinus = world(-halfAcross);
    const surface = surfaceProfile(
      centre.x + centre.acrossX * shift,
      centre.z + centre.acrossZ * shift,
      along,
    );
    const inTunnel = Math.abs(along) < ARCH_SPAN_HALF;
    const soffit = soffitAt(Math.abs(along));
    const bottomPlus = inTunnel
      ? soffit
      : Math.min(terrainHeight(outerPlus.x, outerPlus.z), terrainHeight(roadPlus.x, roadPlus.z)) - 0.5;
    const bottomMinus = inTunnel
      ? soffit
      : Math.min(terrainHeight(outerMinus.x, outerMinus.z), terrainHeight(roadMinus.x, roadMinus.z)) - 0.5;
    const parapetTop = surface + PARAPET_HEIGHT;
    const u = along / TEXTURE_METRES;

    const ring: Ring = {
      outerBottom: [
        vertex(outerPlus.x, bottomPlus, outerPlus.z, u, bottomPlus / TEXTURE_METRES),
        vertex(outerMinus.x, bottomMinus, outerMinus.z, u, bottomMinus / TEXTURE_METRES),
      ],
      outerTop: [
        vertex(outerPlus.x, parapetTop, outerPlus.z, u, parapetTop / TEXTURE_METRES),
        vertex(outerMinus.x, parapetTop, outerMinus.z, u, parapetTop / TEXTURE_METRES),
      ],
      innerBottom: [
        vertex(roadPlus.x, surface, roadPlus.z, u, surface / TEXTURE_METRES),
        vertex(roadMinus.x, surface, roadMinus.z, u, surface / TEXTURE_METRES),
      ],
      innerTop: [
        vertex(roadPlus.x, parapetTop, roadPlus.z, u, parapetTop / TEXTURE_METRES),
        vertex(roadMinus.x, parapetTop, roadMinus.z, u, parapetTop / TEXTURE_METRES),
      ],
      roadA: vertex(roadPlus.x, surface + 0.02, roadPlus.z, u, roadHalf / TEXTURE_METRES),
      roadB: vertex(roadMinus.x, surface + 0.02, roadMinus.z, u, -roadHalf / TEXTURE_METRES),
      soffitA: inTunnel ? vertex(outerPlus.x, soffit, outerPlus.z, u, halfAcross / TEXTURE_METRES) : null,
      soffitB: inTunnel ? vertex(outerMinus.x, soffit, outerMinus.z, u, -halfAcross / TEXTURE_METRES) : null,
      copingOuter: [
        copingVertex(outerPlus.x, parapetTop + 0.06, outerPlus.z, u, 0),
        copingVertex(outerMinus.x, parapetTop + 0.06, outerMinus.z, u, 0),
      ],
      copingInner: [
        copingVertex(roadPlus.x, parapetTop + 0.06, roadPlus.z, u, 1),
        copingVertex(roadMinus.x, parapetTop + 0.06, roadMinus.z, u, 1),
      ],
    };

    if (previous) {
      // Road surface (up).
      quad(indices, previous.roadB, previous.roadA, ring.roadA, ring.roadB);
      for (const side of [0, 1] as const) {
        // Outer wall faces (side 0 faces +across, side 1 faces -across).
        if (side === 0) {
          quad(
            indices,
            previous.outerBottom[0],
            ring.outerBottom[0],
            ring.outerTop[0],
            previous.outerTop[0],
          );
          // Inner parapet face, above the road.
          quad(indices, previous.innerTop[0], ring.innerTop[0], ring.innerBottom[0], previous.innerBottom[0]);
        } else {
          quad(
            indices,
            previous.outerBottom[1],
            previous.outerTop[1],
            ring.outerTop[1],
            ring.outerBottom[1],
          );
          quad(indices, previous.innerTop[1], previous.innerBottom[1], ring.innerBottom[1], ring.innerTop[1]);
        }
        // Coping (parapet top): outer edge to inner edge.
        quad(
          copingIndices,
          previous.copingOuter[side],
          ring.copingOuter[side],
          ring.copingInner[side],
          previous.copingInner[side],
        );
      }
      // Arch haunch soffit (down), full width, only where both rings are in
      // the tunnel and outside the flat crown span the `deck` box owns.
      const midAlong = (previousAlong + along) / 2;
      if (
        previous.soffitA !== null &&
        previous.soffitB !== null &&
        ring.soffitA !== null &&
        ring.soffitB !== null &&
        Math.abs(midAlong) >= ARCH_CLEAR_HALF - SHELL_STEP
      ) {
        quad(indices, previous.soffitA, previous.soffitB, ring.soffitB, ring.soffitA);
      }
      // Abutment faces: the ring where the tunnel begins/ends gets a
      // vertical quad from the ground to the springing, closing the
      // masonry face a rider looks at from inside the tunnel.
      const wasTunnel = Math.abs(previousAlong) < ARCH_SPAN_HALF;
      const isTunnel = Math.abs(along) < ARCH_SPAN_HALF;
      if (wasTunnel !== isTunnel) {
        const edgeRing = isTunnel ? previous : ring;
        const face = isTunnel ? 1 : -1; // which way the face looks (into the tunnel)
        const a = edgeRing.outerBottom[0];
        const b = edgeRing.outerBottom[1];
        // Rebuild two vertices at the springing height straight above the
        // bottom pair, then a quad between them.
        const ax = positions[a * 3] as number;
        const az = positions[a * 3 + 2] as number;
        const bx = positions[b * 3] as number;
        const bz = positions[b * 3 + 2] as number;
        const groundA = terrainHeight(ax, az) - 0.5;
        const groundB = terrainHeight(bx, bz) - 0.5;
        const v0 = vertex(ax, groundA, az, 0, groundA / TEXTURE_METRES);
        const v1 = vertex(bx, groundB, bz, halfAcross / TEXTURE_METRES, groundB / TEXTURE_METRES);
        const v2 = vertex(bx, springY, bz, halfAcross / TEXTURE_METRES, springY / TEXTURE_METRES);
        const v3 = vertex(ax, springY, az, 0, springY / TEXTURE_METRES);
        if (face > 0) quad(indices, v0, v1, v2, v3);
        else quad(indices, v0, v3, v2, v1);
      }
    }
    previous = ring;
    previousAlong = along;
  }

  const stone = new BufferGeometry();
  stone.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  stone.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  stone.setIndex(indices);
  stone.computeVertexNormals();

  const coping = new BufferGeometry();
  coping.setAttribute('position', new BufferAttribute(new Float32Array(copingPositions), 3));
  coping.setAttribute('uv', new BufferAttribute(new Float32Array(copingUvs), 2));
  coping.setIndex(copingIndices);
  coping.computeVertexNormals();

  return { stone, coping };
}
