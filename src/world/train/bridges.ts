import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import type { TrainRoute } from './route';
import type { LevelCrossing } from './crossings';
import {
  BRIDGE_DECK_DEPTH,
  BRIDGE_DECK_SLAB,
  BRIDGE_RISE,
  BRIDGE_ROAD_BED_DROP,
} from './clearance';
import {
  BRIDGE_WALL_THICKNESS,
  DECK_HALF_LENGTH,
  planBridgeFootprints,
  type BridgeFootprint,
  type RealWorldQuery,
} from './bridgeFootprint';
import { TRACK_CLEARANCE } from './route';
import { BUILDING_STEP_UP, PATH_CARRIER_SLACK, PATH_KERB_OVERHANG } from '../../core/constants';
import { terrainHeight } from '../terrain';
import { PALETTE } from '../../core/palette';
import { archStoneTexture, pinkStoneTexture } from '../../core/textures';
import { toonMaterial } from '../../art/style/materials';
import {
  ARCH_CROWN_DIP,
  archCurve,
  buildCopingRun,
  buildVoussoirRing,
  haunchRadius,
} from './bridgeStonework';
import { COPING_HEIGHT, VOUSSOIR_TAPER_RADIUS } from '../../art/models/bridgeStones';
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
 *   and comes back down ({@link surfaceProfile}, a smooth curve with
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
 *   genuine opening over the rail corridor: short abutment walls and a
 *   **three-centred arch**, continuously curved from crown to springing
 *   (`bridgeStonework.ts`, the one owner of that shape), whose soffit
 *   clears the train and its riders by the same `TRAIN_CLEARANCE_Y`
 *   everything else respects. It replaced a flat crown span with
 *   quarter-round haunches, which had a tangent break at the join and read
 *   flat from the mouth — Jim, 2026-08-29: *"a genuine arch-shaped
 *   tunnel"*. The soffit is one continuous surface swept
 *   along the frame by {@link buildShellGeometry}; an invisible `deck`
 *   marker mesh at the same height is all `test/procgen/invariants.ts`
 *   needs to measure the built clearance (`Box3`/`getObjectByName` both
 *   ignore `.visible`), so there is nothing drawn twice and no seam
 *   between two meshes claiming the same span (see that function's own
 *   note — this used to be a separate, rigidly-transformed box, and Jim's
 *   2026-08-24 "there's still a big hole in the mesh" was daylight through
 *   the gap it opened on a curving spine). Nothing else of the bridge
 *   enters the swept rail corridor: the
 *   old geometry stood two support beams *across the track* (they ran the
 *   deck's full length at its outer edges — i.e. down the rail line either
 *   side of the crossing), which is the "walls covering the train track"
 *   bug of the same feedback round.
 * - **Pink stone, the park's own** — `pinkStoneTexture`/`PALETTE.stonePink`
 *   exactly as the garden walls and the rail fence already use, never a
 *   new colour.
 * - **A modelled voussoir ring frames each mouth, and modelled coping caps
 *   both parapets** — real geometry from `art/blend/bridgeStones.blend`, not
 *   a painted stripe. Jim, 2026-08-24, asked for *"a texture giving arch
 *   stones around the tunnel"*; on 2026-08-29, looking at it, he asked
 *   instead for *"modelled stoneworks (not just textures) around the tops of
 *   the walls"* and *"modelled archway masonry around its edge"*. A texture
 *   contributes nothing to a silhouette, and a silhouette is most of what a
 *   six-year-old reads a stone bridge by. `archStoneTexture` stays on the
 *   soffit *inside* the tunnel, where it is the coursing of the barrel
 *   rather than a stand-in for the ring.
 *
 * ## The road a child sees is the park's own path, not a second surface
 *
 * Jim, 2026-08-24: *"the 'floor' on the bridge should be the normal path
 * texture — it should read as a continuous path that goes over a bridge."*
 * It now literally is the same surface: `pathGraph.ts` draws ONE sandy
 * ribbon and ONE cream kerb for the whole park, and
 * `drapePathsOverBridges` lifts the stretch of that ribbon a bridge
 * carries onto {@link Bridge.pavingHeightAt} instead of the terrain. So
 * there is no bridge-deck material, no second set of UVs and no seam to
 * keep in step — the texture, the tiling and the kerb are the same mesh
 * they are a metre before the ramp foot (CLAUDE.md's "one surface, one
 * texture", the same fix the hood faces got).
 *
 * That also closes the old ribbon-through-the-tunnel bug: paths are drawn
 * before the train exists, so the ground ribbon used to drape straight
 * down through the arch while the bridge stood over it. Nothing here
 * moved; the ribbon did.
 *
 * The masonry keeps a road *bed* — the swept shell's own top surface —
 * `BRIDGE_ROAD_BED_DROP` below the walkable height, exactly the way the
 * terrain sits below the paving it carries everywhere else in the park.
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
export const PARAPET_HEIGHT = 0.72;

/**
 * The hump height (above the local ground beside it) below which the
 * parapet tapers away — `BUILDING_STEP_UP`: below one step, the hump's
 * edge is an ordinary kerb a walker can step off, exactly like every other
 * path edge in the park, and a wing wall there does active harm. Found
 * live on the canonical seed, first full build of this geometry: the ramp
 * feet meet ordinary path junctions (the crossing leg merges into the
 * network right past each foot, `paths.ts` promises nothing further out),
 * and full-length parapets walled the junction off — 39 poiGraph
 * waypoints, the whole strip south of the rail, stranded behind a wing
 * wall standing 0.72 m over a hump that was itself barely ankle height.
 * Above one step the drop is a real fall onto (eventually) the fenced
 * rail corridor, and the parapet is load-bearing safety — so the taper is
 * tied to the game's own step, never a styling choice.
 */
const PARAPET_MIN_HUMP = BUILDING_STEP_UP;

/** How the visible parapet fades out as the hump shrinks toward the taper
 * threshold — full height at {@link PARAPET_MIN_HUMP} (where its collision
 * wall also starts existing), gone by ankle height. One owner for the
 * shell geometry so the drawn wall and the collider agree about where a
 * parapet is. */
function parapetHeightFor(humpHeight: number): number {
  // Taper to nothing at the feet, where the hump is barely above the ground
  // and a wall would sever the path junctions the ramps land in.
  const t = (humpHeight - 0.25) / (PARAPET_MIN_HUMP - 0.25);
  const taper = t < 0 ? 0 : t > 1 ? 1 : t;
  // …and grow with how high the hump stands, so the parapet's own top line
  // arcs *above* the road's profile instead of running parallel to it.
  const arc = clamp01(humpHeight / BRIDGE_RISE);
  return (PARAPET_HEIGHT + PARAPET_CROWN_LIFT * arc) * taper;
}

/**
 * **How much taller the parapet stands at the crown than at the feet — the
 * pronounced hump, put where it costs nothing.**
 *
 * Jim, 2026-08-29, asked for *"a more pronounced 'hump' shape to the bridge"*.
 * The obvious way to give him one is to arc the road, and the Engineer's
 * measurement of the 40%-shorter bridge says that is exactly what cannot be
 * done: a sprinting child at the intended blend already rises past
 * `BUILDING_STEP_UP` in one clamped frame and falls through the deck (issue
 * #358). Arcing the *drawn* road above the *walkable* one is refused for a
 * different and better reason — CLAUDE.md's "anything that looks solid must be
 * solid" — because a child on the crown would sink into stone she can see.
 *
 * But **the hump a player reads from beside a bridge is the parapet top line
 * and the coping on it, and nothing walks on those.** So they get the arc and
 * the road does not. Nothing walkable is misrepresented: the road surface, the
 * platform and the collider all still answer the same profile they always did.
 *
 * **Keyed on the hump's own height, not on distance along the ramp.** Those are
 * near enough the same thing on level ground and are not the same thing at all
 * on a slope, where a fraction-along-the-ramp arc would lift the parapet just
 * as high over a stretch where the bridge is barely off the ground. It also
 * means the arc tracks `HUMP_BLEND` for free: when issue #358 lands and the
 * blend goes back to 0.25, the top line follows the new road shape without
 * anyone remembering to retune this.
 *
 * **Why 0.45 and not more.** GAME_DESIGN.md: a small bridge does not obscure a
 * player walking on it. At the crown this stands the coping's top
 * `PARAPET_HEIGHT + this + COPING_STAND` = 1.37 m over the road. The park's
 * camera looks down at about 45°, so a sight line grazing the near parapet has
 * fallen 1.9 m — the road's own half-width — by the time it reaches her, i.e.
 * below the road: she is not occluded at all from the game's own view. In a
 * pure side elevation half a metre of a 1.86 m child still stands clear above
 * the coping, which is what a child on a real humpback bridge looks like.
 * Going much past this starts eating her from the game's camera too.
 */
export const PARAPET_CROWN_LIFT = 0.45;

/**
 * Half-span (along the path) of the arch's flat crown — the stretch of
 * soffit that must clear the train at full height, and the extent of the
 * mesh named `deck` the invariants measure. The train's own swept
 * half-width (`TRACK_CLEARANCE`) plus a stride, so a slightly oblique or
 * gently curving rail line under the bridge still keeps every part of the
 * train under the full-height crown.
 */
export const ARCH_CLEAR_HALF = TRACK_CLEARANCE + 0.5;

/** Half-span (along the path) of the whole arch opening — abutment inner
 * faces stand here. `DECK_HALF_LENGTH` clears both fence lines with margin
 * (its own doc), so the tunnel swallows the entire fenced corridor and the
 * masonry only ever stands on ground the fence already forbids to feet. */
export const ARCH_SPAN_HALF = DECK_HALF_LENGTH;

/**
 * The authored voussoir is cut as a wedge for one particular ring radius
 * (`bridgeStones.ts`'s `VOUSSOIR_TAPER_RADIUS`); the arch this module builds
 * derives its own haunch radius from the two spans above. They have to be the
 * same number, and a comment saying so is not a mechanism — so it is checked,
 * once, at module load, and says which number moved.
 */
const authoredRadius = haunchRadius(ARCH_CLEAR_HALF, ARCH_SPAN_HALF);
if (Math.abs(authoredRadius - VOUSSOIR_TAPER_RADIUS) > 0.005) {
  throw new Error(
    `bridges: the arch's haunch radius is ${authoredRadius.toFixed(3)} m but the ` +
      `voussoir in the kit is cut for ${VOUSSOIR_TAPER_RADIUS} m. Set ` +
      `VOUSSOIR_TAPER_RADIUS in src/art/models/bridgeStones.ts to ` +
      `${authoredRadius.toFixed(3)} and re-run \`npm run blend:bridge-stones\`.`,
  );
}

/**
 * Safety margin added on top of the worst (highest) ground sampled across
 * the crown's own footprint, before it counts as clearing
 * {@link BRIDGE_RISE}.
 *
 * **Sampling error, not a guess at the terrain.** The old note here read
 * *"a route can cross the rail anywhere across the corridor, and the
 * terrain wanders (~1.4 m park-wide), so the crown is derived from the
 * worst sampled ground, plus this"* — but the wander is exactly what the
 * worst-sampled figure already answers, so a further 0.15 m was a second,
 * blind allowance for the same thing, and every bridge in the park stood
 * that much taller than it needed to for it. What a margin here *can*
 * honestly cover is the gap between the ground at the points sampled and
 * the highest ground between them, so the sampling below now walks a fixed
 * {@link GROUND_SAMPLE_STEP} pitch instead of five points per axis, and
 * this is that residue.
 *
 * **Measured on the built park rather than assumed** (canonical seed, both
 * bridges' own crown footprints): refining the pitch from the old 0.9 m to
 * 0.3 m moved the worst ground found by **0.0028 m**, and refining it again
 * to 0.05 m moved it a further **0.0018 m** — under half a centimetre in
 * total, on terrain the old note was allowing 0.15 m for. So this leaves an
 * order of magnitude of daylight over everything the sampling can still
 * miss, which is the honest size for it.
 */
const HEIGHT_MARGIN = 0.05;

/** Pitch the ground under a crown's own footprint is sampled at — see
 * {@link HEIGHT_MARGIN}, which is what is left over once this is fine
 * enough that the worst ground found stops moving. */
const GROUND_SAMPLE_STEP = 0.3;

/** Along-axis sampling pitch of the built shell, metres. */
const SHELL_STEP = 0.6;

/**
 * Height of one masonry course on the bridge's outer flank.
 *
 * Chunky, and deliberately larger than the coursing `pinkStoneTexture` paints
 * on the same wall: this is geometry, and geometry that reads at the distance
 * the texture already covers would only be a second, more expensive copy of
 * it. What the texture cannot do is survive into a silhouette or catch a
 * shadow, and at 0.7 m a course does both from right across the park.
 */
export const COURSE_HEIGHT = 0.7;

/**
 * How far alternate courses are recessed **inward** from the wall's own outer
 * face. Inward is not an aesthetic choice: `halfAcross` is the width the
 * footprint search proved clear, so the wall may get thinner than it but never
 * fatter.
 */
export const COURSE_RECESS = 0.06;

/** Pitch of the parapet collision-wall segments, metres. */
const WALL_SEGMENT = 2.0;

/**
 * Built on first use, never at module load: `pinkStoneTexture` paints a
 * real 2D canvas, and this module is imported (via the train's own leaf
 * chain) by Node check scripts that never install the headless-canvas shim
 * and never build a bridge — a module-level call broke `check:space-night`
 * with `document is not defined` without a single bridge being asked for.
 */
let materialsCache: { stone: Material; archStone: Material; coping: Material } | null = null;
function bridgeMaterials(): { stone: Material; archStone: Material; coping: Material } {
  if (!materialsCache) {
    materialsCache = {
      stone: toonMaterial(0xffffff, { map: pinkStoneTexture(1, 1) }),
      // The voussoir ring — see `archStoneTexture`'s own header. Same `(1,
      // 1)` non-repeat as `stone`: the soffit's own UVs (`u` = along/
      // `TEXTURE_METRES`) are what tiles it, exactly as they tile the wall.
      archStone: toonMaterial(0xffffff, { map: archStoneTexture(1, 1) }),
      coping: toonMaterial(PALETTE.stonePinkLight),
    };
  }
  return materialsCache;
}

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
  /**
   * **The ground the park's drawn path should be draped on here**, or
   * `null` where this bridge does not carry the path — what
   * `pathGraph.ts`'s `drapePathsOverBridges` asks so the one sandy ribbon
   * runs up and over instead of through the arch.
   *
   * Deliberately *not* {@link covers}: that reports where a walker's own
   * centre can stand, which is the paving less her body radius, and a
   * ribbon trimmed to that would tear away from both parapets. This
   * reaches the full masonry width plus the kerb's own overhang
   * ({@link PATH_KERB_OVERHANG}) instead — the honest question "is the
   * paving here carried by this bridge?", which is a different question
   * from "can she stand here?" and so gets its own answer rather than a
   * padded reuse of that one.
   */
  pavingHeightAt(x: number, z: number): number | null;
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

/**
 * Fraction of each side's length spent easing the grade in and out — the
 * hump's slope profile is a cosine-blended trapezoid: zero slope at the
 * crown and at the foot, a constant grade in the middle, cosine blends
 * between. Peak slope is `1 / (1 - HUMP_BLEND)` times the average grade
 * (1.33× at 0.25), and that ratio is the whole reason this is a trapezoid
 * and not a smootherstep (1.875×): the REAL walking physics lose a slope
 * that rises faster than `BUILDING_STEP_UP` in one frame — `Player.tick`
 * samples `WalkSurfaces` with a ceiling one step above her own (damped,
 * lagging) height, so at `PLAYER_MAX_SPEED` (7.4) under a slow device's
 * frame clamp (`MAX_FRAME_DELTA`, 1/12 s) a single frame advances
 * `0.617 m × slope`. A smootherstep's 0.79 peak on the canonical seed's
 * cramped bridge came to 0.49 m/frame plus the damp lag — right at the
 * 0.62 m ceiling, and real-browser QA watched her lose the surface at the
 * steep section, fall into the tunnel and jam against the fence. The
 * trapezoid's 0.56 peak leaves a third of the ceiling spare at the same
 * ramp length.
 */
export const HUMP_BLEND = 0.25;

/**
 * Normalised drop of the hump profile: 0 at the crown (`q = 0`), 1 at the
 * foot (`q = 1`), zero slope at both ends, cosine-blended trapezoid slope
 * in between — see {@link HUMP_BLEND}. The ONE owner of the hump's shape.
 */
export function profileDrop(q: number): number {
  const u = clamp01(q);
  const b = HUMP_BLEND;
  const total = 1 - b; // integral of the slope shape over [0, 1]
  let w: number;
  if (u < b) {
    w = u / 2 - (b / (2 * Math.PI)) * Math.sin((Math.PI * u) / b);
  } else if (u <= 1 - b) {
    w = b / 2 + (u - b);
  } else {
    const v = u - (1 - b);
    w = b / 2 + (1 - 2 * b) + v / 2 + (b / (2 * Math.PI)) * Math.sin((Math.PI * v) / b);
  }
  return w / total;
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
 * **Where the park's drawn paving sits at `(x, z)`, if a bridge carries it
 * there** — the highest answer across every bridge, `null` on plain ground.
 *
 * The one function `pathGraph.ts`'s `drapePathsOverBridges` asks, and the
 * paving twin of {@link bridgeHeightAt}: same "highest surface wins" rule
 * for two bridges that overlap, a different (wider) idea of *covered*. See
 * {@link Bridge.pavingHeightAt} for why the two questions are not the same
 * one with a margin on it.
 */
export function bridgePavingHeightAt(
  bridges: readonly Bridge[],
  x: number,
  z: number,
): number | null {
  let best: number | null = null;
  for (const bridge of bridges) {
    const height = bridge.pavingHeightAt(x, z);
    if (height !== null && (best === null || height > best)) best = height;
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
  const alongStep = Math.min(GROUND_SAMPLE_STEP, ARCH_CLEAR_HALF);
  const acrossStep = Math.min(GROUND_SAMPLE_STEP, halfAcross);
  for (let along = -ARCH_CLEAR_HALF; along <= ARCH_CLEAR_HALF + 1e-6; along += alongStep) {
    for (let across = -halfAcross; across <= halfAcross + 1e-6; across += acrossStep) {
      const { x, z } = frame.worldAt(along, across, shift);
      const ground = terrainHeight(x, z);
      worstGroundY = Math.max(worstGroundY, ground);
      if (ARCH_CLEAR_HALF - Math.abs(along) < alongStep) {
        lowestCrownEdgeGroundY = Math.min(lowestCrownEdgeGroundY, ground);
      }
    }
  }
  // `ARCH_CROWN_DIP` on top, because the soffit is now an arch rather than a
  // flat plate: `BRIDGE_RISE` is the air the train needs, and an arch delivers
  // that at the *edge* of the clear span, where it has already dipped by that
  // much below its own crown. Without this term a genuine arch would have
  // eaten the clearance it was drawn inside. See `bridgeStonework.ts` for what
  // the three candidate arch shapes cost.
  const crownBase = worstGroundY + BRIDGE_RISE + HEIGHT_MARGIN + ARCH_CROWN_DIP;
  const soffitCrownY = crownBase - BRIDGE_DECK_DEPTH;
  // The hump's own surface has already begun to fall away by the far edge of
  // the flat crown span (±ARCH_CLEAR_HALF), and the slab under it does not:
  // it is flat, because the train needs full height across its whole width.
  // So the binding point is the crown's EDGE, not its middle — the road
  // there must still stand `BRIDGE_DECK_DEPTH` over the soffit, or the slab
  // comes up through the paving. (It did: measured 0.06 m of stone proud of
  // the roadway on the canonical seed's cramped bridge, where the old solve
  // only kept the shell's thinnest pinch over the *soffit* and knew nothing
  // about the slab's own thickness or the road bed under the paving.)
  //
  //   surface(edge) = crown − (crown − ground)·dip  ≥  soffitCrownY + BRIDGE_DECK_DEPTH
  //
  // solved for `crown`. Note this is the same height `crownBase` would put
  // the crown at if the road were flat — the dip is the whole reason a real
  // hump stands higher than the published `BRIDGE_RISE`, and the shorter the
  // ramps, the more it costs.
  const shorterLength = Math.min(lengthPos, lengthNeg);
  const dipFraction = profileDrop(ARCH_CLEAR_HALF / Math.max(shorterLength, ARCH_CLEAR_HALF + 0.1));
  const needed = (crownBase - lowestCrownEdgeGroundY * dipFraction) / (1 - dipFraction);
  const crownY = Math.max(crownBase, needed);

  // --- the surface profile — the ONE owner of the hump's shape -------------
  const surfaceProfile = (x: number, z: number, along: number): number => {
    const length = along >= 0 ? lengthPos : lengthNeg;
    const q = length > 0 ? clamp01(Math.abs(along) / length) : 1;
    const ground = terrainHeight(x, z);
    // Blends to the *local* ground at the feet by construction (q = 1 →
    // ground exactly), the same guarantee the old ramp geometry made — see
    // its note on why blending to a single "low end" reference misled a
    // poiGraph probe at the ramp's own low edge.
    return ground + (crownY - ground) * (1 - profileDrop(q));
  };
  const heightAt = (x: number, z: number): number => {
    const projected = frame.project(x, z, shift);
    return surfaceProfile(x, z, projected.along);
  };

  // --- the arch soffit -----------------------------------------------------
  // A genuine three-centred arch, continuously curved from crown to
  // springing — `bridgeStonework.ts` owns the shape, and the voussoir ring
  // built below is laid on that same curve, so the stone a child sees and
  // the hole a train goes through cannot be two different arches.
  //
  // It replaces a flat crown span with quarter-round haunches, which had a
  // tangent break at the join and read flat from the mouth. Jim,
  // 2026-08-29: *"a genuine arch-shaped tunnel"*.
  const arch = archCurve(ARCH_CLEAR_HALF, ARCH_SPAN_HALF, soffitCrownY);
  const springY = arch.springY;
  const soffitAt = (alongAbs: number): number => arch.soffitAt(alongAbs);

  // --- meshes ---------------------------------------------------------------
  const bridgeGroup = new Group();
  // The same name the invariants find this crossing's own group under —
  // one owner (the crossing's `railDistance`) for both.
  bridgeGroup.name = `bridge-${crossing.railDistance.toFixed(1)}`;

  // The crown-span clearance marker — NOT drawn (see below): the swept
  // shell built past this point is the one owner of everything visible,
  // flat crown span included, so a second, separately transformed mesh
  // covering the same span cannot open a seam against it. This box stays
  // only because `test/procgen/invariants.ts` needs an object literally
  // named `deck` to measure the built clearance off — `Box3.setFromObject`
  // and `getObjectByName` both walk the scene graph regardless of
  // `.visible`, so it still answers that question with the same geometry
  // the old, rendered version did, at zero draw cost and with nothing left
  // to fall out of step with the shell beside it.
  const at0 = frame.pointAt(0);
  const origin0 = frame.worldAt(0, 0, shift);
  const deckMesh = new Mesh(
    new BoxGeometry(halfAcross * 2, BRIDGE_DECK_SLAB, ARCH_CLEAR_HALF * 2),
    bridgeMaterials().stone,
  );
  deckMesh.name = 'deck';
  deckMesh.visible = false;
  const yaw = Math.atan2(at0.dirX, at0.dirZ);
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  // Sat at the arch's **binding** height — its crown less `ARCH_CROWN_DIP`,
  // the lowest the soffit gets anywhere over the train's swept width — not at
  // the crown itself. The invariants measure the built clearance off this box,
  // and a marker at the crown would report the roomiest point of an arch as if
  // it were the tightest, which is exactly the "a check can pass without
  // checking anything" failure CLAUDE.md catalogues.
  const matrix = new Matrix4().compose(
    new Vector3(origin0.x, soffitCrownY - ARCH_CROWN_DIP + BRIDGE_DECK_SLAB / 2, origin0.z),
    rotation,
    new Vector3(1, 1, 1),
  );
  deckMesh.applyMatrix4(matrix);
  bridgeGroup.add(deckMesh);

  // The masonry shell — road surface, spandrel/parapet walls, coping, the
  // arch haunches and the abutment faces — one BufferGeometry swept along
  // the frame so the whole thing follows the path's own curve.
  // **The single owner of where the top of the parapet is.** The shell draws
  // it, the collision walls stop at it, and the modelled coping sits on it —
  // three answers that used to be computed in three places and now cannot
  // disagree (CLAUDE.md: "two definitions of one thing, kept in step by hand").
  // The arc is the pronounced hump, put on the one part of the bridge nobody
  // walks on — see `PARAPET_CROWN_LIFT`.
  const parapetTopFor = (surface: number, outerX: number, outerZ: number): number =>
    surface + parapetHeightFor(surface - terrainHeight(outerX, outerZ));

  const shell = buildShellGeometry(
    frame,
    shift,
    lengthNeg,
    lengthPos,
    roadHalf,
    halfAcross,
    crownY,
    surfaceProfile,
    soffitAt,
    springY,
    parapetTopFor,
  );
  // Two materials, one geometry: group 0 (everything but the soffit) reads
  // `stone`, group 1 (the tunnel soffit `buildShellGeometry` built as its
  // own contiguous index run) reads `archStone` — the voussoir ring.
  const shellMesh = new Mesh(shell.stone, [bridgeMaterials().stone, bridgeMaterials().archStone]);
  // Named, like every other drawn part of a bridge, because
  // `nothingHangsIntoTheTunnel` reports *which* mesh it found overhead and
  // "unnamed mesh" is a worse bug report than no bug report.
  shellMesh.name = 'shell';
  shellMesh.castShadow = true;
  shellMesh.receiveShadow = true;
  // The parapet's own flat top face, flush with the wall. It used to be the
  // whole of the "coping" — a two-triangle strip 6 cm proud, which reads as a
  // painted line and vanishes in silhouette. It is now just the face that
  // stops the wall being open at the top; the coping proper is modelled stone,
  // laid on it below.
  const wallTopMesh = new Mesh(shell.coping, bridgeMaterials().coping);
  wallTopMesh.name = 'wallTop';
  wallTopMesh.castShadow = true;
  bridgeGroup.add(shellMesh, wallTopMesh);

  // --- the modelled stonework ----------------------------------------------
  // Jim, 2026-08-29: *"modelled stoneworks (not just textures) around the tops
  // of the walls"*, and *"modelled archway masonry around its edge"*. Both are
  // authored in Blender (`art/blend/bridge_stones_build.py`) and baked here
  // into one geometry apiece, so a bridge wearing sixty-odd stones still costs
  // two draw calls rather than sixty.
  const parapetTopAt = (along: number, side: 1 | -1): number | null => {
    const outer = frame.worldAt(along, halfAcross * side, shift);
    const centre = frame.worldAt(along, 0, shift);
    const surface = surfaceProfile(centre.x, centre.z, along);
    // Nothing to cap where the parapet has tapered to less than the coping's
    // own thickness — see `parapetHeightFor`. The stone follows the wall; it
    // never asserts one that is not there.
    if (parapetHeightFor(surface - terrainHeight(outer.x, outer.z)) < COPING_HEIGHT) return null;
    return parapetTopFor(surface, outer.x, outer.z);
  };

  const ringMesh = new Mesh(
    buildVoussoirRing(frame, shift, halfAcross, arch),
    bridgeMaterials().coping,
  );
  ringMesh.name = 'archRing';
  ringMesh.castShadow = true;
  ringMesh.receiveShadow = true;
  const copingMesh = new Mesh(
    buildCopingRun(frame, shift, roadHalf + BRIDGE_WALL_THICKNESS / 2, lengthNeg, lengthPos, parapetTopAt),
    bridgeMaterials().coping,
  );
  copingMesh.name = 'coping';
  copingMesh.castShadow = true;
  copingMesh.receiveShadow = true;
  bridgeGroup.add(ringMesh, copingMesh);

  // --- collision: the parapet/spandrel walls -------------------------------
  // Only where the hump stands more than a step above the ground beside it
  // — see {@link PARAPET_MIN_HUMP}. Below that the edge is an ordinary
  // kerb, and a wall there severs the path junctions the ramp feet land in.
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
      const humpA = topA - terrainHeight(previous.x, previous.z);
      const humpB = topB - terrainHeight(point.x, point.z);
      if (Math.max(humpA, humpB) > PARAPET_MIN_HUMP) {
        walls.push({
          x1: previous.x,
          z1: previous.z,
          x2: point.x,
          z2: point.z,
          // The drawn parapet's own top, arc included — not `+ PARAPET_HEIGHT`
          // recomputed here. A collider that stopped at the un-arced height
          // would let a child climb the drawn stone and step over it.
          topHeight: Math.max(
            parapetTopFor(topA, previous.x, previous.z),
            parapetTopFor(topB, point.x, point.z),
          ),
        });
      }
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
  // Bounding circle for `pavingHeightAt`'s cheap reject, about the crossing
  // point: the longer ramp, the road's own half-width and the kerb's
  // overhang, plus the spine's own deviation cap (`bridgeSpine.ts`) since a
  // curved frame's far foot is not on the straight axis. Generous on
  // purpose — it only ever has to *contain* the footprint, and `covers`
  // below is what actually decides.
  const pavingReachSq =
    (Math.max(lengthPos, lengthNeg) + roadHalf + PATH_KERB_OVERHANG + PATH_CARRIER_SLACK + 4) ** 2;

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
    pavingHeightAt: (x: number, z: number): number | null => {
      // Cheap circle reject first: `SpineFrame.project` walks the whole
      // resampled spine, and this is asked once per vertex of the park's
      // entire path mesh at boot.
      if ((x - origin0.x) ** 2 + (z - origin0.z) ** 2 > pavingReachSq) return null;
      if (!footprint.covers(x, z, roadHalf - walkHalf + PATH_KERB_OVERHANG + PATH_CARRIER_SLACK))
        return null;
      return heightAt(x, z);
    },
  };

  return { bridge, platform, walls, group: bridgeGroup };
}

interface ShellGeometry {
  readonly stone: BufferGeometry;
  readonly coping: BufferGeometry;
}

/**
 * Sweeps the masonry shell along the frame: road top, both spandrel/parapet
 * walls (outer and inner faces), the tunnel soffit (flat crown span and
 * curved haunches alike, one continuous surface — see the soffit-quad note
 * below), and the abutment faces at the tunnel mouths. Indexed quads;
 * normals computed at the end (toon shading forgives averaged normals on
 * near-planar strips).
 */
function buildShellGeometry(
  frame: import('./bridgeSpine').SpineFrame,
  shift: number,
  lengthNeg: number,
  lengthPos: number,
  roadHalf: number,
  halfAcross: number,
  crownY: number,
  surfaceProfile: (x: number, z: number, along: number) => number,
  soffitAt: (alongAbs: number) => number,
  springY: number,
  parapetTopFor: (surface: number, outerX: number, outerZ: number) => number,
): ShellGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // The tunnel soffit's own triangles — kept apart from `indices` so they
  // land in one contiguous run at the end, ready for a second
  // `BufferGeometry` group carrying `archStoneTexture` (see the return
  // below). Same vertex buffer as everything else; only which draw call
  // reads which indices differs.
  const voussoirIndices: number[] = [];
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
    /** The coursed outer face: per side, two vertex indices per course (its
     * own top and bottom, at its own recess). See {@link COURSE_HEIGHT}. */
    readonly courses: [number[], number[]];
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

  // --- the course levels ----------------------------------------------------
  //
  // **The flank is coursed masonry, not one smooth face.** The outer wall runs
  // from the parapet top all the way down to half a metre under the terrain,
  // which is right and stays — it is what stops a bridge floating over its own
  // ground with a seam. But drawn as a single quad it reads, at a child's eye
  // height at the ramp foot, as a bare embankment with a thin strip of parapet
  // balanced on it: Jim's *"the bridge also doesn't look great"*, 2026-08-29.
  //
  // So the face is stepped into courses at **fixed world heights** — every
  // course is genuinely level, right along the bridge and across both flanks,
  // the way a real coursed wall is. Levels are anchored on the crown so the top
  // course lands square under the coping rather than wherever the arithmetic
  // finished.
  //
  // Alternate courses are recessed `COURSE_RECESS` inward. Inward, never
  // outward: `halfAcross` is the width the footprint search actually cleared
  // (`bridgeFootprint.ts`), and a course proud of it would put masonry on
  // ground nothing checked. So the widest the wall ever gets is exactly what
  // it was before, and the coursing is cut *into* that envelope.
  //
  // Every ring carries the same number of course vertices even where the wall
  // is short, each clamped into that ring's own top and bottom. The degenerate
  // (zero-height) courses that leaves cost two vertices and draw nothing; the
  // alternative — a per-ring course count — makes the strip between two
  // neighbouring rings unjoinable, which is a hole in the mesh, which is the
  // one thing this bridge has already been reported for twice.
  let highestTop = -Infinity;
  let lowestBottom = Infinity;
  for (const along of alongs) {
    const centre = frame.pointAt(along);
    const cx = centre.x + centre.acrossX * shift;
    const cz = centre.z + centre.acrossZ * shift;
    const surface = surfaceProfile(cx, cz, along);
    for (const side of [1, -1] as const) {
      const outer = frame.worldAt(along, halfAcross * side, shift);
      highestTop = Math.max(highestTop, parapetTopFor(surface, outer.x, outer.z));
      lowestBottom = Math.min(lowestBottom, terrainHeight(outer.x, outer.z) - 0.5);
    }
  }
  lowestBottom = Math.min(lowestBottom, soffitAt(0) - 0.5);
  const courseLevels: number[] = [];
  for (let y = crownY; y > lowestBottom - COURSE_HEIGHT; y -= COURSE_HEIGHT) {
    if (y <= highestTop + COURSE_HEIGHT) courseLevels.push(y);
  }
  if (courseLevels.length < 2) courseLevels.push(lowestBottom);
  const courseCount = courseLevels.length - 1;

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
    // The stone the paving is laid on, not the surface a child walks at —
    // see `clearance.ts`'s `BRIDGE_ROAD_BED_DROP`, one of the three terms
    // `BRIDGE_DECK_DEPTH` is now derived from. The parapets' inner faces
    // start here too,
    // so no gap opens between the bed and the wall beside it.
    const roadBed = surface - BRIDGE_ROAD_BED_DROP;
    const inTunnel = Math.abs(along) < ARCH_SPAN_HALF;
    const soffit = soffitAt(Math.abs(along));
    const bottomPlus = inTunnel
      ? soffit
      : Math.min(terrainHeight(outerPlus.x, outerPlus.z), terrainHeight(roadPlus.x, roadPlus.z)) - 0.5;
    const bottomMinus = inTunnel
      ? soffit
      : Math.min(terrainHeight(outerMinus.x, outerMinus.z), terrainHeight(roadMinus.x, roadMinus.z)) - 0.5;
    // The parapet tapers out where the hump is barely above the ground —
    // see `parapetHeightFor`; the collision walls follow the same rule.
    const parapetTopPlus = parapetTopFor(surface, outerPlus.x, outerPlus.z);
    const parapetTopMinus = parapetTopFor(surface, outerMinus.x, outerMinus.z);
    const u = along / TEXTURE_METRES;

    // The coursed outer face for this ring — two vertices per course, at that
    // course's own recess, clamped into this ring's own wall. See the course
    // levels above.
    const buildCourses = (topY: number, bottomY: number, side: 1 | -1): number[] => {
      const column: number[] = [];
      for (let course = 0; course < courseCount; course += 1) {
        const recess = course % 2 === 0 ? 0 : COURSE_RECESS;
        const face = frame.worldAt(along, (halfAcross - recess) * side, shift);
        const levelTop = courseLevels[course] as number;
        const levelBottom = courseLevels[course + 1] as number;
        const yTop = Math.min(topY, Math.max(bottomY, levelTop));
        const yBottom = Math.min(topY, Math.max(bottomY, levelBottom));
        column.push(
          vertex(face.x, yTop, face.z, u, yTop / TEXTURE_METRES),
          vertex(face.x, yBottom, face.z, u, yBottom / TEXTURE_METRES),
        );
      }
      return column;
    };

    const ring: Ring = {
      outerBottom: [
        vertex(outerPlus.x, bottomPlus, outerPlus.z, u, bottomPlus / TEXTURE_METRES),
        vertex(outerMinus.x, bottomMinus, outerMinus.z, u, bottomMinus / TEXTURE_METRES),
      ],
      outerTop: [
        vertex(outerPlus.x, parapetTopPlus, outerPlus.z, u, parapetTopPlus / TEXTURE_METRES),
        vertex(outerMinus.x, parapetTopMinus, outerMinus.z, u, parapetTopMinus / TEXTURE_METRES),
      ],
      courses: [
        buildCourses(parapetTopPlus, bottomPlus, 1),
        buildCourses(parapetTopMinus, bottomMinus, -1),
      ],
      innerBottom: [
        vertex(roadPlus.x, roadBed, roadPlus.z, u, roadBed / TEXTURE_METRES),
        vertex(roadMinus.x, roadBed, roadMinus.z, u, roadBed / TEXTURE_METRES),
      ],
      innerTop: [
        vertex(roadPlus.x, parapetTopPlus, roadPlus.z, u, parapetTopPlus / TEXTURE_METRES),
        vertex(roadMinus.x, parapetTopMinus, roadMinus.z, u, parapetTopMinus / TEXTURE_METRES),
      ],
      roadA: vertex(roadPlus.x, roadBed, roadPlus.z, u, roadHalf / TEXTURE_METRES),
      roadB: vertex(roadMinus.x, roadBed, roadMinus.z, u, -roadHalf / TEXTURE_METRES),
      // `v` spans a flat 0..1 across the whole tunnel width, never scaled by
      // `TEXTURE_METRES` the way every other surface's `v` is: a voussoir is
      // ONE course, uninterrupted for the tunnel's full depth, so
      // `archStoneTexture` must never see more than one vertical repeat of
      // itself here regardless of how wide the tunnel is — a scaled `v`
      // reintroduced a phantom horizontal joint partway across every stone
      // the moment the width exceeded one texture tile.
      soffitA: inTunnel ? vertex(outerPlus.x, soffit, outerPlus.z, u, 1) : null,
      soffitB: inTunnel ? vertex(outerMinus.x, soffit, outerMinus.z, u, 0) : null,
      // Flush with the parapet top, not 6 cm proud of it: this is the wall's
      // own top *face* now, and the coping that stands on it is modelled
      // stone (`bridgeStonework.ts`), not this strip.
      copingOuter: [
        copingVertex(outerPlus.x, parapetTopPlus, outerPlus.z, u, 0),
        copingVertex(outerMinus.x, parapetTopMinus, outerMinus.z, u, 0),
      ],
      copingInner: [
        copingVertex(roadPlus.x, parapetTopPlus, roadPlus.z, u, 1),
        copingVertex(roadMinus.x, parapetTopMinus, roadMinus.z, u, 1),
      ],
    };

    if (previous) {
      // Road surface (up).
      quad(indices, previous.roadB, previous.roadA, ring.roadA, ring.roadB);
      for (const side of [0, 1] as const) {
        // Inner parapet face, and the spandrel underside. The outer face is
        // no longer one quad from bottom to top — it is the coursed column
        // built below, so that a 15 m flank reads as stonework rather than as
        // a smooth embankment (see the course levels above).
        if (side === 0) {
          // Inner parapet face, above the road.
          quad(indices, previous.innerTop[0], ring.innerTop[0], ring.innerBottom[0], previous.innerBottom[0]);
          // Spandrel underside: the solid stone between the road bed
          // (`innerBottom`, at the road's own edge) and the soffit/ground
          // (`outerBottom`, at the masonry's outer edge) had no face
          // closing its own bottom. Outside the tunnel `outerBottom` sits
          // underground, so the gap was never seen; inside the tunnel it
          // is the soffit itself, well below the road, and the gap stood
          // open — Jim's "there's still a big hole in the mesh"
          // (2026-08-24): looking up into the tunnel mouth from outside, a
          // sightline could pass the soffit's own outer edge and the
          // single-sided road-top plane both, with nothing behind either.
          quad(indices, previous.innerBottom[0], ring.innerBottom[0], ring.outerBottom[0], previous.outerBottom[0]);
        } else {
          quad(indices, previous.innerTop[1], previous.innerBottom[1], ring.innerBottom[1], ring.innerTop[1]);
          quad(indices, previous.innerBottom[1], previous.outerBottom[1], ring.outerBottom[1], ring.innerBottom[1]);
        }
        // The coursed outer face: one quad per course, plus the horizontal
        // reveal between a course and the recessed one under it. That reveal
        // is the whole point — it is the shadow line that makes the flank read
        // as masonry from the ground, and it is real geometry, so it survives
        // into the silhouette instead of living in a texture.
        const before = previous.courses[side];
        const now = ring.courses[side];
        for (let course = 0; course < courseCount; course += 1) {
          const bt = before[course * 2] as number;
          const bb = before[course * 2 + 1] as number;
          const nt = now[course * 2] as number;
          const nb = now[course * 2 + 1] as number;
          if (side === 0) quad(indices, bb, nb, nt, bt);
          else quad(indices, bb, bt, nt, nb);
          if (course + 1 < courseCount) {
            const bnt = before[(course + 1) * 2] as number;
            const nnt = now[(course + 1) * 2] as number;
            if (side === 0) quad(indices, bb, bnt, nnt, nb);
            else quad(indices, bb, nb, nnt, bnt);
          }
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
      // Tunnel soffit (down) — one continuous swept surface, flat crown and
      // curved haunch alike, wherever both rings are in the tunnel at all.
      // `soffitAt` already returns the flat `soffitCrownY` for the crown
      // span, so this single sweep draws that span too; it used to stop
      // short of the crown and leave that span to a separately transformed
      // `deckMesh` box instead, which followed only the frame's tangent at
      // along=0. On a curving spine the box's straight edges parted company
      // with this sweep's curved ring at the very seam between them —
      // measured live, a wedge of daylight through the stonework at both
      // top corners of the tunnel mouth (Jim, 2026-08-24, "there's still a
      // big hole in the mesh"). One continuous ring cannot lose a face at a
      // seam it no longer has (CLAUDE.md: "build the shell as geometry, not
      // as trimmed angles").
      if (
        previous.soffitA !== null &&
        previous.soffitB !== null &&
        ring.soffitA !== null &&
        ring.soffitB !== null
      ) {
        quad(voussoirIndices, previous.soffitA, previous.soffitB, ring.soffitB, ring.soffitA);
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

  // Two draw groups sharing one vertex buffer: the plain wall/road coursing
  // first, then the voussoir ring as one contiguous run, so `shellMesh` can
  // carry `[stone, archStone]` and Three.js reads group 1 with the second
  // material — the same mechanism `Mesh.geometry.groups` always uses for a
  // multi-material mesh, never a second, separately-transformed mesh (this
  // file's own "one surface, one texture" rule).
  const voussoirStart = indices.length;
  indices.push(...voussoirIndices);

  const stone = new BufferGeometry();
  stone.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  stone.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  stone.setIndex(indices);
  stone.addGroup(0, voussoirStart, 0);
  stone.addGroup(voussoirStart, voussoirIndices.length, 1);
  stone.computeVertexNormals();

  const coping = new BufferGeometry();
  coping.setAttribute('position', new BufferAttribute(new Float32Array(copingPositions), 3));
  coping.setAttribute('uv', new BufferAttribute(new Float32Array(copingUvs), 2));
  coping.setIndex(copingIndices);
  coping.computeVertexNormals();

  return { stone, coping };
}
