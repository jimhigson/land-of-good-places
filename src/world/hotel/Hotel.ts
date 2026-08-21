import {
  BoxGeometry,
  CanvasTexture,
  type PerspectiveCamera,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  type Object3D,
  PlaneGeometry,
  SpotLight,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { circleBoundary, GARDEN_PLAY_BOUNDARY } from '../boundary';
import { HOTEL_PLAY_RADIUS, PLAYER_RADIUS } from '../../core/constants';
import { hexToCss, PALETTE } from '../../core/palette';
import { ART } from '../../art/style/artPalette';
import { Rng } from '../../core/mathUtils';
import { mosaicTexture } from '../../core/textures';
import type { FrameContext, GameSystem } from '../../core/types';
import type { CollisionWorld, WallCollider } from '../Collision';
import type { AnchorPlots } from '../AnchorPlots';
import type { CreatureHandle } from '../../art/style/asset';
import type { Player } from '../../entities/Player';
import type { InteriorControls } from '../building';
import type { WalkSurfaces, MovingPlatform } from '../building/surfaces';
import type { LiftPanelSource } from '../building/liftRide';
import { interiorMaterial, softMaterial } from '../building/parts';
import {
  buildBasin,
  buildPan,
  buildPrivacyRoof,
  TOILET_APPROACH,
  ToiletRoutine,
} from '../building/Toilets';
import { cornerClosedSpans, segmentsMinusGaps } from '../wallRuns';
import { toonMaterial, solid, decal, inkTint } from '../../art/style/materials';
import {
  BED_MATTRESS_TOP,
  BRIDGE_RAIL_TILE,
  createBreakfastBowl,
  createBreakfastChair,
  createBreakfastTable,
  createBridgeNewel,
  createBridgeRailing,
  createChandelier,
  createDiscoBall,
  createEntranceDoors,
  createGameBoy,
  createGrandStaircase,
  createHotelTv,
  createHotelBed,
  createHotelTower,
  createLandingNosing,
  createLiftCar,
  createLiftDial,
  createLiftDoors,
  createLiftFrame,
  createPetBed,
  createPetBowl,
  createReceptionDesk,
  createStraightStaircase,
  createYoursDoor,
  LANDING_HEIGHT,
  LANDING_SLAB_MAX,
  LANDING_SLAB_MIN,
  LOBBY_MIN_WALL_HEIGHT,
  STAIR_INNER_RADIUS,
  STAIR_OUTER_RADIUS,
  STAIR_RAIL_RADIUS,
  STAIR_RISE,
  STAIR_SWEEP,
  STAIR_TREADS,
  STRAIGHT_RISE,
  STRAIGHT_RUN,
  STRAIGHT_TREADS,
  STRAIGHT_WALK_WIDTH,
  type BreakfastKind,
  type LiftDialHandle,
  PET_BED_CUSHION_RADIUS,
  PET_BED_CUSHION_TOP,
  type SlidingDoorsHandle,
} from '../../art/models/hotelAssets';
import { createRipikaStatue, type RipikaStatueHandle } from '../../art/models/ripikaStatue';
import { createPet, PET_KINDS, type PetKind } from '../../art/models/pets';
import { createKeeper, type KeeperHandle } from '../../art/models/keeper';
import { KID_SKIN_TONES } from '../../art/models/kid';
import { CharacterModel } from '../../entities/CharacterModel';
import { SpeechBubble } from '../../ui/SpeechBubble';
import type { IsoCamera } from '../../core/IsoCamera';
import {
  bedsideTable,
  buffetCounter,
  BUFFET_TOP,
  DECAL_STEP,
  SOFA_SEAT_TOP,
  cloud,
  crystalCluster,
  crystalColumn,
  crystalPlanter,
  createDiscoSparkle,
  ARTWORK_COUNT,
  paintedPicture,
  type DiscoSparkle,
  fishShape,
  flatStar,
  floorChevron,
  flowerTuft,
  hedge,
  lilyPond,
  napBlanket,
  porthole,
  rainbowRing,
  rainbowRug,
  roundRug,
  rug,
  sconce,
  seaweed,
  sofa,
  sunburst,
  trellisArch,
} from './dressing';
import { hotelResidents } from './HotelGuests';
import { HotelProps, Plate } from './place';
import { HotelLighting, pendantLight } from './lighting';
import type { ResidentSpec } from '../../entities/npc';
import { placedEntry } from '../parkLayout';
import { saveFlags } from '../../state/flags';
import { gameStore } from '../../state';
import { ZONE_HEIGHT_TOLERANCE, pressAction, type InteractZone } from '../interact';
import { FloorFader } from '../building/floorFade';
import {
  BREAKFAST,
  clearFloorAround,
  type ClearRect,
  CORRIDOR,
  DOOR_HALF,
  GARDEN_FLOOR,
  HOTEL_FLOORS,
  hotelDoorBands,
  LIFT_ALCOVE_DEPTH,
  LOBBY,
  LOBBY_FOYER_GROWTH,
  LOBBY_HALFZ_BEFORE_RECEPTION,
  OCEAN_FLOOR,
  RECEPTION_ORIGIN_SHIFT,
  RECEPTION_ROOM_DEPTH,
  ROOMS,
  roomFor,
  SUITE,
  SUITE_PARTITION_HALF,
  WALL_HALF_DEPTH,
  SUITE_BED_SPOTS,
  SUITE_BEDSIDE_X,
  SUITE_BEDSIDE_Z,
  SUITE_DOOR_WIDTH,
  SUITE_PARTITION_HEIGHT,
  type HotelDoorBand,
  type HotelRoom,
  type Mezzanine,
  mezzanineWalkConnectors,
  mezzanineGuardedEdges,
  mezzanineHidesPoint,
  RAIL_BASE_DROP,
  type SuitePartition,
  type WallSide,
} from './layout';
import {
  bandContains,
  bandCrossed,
  distanceToBand,
  TAP_FINGER_METRES,
  type PortalBand,
} from '../tapSpacing';
import { HotelLift } from './HotelLift';
import { HotelCinematic, type Shot } from './cinematic';
import { PLAZA } from '../paths';
import { spaceAt, SPACE_GARDEN } from '../spaces';

/** Seconds after a change of space before another may trigger. */
const SPACE_COOLDOWN = 0.9;

/** How long a nap on a suite bed lasts, in seconds. */
const NAP_SECONDS = 2.6;

/** How long the lobby celebrates a check-in. Long enough to see, short enough to want again. */
const CHEER_SECONDS = 2.4;

/** How long the star over the suite door blinks at a child with no key. */
const REFUSE_SECONDS = 1.8;

/**
 * How far back the camera stands to look at a painting, and through what.
 *
 * Tuned as a pair (QA, 7 Aug 2026): the old 1.15 m through a 24° lens showed
 * a 0.49 m-tall slice of a 1.25 m painting — "have a proper look" at the
 * middle fifth. 1.6 m through 46° frames 1.36 m: the whole canvas plus a lip
 * of frame, still inside the 1.9 m the child herself stands back, so she is
 * behind the lens, not in the shot.
 */
const ART_VIEW_DISTANCE = 1.6;
const ART_VIEW_FOV = 46;

/** Height of a hung picture's centre. Module-wide: `hangOnWalls` hangs at it
 *  and `clearOfGlass` tests window overlap against the band around it. */
const PICTURE_Y = 1.9;

/** Clear air demanded between a picture's frame and a pane's edge, metres. */
const PICTURE_GLASS_MARGIN = 0.15;

/**
 * How far a hung picture stands proud of its wall's own face, metres — the
 * one number `hangOnWalls`' placement and `clearOfGlass`'s occlusion search
 * both need, so a picture is never hung this far off one and tested against
 * the mezzanine's shadow at another (issue #271's own class of bug, guarded
 * against rather than repeated).
 */
const PICTURE_WALL_INSET = 0.31;

/** The breakfast tables' flat top, metres — the asset's own figure. */
const TABLE_TOP = 0.74;

/** The food moment: how long the camera takes to arrive, and how long it stays. */
const FOOD_EASE_SECONDS = 2.5;
const FOOD_HOLD_SECONDS = 1.9;
/** How long the pet takes to trot over. Inside the ease, so it arrives on camera. */
const FOOD_TROT_SECONDS = 2.1;

/**
 * The pointer dial's pivot height above the alcove floor.
 *
 * Over the doors and just under the top of the architrave (2.96 m), which is
 * the only place a dial fits: three of these rooms have 3.0 m walls, so the
 * strip *above* the frame that a real lift would use does not exist here. The
 * arc is 0.45 m tall, so this puts its top at 2.91 m.
 */
const DIAL_PIVOT_Y = 2.46;

/** The top of the hotel, in storeys — what the dial's right-hand end means. */
const TOP_STOREY = 50;

/** How far out an automatic door notices somebody, and how wide its approach is. */
const AUTO_DOOR_REACH = 4.2;
const AUTO_DOOR_SIDE = 2.4;

/** Seconds an automatic door takes to slide fully open, or fully shut. */
// 1.2, up from 0.55: at 0.55 s the slide was over before the fixed camera's
// oblique view of the recess could register it — QA staged ten approaches and
// never caught a legible mid-slide frame. A door a person is meant to SEE
// open (Jim asked for exactly that) has to open at the pace of a person
// arriving, not a sensor firing.
const AUTO_DOOR_SECONDS = 1.2;

/** How close a tap must land to a wall's "Look out" pane to select it. */
const WINDOW_PICK_RADIUS = 2.2;

/**
 * How solid the lobby's overhang stays while it is hiding the player.
 *
 * Not zero. The castle's cutaway removes a storey you are standing under
 * because it is simply in the way; the lobby's gallery is the composition —
 * a child under the arch should still see the deck, the balustrade and the
 * colonnade overhead, just see *through* them to herself. Close to
 * `FoliageFade`'s own `MIN_ALPHA` (0.26), which is the value this game
 * already decided a faded-but-present thing looks like.
 */
const OVERHANG_GHOST_ALPHA = 0.24;

/**
 * Where up her body the overhang is asked whether it hides her — head, chest,
 * waist, the same three `check:statue-occlusion` has always used, and the
 * same three `check:hotel` raycasts. Her head clearing the deck while her
 * body does not is exactly the state QA reported ("only the pet's head / a
 * sliver of hat"), so any one of them being hidden is enough to fade.
 */
const OVERHANG_BODY_FRACTIONS = [1, 0.75, 0.5] as const;

/** How tall the player reads for occlusion. Matches `check:statue-occlusion`. */
const PLAYER_HEIGHT = 2.12;

/**
 * How high above her own floor a window's "Look out" zone may sit.
 *
 * The zone used to be pinned to the middle of the glass, which is fine for a
 * normal room and wrong for a grand one: the lobby's west windows are
 * 1.2–3.6 m of double-height glazing, so the midpoint came out at 2.4 m —
 * and every selection path in the game drops a zone further than
 * `ZONE_HEIGHT_TOLERANCE` (2.2 m) from the player's own `y`. The verb was
 * built, placed, and impossible to offer to a child standing on the floor, at
 * any spot in the room. 19 sampled spots along that wall gave nothing but
 * "🏨 Lobby".
 *
 * A window is looked out of by someone standing on the floor, so the zone
 * belongs at her height, not the glass's centre. Derived from the tolerance
 * rather than typed as a number, with room to spare for a damped `y` that
 * dips a little as she walks.
 */
const LOOK_ZONE_MAX_Y = ZONE_HEIGHT_TOLERANCE - 0.4;

/**
 * How much floor a fitted rug leaves between its own edge and a wall face.
 * Rug extents are derived from `layout.ts`'s `clearFloorAround` minus this —
 * never hand-sized against a wall a partition move could bring closer.
 */
const RUG_CLEARANCE = 0.15;

/**
 * How far the grand staircase is sunk below the lobby floor, so its top
 * tread's surface rides just under the deck plane the slab owns (probe 10's
 * one-owner rule) instead of coplanar with it. The gallery rail in
 * `dressMezzanine` drops by the same amount to keep butting the stair's
 * handrail, which eases level at `rise + railHeight` above the asset origin.
 */
const STAIR_SINK = -0.02;

/** How far a window's painted outside-glow spreads past the glass. */
const GLOW_MARGIN = 0.34;

/**
 * Narrowest pane worth building. A declared window clipped by a doorway down
 * to a slit is not a window; dropping it is tidier than drawing a sliver.
 */
const MIN_PANE_WIDTH = 0.6;

/**
 * How many beams come off a lit disco ball, and what they are like.
 *
 * Five, not twenty: they are real `SpotLight`s and the park's whole lighting
 * budget is fourteen point lights (ORDER-OF-WORK). Five sweeping cones is
 * already unmistakably a disco ball, and every one after that costs another
 * pass over every lit surface in the room for a beam nobody counts.
 *
 * The intensity is deliberately *below* the room's own warm fill
 * (`hotel/lighting.ts`'s 3.6): these are highlights sweeping over a lit room,
 * and a mirror ball bright enough to be the room's light source blows the pale
 * pastels of ART_DIRECTION §5 straight to white.
 */
const DISCO_BEAMS = 5;
const DISCO_INTENSITY = 2.6;
/** How far a beam carries. Comfortably the width of the lobby, and no further. */
const DISCO_REACH = 26;
/** Half-angle of one cone, radians. Narrow enough to read as a beam. */
const DISCO_CONE = 0.34;
/** The beams' colours — the park's own markers, so the lobby sparkles in the
 *  same five inks the rest of the game is drawn with. */
const DISCO_COLOURS: readonly number[] = [
  PALETTE.markerPink,
  PALETTE.markerSky,
  PALETTE.markerMint,
  PALETTE.markerLemon,
  PALETTE.markerLilac,
];

/**
 * Where reception stands, in the lobby's own local metres.
 *
 * Named because four things need it — the desk, the receptionist behind it, her
 * speech bubble above her, and the interact zone a child presses — and because
 * getting those four from two sources is a proven live bug: the desk moved to
 * the east bay while the zone kept the old literal, so the *"check in and get
 * your key!"* sign floated beside the staircase, ten metres from any desk
 * (Jim, live play, 7 Aug 2026; QA pinned the stale pair). Every consumer now
 * derives from these two numbers, and `check:hotel` probe 13 asserts the
 * zone's anchor really stands on something solid that is not a staircase.
 * **Exported** so that probe is the desk's own numbers, not a second literal
 * beside them — the exact class of bug this comment already tells the story
 * of, once.
 *
 * **In the entrance foyer now, not the stairs hall** (issue #270). Jim,
 * 17 August 2026, playing it: *"the reception desk is too far from where the
 * player enters."* The desk used to stand at local z −5.2 — beside the grand
 * staircase, 17.6 m from the door, on the far side of where {@link LOBBY_HALL_Z}
 * now draws the line between the two rooms — which is the exact "suggests
 * getting a key near the staircase" bug QA first found on 7 August, reopened
 * by the same spot. It now stands a few strides inside the front door, in the
 * east bay so nothing stands between it and the entrance, still facing the
 * doors the way a grand lobby seats its reception facing the promenade.
 *
 * **z carries `LOBBY_FOYER_GROWTH`** (17 Aug 2026, same day, issue #271's
 * paintings coming back): the front door moved that much further south when
 * the foyer grew, and "a few strides inside the front door" is a statement
 * about the desk's distance from the door, not from the room's own origin —
 * so the desk moves with the door it is a few strides from.
 *
 * **x dropped from 10.5 to 4.5, 18 August 2026** (QA on #280, portrait
 * phone): the fix above moved the desk 7 m closer to the door in a straight
 * line, but 10.5 m of that line was *sideways* and only 1.4 m was deeper into
 * the room — so on a 390×844 portrait screen, standing at the entry point,
 * the desk sat off the right edge of the frame entirely (`IsoCamera`
 * projects it to NDC x=1.53; the visible frustum is ±1). A child had to walk
 * ~5 m sideways, unprompted, before anything appeared. Verified
 * geometrically (no browser access) by projecting the desk and receptionist
 * through `IsoCamera` at the player's real teleport-in point
 * (`enterLobby`'s `LOBBY.halfZ - 2.2`): x=4.5 lands the whole desk footprint
 * (NDC x from 0.585 to 0.932) and the receptionist (NDC x=0.906) on-screen
 * — *technically*, per the same QA round that came back with real rendered
 * screenshots and found only ≈2 px of margin at x=4.5 (298→388 of 390 px),
 * the greeting bubble clipped off the right edge entirely, and the check-in
 * stand spot half behind the (short, see-through) near wall. See the round-3
 * entry below for the fix.
 *
 * **x=4.5→3.2, z carries `8.3` not `8.8`, 18 August 2026** (QA round 3 on
 * #280): the round-2 fix only moved the desk *sideways*; this one moves it
 * **north** too — deeper into the foyer, which {@link LOBBY_FOYER_GROWTH}
 * grew by 7 m for exactly this — so the same total displacement buys real
 * screen margin instead of 2 px of it. The two axes pull screen-x in
 * opposite, near-equal directions at this camera's fixed 45°/38° rig
 * (measured: ∂px/∂x ≈ +25.1 px/m, ∂px/∂z ≈ −25.1 px/m, at 390×844), so
 * "north and recentre together" is not two independent knobs — pushing z
 * north on its own makes the screen-x crowding *worse*, and only combining
 * it with a bigger x pull-in nets a leftward move at all.
 *
 * The room's own furniture bounds how far that combination can go: the
 * RiPika medallion (`STATUE_Z`, ring outer radius 2.3 m) and the doors→
 * medallion runner sit directly in the path a large north+recentre move
 * would take, so 3.2/8.3+GROWTH was the best point found inside the shared
 * foyer that cleared both by a real margin while still gaining screen room
 * — a genuine three-way trade-off against the screen, the statue and the
 * wall, not a single free lever.
 *
 * **Round 4, and a different kind of fix, 18 August 2026** (Jim, direct on
 * #280, superseding all three rounds above): *"still way too hidden. The
 * desk should be in a separate ROOM (like the split rooms in the bedroom)
 * and the lobby in the next room. The desk should be dead centre of this new
 * reception room prior to the main lobby."* Three rounds of nudging this
 * constant inside the one shared foyer never fixed the underlying problem —
 * the desk was always competing with the statue, the seating and the café
 * for the same frame, so any position that avoided one of them crowded
 * another. A genuinely separate room removes the competition structurally:
 * {@link LOBBY_HALFZ_BEFORE_RECEPTION} and {@link RECEPTION_ROOM_DEPTH}
 * (`layout.ts`) carve a new room, entered directly from the (moved) front
 * door, that holds nothing but the desk — so "dead centre" and "obviously
 * visible from the door" stop being in tension with each other for the
 * first time.
 *
 * **x = 0**: dead centre of the room's own `halfX` (13, unchanged) — also
 * the promenade axis every other doorway in this room sits on, so the desk
 * is square in the camera's own natural symmetric frame rather than pulling
 * screen-x toward one edge the way every off-axis value in rounds 1–3 did.
 * **z**: the room's own midpoint, `LOBBY_HALFZ_BEFORE_RECEPTION +
 * RECEPTION_ROOM_DEPTH / 2` — 4.5 m from both the new partition's doorway
 * and the front door, comfortably clear of both doorways' own
 * `DOORWAY_THROUGH_DEPTH + DOORWAY_CLEARANCE` (1.24 m) reach (`place.ts`).
 *
 * Verified geometrically (no browser access this session either — see the
 * HANDOFF/PR comment for the real `IsoCamera` NDC projection from the
 * player's true teleport-in point): the desk's whole footprint and the
 * receptionist project well inside the ±1 frustum at 390×844 portrait, with
 * wide margin on every edge — no round-4 trade-off was needed the way one
 * was in rounds 2/3, because being alone in a small room made the old
 * "sideways vs. deep vs. the statue" bind disappear rather than requiring a
 * better balance point within it.
 */
export const RECEPTION_X = 0;
export const RECEPTION_Z = LOBBY_HALFZ_BEFORE_RECEPTION + RECEPTION_ROOM_DEPTH / 2;

/** Where the receptionist herself stands: behind her own desk, north of it —
 *  i.e. further from the front door, so a child walks up to the counter
 *  rather than past her. */
const RECEPTIONIST_Z = RECEPTION_Z - 1.15;

/**
 * Seat height of a breakfast chair — the asset's own 0.42 m.
 *
 * The player's sit-down pose has always used this figure; a diner sits on the
 * same chairs, so it is named here rather than typed a second time three
 * hundred lines away from the first.
 */
const CHAIR_SEAT_Y = 0.42;

/**
 * Honest tops for the scatter dressing, metres above the floor they stand on.
 *
 * Approximate on purpose — a seeded crystal cluster varies a little — but
 * approximately *true*, where the old `Infinity` default made every one an
 * unjumpable pillar (probe 11). All well above `JUMP_APEX_HEIGHT`'s reach or
 * flagged `stand: false`, so none of them is a landing surface either way.
 */
const CLUSTER_TOP = 1.4;
const PLANTER_TOP = 1.5;
const SEAWEED_TOP = 1.5;

/** What a child sat at breakfast is wearing. The park's own marker set. */
const DINER_OUTFITS: readonly number[] = [
  PALETTE.markerSky,
  PALETTE.markerMint,
  PALETTE.markerLemon,
  PALETTE.flowerRed,
  PALETTE.blossomPink,
];
const DINER_HAIRS: readonly number[] = [ART.kidHair, ART.kidHairBlonde, PALETTE.bark];
/**
 * Hair a diner may wear. **No ponytail**, for exactly the reason
 * `HotelGuests.ts` gives: those styles carry a world-space simulated chain
 * that wants driving every frame, and a child who never moves is not worth a
 * second thing that can visibly go wrong.
 */
const DINER_HAIR_STYLES = ['bunches', 'bob', 'short', 'bowl'] as const;

/** How far a seated child rocks over her cereal, radians, and how fast. */
const DINER_BOB = 0.055;
const DINER_BOB_RATE = 1.6;

/** The three breakfasts, exactly as Eleri listed them. */
const BREAKFASTS: readonly { kind: BreakfastKind; label: string; glyph: string }[] = [
  { kind: 'cheerios', label: 'Heart cheerios', glyph: '🥣' },
  { kind: 'shreddies', label: 'Shreddies', glyph: '🟫' },
  { kind: 'yoghurt', label: 'Yoghurt + honey', glyph: '🍯' },
];

/**
 * The two things the hotel needs from the rest of the game that are not
 * geometry.
 *
 * Both are accessors rather than values, and deliberately: the hotel is built
 * in `World`'s constructor, which is *before* `DayNight` exists, so a clock
 * read eagerly would be a clock read once at dawn and never again. A closure
 * costs nothing and cannot be got wrong.
 */
export interface HotelDeps {
  /** For sizing the receptionist's speech bubble on screen. */
  readonly camera: IsoCamera;
  /** The park clock, 0..1 through a day — `DayNight.timeOfDay`. */
  clock(): number;
}

/**
 * One tread of a sweeping stair — a walkable **wedge**, not a rectangle.
 *
 * A curved stair built out of axis-aligned {@link Plate}s has to either overlap
 * its treads or leave gaps between them, and overlapping is the one that breaks:
 * `WalkSurfaces.sample` answers with the *highest* surface within a step up, so
 * where tread N + 1 overlaps tread N a child standing on the upper one is told
 * the upper one is still the floor and **cannot walk back down**. (The same
 * arithmetic is why she can walk *up* at all, which is what makes the bug look
 * like a working staircase right until somebody tries to leave.)
 *
 * A wedge tiles the arc exactly: adjacent, never overlapping, no gaps, and the
 * test is two comparisons on a radius and one on an angle. It is also simply
 * what a step of a spiral stair *is*.
 */
class ArcTread implements MovingPlatform {
  readonly surfaceY: number;
  private readonly centreX: number;
  private readonly centreZ: number;
  private readonly innerRadius: number;
  private readonly outerRadius: number;
  private readonly fromAngle: number;
  private readonly toAngle: number;

  constructor(
    surfaceY: number,
    centreX: number,
    centreZ: number,
    innerRadius: number,
    outerRadius: number,
    fromAngle: number,
    toAngle: number,
  ) {
    this.surfaceY = surfaceY;
    this.centreX = centreX;
    this.centreZ = centreZ;
    this.innerRadius = innerRadius;
    this.outerRadius = outerRadius;
    this.fromAngle = fromAngle;
    this.toAngle = toAngle;
  }

  covers(x: number, z: number): boolean {
    const dx = x - this.centreX;
    const dz = z - this.centreZ;
    const radius = Math.hypot(dx, dz);
    if (radius < this.innerRadius || radius > this.outerRadius) return false;
    // The game's yaw convention: 0 is +Z, turning toward −X (`Math.atan2(x, z)`
    // everywhere else in this file), so the same call is used here rather than a
    // second angle convention nobody would remember.
    let angle = Math.atan2(-dx, dz);
    // The sweep is a quarter turn starting at 0, so only the wrap at ±π matters.
    if (angle < this.fromAngle - Math.PI) angle += Math.PI * 2;
    return angle >= this.fromAngle && angle < this.toAngle;
  }
}

/**
 * Proves the lobby's declared plan against the staircase asset's own exports,
 * at build time, before anything is placed.
 *
 * `layout.ts` is a leaf data module and cannot import the asset (it would drag
 * the GLB decode into every script that reads a room rectangle), so its
 * numbers are written as data — and six numbers kept in step by two files'
 * comments is this repo's most reliable bug. The artist's handoff asked for
 * exactly this mechanism by name. Throws, because a lobby built around the
 * wrong staircase is not a lobby with a cosmetic problem: the walk surfaces,
 * colliders and nav connectors are all derived from the plan, and every one
 * of them would be describing a flight that is not there.
 */
function assertStairMatches(room: HotelRoom, plan: Mezzanine): void {
  const problems: string[] = [];
  const expect = (what: string, got: number, want: number, eps = 0.005): void => {
    if (Math.abs(got - want) > eps) {
      problems.push(`${what} is ${got.toFixed(3)} but the asset says ${want.toFixed(3)}`);
    }
  };

  expect('the landing height', plan.landing.height, LANDING_HEIGHT);
  expect('the gallery height', plan.height, STAIR_RISE);
  expect("the straight flight's rise", plan.straight.rise, STRAIGHT_RISE);
  expect("the straight flight's walk width", plan.straight.walkWidth, STRAIGHT_WALK_WIDTH);
  expect("the straight flight's run", plan.straight.frontZ - plan.maxZ, STRAIGHT_RUN);
  expect("the straight flight's tread count", plan.straight.treads, STRAIGHT_TREADS, 0);

  if (plan.stairs.length !== 2) {
    problems.push(`the plan declares ${plan.stairs.length} curved flights — the composition is two`);
  }
  for (const stair of plan.stairs) {
    expect('a curve inner radius', stair.innerRadius, STAIR_INNER_RADIUS);
    expect('a curve outer radius', stair.outerRadius, STAIR_OUTER_RADIUS);
    expect('a curve tread count', stair.treads, STAIR_TREADS, 0);
    expect('a curve sweep', Math.abs(stair.toAngle - stair.fromAngle), STAIR_SWEEP);
    // C = STAIR_RAIL_RADIUS + n·BRIDGE_RAIL_TILE/2 for whole n, so the run
    // between the two top newels — the landing's front balustrade — is a
    // whole number of tiles, which is the one thing the tile cannot fake.
    const tiles = ((Math.abs(stair.centreX) - STAIR_RAIL_RADIUS) * 2) / BRIDGE_RAIL_TILE;
    if (Math.abs(tiles - Math.round(tiles)) > 0.02) {
      problems.push(
        `a curve centre at |x| = ${Math.abs(stair.centreX).toFixed(2)} puts ` +
          `${tiles.toFixed(2)} balustrade tiles between the top newels — it must be whole`,
      );
    }
    // The landing laps the inner strings by the designed bite and no more.
    expect('the landing half-width', plan.landing.maxX, Math.abs(stair.centreX) - STAIR_INNER_RADIUS, 0.02);
  }

  if (plan.landing.slab < LANDING_SLAB_MIN - 1e-6 || plan.landing.slab > LANDING_SLAB_MAX + 1e-6) {
    problems.push(
      `the landing slab is ${plan.landing.slab.toFixed(2)} m thick, outside the asset's ` +
        `${LANDING_SLAB_MIN.toFixed(2)}–${LANDING_SLAB_MAX.toFixed(2)} m — past the maximum the ` +
        `arch stops clearing a child in a party hat, which silently undoes Jim's ruling`,
    );
  }
  if (room.wallHeight < LOBBY_MIN_WALL_HEIGHT) {
    problems.push(
      `the lobby's far walls are ${room.wallHeight.toFixed(2)} m against the asset's minimum ` +
        `${LOBBY_MIN_WALL_HEIGHT.toFixed(2)} — a child on the gallery has no air over her head`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `the lobby plan and the staircase asset disagree — layout.ts must follow ` +
        `art/models/hotelAssets.ts (the arrow turned round on 8 Aug 2026):\n  ` +
        problems.join('\n  '),
    );
  }
}

interface Chair {
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly room: HotelRoom;
  readonly id: string;
  /**
   * True once a guest has sat down in it — see {@link Hotel.seatGuests}.
   *
   * A chair with somebody in it offers the player no zone at all, which is the
   * whole mechanism: the alternative (a zone that appears and then refuses)
   * teaches a six-year-old that chips sometimes lie. It is a `let` on purpose,
   * because the chairs are built before the diners are dealt out and the
   * alternative is a second list of chair ids to keep in step with this one.
   */
  taken: boolean;
}

interface Bed {
  readonly x: number;
  readonly z: number;
  readonly id: string;
  /** The tucked-over blanket, hidden until {@link Hotel.nap} shows it. */
  readonly blanket: Group;
}

/**
 * One floor's bathroom — issue #272: *"every floor needs a bathroom with a
 * toilet, reusing the castle's toilet code."* Everything behavioural is the
 * shared `routine` (`building/Toilets.ts`'s `ToiletRoutine`, the castle's
 * own); this is just the geometry a particular room's copy of it stands in —
 * see {@link Hotel.buildBathroomFixtures}, the one place that ties the two
 * together, and {@link Hotel.bathrooms} for where every floor's one lives.
 */
interface Bathroom {
  readonly routine: ToiletRoutine;
  /** The room-local rectangle the privacy roof covers and the roof-approach
   *  test ({@link Hotel.bathroomOccupied}) is measured against. */
  readonly rect: ClearRect;
  readonly panX: number;
  readonly panZ: number;
  readonly basinX: number;
  readonly basinZ: number;
  /** Where the "Use" chip walks her to before it presses — always just
   *  outside the pan, on the nook's own open (doorless) side. */
  readonly standX: number;
  readonly standZ: number;
  /** How far the "Use" zone's pick area reaches. See {@link Hotel.buildBathroomFixtures}. */
  readonly pickRadius: number;
}

/** What `Hotel.hangOnWalls` puts on the two walls the camera can see. */
interface WallPlan {
  /** Sconce x positions on the north (−Z) wall. */
  readonly north?: readonly number[];
  /** Sconce z positions on the west (−X) wall. */
  readonly west?: readonly number[];
  readonly pictures?: readonly {
    readonly wall: 'north' | 'west';
    /** x on the north wall, z on the west wall. */
    readonly along: number;
    readonly width: number;
    readonly height: number;
    readonly seed: number;
  }[];
}

/**
 * **The Land Hotel** — Eleri's hotel (issue #236), close to the castle.
 *
 * Two places, like the castle: a crystal tower stands in the park (generator-
 * placed, `near: 'building'` in the manifest), and walking through its door
 * takes you somewhere else entirely. Unlike the castle — and per Jim's
 * ruling — every room is **its own disjoint space** at its own far origin
 * (`hotel/layout.ts`): lobby, breakfast room, floor-50 corridor, and the
 * suite behind the door that says "yours". The lift between them is the
 * first *portal* lift (Decision 3's shape, `HotelLift`), and the doors are
 * portals too. Nothing pretends the inside fits the outside.
 *
 * All the hotel's new art is Blender-authored (`art/blend/hotel_build.py`,
 * Jim's ruling; the Opus artist's handoff is HANDOFF-hotel-art.md). The
 * statues are deliberately NOT new art: the lobby's giant RiPika is the
 * fountain's own `createRipikaStatue` and the corridor pets are the live
 * `createPet` models — a second RiPika is a statue that goes stale
 * (`ripikaStatue.ts`'s own lesson).
 */
export class Hotel implements GameSystem {
  readonly name = 'hotel';

  /** Everything in the hotel's own spaces. Invisible until entered. */
  readonly hotelRoot = new Group();
  /** The tower in the park. */
  readonly gardenRoot = new Group();

  private readonly lift: HotelLift;
  private player: Player | null = null;
  private inside = false;
  private changingSpace = false;
  private spaceCooldown = 0;

  /**
   * The lobby's gallery-and-landing mass, and the fader that ghosts it.
   *
   * **The headline feature led somewhere a six-year-old could not see
   * herself.** Walking under the arch or anywhere in the colonnade, QA found
   * only her pet's head and a sliver of hat showing: the deck is 4.8 m deep
   * and 26 m wide at 5.44 m, and at the camera's 38° that hid roughly the
   * northern 10 m of a 24.8 m room. Nothing in the hotel had ever faded —
   * `FloorFader` was the castle's, and `FoliageFade` explicitly reasons that
   * the building interior is a separate space that can never occlude anyone.
   *
   * So the castle's fader does the work, with one number added to it: the
   * castle hides a storey outright, this one ghosts, because the gallery is
   * the thing the room is *for* and a child should still see it overhead
   * while she can see herself through it.
   */
  private lobbyOverhang: Group | null = null;
  private readonly overhangFader = new FloorFader(OVERHANG_GHOST_ALPHA);
  private overhangRegistered = false;

  private readonly statue: RipikaStatueHandle;
  private readonly discoBalls: { spin: Group }[] = [];
  /**
   * The lit ball's beams, and the room they belong to. Kept so the frame can
   * switch them off the moment she is anywhere else — see {@link hangDiscoBall}.
   */
  private readonly discoLights: { room: HotelRoom; lights: readonly Object3D[] }[] = [];
  /** The glints and motes, stepped only while their own room is the one she is in. */
  private readonly sparkles: { room: HotelRoom; sparkle: DiscoSparkle }[] = [];
  private readonly keepers: KeeperHandle[] = [];
  private readonly chairs: Chair[] = [];
  private readonly beds: Bed[] = [];
  /**
   * The one way a prop gets put down in this hotel — see `place.ts`. It is
   * what makes a prop solid *and* what tells the guests to walk round it, from
   * a single description of its footprint.
   */
  private readonly props: HotelProps;
  /** The guests, handed to `NpcSystem` — see {@link residents}. */
  private readonly guests: readonly ResidentSpec[];
  private seatedAt: string | null = null;
  /** The person behind the desk, who does the talking. See {@link checkIn}. */
  private receptionist: KeeperHandle | null = null;
  private readonly receptionBubble = new SpeechBubble(PALETTE.markerLilac);
  /** The lines still to say, and how long the current one has left. */
  private speech: { lines: readonly string[]; index: number; timer: number; cheerAt: number } | null =
    null;
  /** Guests sat at tables, bobbing over their breakfast. See {@link seatGuests}. */
  private readonly diners: { model: CharacterModel; phase: number }[] = [];
  /** The pet asleep in the suite's four-poster — kept so it breathes. */
  private sleepingPet: CreatureHandle | null = null;
  /**
   * Every floor's bathroom (issue #272), keyed by the room it stands in.
   * Five rooms, five entries — the suite's own (`dressBathroom`, unchanged
   * from 8 Aug 2026: four walls it already had) and one new nook per other
   * floor (`dressLobby`, `dressBreakfast`, `dressGarden`, `dressOcean`), all
   * built by the one shared {@link buildBathroomFixtures}. Nothing here is a
   * second copy of the castle's toilet: the fittings (`buildPan`,
   * `buildBasin`, `buildPrivacyRoof`) and the flush-wash-roof behaviour
   * (`ToiletRoutine`) are `building/Toilets.ts`'s own, imported rather than
   * re-implemented — only the room geometry each one stands in differs.
   *
   * `CORRIDOR` (Floor 50) is deliberately not a sixth entry — see
   * `dressCorridor`'s own note on why there is no honest rectangle left for
   * one there, and why the suite's own bathroom, one door away on the same
   * lift button, is what that floor offers instead.
   */
  private readonly bathrooms = new Map<HotelRoom, Bathroom>();

  // -------------------------------------------------- the camera moments
  /**
   * The one camera mechanism the hotel has — see `hotel/cinematic.ts`. Three
   * features drive it and none of them owns it.
   */
  private readonly cine: HotelCinematic;
  /** Set by `Game`; the seam that hands a camera to `Game.cameraOverride`. */
  onCinematic: ((camera: PerspectiveCamera | null) => void) | null = null;
  /** Whether the override is currently ours, so the seam is told only on a change. */
  private cineOn = false;
  /**
   * Which of the three moments is running, because they end differently: a
   * picture eases back, a window view fades back, and breakfast ends on its own.
   */
  private moment: 'food' | 'art' | 'window' | null = null;
  /** Every painted picture in the hotel, as something to walk up to and look at. */
  private readonly artworks: {
    readonly id: string;
    readonly art: number;
    /** Where it hangs, and the way it faces — world metres. */
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly normalX: number;
    readonly normalZ: number;
    readonly room: HotelRoom;
  }[] = [];
  /** Breakfast's own little scene: her bowl, the pet, and the pet's bowl. */
  private feast: {
    readonly pet: CreatureHandle;
    readonly petBowl: Group;
    readonly bowl: Group;
    readonly fromX: number;
    readonly fromZ: number;
    readonly toX: number;
    readonly toZ: number;
    readonly facing: number;
    t: number;
  } | null = null;
  /** Seconds of "that door is not yours yet" left to run. See {@link refuseSuite}. */
  private refusing = 0;
  /**
   * The real lock on the suite door: a collision wall across the corridor's
   * east doorway, present until reception hands over the key. The lock lived
   * only in {@link checkDoorways} once, as a trigger — and a trigger is not a
   * wall: its own refusal cooldown gated the whole doorway check, so a second
   * push walked clean through the open gap and off the floor slab into the
   * void (Jim, live play, 7 Aug 2026). Removed in {@link update} the moment
   * `hasHotelKey()` flips, wherever the key came from — check-in downstairs
   * or a restored save — so nothing that grants the key needs to know a wall
   * exists.
   */
  private suiteLock: WallCollider | null = null;
  /** Every lift alcove's sliding leaves and pointer dial. See {@link fitLiftAlcove}. */
  private readonly alcoves: {
    readonly room: HotelRoom;
    readonly doors: SlidingDoorsHandle;
    readonly dial: LiftDialHandle;
  }[] = [];
  /** The tower's front doors, and the lobby's — see {@link fitAutoDoors}. */
  private outerDoors: SlidingDoorsHandle | null = null;
  private innerDoors: SlidingDoorsHandle | null = null;
  private outerOpen = 0;
  private innerOpen = 0;
  /** Seconds of check-in celebration left to run. See {@link checkIn}. */
  private cheer = 0;
  /** The rainbow ring's six bands, which flash when you are given your key. */
  private readonly cheerLights: MeshToonMaterial[] = [];
  /** The star over the "yours" door — it lights up once the suite is yours. */
  private yoursStar: Mesh | null = null;
  private napping = 0;
  private nappingAt: Bed | null = null;

  /** Facade frame: the tower's yaw and centre, for the door trigger. */
  /** The tower's measured height, for a window's proportional vantage. */
  private readonly towerHeight: number;
  private readonly facadeYaw: number;
  private readonly facadeX: number;
  private readonly facadeZ: number;
  /**
   * The anchor's own "entrance" point — `world/anchors.ts`'s `entrance: [p.
   * entranceX, p.entranceZ]`, the exact spot `ui/ParkMap.ts` draws this
   * attraction's pin at. Both come from the same `placedEntry('hotel')`
   * call, stored here rather than re-read, so {@link exteriorEntranceZone}
   * can size itself to reach it without a second, hand-picked constant that
   * could drift out of sync with wherever the solver puts it.
   */
  private readonly entranceX: number;
  private readonly entranceZ: number;

  private readonly collision: CollisionWorld;
  private readonly controls: InteriorControls;
  private readonly surfaces: WalkSurfaces;
  private readonly deps: HotelDeps;

  constructor(
    collision: CollisionWorld,
    anchorPlots: AnchorPlots,
    controls: InteriorControls,
    surfaces: WalkSurfaces,
    deps: HotelDeps,
  ) {
    this.collision = collision;
    this.controls = controls;
    this.surfaces = surfaces;
    this.deps = deps;
    // ------------------------------------------------------------ the tower
    const plot = placedEntry('hotel');
    this.facadeX = plot.x;
    this.facadeZ = plot.z;
    this.entranceX = plot.entranceX;
    this.entranceZ = plot.entranceZ;
    // The door faces the doormat the solver placed — the tower is a cluster
    // of crystals, so any yaw is as natural as any other.
    this.facadeYaw = Math.atan2(plot.entranceX - plot.x, plot.entranceZ - plot.z);

    const tower = createHotelTower();
    this.towerHeight = tower.height;
    tower.root.rotation.y = this.facadeYaw;
    // **Lift the porch clear of the doors.** At the camera's fixed 38° pitch
    // the porch roof hid the 2.58 m sliding leaves from every legal standing
    // spot — the auto-doors worked (QA read their openness live) and were
    // invisible, which is the same as not existing. The glb bakes placement
    // into vertices with nodes at identity, so one position lift raises the
    // whole porch; the signboard is its own node and stays put.
    tower.root.getObjectByName('tower-porch')?.position.setY(0.62);
    paintSign(tower.signboard);
    this.gardenRoot.add(tower.root);
    this.gardenRoot.name = 'the-land-hotel-outside';

    const group = anchorPlots.getGroup('hotel');
    this.gardenRoot.position.set(plot.x - group.position.x, -group.position.y, plot.z - group.position.z);
    group.add(this.gardenRoot);
    anchorPlots.setPlaceholderVisible('hotel', false);

    // Collision: an octagon of walls around the crystal cluster, with the
    // doorway left open and a short lobby wall behind it — the same "a metre
    // of hallway, then somewhere else entirely" trick as the castle facade.
    registerTowerCollision(collision, plot.x, plot.z, this.facadeYaw);

    // ------------------------------------------------------------ the rooms
    this.hotelRoot.name = 'the-land-hotel-inside';
    this.hotelRoot.visible = false;

    // Its own constant warm light, because `World` now tells `DayNight` the
    // player is indoors in here and the sky's own lights switch off — see
    // `hotel/lighting.ts`. Inside `hotelRoot`, so it costs nothing at all
    // while she is out in the park.
    this.hotelRoot.add(new HotelLighting().group);

    this.props = new HotelProps(collision, surfaces);
    for (const room of ROOMS) this.buildRoomShell(room);
    if (!saveFlags.hasHotelKey()) {
      this.suiteLock = collision.addWall(
        CORRIDOR.originX + CORRIDOR.halfX,
        CORRIDOR.originZ - (DOOR_HALF + 0.4),
        CORRIDOR.originX + CORRIDOR.halfX,
        CORRIDOR.originZ + (DOOR_HALF + 0.4),
        0.3,
      );
    }
    this.statue = this.dressLobby();
    this.dressBreakfast();
    this.dressGarden();
    this.dressOcean();
    this.dressCorridor();
    this.dressSuite();
    // Every solid prop just placed by the `dress*` calls above has already
    // been checked against its room's doorways as it went down
    // (`HotelProps.footprint`); this is where any violation collected along
    // the way actually throws — once, with every offender named, rather than
    // shipping a sofa nobody can walk past.
    this.props.assertDoorwaysClear();
    // After every table exists, because it picks its chairs out of the list
    // those tables filled in — see `seatGuests`.
    this.seatGuests();
    // After the lobby's shell exists, because the inner pair hangs in it.
    this.fitAutoDoors(tower);

    // ----------------------------------------------------------- the guests
    // Built last, on purpose: it takes the keep-out list every `dress*` method
    // above filled in as it put its furniture down, so nobody strolls through
    // a sofa. Building it earlier would hand it an empty list, and the failure
    // would be silent — which is why it is here rather than beside them.
    //
    // Parented to `hotelRoot` rather than to a room's shell: an `NpcCharacter`
    // writes **world** positions onto its model's root, and `hotelRoot` is the
    // only node here with an identity transform. It is also what hides them
    // with the hotel.
    this.guests = hotelResidents(this.hotelRoot, this.props.roomKeepOuts);

    // -------------------------------------------------- the camera moments
    this.cine = new HotelCinematic(deps.camera);
    // See `dismissView`: one listener for every kind of press there is.
    const press = (): void => this.dismissView();
    window.addEventListener('pointerdown', press);
    window.addEventListener('keydown', press);

    // ------------------------------------------------------------- the lift
    this.lift = new HotelLift({
      currentRoom: () => this.currentRoom(),
      atLiftDoors: (player) => this.atLiftDoors(player),
      travelTo: (room) => this.travelTo(room),
      cancelWalk: () => this.controls.cancelWalk(),
      player: () => this.player,
    });
  }

  get liftPanel(): LiftPanelSource {
    return this.lift;
  }

  /**
   * Every room with its own bathroom (issue #272 — five of the hotel's six
   * rooms; `CORRIDOR` shares the suite's, see `dressCorridor`).
   *
   * `check:hotel` walks this list rather than keeping its own copy of which
   * floors have one and where the fittings stand — CLAUDE.md's "one owner;
   * everyone else asks" — so a floor added here without a bathroom shows up
   * as a probe failure rather than as a silent gap.
   */
  get bathroomRooms(): readonly HotelRoom[] {
    return [...this.bathrooms.keys()];
  }

  /** World-metre pan and basin positions for `room`'s bathroom, or `null` if
   *  it has none. See {@link bathroomRooms}. */
  bathroomFixtures(
    room: HotelRoom,
  ): { readonly pan: { readonly x: number; readonly z: number }; readonly basin: { readonly x: number; readonly z: number } } | null {
    const bathroom = this.bathrooms.get(room);
    if (!bathroom) return null;
    return {
      pan: { x: room.originX + bathroom.panX, z: room.originZ + bathroom.panZ },
      basin: { x: room.originX + bathroom.basinX, z: room.originZ + bathroom.basinZ },
    };
  }

  /** The cinematic camera's aspect, from `Game`'s resize handler. */
  resizeCinematic(width: number, height: number): void {
    this.cine.resize(width, height);
  }

  /**
   * Where the camera stands to look out of `room`'s window — the tower's real
   * place in the park, at this storey's proportional height up its spire.
   *
   * **Public because `check:hotel` asserts on it**, and because the
   * alternative is the check recomputing the formula from the same inputs,
   * which is a check that agrees with a copy of the code rather than with the
   * code. It is one expression and it has one owner.
   */
  windowVantage(room: HotelRoom): Vector3 {
    const storey = HOTEL_FLOORS[room.liftFloor ?? 0]?.storey ?? 0;
    const ground = this.surfaces.sample(this.facadeX, this.facadeZ, 3);
    // Proportional up the spire, and never right at the tip — the top floor
    // looks out of the tower, not off the end of it.
    const height = ground + 2.5 + (storey / TOP_STOREY) * (this.towerHeight - 5);
    // **On the plaza's side of the tower, by construction.** Two drafts got
    // this wrong by measuring off the doorway: 3.2 m from the tower's centre
    // was *inside* the 7.2 m-wide base cluster, and 8.5 m out along the
    // facade's yaw still left the spire between the camera and the plaza it
    // was about to look at — both watched as crystal filling a third of the
    // frame (QA, then /view, 7 Aug 2026). Standing 8.5 m out along the line
    // from the tower **toward the plaza** puts the crystal behind the lens,
    // whatever yaw the solver gave the doorway.
    const toPlazaX = PLAZA.x - this.facadeX;
    const toPlazaZ = PLAZA.z - this.facadeZ;
    const along = Math.hypot(toPlazaX, toPlazaZ) || 1;
    const out = 8.5;
    return new Vector3(
      this.facadeX + (toPlazaX / along) * out,
      height,
      this.facadeZ + (toPlazaZ / along) * out,
    );
  }

  /**
   * Where a child stands to look at each painting, in world metres — for
   * `check:hotel`, which asserts none of them is inside the furniture.
   */
  get artworkStands(): readonly { readonly x: number; readonly z: number; readonly art: number }[] {
    return this.artworks.map((art) => ({
      x: art.x + art.normalX * 1.9,
      z: art.z + art.normalZ * 1.9,
      art: art.art,
    }));
  }

  /**
   * Where each painting actually hangs, world metres, plus which room it is
   * in — for `check:hotel`'s mezzanine-occlusion probe (issue #271), which
   * needs the room's own mezzanine plan alongside the built position and
   * cannot get both from {@link artworkStands} alone.
   */
  get artworkPlacements(): readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly room: HotelRoom;
  }[] {
    return this.artworks.map((art) => ({ x: art.x, y: art.y, z: art.z, room: art.room }));
  }

  /**
   * One frame of whichever camera moment is running, and the seam.
   *
   * `onCinematic` is told **only when the answer changes** — handing `Game` the
   * same camera object sixty times a second would be sixty assignments to
   * `cameraOverride` for one decision, and the one frame that matters (the
   * hand-back) would be indistinguishable from the fifty-nine that do not.
   */
  private updateCinematic(dt: number): void {
    const camera = this.cine.update(dt);
    const on = camera !== null;
    if (on !== this.cineOn) {
      this.cineOn = on;
      this.onCinematic?.(camera);
    }
  }

  /**
   * A press, while a held shot is up — the way out of a picture or a window.
   *
   * Jim asked for *"any-press exit"*, and any press genuinely means any: a tap,
   * a click, a key, a controller button. Rather than teach three input systems
   * about this, it listens on the window itself, which is the one place all of
   * them arrive. Registered once for the hotel's whole life and guarded on
   * `dismissible`, so it costs nothing at all until a shot is actually holding.
   */
  private dismissView(): void {
    if (!this.cine.dismissible) return;
    if (this.moment === 'window') {
      // A window closes behind the same soft fade it opened behind, rather
      // than flying the camera back across four hundred metres of park.
      this.controls.iris(() => this.cine.cancel());
      return;
    }
    this.cine.dismiss();
  }

  /**
   * True while the player is in any of the hotel's own spaces.
   *
   * `World` OR-s this with the castle's `playerInRoofedInterior` into the one
   * question it asks `DayNight`: *is the player in **any** interior?* Jim,
   * having played it: *"the hotel shouldn't have a night/day cycle like
   * outdoors."* Every room here counts — there is no roof terrace to be an
   * exception, and a hotel room being open-topped is a *camera* decision, not
   * a statement that it is outdoors.
   */
  get playerIsInside(): boolean {
    // **False while she is looking out of a window**, even though she has not
    // moved. This getter has exactly one consumer — `World.playerInAnyInterior`,
    // which feeds `DayNight.setIndoors` — so it is not really "is she indoors"
    // but "should the sky's own lights be off". During a window view the
    // camera is out in the park, and `setIndoors(true)` switches off the sun,
    // the fill and the ambient: the view would be of a park lit by nothing at
    // all. Answering the question that is actually being asked is cheaper and
    // truer than adding a second flag that has to be kept in step with this
    // one.
    return this.inside && this.moment !== 'window';
  }

  /**
   * The hotel's guests, as park-NPC bodies for `NpcSystem` to run.
   *
   * Read once, by `World`, when it builds the crowd — which is why the hotel
   * is constructed before `NpcSystem` there. See `NpcSystem`'s `ResidentSpec`
   * for the split, and `HotelGuests.ts` for why there is no movement code left
   * in this building at all.
   */
  get residents(): readonly ResidentSpec[] {
    return this.guests;
  }

  attachPlayer(player: Player): void {
    this.player = player;
  }

  /**
   * Adopt a player RESTORED into a hotel room (a reload mid-visit). Being in
   * a room is not just a coordinate — the room must be visible, the play
   * bounds re-bound, `inside` true — and none of that has happened at
   * construction. Called once from `Game` after the spawn resolves; a
   * no-op for a garden spawn. This is what stops the QA-observed limbo of
   * "save says hotel.lobby, player stands at the plaza".
   */
  adoptRestoredPlayer(): void {
    const room = this.currentRoom();
    if (!room) return;
    this.inside = true;
    this.hotelRoot.visible = true;
    this.boundTo(room);
    this.spaceCooldown = SPACE_COOLDOWN;
  }

  /**
   * The `/hotel` deep link: straight into the lobby from wherever she is.
   * Safe from anywhere, the way the slide's own deep link is: the change
   * happens behind a closed iris and teleports, so it does not care where
   * she was standing when she asked.
   */
  requestEnterLobby(): boolean {
    const player = this.player;
    if (!player || player.riding || this.changingSpace || this.inside) return false;
    this.changeSpace(() => this.enterLobby());
    return true;
  }

  /**
   * The `/hotel-bathroom` family of deep links (#281, extended for the
   * own-room rewrite to reach every floor's bathroom, not just Floor 1's):
   * straight to a guest-floor bathroom, without the lobby-stairs-corridor
   * walk to find one. Defaults to `BREAKFAST` (the original `/hotel-bathroom`
   * link's target, kept stable) but takes any bathroom-bearing room, so a QA
   * pass can land in each floor's own room in turn. Lands facing the pan —
   * the same "Use" stand spot `interactZones` itself walks her to, read from
   * `this.bathrooms` rather than a second hand-copied literal, so a re-tuned
   * room stays correct here for free (see the "kept in step by hand" warning
   * this repo has paid for before).
   */
  requestEnterBathroom(room: HotelRoom = BREAKFAST): boolean {
    const player = this.player;
    if (!player || player.riding || this.changingSpace || this.inside) return false;
    const bathroom = this.bathrooms.get(room);
    if (!bathroom) return false;
    this.changeSpace(() => this.enterFloorBathroom(room, bathroom));
    return true;
  }

  /**
   * The `/hotel-breakfast` deep link (#276): straight into the breakfast
   * room, already seated at a table, chip row up. Same "safe from anywhere"
   * shape as {@link requestEnterLobby} — the whole point of a deep link for a
   * clipped `.action-chip-row` is showing the row on the very first frame,
   * not requiring a tester to walk over and sit down before the bug is even
   * on screen.
   */
  requestEnterBreakfast(): boolean {
    const player = this.player;
    if (!player || player.riding || this.changingSpace || this.inside) return false;
    this.changeSpace(() => this.enterBreakfastRoom());
    return true;
  }

  /**
   * The `/hotel-suite` deep link: straight into the guest suite — where
   * #273/#278's doorway-clearance fix (the lounge sofa and TV) and #279's
   * bigger bedrooms and pet beds actually live — from wherever she is.
   * Bypasses reception's key check on purpose: the normal route in is
   * `CORRIDOR`'s `suite-door` band refusing entry without
   * `saveFlags.hasHotelKey()` (see the walk-through handling above), but a
   * deep link exists precisely so QA does not have to check in first to see
   * the room. Same shape as {@link requestEnterLobby}.
   */
  requestEnterSuite(): boolean {
    const player = this.player;
    if (!player || player.riding || this.changingSpace || this.inside) return false;
    this.changeSpace(() => this.enterSuite());
    return true;
  }

  // ---------------------------------------------------------------- zones

  /**
   * The tower from outside, before she has ever walked in — GitHub issue
   * #309's "the character can't be sent there at all", for the hotel
   * specifically.
   *
   * One zone covering the whole crystal footprint, so a `ui/ParkMap.ts` tap
   * anywhere on the tower's plot finds it (`Game.useZoneNear`'s
   * `pickInteractZone`, tested against `pickRadius`) rather than getting the
   * flat "can't walk there" a solid collider used to earn. No `actions` —
   * same as `world/building/interactZones.ts`'s own `frontDoor` — because
   * there has never been an "enter the hotel" button to press: walking
   * through the doorway is what has always done it, via
   * {@link checkDoorways}'s own crossing trigger, and that fires on the walk
   * itself with no help from this zone.
   *
   * **`standX/standZ` is {@link towerDoorBand}'s own centre — not a second,
   * hand-picked offset.** The first cut placed it 1.5 m *past* the band's
   * inner edge, reasoning that only a point beyond the whole band could force
   * a routed walk to cross it — sound for straight-line steering, wrong for
   * the actual routed walk, which plans on `NavGrid`'s half-metre lattice
   * baked from collision. That lattice has no waypoint past the tower's real
   * back wall (measured empirically, sat well short of the doc comment's own
   * `TOWER_BACK_ALONG`), so the route stopped 2.6 m short of the target every
   * time and the doorway's crossing trigger never fired (`check:park`'s
   * `route.unreachable`, and a live repro, both caught it — PR #315 review).
   * The band's centre needs no such offset trick: it is, by construction,
   * inside the band on every axis, so any walk that reaches it has already
   * crossed the band getting there — and it is comfortably inside the
   * lattice's real reach (confirmed against the built park: the whole band
   * from its centre out to the facade routes with zero shortfall). One
   * number, already owned by {@link towerDoorBand}, used here instead of
   * copied.
   *
   * **`pickRadius` reaches at least as far as {@link entranceX}/{@link
   * entranceZ}** — the exact point `world/anchors.ts` reports as this
   * anchor's `entrance` and `ui/ParkMap.ts` draws the tower's pin at. PR
   * #315's second review round found the two 9.38 m apart on one seed: this
   * zone was centred on the tower's true plot centre (`facadeX`/`facadeZ`)
   * with a fixed `TOWER_SHELL_RADIUS + 2` reach, which happened to fall just
   * short of wherever the solver had put the doormat that seed, so tapping
   * the pin a family actually sees fell through to a plain ground walk and
   * the doorway trigger never had a chance to fire — the "two definitions of
   * one thing" bug class CLAUDE.md names as this repo's most common, with
   * the map's pin and this zone's reach kept in step by two separate
   * numbers instead of one owner. Deriving the radius from the real,
   * measured distance to the entrance point — rather than nudging the
   * constant up until this seed's number happens to clear it — means it
   * always covers the pin, whatever a future reseed puts it at, with no
   * second number to fall out of sync again. `Math.max` with
   * `TOWER_SHELL_RADIUS` keeps the whole crystal footprint tappable too, on
   * a seed where the entrance sits unusually close to centre.
   */
  private exteriorEntranceZone(): InteractZone {
    const band = this.towerDoorBand();
    const entranceReach = Math.hypot(
      this.entranceX - this.facadeX,
      this.entranceZ - this.facadeZ,
    );
    return {
      id: 'hotel-entrance',
      label: 'The Land Hotel',
      x: this.facadeX,
      y: this.surfaces.sample(this.facadeX, this.facadeZ, 3),
      z: this.facadeZ,
      pickRadius: Math.max(TOWER_SHELL_RADIUS, entranceReach) + 1,
      standX: band.centreX,
      standZ: band.centreZ,
    };
  }

  interactZones(): InteractZone[] {
    if (!this.inside) return [this.exteriorEntranceZone()];
    const zones: InteractZone[] = [];
    const room = this.currentRoom();
    if (!room) return zones;

    if (room === LOBBY) {
      // Derived from RECEPTION_X/Z — the same numbers the desk itself is
      // placed by — never a second literal. The zone used to keep the desk's
      // *old* spot and sent a child to check in beside the staircase.
      const x = LOBBY.originX + RECEPTION_X;
      const z = LOBBY.originZ + RECEPTION_Z;
      zones.push({
        id: 'hotel-reception',
        label: 'reception',
        x,
        y: 1,
        z,
        pickRadius: 2.6,
        // Straight in front of the counter. The old step-east dodge was for
        // the statue's silhouette when the desk sat on the axis; the desk is
        // in the east bay now and nothing stands between her and the lens.
        standX: x,
        standZ: z + 2.4,
        verb: 'Check in',
        actions: () =>
          saveFlags.hasHotelKey()
            ? pressAction('Say hello!', () => this.wave(), '👋')
            : pressAction('Check in here!', () => this.checkIn(), '🔑'),
      });
    }

    // The suite door, from the corridor side — a sign that says whose door it
    // is and, until reception has handed the key over, what to do about it.
    //
    // **The actions are real, or the sign never appears at all**:
    // `Selection.selectable` drops any zone whose `actions()` is empty, so
    // the first version of this — `actions: () => []`, on the theory that a
    // sign needs no button — was a sign a child could never see (QA, 7 Aug
    // 2026). With the key the chip walks her in, which the door would also do
    // by touch; without it the chip blinks the star and says where the key
    // lives, which is the gentle refusal Jim asked for with a button on it.
    if (room === CORRIDOR) {
      const hasKey = saveFlags.hasHotelKey();
      zones.push({
        id: 'hotel-yours-door',
        label: 'your door',
        x: CORRIDOR.originX + CORRIDOR.halfX - 0.6,
        y: 1.2,
        z: CORRIDOR.originZ,
        pickRadius: 2.4,
        standX: CORRIDOR.originX + CORRIDOR.halfX - 2.4,
        standZ: CORRIDOR.originZ,
        standRadius: 2.6,
        verb: hasKey ? 'Go in' : 'Locked',
        actions: () =>
          hasKey
            ? pressAction('Go in — this is yours!', () => this.enterSuiteThroughDoor(), '⭐')
            : pressAction('Where is my key?', () => this.blinkYoursStar(), '🔑'),
      });
    }

    // The paintings — one "Look!" each. See `lookAtArt`.
    for (const art of this.artworks) {
      if (art.room !== room) continue;
      zones.push({
        id: `hotel-art-${art.id}`,
        label: 'painting',
        x: art.x,
        y: art.y,
        z: art.z,
        pickRadius: 2,
        standX: art.x + art.normalX * 1.9,
        standZ: art.z + art.normalZ * 1.9,
        standRadius: 2.4,
        verb: 'Look',
        actions: () => pressAction('See the painting', () => this.lookAtArt(art), '🖼️'),
      });
    }

    // The windows — one per wall that has any, at the middle pane. One zone
    // per *wall* rather than per pane on purpose: forty-one panes would be
    // forty-one selectable things in a hotel with four other verbs in it.
    for (const side of ['north', 'west'] as const) {
      const wall = room.windows[side];
      if (!wall || wall.at.length === 0) continue;
      // A wall may declare its panes light-only — see `WindowWall.lookZone`
      // (the suite's west pane lights the bathroom, whose own tap target
      // cannot share the little room with a second verb).
      if (wall.lookZone === false) continue;
      const stand = 1.8;
      const paneX = (at: number): number =>
        side === 'north' ? room.originX + at : room.originX - room.halfX + 0.4;
      const paneZ = (at: number): number =>
        side === 'north' ? room.originZ - room.halfZ + 0.4 : room.originZ + at;
      // **Only a pane the tap-spacing rule allows.** The suite's west panes
      // flank the corridor doorway, and a zone there ate every tap aimed at
      // the door — Jim's "isn't possible to leave the hotel room on mobile"
      // (8 Aug 2026). The rule lives in `world/tapSpacing.ts`; a wall with no
      // compliant pane simply offers no zone, and the room's other wall
      // carries "Look out".
      const bands = hotelDoorBands(room);
      const clearOfDoors = (at: number): boolean =>
        bands.every(
          (band) =>
            distanceToBand(band, paneX(at), paneZ(at)) - WINDOW_PICK_RADIUS >=
            TAP_FINGER_METRES,
        );
      const candidates = wall.at.filter(clearOfDoors);
      if (candidates.length === 0) continue;
      // Middle pane by preference — but only a pane a child can actually
      // stand at. The breakfast room's middle north pane is behind the
      // buffet counter, and a zone whose stand spot is inside a counter is
      // a chip that never comes in range (QA, 8 Aug 2026). The collision
      // world is the authority on "can stand here", so ask it, nearest the
      // middle first. A layout that knows better says so with `zoneAt`.
      const middleOf = wall.at[Math.floor(wall.at.length / 2)] ?? 0;
      const probe = new Vector3();
      /**
       * Somewhere clear to stand and look through this pane, or `null`.
       *
       * **Searched, not assumed.** A fixed 1.8 m straight out from the glass
       * is one guess, and in the corridor it is wrong at every single pane:
       * the row of pet statues stands right across that line, so every
       * candidate stand spot was pushed 0.77 m and landed outside the zone's
       * own 2.2 m pick radius — the verb existed and could never come into
       * range. There are clear gaps between those statues, and this finds
       * them: straight out first, then further out, then to either side,
       * never further from the pane than the pick radius, or she would arrive
       * and still not be offered it.
       */
      const standSpotFor = (at: number): { x: number; z: number } | null => {
        const px = paneX(at);
        const pz = paneZ(at);
        // Inward from the glass, and along the wall.
        const inX = side === 'north' ? 0 : 1;
        const inZ = side === 'north' ? 1 : 0;
        for (const lateral of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4]) {
          for (const depth of [stand, 1.4, 2.2, 1.0, 2.6, 0.8]) {
            // She must end up inside the pick radius, or the walk arrives at
            // a spot the picker will not answer from.
            if (Math.hypot(depth, lateral) > WINDOW_PICK_RADIUS - 0.1) continue;
            const sx = px + inX * depth + inZ * lateral;
            const sz = pz + inZ * depth + inX * lateral;
            probe.set(sx, 0, sz);
            this.collision.resolve(probe, PLAYER_RADIUS);
            if (Math.hypot(probe.x - sx, probe.z - sz) < 0.05) return { x: sx, z: sz };
          }
        }
        return null;
      };
      const ordered = [...candidates].sort(
        (a, b) => Math.abs(a - middleOf) - Math.abs(b - middleOf),
      );
      const middle =
        wall.zoneAt ?? ordered.find((at) => standSpotFor(at) !== null) ?? candidates[0] ?? 0;
      const x = paneX(middle);
      const z = paneZ(middle);
      const spot = standSpotFor(middle);
      zones.push({
        id: `hotel-window-${room.space}-${side}`,
        label: 'window',
        x,
        y: Math.min((wall.sill + wall.head) / 2, LOOK_ZONE_MAX_Y),
        z,
        pickRadius: WINDOW_PICK_RADIUS,
        standX: spot ? spot.x : side === 'north' ? x : x + stand,
        standZ: spot ? spot.z : side === 'north' ? z + stand : z,
        standRadius: 2.6,
        verb: 'Look out',
        actions: () => pressAction('See the view', () => this.lookOutside(room), '🪟'),
      });
    }

    for (const chair of this.chairs) {
      if (chair.room !== room) continue;
      // Somebody is already sitting there. See `seatGuests`.
      if (chair.taken) continue;
      zones.push({
        id: `hotel-chair-${chair.id}`,
        label: 'breakfast chair',
        x: chair.x,
        y: 1,
        z: chair.z,
        pickRadius: 1.6,
        standX: chair.x - Math.sin(chair.facing) * 0.9,
        standZ: chair.z - Math.cos(chair.facing) * 0.9,
        standRadius: 2.2,
        // Sitting is a ride as far as the engine cares, and a zone is not
        // selectable while riding unless it says so — the train's own 'Get
        // off' precedent. Without this, sitting down eats every chip
        // including 'Hop down' and a child is stuck at the table forever.
        selectableWhileRiding: true,
        verb: 'Sit',
        actions: () =>
          this.seatedAt === chair.id
            ? [
                ...BREAKFASTS.map((food) => ({
                  id: `eat-${food.kind}`,
                  label: food.label,
                  glyph: food.glyph,
                  run: () => this.eat(food.kind),
                })),
                // "Leave breakfast", not "Hop down" (Jim, 7 August 2026): the
                // chip has to say what leaving *this* is, because a child sat
                // at a table reads "Hop down" as another thing to do at the
                // table rather than as the way out of it.
                { id: 'hop-down', label: 'Leave breakfast', run: () => this.standUp() },
              ]
            : pressAction('Have breakfast', () => this.sitAt(chair), '🪑'),
      });
    }

    // The bathroom — the castle's toilets zone, one per floor now (issue
    // #272). One zone for the whole two-beat routine (flush, then wash),
    // anchored on the pan with its stand spot inside the room, so tapping it
    // walks her in and the privacy roof has already closed over her by the
    // time the flush plays.
    const bathroom = this.bathrooms.get(room);
    if (bathroom) {
      zones.push({
        id: `hotel-bathroom-${room.space}`,
        label: 'bathroom',
        x: room.originX + bathroom.panX,
        y: 1,
        z: room.originZ + bathroom.panZ,
        // A bed-sized target: any bigger and the pick area reaches the
        // bathroom doorway's band (`hotelDoorBands`), and a doorway a zone
        // covers is a doorway a phone cannot use. Per-room, because a floor
        // nook has closer neighbours than the suite's own bathroom did —
        // see {@link buildBathroomFixtures}.
        pickRadius: bathroom.pickRadius,
        standX: room.originX + bathroom.standX,
        standZ: room.originZ + bathroom.standZ,
        standRadius: 2.2,
        verb: 'Use',
        actions: () =>
          bathroom.routine.busy
            ? []
            : pressAction('Use the toilet!', () => bathroom.routine.use(), '🚽'),
      });
    }

    for (const bed of this.beds) {
      if (room !== SUITE) continue;
      zones.push({
        id: `hotel-bed-${bed.id}`,
        label: 'your bed',
        x: bed.x,
        y: 1,
        z: bed.z,
        pickRadius: 1.8,
        standX: bed.x,
        standZ: bed.z + 1.5,
        standRadius: 2.4,
        verb: 'Sleep',
        actions: () =>
          this.napping > 0 ? [] : pressAction('Have a sleep', () => this.nap(bed), '💤'),
      });
    }

    return zones;
  }

  /**
   * Ghost the lobby's overhang whenever it is between the player and the
   * camera — the hotel's answer to the castle's cutaway.
   *
   * The test is exact rather than sampled, because the camera is orthographic
   * (one fixed view direction everywhere) and the decks are axis-aligned
   * rectangles: `mezzanineHidesPoint` marches from a point along the view
   * direction to each deck's walking surface and asks whether it lands on it.
   * Three heights up her body, the same three `check:hotel` raycasts, so what
   * fades and what the probe calls hidden are the same question asked twice
   * in two different ways.
   */
  private updateOverhangCutaway(context: FrameContext): void {
    if (this.lobbyOverhang && !this.overhangRegistered) {
      this.overhangFader.addLayer(this.lobbyOverhang);
      this.overhangRegistered = true;
    }
    if (!this.overhangRegistered) return;
    const plan = LOBBY.mezzanine;
    const player = context.playerPosition;
    let hidden = false;
    if (plan && player && this.inside && this.currentRoom() === LOBBY) {
      const localX = player.x - LOBBY.originX;
      const localZ = player.z - LOBBY.originZ;
      for (const fraction of OVERHANG_BODY_FRACTIONS) {
        if (mezzanineHidesPoint(plan, localX, player.y + PLAYER_HEIGHT * fraction, localZ)) {
          hidden = true;
          break;
        }
      }
    }
    this.overhangFader.setVisibleUpTo(hidden ? -1 : null);
    this.overhangFader.update(context.dt);
  }

  // ---------------------------------------------------------------- frame

  update(context: FrameContext): void {
    const { dt, elapsed } = context;
    if (this.spaceCooldown > 0) this.spaceCooldown -= dt;
    this.updateOverhangCutaway(context);

    // The key turning in the lock. Before the player-null return, so a
    // headless world (check:hotel) can watch the door open too.
    if (this.suiteLock && saveFlags.hasHotelKey()) {
      this.collision.removeWall(this.suiteLock);
      this.suiteLock = null;
    }

    this.lift.update(dt);
    // After the lift, so the leaves answer to this frame's phase rather than
    // to last frame's — a door that lags the ride by a frame is a door you can
    // see close on the wrong side of the iris.
    this.updateDoors(dt);
    this.statue.update(dt, elapsed);
    // No guest update here any more: they are ordinary `NpcCharacter`s in
    // `NpcSystem`'s own array and are stepped by it, with the park's crowd,
    // by the park's code — which is the whole point (see `HotelGuests.ts`).
    for (const ball of this.discoBalls) ball.spin.rotation.y = elapsed * 0.5;
    for (const keeper of this.keepers) keeper.setWalkPhase(elapsed * 0.4, 0.5);

    // Five real spot lights per lit ball, so they burn only in the room they
    // are in. `visible = false` takes a light out of three.js's own gather, so
    // this is a genuine saving rather than a dimmer — see `hangDiscoBall`.
    const here = this.currentRoom();
    for (const rig of this.discoLights) {
      const lit = this.inside && rig.room === here;
      for (const light of rig.lights) light.visible = lit;
    }
    // Same rule for the sparkle: two `InstancedMesh` rewrites a frame is
    // nothing next to the park, but it is not nothing when she is on the other
    // side of the world and cannot see the ball at all.
    for (const rig of this.sparkles) {
      const near = this.inside && rig.room === here;
      rig.sparkle.glints.visible = near;
      rig.sparkle.motes.visible = near;
      if (near) rig.sparkle.update(elapsed);
    }

    // The pet asleep in the suite, breathing. `setWalkPhase(phase, 0)` is the
    // pets' own idle — no stride, just the body's bob — so a sleeping pet uses
    // the same one line every other pet in the park uses to stand still.
    this.sleepingPet?.setWalkPhase(elapsed * 0.7, 0);

    // Every floor's bathroom clock — the same call the castle makes, every
    // frame, occupancy asked fresh from where she is standing (the roof must
    // lead her in and can never trap her; `building/Toilets.ts`). Only the
    // bathroom in the room she is actually in can be occupied; every other
    // floor's routine simply idles.
    for (const [bathroomRoom, bathroom] of this.bathrooms) {
      const occupied = here === bathroomRoom && this.bathroomOccupied(bathroomRoom, bathroom);
      bathroom.routine.update(dt, elapsed, occupied);
    }

    // Children at breakfast, rocking gently over their cereal. Three lines of
    // motion is the difference between somebody eating and a mannequin.
    for (const diner of this.diners) {
      diner.model.body.rotation.x = Math.sin(elapsed * DINER_BOB_RATE + diner.phase) * DINER_BOB;
    }

    this.updateCinematic(dt);
    this.updateFeast(dt, elapsed);
    this.updateSpeech(dt);
    if (this.speech) {
      // The bubble's natural (unclamped) world anchor is the position it was
      // parented at in `dressLobby` — she never moves, so nothing re-sets it
      // here. `updateScreenSize` reads that anchor straight off the sprite
      // (`sprite.getWorldPosition`) and re-clamps it to the screen fresh,
      // every call — see `SpeechBubble`'s own doc.
      this.receptionBubble.updateScreenSize(this.deps.camera);
    }

    // The "that door is not yours yet" blink. Driven off `elapsed` like the
    // check-in flash, for the same reason: the same pulse rate every time.
    if (this.refusing > 0) {
      this.refusing -= dt;
      const lit = this.refusing > 0 && Math.sin(elapsed * 11) > 0;
      this.lightYoursStar(lit || saveFlags.hasHotelKey());
    }

    // The check-in flash. Driven off `elapsed` rather than off the countdown
    // so the pulse rate is the same every time, and settled back to zero on
    // the frame it runs out rather than left wherever the sine happened to be.
    if (this.cheer > 0) {
      this.cheer -= dt;
      const pulse = this.cheer > 0 ? 0.25 + Math.abs(Math.sin(elapsed * 8.5)) * 0.95 : 0;
      for (const band of this.cheerLights) band.emissiveIntensity = pulse;
    }

    const player = this.player;
    if (!player) return;

    if (this.napping > 0 && this.nappingAt) {
      this.napping -= dt;
      if (this.napping <= 0) {
        this.napping = 0;
        this.nappingAt.blanket.visible = false;
        this.nappingAt = null;
        // `endRide` stands the model back up itself; the group was never
        // pitched (see `nap` — the posture owns the recline).
        player.endRide();
        player.model.setExpression('happy');
      }
      return;
    }

    if (!this.changingSpace && !player.riding) this.checkDoorways(player);

    // Nobody falls out of the world. Every doorway is a portal or a wall, but
    // the proof is a backstop rather than an audit of doorways: anything that
    // still slips a trigger — a cooldown window, a dropped frame, a door not
    // written yet — lands back in the room it fell from, not in the void.
    if (this.inside && !this.changingSpace && player.position.y < -2) {
      const room = this.currentRoom() ?? LOBBY;
      player.teleportTo(room.originX, 0, room.originZ, Math.PI);
      this.controls.snapCamera();
    }

    // There used to be a second net here: anyone at ground level inside the
    // mezzanine's rectangle was stood back at the room's origin, because that
    // rectangle was the inside of the gallery's *solid mass* — a pocket a
    // pre-fix save could restore a player into, invisible and pinned. The
    // imperial rework made that rectangle the **colonnade**: open, walkable,
    // and on the room's own axis, so the net was teleporting a child to the
    // middle of the lobby for the crime of walking under her own gallery
    // (found live, 9 Aug 2026 — the axis walk reset at z ≈ −7.5 on every
    // attempt). A stale save restoring inside the old mass region now lands
    // on honest floor, which needs no rescue.
  }

  // ------------------------------------------------------ changing space

  /**
   * The tower's front-door trigger, in world metres — the same rectangle
   * {@link checkDoorways} walks through, published so
   * `scripts/check-tap-spacing.mts` can hold the park's tap targets clear of
   * it. Room doorways get the same treatment from `layout.ts`'s
   * `hotelDoorBands`; this one alone lives here because only the built hotel
   * knows where the solver put its facade.
   */
  towerDoorBand(): PortalBand {
    // **The doorway, as built**, rather than three numbers that have to be
    // kept level with it by hand: from the lobby back wall out to the outer
    // face of the facade she walks through. The old band stopped 0.45 m
    // *inside* the facade plane, so there was a sliver in which she was
    // through the door and the trigger said she was not — the sort of gap
    // between two hand-copied depths this repo has been bitten by six times
    // in a day (CLAUDE.md, "Two definitions of one thing").
    const outer = TOWER_FACADE_ALONG + 0.4;
    const centre = (TOWER_BACK_ALONG + outer) / 2;
    return {
      what: "the hotel tower's front door",
      centreX: this.facadeX + Math.sin(this.facadeYaw) * centre,
      centreZ: this.facadeZ + Math.cos(this.facadeYaw) * centre,
      halfAlong: (outer - TOWER_BACK_ALONG) / 2,
      halfAcross: DOOR_HALF + 0.4,
      yaw: this.facadeYaw,
      y: 0,
      // `exteriorEntranceZone`'s `hotel-entrance` zone *is* this door now
      // (GitHub issue #309: a `ui/ParkMap.ts` tap anywhere on the tower walks
      // her to this band and its own crossing trigger does the rest) — same
      // pattern as `Building.ts`'s `castleEntranceBand`, whose `frontDoor`
      // zone is its band's handle the same way. Without this,
      // `scripts/check-tap-spacing.mts` reads the zone's wide `pickRadius`
      // (it has to cover the whole tower footprint, not just the door) as one
      // zone's pick area eating another's trigger band — which is exactly
      // backwards here, since there is no "another": the zone and the band
      // are the same doorway.
      ownZoneId: 'hotel-entrance',
    };
  }

  /**
   * **Every doorway in the hotel is one question, asked of the line she just
   * walked**: did that line pass through this door's rectangle?
   *
   * Not "is she standing in it", which is what this used to ask. A band is
   * a couple of metres deep and a walk samples it once a frame, so the point
   * test mostly worked and *occasionally* did not — Jim, playing, 9 August
   * 2026: *"the entry is too hard to trigger… it only occasionally triggers
   * if I step into exactly the right point."* The tower's front door was the
   * worst of them, because the lobby back wall stops her 5.97 m out and the
   * band's outer edge is 6.60 m, so the whole trigger was 0.63 m of reachable
   * depth against a 0.93 m sprint stride (`PLAYER_LONGEST_STEP`): at full
   * pelt through a long frame she could step over the entire doorway.
   *
   * `bandCrossed` (`world/tapSpacing.ts`) is the one owner of the answer, and
   * `player.previousPosition` is the line — which every teleport collapses to
   * a point, so a change of space cannot sweep a segment through some other
   * door on the way. Same reasoning as `CollisionWorld.resolveMovement`
   * against wall tunnelling, asked of the same segment.
   */
  private checkDoorways(player: Player): void {
    if (this.spaceCooldown > 0) return;
    const { x, z } = player.position;
    const fromX = player.previousPosition.x;
    const fromZ = player.previousPosition.z;

    if (!this.inside) {
      if (bandCrossed(this.towerDoorBand(), fromX, fromZ, x, z)) {
        this.changeSpace(() => this.enterLobby());
      }
      return;
    }

    const room = this.currentRoom();
    if (!room) return;
    // The doorway rectangles themselves are layout data — `hotelDoorBands`,
    // the same list the tap-spacing check holds every zone clear of.
    const bands = hotelDoorBands(room);
    const walkedThrough = (kind: HotelDoorBand['kind']): boolean => {
      const band = bands.find((candidate) => candidate.kind === kind);
      return band !== undefined && bandCrossed(band, fromX, fromZ, x, z);
    };

    if (room === LOBBY && walkedThrough('exit')) {
      this.changeSpace(() => this.leaveToPark());
      return;
    }
    if (room === CORRIDOR && walkedThrough('suite-door')) {
      // **The lock lives here, not in the lift.** Jim, 7 August 2026: *"go to
      // level 50 before you have your key but not through the door to the
      // room."* Every lift button is now pressable, so a child can ride up and
      // see her own floor; what she cannot do is open her door until reception
      // has given her the key. This is the better place for it by a distance —
      // a refusal at the door happens *at the sign that says what to do next*,
      // where a greyed-out lift button was a dead end three rooms away from
      // any explanation.
      //
      // What she cannot do is *physically* cannot: `suiteLock` is a real wall
      // and this branch is only the words at it. Its band starts a metre
      // further out than the portal's because the wall itself stops her at
      // `halfX − 0.92` (0.3 half-thickness + 0.62 player radius) — a refusal
      // triggered at the portal's own depth would sit beyond her reach, and
      // the door would be a mute invisible wall. Both depths are `layout.ts`'s
      // (`suite-door` and `suite-portal`), so nothing here re-derives one.
      if (!saveFlags.hasHotelKey()) {
        this.refuseSuite(player);
        return;
      }
      if (walkedThrough('suite-portal')) {
        this.changeSpace(() => this.stepThroughDoor(SUITE, -SUITE.halfX + 1.6, 0, Math.PI / 2));
      }
      return;
    }
    if (room === SUITE && walkedThrough('corridor-door')) {
      this.changeSpace(() => this.stepThroughDoor(CORRIDOR, CORRIDOR.halfX - 1.6, 0, -Math.PI / 2));
    }
  }

  private changeSpace(midpoint: () => void): void {
    this.changingSpace = true;
    this.controls.cancelWalk();
    this.controls.iris(() => {
      midpoint();
      this.controls.snapCamera();
      this.changingSpace = false;
      this.spaceCooldown = SPACE_COOLDOWN;
    });
  }

  private enterLobby(): void {
    const player = this.player;
    if (!player) return;
    this.inside = true;
    this.hotelRoot.visible = true;
    this.boundTo(LOBBY);
    // Just inside the front door, facing the statue.
    player.teleportTo(LOBBY.originX, 0, LOBBY.originZ + LOBBY.halfZ - 2.2, Math.PI);
    if (!saveFlags.hasHotelKey()) {
      this.greet();
      // …and the receptionist calls out from the desk a few strides away, so
      // the first words and the room agree about where checking in happens
      // (issue #270 — reception moved into the entrance foyer itself).
      this.say([`${greetingFor(this.deps.clock())}! Come to the desk and check in!`], -1);
    }
  }

  /**
   * The `/hotel-bathroom` deep link's landing, mirroring {@link enterLobby}:
   * binds play bounds to the floor room and stands her at the nook's own
   * "Use" spot, facing the pan — derived from `bathroom`'s own fields
   * (`standX/standZ` to `panX/panZ`) rather than a hardcoded yaw, so it stays
   * right if the nook is ever re-tuned.
   */
  private enterFloorBathroom(room: HotelRoom, bathroom: Bathroom): void {
    const player = this.player;
    if (!player) return;
    this.inside = true;
    this.hotelRoot.visible = true;
    this.boundTo(room);
    const facing = Math.atan2(
      bathroom.panX - bathroom.standX,
      bathroom.panZ - bathroom.standZ,
    );
    player.teleportTo(room.originX + bathroom.standX, 0, room.originZ + bathroom.standZ, facing);
  }

  /**
   * The other half of {@link requestEnterBreakfast}. Lands her bound to the
   * breakfast room and, whenever a chair is free, already sat down at it —
   * `sitAt` does the pose and sets `seatedAt`, which is what makes
   * `interactZones` offer the `BREAKFASTS` chip row instead of "Have
   * breakfast", so the very row #276 fixes is up on the first frame.
   */
  private enterBreakfastRoom(): void {
    const player = this.player;
    if (!player) return;
    this.inside = true;
    this.hotelRoot.visible = true;
    this.boundTo(BREAKFAST);
    // Fixed seating order, same list `interactZones` reads — first chair
    // no guest has been dealt into. `seatGuests` can occupy some of these,
    // so this is never assumed free; if every chair is taken, land her in
    // the room anyway rather than dead-ending the link.
    const chair = this.chairs.find((seat) => seat.room === BREAKFAST && !seat.taken);
    if (chair) {
      this.sitAt(chair);
    } else {
      player.teleportTo(BREAKFAST.originX, 0, BREAKFAST.originZ, 0);
    }
  }

  /**
   * Lands just inside the suite's own corridor door, facing east down the
   * hall — the exact spot `stepThroughDoor(SUITE, ...)` puts a guest who
   * walked in from `CORRIDOR` (line ~1589), reused rather than re-picked so
   * it is already known not to land inside a wall or a prop. From there the
   * three bedroom doors (and `SUITE_BED_SPOTS`' beds behind them) line the
   * north wall ahead-left, and the lounge door — home to the sofa and TV
   * #278 moved clear of it — sits ahead-right: a look down the hall shows
   * the whole doorway layout in one frame rather than one room jammed in a
   * corner.
   */
  private enterSuite(): void {
    const player = this.player;
    if (!player) return;
    this.inside = true;
    this.hotelRoot.visible = true;
    this.stepThroughDoor(SUITE, -SUITE.halfX + 1.6, 0, Math.PI / 2);
  }

  private leaveToPark(): void {
    const player = this.player;
    if (!player) return;
    this.inside = false;
    this.hotelRoot.visible = false;
    this.collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
    const plot = placedEntry('hotel');
    const x = plot.entranceX;
    const z = plot.entranceZ;
    player.teleportTo(x, this.surfaces.sample(x, z, 3), z, this.facadeYaw);
  }

  private stepThroughDoor(room: HotelRoom, localX: number, localZ: number, facing: number): void {
    const player = this.player;
    if (!player) return;
    this.boundTo(room);
    player.teleportTo(room.originX + localX, 0, room.originZ + localZ, facing);
  }

  /** The lift's portal hop — same shape as a door, wrapped in its own iris. */
  private travelTo(room: HotelRoom): void {
    this.controls.iris(() => {
      const player = this.player;
      if (player) {
        // Behind the closed iris, like every other space change — posing
        // her before it closed gave a visible cross-space camera whip
        // (reviewer finding 2 on PR #247). The lift keeps the ride pose;
        // only the world jumps. Land in the new room's alcove.
        const x = room.originX - room.halfX - 1.2;
        const z = room.originZ + (room.liftZ ?? 0);
        player.setRidePose(x, 0, z, Math.PI / 2);
      }
      this.boundTo(room);
      this.controls.snapCamera();
      this.spaceCooldown = SPACE_COOLDOWN;
    });
  }

  private boundTo(room: HotelRoom): void {
    this.collision.setPlayBounds(circleBoundary(HOTEL_PLAY_RADIUS, room.originX, room.originZ));
  }

  // ------------------------------------------------------------- actions

  /**
   * Other children, sat at breakfast — Jim, 7 August 2026: *"some residents SIT
   * at breakfast tables."*
   *
   * ## Why these are not `NpcSystem` residents
   *
   * The hotel's strolling guests are ordinary park NPCs precisely because they
   * *move*: they need the shared body, walk cycle, collision, ground sampler
   * and push-apart, and `NpcCharacter` is all of that (see `HotelGuests.ts`).
   * A diner needs **none** of it. She sits on a known chair, at a known height,
   * facing a known way, and never goes anywhere. Driving her through the crowd
   * system would mean fighting it — a driver whose every intent is "stay
   * exactly here", a body being resolved against the very chair it is sat on,
   * and a ground sampler asked a question about a seat.
   *
   * So a diner is a posed `CharacterModel` and nothing else, the same way the
   * receptionist and the buffet's server are posed keepers. The pose itself is
   * the ferris wheel's (`minigames/ferrisWheel/gondola.ts`): legs forward,
   * arms resting. That is where seating a toy in this game is defined, and
   * copying the four numbers rather than inventing new ones is what makes a
   * child in a gondola and a child at breakfast read as the same child.
   *
   * ## The chair she is on stops being offered
   *
   * `Chair.taken` goes true and `interactZones` skips it, so the player never
   * gets a "Sit down!" chip for a chair that already has somebody in it. The
   * chairs are dealt out here, after every table exists, from a fixed list of
   * ids — so moving a table moves its diner, and deleting one is caught by the
   * lookup finding nothing rather than by a child finding two people in a seat.
   */
  private seatGuests(): void {
    /** Which chairs have somebody in them. Ids, so they follow their tables. */
    const takenChairs: readonly string[] = [
      // The lobby café: one child at the near table, so the corner reads as
      // occupied from the door rather than as furniture.
      'lobby-a-0',
      // Floor 1: three tables of the seven, spread across the room. Never all
      // of them — a breakfast room with every seat full is a breakfast room a
      // child cannot sit down in, and sitting down is the thing she came for.
      'b1-b-1',
      'b1-e-0',
      'b1-g-1',
    ];

    takenChairs.forEach((id, index) => {
      const chair = this.chairs.find((seat) => seat.id === id);
      if (!chair) return;
      chair.taken = true;

      // Its own seeded stream, salted well away from `HotelGuests`' 0x6035 so
      // adding a diner cannot reshuffle a stroller's clothes.
      const rng = new Rng(0x7d10 + index * 613);
      const outfit = rng.pick(DINER_OUTFITS);
      const model = new CharacterModel(
        {
          skin: (KID_SKIN_TONES[rng.int(0, KID_SKIN_TONES.length - 1)] ?? KID_SKIN_TONES[1])!.colour,
          hair: rng.pick(DINER_HAIRS),
          outfit,
          outfitArms: outfit,
          shoe: PALETTE.shoe,
        },
        { hairStyle: rng.pick(DINER_HAIR_STYLES) },
      );

      // Sat down: legs forward, arms resting on the table. The gondola's own
      // four numbers — see this method's header.
      model.leftLeg.rotation.x = -1.25;
      model.rightLeg.rotation.x = -1.15;
      model.leftArm.rotation.x = 0.25;
      model.rightArm.rotation.x = 0.25;
      model.root.position.set(chair.x, CHAIR_SEAT_Y, chair.z);
      model.root.rotation.y = chair.facing;
      model.setExpression('happy');
      // Parented to `hotelRoot`, not to the room's shell: the position above is
      // already in world metres (a `Chair` carries world coordinates, because
      // that is what the interact zones need), and `hotelRoot` is the only node
      // in here with an identity transform. Same rule as the guests'.
      this.hotelRoot.add(model.root);
      this.diners.push({ model, phase: rng.range(0, Math.PI * 2) });
    });
  }

  /**
   * Reception hands over the key — the one moment in the hotel a child has
   * *achieved* something, and until QA's note on 6 August the only sign of it
   * was a line of text changing on a sign she had already stopped reading.
   *
   * So three things now happen, all of them things she can see from where she
   * is standing:
   *
   *  - the receptionist beams (and so does she);
   *  - the rainbow inlaid round the statue **flashes**, right in the middle of
   *    the lobby, for {@link CHEER_SECONDS};
   *  - the star over the "yours" door, fifty floors up, comes on for good —
   *    which is the payoff she finds when she gets there.
   *
   * No new asset and no new sound: the ring and the star already existed, and
   * the star's own doc comment in `hotelAssets.ts` asks for exactly this
   * ("brighten its emissive when the suite unlocks").
   */
  private checkIn(): void {
    saveFlags.giveHotelKey();
    this.player?.model.setExpression('happy');
    for (const keeper of this.keepers) keeper.setExpression('happy');
    // …and now she is *told* so, out loud. Jim, 7 August 2026: *"good
    // afternoon/morning, here is your key, enjoy your stay etc, maybe a bit
    // longer and more embellished."* The flash and the star fire on the line
    // that hands the key over rather than on the button press, so the
    // celebration lands on the words rather than three sentences before them.
    this.say(checkInLines(this.deps.clock()), 3);
  }

  /**
   * Everything the check-in celebration lights up. Split out of
   * {@link checkIn} so the speech can trigger it on the right line.
   */
  private celebrate(): void {
    this.cheer = CHEER_SECONDS;
    this.lightYoursStar(true);
  }

  /**
   * Puts a short script in the receptionist's speech bubble.
   *
   * The bubble is `ui/SpeechBubble.ts` — the same one the park's chatting
   * children use, so this is the game's one way of having somebody say
   * something rather than a second one. Each line is held for a moment
   * proportional to its length and then replaced; when the script runs out the
   * bubble goes away.
   *
   * `cheerAt` is the index of the line the rainbow flash belongs to, or −1 for
   * a script with nothing to celebrate.
   */
  private say(lines: readonly string[], cheerAt: number): void {
    if (lines.length === 0) return;
    this.speech = { lines, index: 0, timer: lineSeconds(lines[0] ?? ''), cheerAt };
    this.receptionBubble.setText(lines[0] ?? null);
    this.receptionist?.setExpression('happy');
    if (cheerAt === 0) this.celebrate();
  }

  /** One frame of the receptionist's script. */
  private updateSpeech(dt: number): void {
    const speech = this.speech;
    if (!speech) return;
    // She only talks while somebody is in the lobby to hear her — walk out
    // mid-sentence and the bubble stops rather than following you upstairs.
    if (this.currentRoom() !== LOBBY) {
      this.speech = null;
      this.receptionBubble.setText(null);
      return;
    }
    speech.timer -= dt;
    if (speech.timer > 0) return;
    speech.index += 1;
    const line = speech.lines[speech.index];
    if (line === undefined) {
      this.speech = null;
      this.receptionBubble.setText(null);
      return;
    }
    this.receptionBubble.setText(line);
    speech.timer = lineSeconds(line);
    if (speech.index === speech.cheerAt) this.celebrate();
  }

  /** The star over the suite door: dim while the room is nobody's, lit once it is hers. */
  private lightYoursStar(lit: boolean): void {
    const material = this.yoursStar?.material;
    if (material instanceof MeshToonMaterial) material.emissiveIntensity = lit ? 1.15 : 0.3;
  }

  private greet(): void {
    for (const keeper of this.keepers) keeper.setExpression('happy');
  }

  private wave(): void {
    this.player?.model.setExpression('happy');
    // A returning guest gets a shorter hello — the long one is the check-in,
    // and a hotel that reads you the whole welcome every time you walk past
    // the desk is a hotel you stop walking past.
    this.say(returningLines(this.deps.clock()), -1);
  }

  /**
   * **Your door, before it is yours.**
   *
   * No fail state, nothing taken away, no noise: she is eased back a step, the
   * star over the door blinks at her, and the sign on the door says where to
   * go. Jim asked for *"a gentle refusal"* and the star was his own suggestion
   * — it is already the thing that lights up for good the moment reception
   * hands the key over (see {@link checkIn}), so blinking it here makes the
   * two halves of the same story point at each other.
   *
   * Eased back rather than blocked with a collider because there is no collider
   * available to add: `CollisionWorld` is built once, at construction, and a
   * doorway that is solid until a flag flips is not a thing it can express. A
   * nudge is also simply better — a child who walks into her own door and is
   * stopped dead has met a bug; one who is turned round has met a locked door.
   */
  private refuseSuite(player: Player): void {
    if (this.refusing > 0) return;
    this.controls.cancelWalk();
    player.teleportTo(
      CORRIDOR.originX + CORRIDOR.halfX - 2.4,
      0,
      CORRIDOR.originZ,
      Math.PI / 2,
    );
    player.model.setExpression('sad');
    this.refusing = REFUSE_SECONDS;
    // Deliberately NOT `spaceCooldown` here: that gate silences the whole of
    // `checkDoorways`, and granting it on refusal was precisely the hole that
    // let a second push through the doorway unchecked. The wall is the lock;
    // `refusing` alone stops the words repeating every frame.
  }

  /**
   * The "Go in!" chip on her own door — the same portal hop the doorway
   * trigger makes, offered as a button so the sign is selectable at all
   * (see the zone in {@link interactZones}).
   */
  private enterSuiteThroughDoor(): void {
    const player = this.player;
    if (!player || player.riding || this.changingSpace) return;
    this.changeSpace(() => this.stepThroughDoor(SUITE, -SUITE.halfX + 1.6, 0, Math.PI / 2));
  }

  /**
   * The keyless "Where is my key?" chip: the star over the door blinks — the
   * same star the check-in lights for good — and the sign underneath is
   * already saying "get your key at reception!". No teleport, no refusal
   * noise: she asked a question and the door winked at her.
   */
  private blinkYoursStar(): void {
    if (this.refusing > 0) return;
    this.refusing = REFUSE_SECONDS;
  }

  private sitAt(chair: Chair): void {
    const player = this.player;
    if (!player || player.riding) return;
    player.beginRide();
    player.setRidePose(chair.x, CHAIR_SEAT_Y, chair.z, chair.facing);
    this.seatedAt = chair.id;
  }

  private standUp(): void {
    const player = this.player;
    if (!player) return;
    this.seatedAt = null;
    player.endRide();
    // Breakfast is over: the bowls and the pet go with it. Hidden rather than
    // disposed — she may sit straight back down, and rebuilding a pet to eat a
    // second bowl of cereal is three models for one child changing her mind.
    if (this.feast) {
      this.feast.bowl.visible = false;
      this.feast.pet.root.visible = false;
      this.feast.petBowl.visible = false;
    }
  }

  /**
   * **Breakfast, as a moment rather than a menu item.**
   *
   * Jim, 7 August 2026: a bowl appears in front of her, the camera eases in on
   * her eating happily for a couple of seconds, and her own pet trots over,
   * sits down and eats out of its bowl beside her.
   *
   * Choosing a cereal used to set a happy face and nothing else — which is to
   * say the one thing a child came to the breakfast room to *do* had no
   * result. This is the result.
   *
   * Everything here is built on first use and then kept: the pet, its bowl and
   * her bowl are three objects for the life of the hotel, not three per
   * mouthful. The shot itself is `hotel/cinematic.ts`, the same mechanism the
   * pictures and the windows use.
   */
  private eat(kind: BreakfastKind): void {
    const player = this.player;
    const chair = this.chairs.find((seat) => seat.id === this.seatedAt);
    if (!player || !chair) {
      this.player?.model.setExpression('happy');
      return;
    }
    player.model.setExpression('happy');

    // Her bowl, on the table in front of her — 0.42 m toward the table's
    // middle, which is the chair's own facing. Rebuilt per cereal because
    // which one she chose is the whole point of choosing.
    this.feast?.bowl.removeFromParent();
    const bowl = new Group();
    bowl.add(createBreakfastBowl(kind).root);
    bowl.position.set(
      chair.x + Math.sin(chair.facing) * 0.42,
      TABLE_TOP,
      chair.z + Math.cos(chair.facing) * 0.42,
    );
    this.hotelRoot.add(bowl);

    // The pet, and its own bowl, beside her chair and a little to one side so
    // it is not between her and the table.
    const side = chair.facing + Math.PI / 2;
    const petX = chair.x + Math.sin(side) * 1.15;
    const petZ = chair.z + Math.cos(side) * 1.15;
    const pet = this.feast?.pet ?? createPet(this.paradePetKind());
    const petBowl = this.feast?.petBowl ?? new Group();
    if (!this.feast) {
      petBowl.add(createPetBowl().root);
      this.hotelRoot.add(pet.root, petBowl);
    }
    petBowl.position.set(
      petX + Math.sin(chair.facing) * 0.5,
      0,
      petZ + Math.cos(chair.facing) * 0.5,
    );

    this.feast = {
      pet,
      petBowl,
      bowl,
      // It trots in from a little way behind her, so it is seen to arrive.
      fromX: petX - Math.sin(chair.facing) * 3.4,
      fromZ: petZ - Math.cos(chair.facing) * 3.4,
      toX: petX,
      toZ: petZ,
      facing: chair.facing,
      t: 0,
    };
    pet.root.visible = true;
    petBowl.visible = true;

    this.moment = 'food';
    this.cine.play(this.foodShotFor(chair), () => {
      this.moment = null;
    });
  }

  /**
   * The breakfast push-in for one chair — a shot over her shoulder to a spot
   * above the table, looking back at her over her cereal. A long-ish lens
   * (30°) so the room behind her compresses and she is unmistakably the
   * subject.
   *
   * A method rather than inline in {@link eat} because `check:hotel` measures
   * every one of these (via {@link cinematicShots}) against
   * `MIN_SHOT_DISTANCE` and the room's own walls.
   */
  private foodShotFor(chair: Chair): Shot {
    // **Everything in the chair's own frame.** The first version offset the
    // end pose `+0.9` on world X *and* world Z, which is a different shot for
    // every facing — for chairs facing south-west it landed ~1.06 m from the
    // diner, inside her head (Jim, live play, 7 Aug 2026). Forward and side
    // are the chair's, so every table in the hotel gets the same framing.
    const forwardX = Math.sin(chair.facing);
    const forwardZ = Math.cos(chair.facing);
    const sideX = Math.sin(chair.facing + Math.PI / 2);
    const sideZ = Math.cos(chair.facing + Math.PI / 2);
    // Framed on her chest, not over her head: she sits at CHAIR_SEAT_Y and a
    // seated child's chest is about 0.55 m above the seat.
    const chestY = CHAIR_SEAT_Y + 0.55;
    // **From her free side, not across the table.** "Across the table" was
    // the second draft, and watching it run found the flaw: the opposite
    // chair often holds a seated diner (`seatGuests`), and 1.9 m ahead is
    // exactly that seat — the shot ended inside the *neighbour's* face. The
    // pet trots in on `facing + PI/2`, so the camera stands on the other
    // side (`-side`), a touch ahead of her: her face three-quarters on, the
    // bowl in front of her, and the pet arriving in the background.
    // 2.7 m out through a 40° lens frames ~1.9 m at her — the whole seated
    // child, her bowl and the pet, not a face-filling close-up: these kids
    // are chibi-proportioned (the head is half the body), so a tight
    // portrait lens on a chair is all head (watched in the browser, twice).
    return {
      from: 'here',
      to: new Vector3(
        chair.x + forwardX * 0.9 - sideX * 2.4,
        1.7,
        chair.z + forwardZ * 0.9 - sideZ * 2.4,
      ),
      lookAt: new Vector3(chair.x, chestY, chair.z),
      easeSeconds: FOOD_EASE_SECONDS,
      holdSeconds: FOOD_HOLD_SECONDS,
      fov: 40,
    };
  }

  /**
   * The "Look!" shot for one painting — see {@link lookAtArt}, and
   * {@link cinematicShots} for why it is a method.
   */
  private artShotFor(art: (typeof this.artworks)[number]): Shot {
    return {
      from: 'here',
      to: new Vector3(
        art.x + art.normalX * ART_VIEW_DISTANCE,
        art.y,
        art.z + art.normalZ * ART_VIEW_DISTANCE,
      ),
      lookAt: new Vector3(art.x, art.y, art.z),
      easeSeconds: 1.1,
      holdSeconds: null,
      fov: ART_VIEW_FOV,
    };
  }

  /**
   * Every close-up shot the hotel can produce, one per chair and one per
   * painting, exactly as the game would play them.
   *
   * **Public because `check:hotel` asserts on it** — the alternative is the
   * check recomputing the end-pose formula from the same inputs, which is a
   * check that agrees with a copy of the code rather than with the code. The
   * bug this guards against was real: the old end pose was offset in *world*
   * axes rather than the chair's own, so chairs facing south-west put the
   * lens inside the diner's head (Jim, live play, 7 Aug 2026).
   */
  get cinematicShots(): readonly { readonly id: string; readonly room: HotelRoom; readonly shot: Shot }[] {
    return [
      ...this.chairs.map((chair) => ({
        id: `food-${chair.id}`,
        room: chair.room,
        shot: this.foodShotFor(chair),
      })),
      ...this.artworks.map((art) => ({
        id: `art-${art.id}`,
        room: art.room,
        shot: this.artShotFor(art),
      })),
    ];
  }

  /**
   * The pet trotting over, sitting, and eating — one frame of it.
   *
   * Driven off the shot's own clock rather than a timer of its own, so the
   * arrival lands inside the push-in rather than before or after it whatever
   * the ease is retuned to. It uses the pets' own `setWalkPhase`, which is the
   * same walk every pet in the park has.
   */
  private updateFeast(dt: number, elapsed: number): void {
    const feast = this.feast;
    if (!feast) return;
    feast.t += dt;

    const walk = Math.min(1, feast.t / FOOD_TROT_SECONDS);
    const eased = walk * walk * (3 - 2 * walk);
    feast.pet.root.position.set(
      feast.fromX + (feast.toX - feast.fromX) * eased,
      0,
      feast.fromZ + (feast.toZ - feast.fromZ) * eased,
    );
    feast.pet.root.rotation.y = feast.facing;

    if (walk < 1) {
      // Trotting: a brisk stride, and a body that bobs with it.
      feast.pet.setWalkPhase(elapsed * 9, 1);
      return;
    }
    // Arrived: sat down, head dipping into the bowl. No stride — the bob alone
    // is the pets' own idle, and dipping is one rotation on the head.
    feast.pet.setWalkPhase(elapsed * 2.2, 0);
    feast.pet.head.rotation.x = 0.5 + Math.sin(elapsed * 4.5) * 0.28;
  }

  /**
   * Sleep — visibly, in the bed (Jim, 8 August 2026: *"they should lie in a
   * bed visibly with a blanket on them"*).
   *
   * **One recline, not two.** The first version set the shared `'reclined'`
   * posture *and* pitched the whole player group −π/2 — the model root's own
   * −1.35 recline stacked on top made ≈ −167°, folding her backwards through
   * the mattress: `check:hotel` probe 16 measured her head 0.64 m below the
   * floor. `applyRidePose`'s `'reclined'` is the game's one owner of "lying
   * on your back" (the slide's pose), so the group stays upright and only the
   * posture lies her down.
   *
   * The reclined pose swings her back from her feet (the root origin), her
   * head landing 1.33 m behind them and 0.30 m up — measured on the real rig,
   * see `applyReclinedRidePose`. Feet at +0.61 on a 2 m bed therefore put her
   * head at −0.72: on the pillow, which the bed asset authors at the −Z end,
   * with the tucked blanket (built with the bed, hidden until now) over her
   * body and her face in the open air. Probe 16 measures all three.
   */
  private nap(bed: Bed): void {
    const player = this.player;
    if (!player || player.riding) return;
    player.beginRide();
    player.ridePosture = 'reclined';
    player.setRidePose(bed.x, BED_MATTRESS_TOP + 0.16, bed.z + 0.61, 0);
    bed.blanket.visible = true;
    this.napping = NAP_SECONDS;
    this.nappingAt = bed;
    player.model.setExpression('blink');
  }

  // ------------------------------------------------------------- queries

  private currentRoom(): HotelRoom | null {
    const player = this.player;
    if (!player) return null;
    const space = spaceAt(player.position.x, player.position.z);
    if (space === SPACE_GARDEN) return null;
    return roomFor(space);
  }

  private atLiftDoors(player: Player): boolean {
    const room = this.currentRoom();
    if (!room) return false;
    const lift = hotelDoorBands(room).find((band) => band.kind === 'lift');
    return lift !== undefined && bandContains(lift, player.position.x, player.position.z);
  }

  // ------------------------------------------------------------- builders

  private buildRoomShell(room: HotelRoom): void {
    const shell = new Group();
    shell.name = `hotel:${room.space}`;
    shell.position.set(room.originX, 0, room.originZ);
    this.hotelRoot.add(shell);

    // The floor plate, in this floor's own colour, with a soft emissive lift
    // so an open-topped room at night is cosy rather than cave-dark.
    //
    // **Its west apron stops short of the lift alcove.** The plate used to
    // run 0.6 m past every wall, and under the alcove that put its top face
    // at exactly the lift car's own floor height — y = 0 against y = 0,
    // measured by probe 17 as a genuine z-fight. The pullback tucks the edge
    // under the west wall's band, so nothing shows and nothing fights; the
    // invisible walk `Plate` below still covers the alcove.
    const westEdge = room.liftZ !== null ? -room.halfX + 0.2 : -room.halfX - 0.6;
    const eastEdge = room.halfX + 0.6;
    const floor = solid(
      new Mesh(
        new BoxGeometry(eastEdge - westEdge, 0.5, room.halfZ * 2 + 1.2),
        interiorMaterial(room.theme.floor),
      ),
    );
    floor.position.set((westEdge + eastEdge) / 2, -0.25, 0);
    shell.add(floor);
    this.surfaces.addPlatform(
      new Plate(
        0,
        room.originX - room.halfX - 0.6,
        room.originX + room.halfX + 0.6,
        room.originZ - room.halfZ - 0.6,
        room.originZ + room.halfZ + 0.6,
      ),
    );

    // Walls per side, minus the door and lift gaps, both visual and solid.
    const sides = [
      { side: 'north' as const, x1: -room.halfX, z1: -room.halfZ, x2: room.halfX, z2: -room.halfZ },
      { side: 'south' as const, x1: -room.halfX, z1: room.halfZ, x2: room.halfX, z2: room.halfZ },
      { side: 'west' as const, x1: -room.halfX, z1: -room.halfZ, x2: -room.halfX, z2: room.halfZ },
      { side: 'east' as const, x1: room.halfX, z1: -room.halfZ, x2: room.halfX, z2: room.halfZ },
    ];
    const wallMaterial = interiorMaterial(room.theme.wall);
    for (const { side, x1, z1, x2, z2 } of sides) {
      // The two walls the camera looks *through* may be shorter than the two it
      // looks *at* — see `HotelRoom.nearWallHeight`. Everywhere but the lobby
      // they are the same number and this reads as it always did.
      const height =
        side === 'south' || side === 'east' ? room.nearWallHeight ?? room.wallHeight : room.wallHeight;
      const gap = room.gaps[side];
      const along = side === 'north' || side === 'south' ? 'x' : 'z';
      const from = along === 'x' ? x1 : z1;
      const to = along === 'x' ? x2 : z2;
      // The shared span arithmetic — `world/wallRuns.ts`, the same owner the
      // castle's storeys use.
      const spans = segmentsMinusGaps(from, to, gap ? [gap] : []);
      // Every pane this side declares, clipped to the wall's own solid spans
      // below — so a window can never end up floating across a doorway, and
      // `layout.ts` never has to repeat where the doorways are. Panes clip to
      // the *logical* spans, never the corner-closed ones — a pane slid past
      // the room's half-extent would glaze the inside of a corner pillar.
      this.glazeWall(shell, room, side, spans);

      // North and south take the corners; east and west butt between them —
      // `wallRuns.ts`'s rule. Before this, all four walls stopped at the
      // room's half-extent (the perpendicular wall's centre line), leaving an
      // empty see-through column half a wall square at every outer corner:
      // Jim's "the walls don't abut each other properly". Only the drawn box
      // is extended; the collider keeps the logical span, which changes
      // nothing a child can reach.
      const drawn =
        along === 'x' ? cornerClosedSpans(spans, from, to, WALL_HALF_DEPTH) : spans;

      for (const [index, [a, b]] of spans.entries()) {
        if (b - a < 0.05) continue;
        const [drawnA, drawnB] = drawn[index] ?? [a, b];
        const length = drawnB - drawnA;
        const mid = (drawnA + drawnB) / 2;
        const wall = solid(
          new Mesh(
            along === 'x'
              ? new BoxGeometry(length, height, WALL_HALF_DEPTH * 2)
              : new BoxGeometry(WALL_HALF_DEPTH * 2, height, length),
            wallMaterial,
          ),
        );
        wall.name = 'hotel.wall';
        wall.position.set(along === 'x' ? mid : x1, height / 2, along === 'x' ? z1 : mid);
        shell.add(wall);
        const wx1 = room.originX + (along === 'x' ? a : x1);
        const wz1 = room.originZ + (along === 'x' ? z1 : a);
        const wx2 = room.originX + (along === 'x' ? b : x1);
        const wz2 = room.originZ + (along === 'x' ? z1 : b);
        this.collision.addWall(wx1, wz1, wx2, wz2, 0.3);
      }
    }

    // The lift alcove: three walls poking out of the west gap, so the "car"
    // is a little crystal room of its own.
    if (room.liftZ !== null) {
      const ax = -room.halfX;
      const depth = LIFT_ALCOVE_DEPTH;
      // The back wall runs 0.2 m (its own half-thickness) past each side wall,
      // closing the alcove's outer corners the same way `cornerClosedSpans`
      // closes the room's — one wall owns each corner, no notch, no doubled
      // box.
      for (const [x1, z1, x2, z2] of [
        [ax - depth, room.liftZ - 1.7, ax, room.liftZ - 1.7],
        [ax - depth, room.liftZ + 1.7, ax, room.liftZ + 1.7],
        [ax - depth, room.liftZ - 1.9, ax - depth, room.liftZ + 1.9],
      ] as const) {
        this.collision.addWall(
          room.originX + x1,
          room.originZ + z1,
          room.originX + x2,
          room.originZ + z2,
          0.25,
        );
        const wall = solid(
          new Mesh(
            x1 === x2
              ? new BoxGeometry(0.4, room.wallHeight, Math.abs(z2 - z1))
              : new BoxGeometry(Math.abs(x2 - x1), room.wallHeight, 0.4),
            interiorMaterial(room.theme.trim),
          ),
        );
        wall.name = 'hotel.wall';
        wall.position.set((x1 + x2) / 2, room.wallHeight / 2, (z1 + z2) / 2);
        shell.add(wall);
      }
      this.surfaces.addPlatform(
        new Plate(
          0,
          room.originX - room.halfX - depth,
          room.originX - room.halfX,
          room.originZ + room.liftZ - 1.7,
          room.originZ + room.liftZ + 1.7,
        ),
      );
      this.fitLiftAlcove(shell, room, room.liftZ);
    }

    if (room.mezzanine) this.buildMezzanine(shell, room, room.mezzanine);
    if (room.partitions) this.partitionRoom(shell, room, room.partitions);
  }

  /**
   * Internal walls, turning one room into several — the suite's three bedrooms
   * and its lounge (Jim, 7 August 2026).
   *
   * Exactly the same span arithmetic `buildRoomShell` already does for the
   * outer walls' doorways, which is why it looks familiar: a run, minus the
   * doorways, is a list of solid spans, and each span is one box and one
   * collider. Doing it the same way is the point — a partition is a wall, and
   * a second way of building walls is a second place for a doorway to end up
   * in the wrong place.
   *
   * These are **not** open at the top and they *are* solid, but they are
   * shorter than the room (see `SUITE_PARTITION_HEIGHT`), because every one of
   * them stands between the camera and something.
   */
  private partitionRoom(
    shell: Group,
    room: HotelRoom,
    partitions: readonly SuitePartition[],
  ): void {
    const height = SUITE_PARTITION_HEIGHT;
    const half = SUITE_DOOR_WIDTH / 2;

    for (const wall of partitions) {
      // Doorways become the gaps between the solid spans — the same shared
      // arithmetic (`world/wallRuns.ts`) the outer walls and the castle use.
      // No corner-closing here: a partition's ends stop on a perpendicular
      // wall's centre line and its box already reaches half a thickness into
      // that wall's own band, so the joint is solid masonry as built.
      const spans = segmentsMinusGaps(
        wall.from,
        wall.to,
        wall.doors.map((door) => [door - half, door + half] as const),
      );

      for (const [a, b] of spans) {
        if (b - a < 0.05) continue;
        const mid = (a + b) / 2;
        const alongX = wall.along === 'x';
        const panel = solid(
          new Mesh(
            alongX
              ? new BoxGeometry(b - a, height, SUITE_PARTITION_HALF * 2)
              : new BoxGeometry(SUITE_PARTITION_HALF * 2, height, b - a),
            interiorMaterial(room.theme.wall),
          ),
        );
        panel.name = 'hotel.wall';
        panel.position.set(alongX ? mid : wall.at, height / 2, alongX ? wall.at : mid);
        shell.add(panel);
        this.collision.addWall(
          room.originX + (alongX ? a : wall.at),
          room.originZ + (alongX ? wall.at : a),
          room.originX + (alongX ? b : wall.at),
          room.originZ + (alongX ? wall.at : b),
          0.25,
        );
        // Guests never come in here (the suite is yours — `HotelGuests`' roster
        // says so), but the keep-out is registered anyway: it costs one entry
        // and it means a future roster change cannot put somebody in a wall.
        this.props.footprint(room, {
          x: alongX ? mid : wall.at,
          z: alongX ? wall.at : mid,
          halfX: alongX ? (b - a) / 2 : SUITE_PARTITION_HALF,
          halfZ: alongX ? SUITE_PARTITION_HALF : (b - a) / 2,
          top: height,
          solid: false,
        });
      }
    }
  }

  /**
   * Everything that makes a hole in the west wall look like a lift: the
   * architrave, the car behind it, two sliding leaves, and the pointer dial
   * over the top.
   *
   * Jim, 7 August 2026: *"no doors, no floor and also no lift to speak of"* —
   * the alcove was three collision walls and a teleport. All four pieces are
   * the artist's (`art/models/hotelAssets.ts`), and every one of them is
   * measured to the hole this file already cuts: the frame is 3.28 m against
   * `gaps.west`'s 3.2 m so it overlaps the wall by 4 cm a side, and the car's
   * floor has its top at exactly y = 0 so it lies flush *under* the walk
   * surface the alcove already registers rather than standing on it as a step.
   *
   * **The doors face +Z as authored and are yawed a quarter turn to face +X**,
   * out of the alcove into the room. That also turns their sliding axis — the
   * leaves move along local X, which after the yaw runs along world Z, which is
   * the way the doorway runs. Nothing here has to know that; it falls out of
   * `setOpen` being written in the asset's own frame.
   */
  private fitLiftAlcove(shell: Group, room: HotelRoom, liftZ: number): void {
    const wallX = -room.halfX;

    // The car, at the back of the alcove, open side facing the room.
    const car = createLiftCar();
    car.root.position.set(wallX - 1.72, 0, liftZ);
    car.root.rotation.y = Math.PI / 2;
    shell.add(car.root);

    // The architrave, plugging the wall gap.
    const frame = createLiftFrame();
    frame.root.position.set(wallX, 0, liftZ);
    frame.root.rotation.y = Math.PI / 2;
    shell.add(frame.root);

    const doors = createLiftDoors();
    doors.root.position.set(wallX, 0, liftZ);
    doors.root.rotation.y = Math.PI / 2;
    doors.setOpen(0);
    shell.add(doors.root);

    // The dial, over the doors and standing proud of the architrave, which is
    // where a lift dial goes and the only place there is room for one: the
    // frame is 2.96 m tall and three of these rooms have 3.0 m walls, so the
    // strip *above* the frame does not exist except in the lobby.
    const dial = createLiftDial();
    dial.root.position.set(wallX + 0.3, DIAL_PIVOT_Y, liftZ);
    dial.root.rotation.y = Math.PI / 2;
    paintDialFace(dial.face);
    dial.setSweep(0);
    shell.add(dial.root);

    this.alcoves.push({ room, doors, dial });
  }

  /**
   * The doors that open because you walked up to them — Jim: the hotel
   * entrance *"slides open as you approach"*.
   *
   * Two pairs, and they are the same pair twice: the tower's own front door out
   * in the park, and the lobby's south doorway on the other side of the portal.
   * A child who has just watched a door slide open for her and then walks
   * through a permanent hole in a wall has been told the doors were a trick.
   *
   * **The portal is untouched.** `checkDoorways` still fires on exactly the
   * same patch of ground it always did; these leaves are decoration in front of
   * a trigger that already worked, opening a good two metres before it. That
   * ordering is the whole design — the doors have to be visibly open by the
   * time she reaches the threshold, or she walks through shut ones.
   */
  private fitAutoDoors(tower: { root: Group; doorGlow: Mesh }): void {
    // **Measured off the asset, not written down here.** The doorway's own
    // recess panel knows where the doorway is; `hotel_build.py` bakes every
    // placement into vertices and leaves the nodes at identity, so the panel's
    // geometry bounds *are* its position in the tower's frame. Retune the gem
    // profile and the doors follow the hole rather than floating off it.
    tower.doorGlow.geometry.computeBoundingBox();
    const box = tower.doorGlow.geometry.boundingBox;
    if (box) {
      const outside = createEntranceDoors();
      outside.root.position.set((box.min.x + box.max.x) / 2, box.min.y, box.max.z + 0.07);
      outside.setOpen(0);
      // Parented to the tower, so it takes the facade's yaw for free.
      tower.root.add(outside.root);
      this.outerDoors = outside;
    }

    // …and the same pair on the lobby's side of the portal, in the south wall.
    const inside = createEntranceDoors();
    inside.root.position.set(LOBBY.originX, 0, LOBBY.originZ + LOBBY.halfZ);
    inside.setOpen(0);
    this.roomShell(LOBBY).add(inside.root);
    this.innerDoors = inside;
  }

  /**
   * One frame of every door and dial in the hotel.
   *
   * The lift's doors are driven from `HotelLift.doorOpenness()` rather than
   * from its phase: the lift owns *when*, the alcove owns what that looks like,
   * and a copy of that switch statement over here would go stale the next time
   * a phase is added. Same reason `activeRoom()` exists — while the car is
   * "travelling" the doors that matter are the ones in the room she is about to
   * be standing in, and only the lift knows which that is.
   */
  private updateDoors(dt: number): void {
    const active = this.lift.activeRoom();
    const openness = this.lift.doorOpenness();
    for (const alcove of this.alcoves) {
      alcove.doors.setOpen(alcove.room === active ? openness : 0);
      // Every dial in the hotel reads the same storey, because every alcove is
      // the same lift. The needle sweeps rather than snaps — `indicatedStorey`
      // is already eased for the indicator's own count.
      alcove.dial.setSweep(this.lift.indicatedStorey() / TOP_STOREY);
    }

    const player = this.player;
    if (!player) return;

    // The tower's front doors, in the facade's own frame — the same `forward`
    // and `side` `checkDoorways` computes, so the doors and the portal can
    // never end up measuring from different places.
    if (this.outerDoors && !this.inside) {
      const dx = player.position.x - this.facadeX;
      const dz = player.position.z - this.facadeZ;
      const forward = dx * Math.sin(this.facadeYaw) + dz * Math.cos(this.facadeYaw);
      const side = dx * Math.cos(this.facadeYaw) - dz * Math.sin(this.facadeYaw);
      const near =
        Math.abs(side) < AUTO_DOOR_SIDE && forward > 3.6 && forward < AUTO_DOOR_REACH + 6.6;
      this.outerOpen = ease(this.outerOpen, near ? 1 : 0, dt);
      this.outerDoors.setOpen(this.outerOpen);
    }

    if (this.innerDoors) {
      const localX = player.position.x - LOBBY.originX;
      const localZ = player.position.z - LOBBY.originZ;
      const near =
        this.inside &&
        this.currentRoom() === LOBBY &&
        Math.abs(localX) < AUTO_DOOR_SIDE &&
        localZ > LOBBY.halfZ - AUTO_DOOR_REACH;
      this.innerOpen = ease(this.innerOpen, near ? 1 : 0, dt);
      this.innerDoors.setOpen(this.innerOpen);
    }
  }

  /**
   * The imperial composition — Jim's reference photograph, realised: two
   * mirrored curved flights sweep up to a landing at 3.84 m, a single wide
   * straight flight carries on to the gallery at 5.44 m, and the 5.85 m arch
   * **under** the landing is open — the room's axis runs from the entrance,
   * under the arch, through the colonnade beneath the gallery to the north
   * wall. Read {@link Mezzanine}'s header for why the overhang is legal now
   * (`Collision.ts`'s banded `baseHeight`), and HANDOFF-lobby-art.md for
   * where every number comes from.
   *
   * The pieces, and who holds whom up:
   *
   * - **The curves** are the artist's `createGrandStaircase`, one hand each,
   *   origins at their arcs' centres, no rotation at all. Treads are
   *   `WalkSurfaces` only (a solid tread is a wall to the child on the step
   *   below); the closed strings are honest height-agnostic collider chains,
   *   solid floor-to-tread.
   * - **The landing** is a true overhang: a slab whose walk surface is a
   *   plate, whose balustrades are **banded** colliders (base
   *   `height − RAIL_BASE_DROP`) that hold a child on the landing and do not
   *   exist for the child walking under the arch below her.
   * - **The straight flight** stands on the landing, which is carried the
   *   whole `LANDING_BACK` under it — the one thing the artist's handoff says
   *   can be got wrong and not seen. Its flanks are banded too: below them is
   *   the open recess, not floor-to-flank masonry.
   * - **The gallery** is a colonnade: a full-width deck on columns, open
   *   underneath all the way to the north wall so the arch genuinely sees
   *   through. Its front edge carries a banded balustrade collider with a gap
   *   where the flight lands.
   *
   * Every number is proven against the asset's own exports first
   * ({@link assertStairMatches}) — six numbers kept in step by comments was
   * this repo's most reliable bug, and the artist asked for the mechanism by
   * name.
   */
  private buildMezzanine(shell: Group, room: HotelRoom, plan: Mezzanine): void {
    assertStairMatches(room, plan);

    const { minX, maxX, minZ, maxZ, height, landing, straight } = plan;

    // --- the gallery deck ----------------------------------------------------
    // One slab, full width: its top is the deck plane's single owner (probe
    // 10) and its underside is the colonnade's soffit. The walk surface is
    // the plate; the box is its portrait.
    const deckSlab = solid(
      new Mesh(
        new BoxGeometry(maxX - minX, 0.4, maxZ - minZ),
        interiorMaterial(room.theme.floor),
      ),
    );
    deckSlab.position.set((minX + maxX) / 2, height - 0.2, (minZ + maxZ) / 2);
    // **The mass that can hide a child.** One group for both slabs and every
    // rail and stick of furniture that stands on them, so the whole overhang
    // ghosts as one thing when the camera would otherwise be looking at the
    // top of it with her underneath.
    const overhang = new Group();
    overhang.name = 'hotel:lobby/overhang';
    shell.add(overhang);
    this.lobbyOverhang = overhang;
    overhang.add(deckSlab);
    this.surfaces.addPlatform(
      new Plate(
        height,
        room.originX + minX,
        room.originX + maxX,
        room.originZ + minZ,
        room.originZ + maxZ,
      ),
    );

    // The columns that hold it up — real, solid, and honest about their tops
    // (the soffit): a ground walker goes round one, a deck walker crosses
    // over it. Symmetric pairs, clear of the straight flight's mouth and of
    // the connector's own exit stride (which `NavGrid` routes through).
    for (const columnX of [-8.6, -4.4, 4.4, 8.6]) {
      this.props.place(shell, room, crystalColumn(height - 0.4, room.theme.trim), {
        x: columnX,
        z: (minZ + maxZ) / 2 + 1.6,
        radius: 0.62,
        top: height - 0.4,
        stand: false,
      });
    }

    // --- the landing ---------------------------------------------------------
    // The slab is drawn at its declared thickness — the number that turns
    // `LANDING_HEIGHT` into headroom, held inside the asset's range by
    // `assertStairMatches` — and the walk plate covers the whole rectangle,
    // which also carries the straight flight standing on it (the artist's
    // "the platform has to be under all of it").
    const landingSlab = solid(
      new Mesh(
        new BoxGeometry(landing.maxX - landing.minX, landing.slab, landing.maxZ - landing.minZ),
        interiorMaterial(room.theme.floor),
      ),
    );
    landingSlab.position.set(
      (landing.minX + landing.maxX) / 2,
      landing.height - landing.slab / 2,
      (landing.minZ + landing.maxZ) / 2,
    );
    overhang.add(landingSlab);
    this.surfaces.addPlatform(
      new Plate(
        landing.height,
        room.originX + landing.minX,
        room.originX + landing.maxX,
        room.originZ + landing.minZ,
        room.originZ + landing.maxZ,
      ),
    );

    // --- the two curved flights ---------------------------------------------
    for (const stair of plan.stairs) {
      const handedness = stair.toAngle > stair.fromAngle ? 'right' : 'left';
      const flight = createGrandStaircase(handedness);
      // Sunk {@link STAIR_SINK} so the top tread's surface rides just below
      // the landing plane the slab owns (probe 10's one-owner rule). The walk
      // surfaces keep the true heights, so her feet still land level.
      flight.root.position.set(stair.centreX, STAIR_SINK, stair.centreZ);
      flight.root.rotation.y = -stair.fromAngle;
      shell.add(flight.root);

      const sweep = flight.sweep;
      const midRadius = (flight.innerRadius + flight.outerRadius) / 2;
      const treadDepth = flight.outerRadius - flight.innerRadius;
      const climbSign = Math.sign(sweep);
      for (let i = 0; i < flight.treads; i += 1) {
        // **Ask the handle for the tread's angular span — never subdivide the
        // sweep by hand.** A left-hand flight climbs through *decreasing*
        // angles; hand-built ranges come out descending, `ArcTread.covers`'s
        // `angle >= from && angle < to` is then false everywhere, and the
        // child walks straight through a staircase that renders perfectly.
        // The artist's handoff calls this the loaded gun, and `treadArc` is
        // its safety: always ascending, whichever hand.
        const arc = flight.treadArc(i);
        const from = stair.fromAngle + arc.from;
        const to = stair.fromAngle + arc.to;
        const top = flight.treadTop(i);
        const angle = stair.fromAngle + (sweep * (i + 0.5)) / flight.treads;

        // Four walk-surface slices per visual tread, ramping up to its top —
        // NOT one flat wedge at the tread's own height. A flat 0.32 riser is
        // walkable in theory (half of `BUILDING_STEP_UP`) but not at speed:
        // `Player` *damps* onto the ground (time constant 0.04 s), her
        // sampled `y` lags the surface, and two treads into the lag the
        // step-up ceiling is gone — `sample` stops offering the next tread
        // and she walks under the flight at y = 0. Probe 14 measures exactly
        // this, at sprint, on all three flights. Within the tread the ramp
        // ascends **in the climb direction**, which for a left-hand flight is
        // from `to` down to `from`.
        const slices = 4;
        for (let slice = 0; slice < slices; slice += 1) {
          const stepsBelowTop = climbSign > 0 ? slices - 1 - slice : slice;
          this.surfaces.addPlatform(
            new ArcTread(
              top - (flight.riser * stepsBelowTop) / slices,
              room.originX + stair.centreX,
              room.originZ + stair.centreZ,
              flight.innerRadius,
              flight.outerRadius,
              from + ((to - from) * slice) / slices,
              from + ((to - from) * (slice + 1)) / slices,
            ),
          );
        }

        // …and a keep-out over the tread, so no guest is handed a waypoint on
        // the staircase — a waypoint between the flank colliders is one a
        // body can never reach, and it leans there for ever. `check:hotel`
        // caught exactly this on the first run after the original stair.
        this.props.footprint(room, {
          x: stair.centreX - Math.sin(angle) * midRadius,
          z: stair.centreZ + Math.cos(angle) * midRadius,
          radius: treadDepth * 0.62,
          top,
          solid: false,
        });
      }

      // The flanks: chains of short walls along each radius. The asset's
      // closed strings are solid from the floor to the tread at every point
      // (its own doc says so, and why), so height-agnostic is honest here —
      // and it is the only collision a curved flight has.
      for (const radius of [flight.innerRadius, flight.outerRadius]) {
        const segments = Math.max(4, Math.ceil((Math.abs(sweep) * radius) / 0.8));
        for (let i = 0; i < segments; i += 1) {
          const a = stair.fromAngle + (sweep * i) / segments;
          const b = stair.fromAngle + (sweep * (i + 1)) / segments;
          this.collision.addWall(
            room.originX + stair.centreX - Math.sin(a) * radius,
            room.originZ + stair.centreZ + Math.cos(a) * radius,
            room.originX + stair.centreX - Math.sin(b) * radius,
            room.originZ + stair.centreZ + Math.cos(b) * radius,
            0.22,
          );
        }
      }
    }

    // --- the straight flight -------------------------------------------------
    // Origin at the centre of its bottom riser, standing on the landing,
    // climbing toward −Z onto the gallery — the asset's own frame, so no
    // rotation and no half-anything arithmetic.
    const grand = createStraightStaircase();
    grand.root.position.set(straight.centreX, landing.height + STAIR_SINK, straight.frontZ);
    shell.add(grand.root);
    for (let i = 0; i < grand.treads; i += 1) {
      const top = landing.height + grand.treadTop(i);
      const near = straight.frontZ - grand.treadFront(i);
      // The same quarter-riser slices as the curves, for the same damp-lag
      // reason (probe 14's rule: no sprint stride may present a whole riser).
      // Climb is toward −Z, so the ramp ascends as z falls.
      const slices = 4;
      for (let slice = 0; slice < slices; slice += 1) {
        this.surfaces.addPlatform(
          new Plate(
            top - (grand.riser * (slices - 1 - slice)) / slices,
            room.originX + straight.centreX - straight.walkWidth / 2,
            room.originX + straight.centreX + straight.walkWidth / 2,
            room.originZ + near - (grand.going * (slice + 1)) / slices,
            room.originZ + near - (grand.going * slice) / slices,
          ),
        );
      }
    }
    // Its flanks hold a climber on the flight and a landing walker out of its
    // strings — **banded**, because beneath them is the open recess a ground
    // walker crosses on the axis, not floor-to-flank masonry. They are also
    // `navStamped`, the one banded case the lattice's level rule cannot
    // refuse on its own: the flight's lowest treads run within a step of the
    // landing beside them, so an unstamped flank let the router connect the
    // landing to the flight *sideways* and the walk wedged against a rail it
    // could not see (found live, 9 Aug 2026; check:nav-routes walks the legs
    // now). The axis keeps its channel — the flanks stand 4 m apart.
    for (const flankSign of [-1, 1]) {
      this.collision.addWall(
        room.originX + straight.centreX + flankSign * straight.flankX,
        room.originZ + straight.frontZ,
        room.originX + straight.centreX + flankSign * straight.flankX,
        room.originZ + maxZ,
        0.18,
        Infinity,
        false,
        false,
        landing.height - RAIL_BASE_DROP,
        true,
      );
    }

    // --- the banded balustrade colliders -------------------------------------
    // The visual balustrade is `dressMezzanine`'s (the artist's tiles); these
    // are the rails' physics, and the whole reason `baseHeight` exists: a
    // deck walker pushed at the rail is held, a ground walker walks under the
    // same XZ freely. Proven both ways by `check:hotel`.
    // **Straight off the schedule.** `mezzanineGuardedEdges` is the one owner
    // of which deck edges are drops and how each is banded, and `check:hotel`
    // walks a body off every edge in that same list. These used to be five
    // `addWall` calls written out here, and the landing's *north* edge was in
    // neither them nor the three spot checks that were supposed to cover
    // them: the gallery's balustrade is drawn along that line but banded to
    // its own 4.94 m, so a child on the landing at 3.84 m walked through the
    // rail she could see and fell to the lobby floor.
    for (const edge of mezzanineGuardedEdges(plan, STAIR_RAIL_RADIUS)) {
      this.collision.addWall(
        room.originX + edge.x1,
        room.originZ + edge.z1,
        room.originX + edge.x2,
        room.originZ + edge.z2,
        0.15,
        Infinity,
        false,
        false,
        edge.base,
      );
    }

    // --- the ways between the levels, declared for the router ---------------
    // Three edges — each curve (floor ↔ landing) and the straight flight
    // (landing ↔ gallery) — derived from the same plan as the treads, so a
    // route from the floor to the gallery multi-hops through the landing with
    // no further declaration. ARCHITECTURE-DECISIONS.md Decision 11.
    for (const path of mezzanineWalkConnectors(plan)) {
      this.surfaces.addConnector(
        path.map((p) => ({ x: room.originX + p.x, y: p.y, z: room.originZ + p.z })),
      );
    }
  }

  /**
   * The windows in one wall — Jim's *"a room without windows is not
   * inviting"*, and *"the windowless building is weird and claustrophobic"*.
   *
   * **The room declares, this builds** (`layout.ts`'s `WindowWall`). It
   * replaced a single hand-built glowing band bolted to the breakfast room's
   * north wall — a fact about one room, written somewhere no other room could
   * inherit it — with a mechanism every floor gets for four numbers.
   *
   * Two meshes per pane, and both of them earn their place:
   *
   * - a **soft glow** flat against the wall, a little larger all round, in
   *   that floor's own `glow` colour. This is the light *spilling in*, and it
   *   is what stops a bright rectangle reading as a poster. Painted rather
   *   than lit: a real light per pane would be twenty-odd lights for a effect
   *   that never moves (see `hotel/lighting.ts` for what is actually lit).
   * - the **pane** itself, standing proud of it: `glassTint`, self-lit, the
   *   same crystal the floor plate and the tower outside are made of.
   *
   * `spans` is the wall's *solid* stretches, handed in by the caller that just
   * worked them out to leave the doorways alone. Clipping to them here is what
   * makes the declared numbers safe to edit: the doorway is respected by
   * construction rather than by everybody remembering it.
   */
  private glazeWall(
    shell: Group,
    room: HotelRoom,
    side: WallSide,
    spans: readonly (readonly [number, number])[],
  ): void {
    const plan = room.windows[side];
    if (!plan) return;

    const alongX = side === 'north' || side === 'south';
    // Distance from the room's centre to the wall's inner face, and which way
    // "into the room" points on this side.
    const face = (alongX ? room.halfZ : room.halfX) - WALL_HALF_DEPTH;
    const inward = side === 'north' || side === 'west' ? 1 : -1;
    const height = plan.head - plan.sill;
    if (height <= 0) return;
    const centreY = (plan.sill + plan.head) / 2;

    const glassMaterial = new MeshToonMaterial({
      color: PALETTE.glassTint,
      emissive: PALETTE.glassTint,
      emissiveIntensity: 0.92,
    });
    const glowMaterial = new MeshToonMaterial({
      color: PALETTE.blossomWhite,
      emissive: room.theme.glow,
      emissiveIntensity: 0.42,
    });

    for (const glazed of glazedSpans(room, side)) {
      for (const [from, to] of spans) {
        const a = Math.max(glazed.from, from);
        const b = Math.min(glazed.to, to);
        if (b - a < MIN_PANE_WIDTH) continue;
        const width = b - a;
        const along = (a + b) / 2;

        const glow = decal(
          new Mesh(
            alongX
              ? new BoxGeometry(width + GLOW_MARGIN * 2, height + GLOW_MARGIN * 2, 0.06)
              : new BoxGeometry(0.06, height + GLOW_MARGIN * 2, width + GLOW_MARGIN * 2),
            glowMaterial,
          ),
        );
        const pane = decal(
          new Mesh(
            alongX
              ? new BoxGeometry(width, height, 0.14)
              : new BoxGeometry(0.14, height, width),
            glassMaterial,
          ),
        );
        glow.name = 'hotel.window-glow';
        pane.name = 'hotel.window';
        if (alongX) {
          glow.position.set(along, centreY, -inward * face + inward * 0.04);
          pane.position.set(along, centreY, -inward * face + inward * 0.1);
        } else {
          glow.position.set(-inward * face + inward * 0.04, centreY, along);
          pane.position.set(-inward * face + inward * 0.1, centreY, along);
        }
        shell.add(glow, pane);
      }
    }
  }

  private dressLobby(): RipikaStatueHandle {
    const shell = this.roomShell(LOBBY);

    // The mosaic floor — Jim's first note after playing it, and the single
    // biggest reason the lobby stops reading as a big pink rectangle. See
    // `core/textures.ts`'s `mosaicTexture` for why a tiling map is the right
    // answer here and a material colour is not.
    this.layMosaic(shell, LOBBY);

    // The giant RiPika on its floor medallion, with the disco ball above —
    // Eleri: "a disco ball above the ripika statue" — **on the axis, south of
    // the arch**: doors → runner → the statue's medallion → under the arch →
    // the colonnade. A grand lobby's centrepiece stands on the promenade and
    // you walk round it, which the rainbow ring invites; it must not stand IN
    // the archway, which the old spot (0, −1) now is.
    //
    // **z moved with the whole foyer** when it grew by `LOBBY_FOYER_GROWTH`
    // (17 Aug 2026, issue #271's paintings coming back) — the statue's own
    // position relative to the door, the runner and the seating either side
    // of it is exactly what it always was, just carried 5 m further from
    // the (unmoved) lift and stairs hall. See that constant's doc in
    // `layout.ts`.
    const STATUE_Z = 4.6 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT;
    const statue = createRipikaStatue();
    // Solid at its plinth's own 1.15 m footing — Jim: *"the statues and chairs
    // you can clip through are weird."*
    this.props.place(shell, LOBBY, statue.root, {
      x: 0,
      z: STATUE_Z,
      radius: 1.2,
      // The statue's real height — far above any jump, so no plate; honest
      // rather than Infinity so probe 11's pillar sweep stays meaningful.
      top: statue.height,
      stand: false,
    });
    // **Three times the size, and it lights the room** (Jim, 7 August 2026).
    // Hung so the ball's middle rides just above the gallery deck (5.44):
    // from up there it is at eye height and close enough to touch, and from
    // the lobby floor it hangs in the middle of the tall room over the
    // statue. Its beams sweep all three levels.
    this.hangDiscoBall(shell, 0, 8.3, STATUE_Z, { scale: 3, lit: true, room: LOBBY });
    // The medallion: Eleri's rainbow ring, inlaid round the plinth. Inner
    // radius 1.4 clears the 1.15 m footing; six 0.15 m bands (0.22 until
    // issue #270's foyer/hall partition landed at `LOBBY_HALL_Z`) keep the
    // whole medallion inside the runner's line **and** short of the new
    // partition — `check:hotel` probe 19 measures the built ring's box
    // against the built wall's, so the two cannot drift back into each other.
    const ring = rainbowRing(1.4, 0.15);
    ring.position.set(0, 0, STATUE_Z);
    shell.add(ring);
    // Kept, because checking in flashes them — see `checkIn`. The ring is six
    // meshes with six materials and this is the only handle on them; asking
    // the scene graph for "the rainbow" every frame would be a string lookup
    // in the render loop for something that never moves.
    for (const band of ring.children) {
      if (band instanceof Mesh && band.material instanceof MeshToonMaterial) {
        // Armed but off: `emissiveIntensity` defaults to 1, so setting the
        // emissive colour without also zeroing the intensity would leave the
        // rainbow permanently self-lit — the flash would be the *normal* state
        // and checking in would make it stop.
        band.material.emissive.setHex(band.material.color.getHex());
        band.material.emissiveIntensity = 0;
        this.cheerLights.push(band.material);
      }
    }

    // **The chandelier** — the artist's pendant cluster, hung on the axis
    // over the arch's mouth, high in the double-height space: the lowest
    // globe stays above the gallery's own deck, and a hatted child on the
    // landing walks nowhere near it. Its glow is a real light, built by
    // `hotel/lighting.ts`'s own helper so the fitting and the room's lamps
    // stay one system. z carries `LOBBY_FOYER_GROWTH` with the rest of the
    // hall it hangs over — the arch itself moved.
    const CHANDELIER_Z = -0.7 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT;
    const chandelier = createChandelier();
    chandelier.root.position.set(0, 8.7, CHANDELIER_Z);
    shell.add(chandelier.root);
    const pendant = pendantLight();
    pendant.position.set(0, 8.7 - chandelier.height / 2, CHANDELIER_Z);
    shell.add(pendant);

    // The desk is 2.67 m of bowed crystal counter — a run, so a rectangle
    // rather than a disc, or a child could not walk along it to reach the far
    // end of it.
    //
    // **Dead centre of its own reception room, facing the doors** — see
    // RECEPTION_X's header (issue #280): the room between
    // {@link LOBBY_HALFZ_BEFORE_RECEPTION} (the doorway into the rest of the
    // lobby) and the front door holds nothing else, so the desk is the one
    // and only thing a child sees stepping in.
    const desk = createReceptionDesk();
    this.props.place(shell, LOBBY, desk.root, {
      x: RECEPTION_X,
      z: RECEPTION_Z,
      halfX: 1.35,
      halfZ: 0.45,
      // The asset's own measured height (counter plus key board). No plate:
      // the counter is not the top of the asset, so there is no honest floor.
      top: desk.height,
      stand: false,
    });
    const reception = createKeeper({ colour: PALETTE.flowerRed, hair: PALETTE.markerPink });
    // The receptionist is a person, and people in this park are scenery-soft
    // (see `NpcSystem.separate` for the one exception, which is a push rather
    // than a wall). She stands behind her own solid desk regardless.
    this.props.place(shell, LOBBY, reception.root, {
      x: RECEPTION_X,
      z: RECEPTIONIST_Z,
      radius: 0.7,
      top: reception.height,
      solid: false,
    });
    this.keepers.push(reception);
    this.receptionist = reception;
    // Her speech bubble hangs over her own head and moves with nothing, because
    // she never moves. Parented to the lobby's shell so it vanishes with the
    // hotel; positioned once, here, rather than every frame.
    this.receptionBubble.sprite.position.set(
      RECEPTION_X,
      reception.height + 0.42,
      RECEPTIONIST_Z,
    );
    shell.add(this.receptionBubble.sprite);

    // **The axis.** A runner in two lengths — doors to the medallion, then
    // medallion to the arch's mouth — so the promenade reads as one line from
    // the entrance, round the statue, under the arch and into the colonnade.
    // Two pieces rather than one because a decal under the medallion's own
    // bands would sit inside the depth ladder's two-step window (probe 17).
    //
    // The south piece moves with `LOBBY_FOYER_GROWTH` (+) — it runs
    // doors-to-medallion, and both of those moved with the statue. The north
    // piece runs medallion-to-arch, and the arch moved too, the other way
    // (−) — so this one carries the *same constant, negated*: the medallion
    // ends up twice as far from the door as it was, and each runner still
    // reaches exactly what it always reached.
    const runnerSouth = rug(3.2, 4.6, LOBBY.theme.accent, PALETTE.blossomWhite);
    runnerSouth.position.set(0, 0, 9.8 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT);
    shell.add(runnerSouth);
    const runnerNorth = rug(3.2, 3.9, LOBBY.theme.accent, PALETTE.blossomWhite);
    runnerNorth.position.set(0, 0, -0.35 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT);
    shell.add(runnerNorth);

    // The breakfast corner — "breakfast ... at the ground floor". Two tables
    // only (the *room* full of them is Floor 1 now), tucked in the south-west
    // corner by the west windows, where a café by the glass belongs — not
    // scattered mid-floor where they read as lost furniture. z carries
    // `LOBBY_FOYER_GROWTH` with the rest of the foyer.
    this.placeBreakfastTable(shell, LOBBY, -10.2, 9.6 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT, 'lobby-a', 0.15);
    // Spun so its chairs sit east-west (at the first spin a chair interleaved
    // with the west lounge's rug). "kept clear of the west wall's painting"
    // no longer describes this table specifically — the paintings that
    // spacing was measured against are the two returning ones below, hung
    // well north of here in the gap `LOBBY_FOYER_GROWTH` opened, not beside
    // the café — but the same two-metre clearance this spin bought is still
    // worth keeping for whatever else ends up on that wall.
    this.placeBreakfastTable(shell, LOBBY, -10.3, 7.7 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT, 'lobby-b', 1.35);

    // **Two mirrored seating groups flanking the axis** — the symmetric pair
    // every grand lobby seats its guests in, shifted a stride south of the
    // old spots so the rugs stay clear of the flights' feet. Both groups face
    // +Z so you see who is sitting on them (the camera rule). z carries
    // `LOBBY_FOYER_GROWTH` with the rest of the foyer.
    for (const side of [-1, 1] as const) {
      const lounge = roundRug(2.6, LOBBY.theme.accent, PALETTE.stonePinkLight);
      lounge.position.set(side * 7.6, 0, 5.3 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT);
      shell.add(lounge);
      for (const [x, colour] of [
        [side * 5.9, PALETTE.markerSky],
        [side * 9.2, PALETTE.markerMint],
      ] as const) {
        this.props.place(shell, LOBBY, sofa(2.6, colour, PALETTE.blossomWhite), {
          x,
          z: 4.8 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
          halfX: 1.3,
          halfZ: 0.48,
          // The seat: what a jump lands on. Sailing over the backrest on the
          // way is a visual graze a six-year-old reads as bouncing onto the
          // cushions, which is the whole point.
          top: SOFA_SEAT_TOP,
        });
      }
      this.props.place(shell, LOBBY, bedsideTable(), {
        x: side * 7.6,
        z: 6.4 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
        radius: 0.36,
        top: 1.0,
        stand: false,
      });
    }

    // Crystal columns — the lobby's theme is "a grand crystal welcome", and a
    // column is the only prop in the hotel taller than a grown-up. The two on
    // the west wall now rise 8.3 m, because the room grew to 8.9 with the
    // composition and a 5.8 m column under an 8.9 m wall reads as a stub.
    //
    // Both stand against the **west** wall, and that is not decoration: the
    // camera looks along (−X, −Z) and down 38°, so anything tall on the +X or
    // +Z side of a child stands between her and the lens. The far two walls
    // are the only place a tall prop is free. (Same rule as `nearWallHeight`,
    // applied to furniture.) They are set between the west windows rather
    // than across them. The old cluster at (12, −10.4) stood where the
    // colonnade now runs; it holds the east bay's corner instead, mirroring
    // the west one.
    //
    // **Every one of these carries `LOBBY_FOYER_GROWTH`, sign matching
    // which side of the partition it is on.** The south column and the two
    // south planters (+) are the entire point of the growth — issue #271's
    // returning paintings hang in the gap this opens between the relocated
    // column and the lift's own exclusion line (that constant's own doc).
    // The hall-side column, both clusters and the hall planter (−) are not
    // about the paintings at all; they carry it only because the hall they
    // stand in moved with the wall it is built flush against.
    this.placeProps(shell, LOBBY, [
      {
        prop: () => crystalColumn(8.3, LOBBY.theme.floor),
        x: -11.9,
        z: -6.6 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
        radius: 0.62,
        top: 8.3,
      },
      {
        prop: () => crystalColumn(8.3, LOBBY.theme.floor),
        x: -11.9,
        z: 6.6 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
        radius: 0.62,
        top: 8.3,
      },
      { prop: () => crystalCluster(0x10b1), x: -12.2, z: -5.8 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT, top: CLUSTER_TOP },
      { prop: () => crystalCluster(0x10b2), x: 12.2, z: -5.8 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT, top: CLUSTER_TOP },
      // Back at its natural, mirrored x (3.4, matching the planter at −3.4),
      // 18 August 2026: it moved to 7.2 only to dodge the reception check-in
      // stand spot, which shared this room with it at the time. Issue #280's
      // room split moved the desk (and its stand spot) into its own room
      // entirely — see {@link RECEPTION_X} — so nothing here needs dodging
      // any more.
      { prop: () => crystalPlanter(0x10b3), x: 3.4, z: 10.8 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT, top: PLANTER_TOP },
      { prop: () => crystalPlanter(0x10b5), x: -3.4, z: 10.8 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT, top: PLANTER_TOP },
      { prop: () => crystalPlanter(0x10b4), x: -6.2, z: -6.6 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT, top: PLANTER_TOP },
    ]);

    // The one keep-out in the lobby that is not a prop: the patch of floor a
    // child stands on to check in — now in the reception room, a few strides
    // south of the desk (toward the front door), same convention as before
    // the room split. See `HotelProps.reserve`.
    this.props.reserve(LOBBY, RECEPTION_X, RECEPTION_Z + 2.2, 2);
    this.hangOnWalls(shell, LOBBY, {
      // Ground-level sconces on the north wall light the colonnade — the
      // north wall is the end of the axis now, the far side of the
      // see-through, and a dark terminus reads as a hole rather than a room.
      north: [-8.4, 0, 8.4],
      // The southern sconce moved off z = -6 when the west wall's northern
      // pane did (see `LOBBY.windows` — a sconce on glass lights nothing).
      // Both are hall fixtures (they light the stairs-and-lifts hall, not
      // the foyer) and carry `− LOBBY_FOYER_GROWTH` with the rest of it.
      west: [-4.6 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT, 2 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT],
      // **Issue #271, then #271-again: the paintings are back, on the west
      // wall, south of the lift.**
      //
      // The north wall is still permanently out — every point on it stands
      // under the gallery deck (`LOBBY.mezzanine` reaches the whole width of
      // that wall), so the fixed camera's own ray from anywhere on it
      // crosses the deck's box before it reaches the lens;
      // `mezzanineHidesPoint` says so, which is how the original bug was
      // found. {@link clearOfGlass} refuses a spot the deck hides (the same
      // way it already refuses one over glass), so that wall can never host
      // one again, whatever this array says.
      //
      // The west wall was the fix, once there was somewhere on it — the
      // first attempt found there wasn't: every point on it sits within
      // 0.31 m (local x) of the lift's own boarding band, whose 2.6 m
      // half-width plus a picture's 2 m pick radius plus the tap-spacing
      // finger needs 5.73 m of clearance from `liftZ` (the exact number
      // moves with the lift, since `LOBBY_FOYER_GROWTH` shifts that too),
      // and both directions from there were already spoken for by the
      // crystal column and the café. Jim's call (17 Aug 2026): don't drop
      // the paintings, make more wall — {@link LOBBY_FOYER_GROWTH} moves
      // every foyer fixture's own local z by itself, which (added to the
      // same shift in the room's own origin) doubles to how far each
      // actually ends up from the lift. The seating group's sofas turned out
      // to be the binding one, not the column — `check:hotel`'s "Look!"
      // stand-spot probe (7) found a picture's stand point still landing on
      // a sofa at the growth's first, smaller value, which the column alone
      // would never have caught — so these two hang in the stretch between
      // the lift's own exclusion line and the sofas' own (now much further)
      // north edge, `clearOfGlass`'s own search finding the exact clear
      // metres within it rather than this array guessing them.
      pictures: [
        { wall: 'west', along: 7.0 - RECEPTION_ORIGIN_SHIFT, width: 1.5, height: 1.25, seed: 0x10c2 },
        { wall: 'west', along: 9.4 - RECEPTION_ORIGIN_SHIFT, width: 1.5, height: 1.25, seed: 0x10c3 },
      ],
    });
    this.dressMezzanine(shell);

    // A painted arrow on the floor pointing at the lift — "an arrow showing
    // the way to your floor, on the floors of the hotel". Two legs now
    // (issue #270): the straight line this used to be would have crossed the
    // new foyer/hall partition through solid wall — its two endpoints sit on
    // the same (negative) side of x, so a single straight line between them
    // never reaches {@link LOBBY_HALL_DOOR_X}'s doorway however that constant
    // is tuned. The first leg carries on past the statue to the doorway; the
    // second picks up on the far side and carries on between the west
    // seating group and the café to the lift's mouth. Every z here carries
    // `LOBBY_FOYER_GROWTH`, sign matching whichever side of the (also-moved)
    // doorway it is on: + for the first leg's start (it is routed round the
    // statue, a foyer fixture), − for both the doorway crossing itself and
    // the second leg's end at the lift's own (also relocated) mouth.
    //
    // **A decal tier up from the default**, because the first leg's straight
    // line still passes inside the rainbow ring's own radius round the
    // statue — `check:hotel` probe 17 caught the two exactly coplanar at
    // 4·`DECAL_STEP` (both 0.080 m, "0.0 mm apart"), the same class of
    // flicker the garden's arrow already sidesteps over its own stacked lawn
    // rug.
    this.paintArrow(
      shell,
      -2.4,
      9.2 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
      0,
      2.4 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
      8 * DECAL_STEP,
    );
    this.paintArrow(
      shell,
      0,
      1.6 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
      -10.8,
      0.4 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
      8 * DECAL_STEP,
    );

    // The bathroom (issue #272, own-room rewrite issue #281) — south-east
    // corner of the *foyer*, now a genuinely enclosed room: `LOBBY.partitions`
    // closes the two sides the room's own east wall (x = 13, untouched by
    // #280) and the reception/lobby partition (its new south side — see
    // `LOBBY.partitions`'s own comment for why that's the wall now) don't
    // already own, door on the (widened-in) west wall at x = 7.0. Clear of
    // the breakfast corner (south-west, x ≈ −10), the seating groups and
    // columns (|x| ≤ 12.2, z ≤ 7.6) and the corner planters (x = ±3.4,
    // z = 11.8) — all of it, this bathroom included, carrying #280's
    // `+ LOBBY_FOYER_GROWTH − RECEPTION_ORIGIN_SHIFT` foyer shift together, so
    // the relative gaps between them are exactly what they always were.
    //
    // With the door pushed well west, the pan sits with room to spare from
    // both the doorway's own clearance zone (reach 1.24 m from x = 7.0) and
    // its tap-spacing band (a further finger, `check:tap-spacing`), and
    // still a comfortable margin short of the east wall — no more fighting
    // one rule against the other the way the narrower nook did.
    //
    // A tighter pick radius than the suite's own 1.8 m default — this small
    // a room puts the "Use" zone within a finger of its own doorway
    // (`check:tap-spacing`'s rule) at the default radius.
    const rect = clearFloorAround(LOBBY, 11.5, 10.7 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT);
    this.buildBathroomFixtures(
      shell,
      LOBBY,
      rect,
      11.5,
      10.7 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
      10.2,
      10.7 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
      10.8,
      9.8 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
      -Math.PI / 2,
      0.9,
    );

    return statue;
  }

  /**
   * Breakfast, **Floor 1** — the big room.
   *
   * Jim, having played it: *"Breakfast should be on the 1st floor … and should
   * be a large room with lots of tables and a buffet with breakfast foods."*
   * So: seven tables, none of them square-on to another, and a twelve-metre
   * buffet along the far wall with a keeper serving behind it.
   *
   * **The tables are laid out by hand, not scattered.** `dressDeck`'s seeded
   * rejection sampler is right for the castle, whose plan moves under it; this
   * room's plan is these fourteen numbers, and a hand layout is the one that
   * can guarantee a clear lane from the lift alcove to the buffet — which is
   * the walk a child actually makes here.
   */
  private dressBreakfast(): void {
    const shell = this.roomShell(BREAKFAST);

    // Seven tables. Each gets its own `spin`, so the room reads as a café that
    // people have been sitting in rather than as a grid — the chairs, the
    // bowls and the sit-down pose all rotate with it, so the mechanics do not
    // notice.
    // Tables a and e moved east/south on 8 Aug 2026: each had a chair whose
    // "Sit" zone reached inside a finger of the lift's boarding band, so a
    // tap aimed at the lift sat a child down instead (the tap-spacing rule,
    // `world/tapSpacing.ts` — `check:tap-spacing` measures every chair).
    const tables: readonly (readonly [number, number, string, number])[] = [
      [-6.4, 6.2, 'b1-a', 0.34],
      [-2.4, 6.4, 'b1-b', -0.52],
      [3.4, 5.6, 'b1-c', 0.18],
      [8.8, 4.6, 'b1-d', -0.3],
      [-4.6, 0.2, 'b1-e', 0.62],
      [-2.6, -3, 'b1-f', -0.16],
      [7.4, -0.8, 'b1-g', 0.46],
    ];
    for (const [x, z, id, spin] of tables) {
      this.placeBreakfastTable(shell, BREAKFAST, x, z, id, spin);
    }

    // The buffet, along the north wall — the wall the camera looks straight
    // at (see `hotel/dressing.ts`'s header on which walls are visible), so the
    // food is the thing you see when you walk in.
    // Fourteen metres of counter, registered as fourteen metres of counter:
    // one footprint, which makes it solid *and* which `place.ts` covers with a
    // chain of keep-out discs so a guest can still stroll along it.
    this.props.place(shell, BREAKFAST, buffetCounter(14), {
      x: 1.5,
      z: -7.4,
      halfX: 7.12,
      halfZ: 0.47,
      // The counter top — a jump can just reach it, so a determined child can
      // stand on the buffet, which is exactly the sort of thing she should be
      // able to do to a buffet.
      top: BUFFET_TOP,
    });
    this.layBuffet(shell, 1.5, -7.4, 14);

    const server = createKeeper({ colour: PALETTE.flowerRed, hair: PALETTE.markerPink });
    this.props.place(shell, BREAKFAST, server.root, {
      x: 1.5,
      z: -8.25,
      radius: 0.7,
      top: server.height,
      solid: false,
    });
    this.keepers.push(server);

    // (Floor 1's windows are `BREAKFAST.windows` now — seven declared panes
    // along this same north wall, built by `glazeWall`. The single hand-built
    // glowing band that used to be nailed here is gone: it was a fact about
    // one room, kept somewhere no other room could inherit it.)

    // The runner from the lift into the room, and the corners.
    const runner = rug(5, 3, BREAKFAST.theme.trim, PALETTE.blossomWhite);
    runner.position.set(-9.2, 0, 0);
    shell.add(runner);

    // The sun on the floor — Floor 1's theme in one shape, in the middle of
    // the room, which is the first thing the lift doors show you.
    const sun = sunburst(3.2);
    sun.position.set(1, 0, 1.6);
    shell.add(sun);

    this.placeProps(shell, BREAKFAST, [
      { prop: () => crystalCluster(0x20b1), x: -10.6, z: -7.4, top: CLUSTER_TOP },
      { prop: () => crystalCluster(0x20b2), x: 11, z: -7.4, top: CLUSTER_TOP },
      { prop: () => crystalPlanter(0x20b3), x: -10.8, z: 6.4, top: PLANTER_TOP },
      { prop: () => crystalPlanter(0x20b4), x: 10.6, z: 1, top: PLANTER_TOP },
    ]);
    this.hangOnWalls(shell, BREAKFAST, {
      // No sconces on the north wall here: the glowing window band already
      // lights it, and anything mounted lower would be behind the buffet.
      north: [],
      west: [-7, 7],
      // One painting here now, south of the lift on the west wall's only
      // stretch a finger clear of the boarding band (tap-spacing rule,
      // 8 Aug 2026) — its old twin at z 5 sat 0.40 m from the band, and the
      // matching compliant stretch north of the lift belongs to the wall's
      // own "Look out" pane at 8.1.
      pictures: [{ wall: 'west', along: -6.4, width: 1.6, height: 1.2, seed: 0x20c1 }],
    });

    // The bathroom (issue #272, own-room rewrite issue #281) — south-east
    // corner, same shape as the lobby's: `BREAKFAST.partitions` closes the
    // two open sides, door on the west wall, jamb at the (grown) south wall.
    // The floor grew deeper (`BREAKFAST.halfZ`) so the door sits a full
    // 5.5 m south of table b1-d (8.8, 4.6) — clear of it and its chairs'
    // "Sit" zones for both `check:hotel`'s doorway-clearance check and
    // `check:tap-spacing`'s finger rule. The pan sits east and well south of
    // the door's own tap-spacing band — the extra room's own depth is what
    // buys the "Use" zone its clearance, not extra width (see `halfX`'s own
    // comment for why widening the room instead put a painting in a wall).
    // It also sits a body's width shy of the east wall, not flush against it
    // — `check:hotel` found the wall's own face shoving a standing child
    // sideways at the position tried first.
    //
    // The whole nook — this query point and every coordinate below — is
    // translated a further 0.6 m south of that (`BREAKFAST.halfZ`'s own
    // comment): the room's own NW corner sat only 0.226 m from b1-d's own
    // chair (a real 0.324 m disc-into-wall overlap — PR #281 review, 18 Aug
    // 2026), and a pure translation keeps every fixture's spacing from every
    // other fixture exactly as it was, so nothing here needed re-deriving.
    const rect = clearFloorAround(BREAKFAST, 10.9, 9.1);
    // A tighter pick radius than the suite's own 1.8 m — this nook has a
    // breakfast chair for a neighbour, and check:tap-spacing wants a full
    // finger (TAP_FINGER_METRES) between them.
    this.buildBathroomFixtures(shell, BREAKFAST, rect, 10.9, 7.6, 9.6, 7.6, 11.0, 9.6, Math.PI / 2, 0.9);
  }

  /**
   * Floor 50 — **up among the clouds**, which is the only thing about a
   * fiftieth floor a six-year-old cares about.
   *
   * The theme does the heavy lifting (sky-blue walls over a deeper sky floor,
   * `layout.ts`'s `CORRIDOR_THEME`); this adds the two shapes that say *sky*
   * without a word: chunky flat stars on the far wall, at the same angle as
   * the "yours" door's own star, and clouds floating **above the wall line**,
   * which an open-topped room is uniquely able to show off.
   */
  private dressCorridor(): void {
    const shell = this.roomShell(CORRIDOR);
    const sky: readonly number[] = [
      PALETTE.markerSky,
      PALETTE.flowerBlue,
      PALETTE.bubbleSkin,
      PALETTE.buildingRoof,
    ];

    // Life-sized statues of all the cute pets, on little plinths. The plinth
    // is what carries the footprint — Jim's "the statues … you can clip
    // through are weird" — and the pet standing on it needs none of its own,
    // since anything that can reach the pet is already stopped by the plinth.
    PET_KINDS.forEach((kind, index) => {
      const plinth = solid(
        new Mesh(new CylinderGeometry(0.85, 0.95, 0.4, 16), softMaterial(PALETTE.stonePink)),
      );
      const x = -7.5 + index * 5;
      const z = -CORRIDOR.halfZ + 1.4;
      // Top 0.4: the plinth's own height (`y` only centres the cylinder), so
      // a jump lands her on the plinth beside the pet — pure six-year-old.
      this.props.place(shell, CORRIDOR, plinth, { x, y: 0.2, z, radius: 0.95, top: 0.4 });
      const pet = createPet(kind);
      pet.root.position.set(x, 0.4, z);
      shell.add(pet.root);
    });

    // The runner from the lift to the door. It is also the plainest possible
    // "this way" — the chevrons painted on top of it point along it.
    const runner = rug(17, 2.6, CORRIDOR.theme.accent, PALETTE.blossomWhite);
    runner.position.set(0, 0, 0.6);
    shell.add(runner);

    // Stars on the far wall, at child's-eye height and above.
    const starRng = new Rng(0x30a5);
    for (const [x, y, r] of [
      [-9.6, 2.35, 0.34],
      [-5, 2.62, 0.42],
      [0, 2.3, 0.3],
      [5, 2.66, 0.4],
      [9.6, 2.4, 0.36],
    ] as const) {
      const star = flatStar(r, CORRIDOR.theme.glow);
      star.position.set(x, y, -CORRIDOR.halfZ + 0.3);
      star.rotation.z = starRng.range(-0.3, 0.3);
      shell.add(star);
    }

    // Clouds, floating over the wall line where the iso camera can see them.
    for (const [x, y, z, scale, seed] of [
      [-6.4, 3.7, -1, 1.25, 0x30c1],
      [0.8, 4.05, 1.6, 1, 0x30c2],
      [6.8, 3.65, -0.4, 1.15, 0x30c3],
    ] as const) {
      const puff = cloud(seed, scale);
      puff.position.set(x, y, z);
      shell.add(puff);
    }

    this.placeProps(shell, CORRIDOR, [
      // z = 3.0, not the lift gap's own 2.6: `doorwayClearanceZones` reaching
      // `DOORWAY_THROUGH_DEPTH` further into the room (18 Aug 2026, the
      // `/hotel-suite` furniture fix) caught this cluster 0.22 m inside the
      // west lift doorway's now-deeper zone. It is still the same corner
      // scatter, just a stride further from the door it stands beside.
      { prop: () => crystalCluster(0x30b1, 1, sky), x: -9.8, z: 3.0, top: CLUSTER_TOP },
      { prop: () => crystalCluster(0x30b2, 1, sky), x: 9.6, z: 2.6, top: CLUSTER_TOP },
      { prop: () => crystalPlanter(0x30b3, CORRIDOR.theme.trim, sky), x: -4, z: 2.9, top: PLANTER_TOP },
      { prop: () => crystalPlanter(0x30b4, CORRIDOR.theme.trim, sky), x: 4, z: 2.9, top: PLANTER_TOP },
    ]);
    this.hangOnWalls(shell, CORRIDOR, { north: [], west: [-2.9, 2.9], pictures: [] });

    // The door that says "yours", at the corridor's end, with an arrow to it.
    const door = createYoursDoor();
    door.root.position.set(CORRIDOR.halfX - 0.3, 0, 0);
    door.root.rotation.y = -Math.PI / 2;
    paintYours(door.plaque);
    shell.add(door.root);
    this.yoursStar = door.star;
    // A returning child's star is already lit — the door has been hers since
    // the moment reception handed the key over.
    this.lightYoursStar(saveFlags.hasHotelKey());
    this.paintArrow(shell, -2, 0, CORRIDOR.halfX - 2, 0);

    // **No bathroom nook of its own** (issue #272) — this is the one floor of
    // the five where that is the right call rather than a shortfall. The
    // corridor is 8 m deep and every stretch of its east wall that is not
    // the doorway itself is already claimed: the pet statues' row to the
    // north (last one at 7.5, radius 0.95), the crystal cluster to the south
    // (9.6, 2.6) whose own `PLAYER_RADIUS` clearance overruns the real south
    // wall's, and — the one that actually broke `check:hotel` first —
    // `Hotel.marchAtSuiteDoor`'s straight probe down the local z = 0 spine
    // from x = 8 to the "yours" door, which a nook anywhere near the middle
    // of this wall sits squarely on top of. There is no rectangle left big
    // enough for a solid, standable pan and basin a `PLAYER_RADIUS`
    // (0.62 m) apart from each other and from every wall.
    //
    // The suite is not a different floor pretending to be this one: the
    // lift panel answers to this room and the suite both under the single
    // "Yours! · Floor 50" button (`HOTEL_FLOORS`), and its own door is at
    // the far end of this very corridor. Its bathroom (`dressBathroom`,
    // reached through it) is what this floor offers — `check:hotel`'s probe
    // 21 checks exactly that pairing rather than asking this room for a
    // second one it has no honest room to build.
  }

  /**
   * **Floor 12 — the garden floor.** An indoor meadow, twelve storeys up.
   *
   * Jim, 7 August 2026: *"you should be able to go to certain other floors with
   * their own schemes."* The scheme is `GARDEN_THEME`, and the job here is to
   * make the *shape* of the room agree with it: you step out of the lift onto a
   * lawn, walk under a rose arch, and there is a pond with lilies on it.
   *
   * The lawn is the one piece of this worth explaining. It runs the length of
   * the room down the middle, and everything else — hedges, planters, arches —
   * is placed *beside* it, which is what keeps a clear walk from the lift to
   * the far end. Same reasoning as the breakfast room's hand layout: a room a
   * child crosses wants a lane, and a scatter cannot promise one.
   */
  private dressGarden(): void {
    const room = GARDEN_FLOOR;
    const shell = this.roomShell(room);

    // The lawn, straight down the middle — the lane from the lift.
    // The lawn lies over the sand path where they cross, so it rides one rug
    // tier up — two rugs on the same rungs are exactly the coplanar flicker
    // probe 17 measures.
    const lawn = roundRug(3.4, PALETTE.grass, PALETTE.grassLight, 1);
    lawn.position.set(1.5, 0, 1.2);
    shell.add(lawn);
    const path = rug(17, 2.4, PALETTE.pathSand, PALETTE.pathEdge);
    path.position.set(-0.5, 0, -2.6);
    shell.add(path);

    // Two rose arches over that path, so walking it is walking *through*
    // something. The footprint is the posts, never the span — you go under an
    // arch, and a solid rectangle across it would be a wall you cannot see.
    for (const [x, seed] of [
      [-4.5, 0x50a1],
      [4.5, 0x50a2],
    ] as const) {
      const arch = trellisArch(3.2, 2.5, seed);
      arch.position.set(x, 0, -2.6);
      shell.add(arch);
      for (const side of [-1, 1]) {
        this.props.footprint(room, { x: x + side * 1.6, z: -2.6, radius: 0.22, top: 2.5, stand: false });
      }
    }

    // Hedges along the north wall, either side of the windows' light, and a
    // pair marking the room's south corners.
    for (const [x, z, length, seed] of [
      [-6.4, -6.4, 5.4, 0x50b1],
      [6.4, -6.4, 5.4, 0x50b2],
      [-7.4, 5.6, 4.6, 0x50b3],
      [7.4, 5.6, 4.6, 0x50b4],
    ] as const) {
      this.props.place(shell, room, hedge(length, seed), {
        x,
        z,
        halfX: length / 2,
        halfZ: 0.31,
        // Bobbles top out around a metre; a hedge's top is foliage, not floor.
        top: 1.0,
        stand: false,
      });
    }

    // The pond, off the lane so it is something you walk *to*.
    // Tier 2: the pond's rim laps over the tier-1 lawn.
    const pond = lilyPond(2.1, 0x50c0, 2);
    pond.position.set(6.2, 0, 2.4);
    shell.add(pond);

    // Planters and tufts scattered along the lane's edges. Tufts are ankle
    // height and register nothing: a child who cannot walk over a daisy is a
    // child fighting the floor.
    const tuftRng = new Rng(0x50d0);
    for (let i = 0; i < 14; i += 1) {
      const tuft = flowerTuft(0x50e0 + i * 61, tuftRng.range(0.75, 1.15));
      tuft.position.set(tuftRng.range(-9.4, 9.4), 0, tuftRng.range(-5.4, 6.6));
      shell.add(tuft);
    }

    this.placeProps(shell, room, [
      // x = -9.0, not the lift gap's own -9.2: `doorwayClearanceZones`
      // reaching `DOORWAY_THROUGH_DEPTH` further into the room (18 Aug 2026,
      // the `/hotel-suite` furniture fix) caught this planter 0.04 m inside
      // the west lift doorway's now-deeper zone. Still the same corner spot,
      // just clear of it.
      { prop: () => crystalPlanter(0x50f1, PALETTE.woodLight, [PALETTE.leafMid, PALETTE.grass, PALETTE.blossomPink]), x: -9.0, z: 0.4, top: PLANTER_TOP },
      { prop: () => crystalPlanter(0x50f2, PALETTE.woodLight, [PALETTE.leafMid, PALETTE.grass, PALETTE.flowerYellow]), x: 9.2, z: -0.6, top: PLANTER_TOP },
      { prop: () => flowerTuft(0x50f3, 1.6), x: -2.4, z: 5.4, radius: 0.4, top: 1.2 },
    ]);

    // A bench to sit and look at the pond from. It is a sofa in the room's own
    // accent, which is what a garden bench is in this game's language.
    this.props.place(shell, room, sofa(2.4, room.theme.accent, PALETTE.blossomWhite), {
      x: 2.2,
      z: 5.2,
      halfX: 1.2,
      halfZ: 0.48,
      top: SOFA_SEAT_TOP,
    });

    this.hangOnWalls(shell, room, {
      north: [-9.8, 9.8],
      west: [-4.2, 4.2],
      // **Not on the west wall at all any more.** First it could not hang at
      // z = 0 (the lift's own doorway — a painting across the lift doors,
      // `check:hotel`'s find); then z 2.9 turned out to sit *beside* the
      // doorway with its "Look" zone still covering the boarding band by
      // 1.7 m, eating taps aimed at the lift (tap-spacing rule, 8 Aug 2026).
      // The north wall's stretch between two panes has room to stand and
      // nothing to fight with.
      pictures: [{ wall: 'north', along: 6.3, width: 1.6, height: 1.2, seed: 0x50c1 }],
    });
    // Six ladder steps, not four: this arrow crosses the stacked lawn rug.
    this.paintArrow(shell, 6.4, -2.6, -room.halfX + 2.5, 0, 6 * DECAL_STEP);

    // The bathroom (issue #272, own-room rewrite issue #281) — against the
    // (grown) east wall, between the two hedges (spanning x 3.7–9.1 both
    // north and south, half-depth 0.31 at z ±6.4) and well clear of the pond
    // (x 4.1–8.3, z 0.3–4.6). `room.partitions` closes all four sides now:
    // the same two north/south walls the old nook had, plus a third on the
    // west (previously open) side carrying the door — the floor grew 1.4 m
    // east so this room has real depth instead of the old nook's bare
    // corner-of-two-walls.
    //
    // The doorway's clearance zone (reach 1.24 m from x = 8.35) still eats
    // into the room along X, so the fixtures sit east of x = 9.59 — every
    // fitting also keeps a full `PLAYER_RADIUS` (0.62 m) clear of every wall
    // *centreline* and of every other fitting's own collider, the margin
    // `check:hotel` probe 21 actually measures (a child standing on the pan
    // must not be shoved by the wall or the basin beside it).
    // A tighter pick radius than the suite's own 1.8 m default — this small
    // a room puts the "Use" zone within a finger of its own doorway
    // (`check:tap-spacing`'s rule) at the default radius.
    const rect = clearFloorAround(room, 11.1, -2.6);
    this.buildBathroomFixtures(shell, room, rect, 11.1, -2.6, 9.8, -2.6, 11.6, -3.7, -Math.PI / 2, 0.9);
  }

  /**
   * **Floor 33 — the ocean floor.** Under the sea, thirty-three storeys up.
   *
   * The trick this room plays is the one Floor 50 plays with its clouds, and it
   * is only available because hotel rooms are open-topped: the **shoal swims
   * above the wall line**, where the iso camera looks straight at it and where
   * nothing a child does can reach it. Everything at floor level — seaweed,
   * treasure, a sandy floor — is scenery she walks between; everything
   * overhead is the bit that says *under the sea*, and it costs no collision at
   * all.
   */
  private dressOcean(): void {
    const room = OCEAN_FLOOR;
    const shell = this.roomShell(room);
    const fishColours: readonly number[] = [
      PALETTE.markerLemon,
      PALETTE.flowerRed,
      PALETTE.markerPink,
      PALETTE.markerMint,
      PALETTE.flowerYellow,
    ];

    // The sandy sea bed, laid over the deep-water plate — the room's floor
    // colour survives as a border, exactly as the lobby's mosaic does.
    const sand = roundRug(5.2, PALETTE.pathSand, PALETTE.pathSandDark);
    sand.position.set(0, 0, 1);
    shell.add(sand);

    // Portholes, round the room's own declared windows. The pane is the
    // window; this is the brass. See `porthole`'s header for why the two are
    // not one mesh.
    for (const x of OCEAN_FLOOR.windows.north?.at ?? []) {
      const ring = porthole(1.15);
      ring.position.set(x, 1.85, -room.halfZ + 0.34);
      shell.add(ring);
    }
    for (const z of OCEAN_FLOOR.windows.west?.at ?? []) {
      const ring = porthole(1.15);
      ring.position.set(-room.halfX + 0.34, 1.85, z);
      ring.rotation.y = Math.PI / 2;
      shell.add(ring);
    }

    // The shoal, swimming over the wall line. Angled a little off horizontal
    // and all leaning the same way, because a shoal is a shoal precisely
    // because everybody in it is going the same way.
    const shoalRng = new Rng(0x60a0);
    for (let i = 0; i < 11; i += 1) {
      const fish = fishShape(shoalRng.range(0.5, 0.95), shoalRng.pick(fishColours));
      fish.position.set(
        shoalRng.range(-8, 8),
        shoalRng.range(3.5, 5.4),
        shoalRng.range(-6.5, 4),
      );
      fish.rotation.z = shoalRng.range(-0.24, 0.24);
      shell.add(fish);
    }

    // A few more at child height on the far wall, so there is something to look
    // at from standing on the floor as well as from looking up.
    const wallRng = new Rng(0x60b0);
    for (const [x, y] of [
      [-8.2, 2.2],
      [-3.4, 2.6],
      [3.4, 2.15],
      [8.2, 2.55],
    ] as const) {
      const fish = fishShape(0.72, wallRng.pick(fishColours));
      fish.position.set(x, y, -room.halfZ + 0.3);
      fish.rotation.z = wallRng.range(-0.2, 0.2);
      shell.add(fish);
    }

    // Seaweed in the corners and along the walls — this floor's crystal
    // cluster, and placed the same way.
    this.placeProps(shell, room, [
      { prop: () => seaweed(0x60c1, 1.2), x: -8.4, z: -6.4, top: SEAWEED_TOP },
      { prop: () => seaweed(0x60c2, 1.1), x: 8.4, z: -6.4, top: SEAWEED_TOP },
      // Moved from (-8.6, 6.4) to (-6.0, 7.2) (issue #281) — the bathroom's
      // own room now occupies exactly that corner, growing a real south wall
      // out to z = 6.8; the old spot first sat inside the doorway's
      // clearance zone, and once nudged along the wall to clear that, sat
      // inside the wall's own collider instead (the wall physically stands
      // there now — this decoration cannot). East of the bathroom's own east
      // wall (x = -7.6) instead, still low in the room's south end.
      { prop: () => seaweed(0x60c3, 1), x: -6.0, z: 7.2, top: SEAWEED_TOP },
      { prop: () => seaweed(0x60c4, 1.25), x: 8.6, z: 6.2, top: SEAWEED_TOP },
      { prop: () => seaweed(0x60c5, 0.9), x: -2.6, z: -6.6, top: SEAWEED_TOP },
      { prop: () => seaweed(0x60c6, 0.95), x: 3.2, z: -6.6, top: SEAWEED_TOP },
      {
        // x nudged from -6.4 to -5.4 (issue #281) — sat squarely inside the
        // new bathroom doorway's clearance zone, which reaches from the
        // wall at x = -7.6 out to -6.36 (`check:hotel` found this: prop at
        // local (-6.4, 3.6), fully inside).
        prop: () => crystalPlanter(0x60c7, PALETTE.waterFoam, [PALETTE.markerMint, PALETTE.bubbleSkin, PALETTE.waterTop]),
        x: -5.4,
        z: 3.6,
        top: PLANTER_TOP,
      },
      {
        prop: () => crystalPlanter(0x60c8, PALETTE.waterFoam, [PALETTE.bubbleSkin, PALETTE.markerSky, PALETTE.waterTop]),
        x: 6.4,
        z: 3.6,
        top: PLANTER_TOP,
      },
    ]);

    // Somewhere to sit and watch the fish, in the room's own mint.
    this.props.place(shell, room, sofa(2.8, room.theme.accent, PALETTE.blossomWhite), {
      x: 0,
      z: 5.4,
      halfX: 1.4,
      halfZ: 0.48,
      top: SOFA_SEAT_TOP,
    });
    // Tier 1: the mat lies on the sandy sea bed, not beside it.
    const mat = roundRug(2.2, PALETTE.markerSky, PALETTE.bubbleSkin, 1);
    mat.position.set(0, 0, 3.4);
    shell.add(mat);

    this.hangOnWalls(shell, room, {
      north: [],
      west: [-1.8, 1.8],
      pictures: [],
    });
    this.paintArrow(shell, 4.6, 0, -room.halfX + 2.5, 0);

    // The bathroom (issue #272, own-room rewrite issue #281) — against the
    // (grown) west wall, above the lift gap (z ±1.6, cleared by 0.4 m — see
    // `layout.ts`). Now a real four-sided room: the north wall shifted from
    // the old nook's z = 1.6 to 2.0 to clear the lift gap, the south wall
    // pushed on to z = 6.8 (see `layout.ts` — there was room to spare before
    // `halfZ`), and a third wall on the east (previously open) side carries
    // the door.
    //
    // The doorway's clearance zone (reach 1.24 m from x = −7.6) eats into
    // the room along X, so the fixtures sit west of x = −8.84. The pan sits
    // near the room's south end, far from *two* neighbours at once: the
    // lift alcove's own boarding band to the north (`hotelDoorBands`,
    // reaching to z ≈ 2.6) and this room's own doorway band, centred on the
    // door at z = 4.0 — `check:tap-spacing` ruled out every more central
    // position. It sits a full body's width off the south wall (z = 6.8),
    // not flush against it — `check:hotel` found the wall's own face
    // shoving a standing child sideways at the position tried first. The
    // stand spot sits north-east of the pan rather than level with it —
    // `check:hotel` found a level stand spot inside the west wall's own
    // rounded end-cap (`CollisionWorld.addWall`'s half-thickness capsule
    // reaches past a wall segment's literal endpoint), the same class of
    // bug the breakfast room's stand spot hit.
    const rect = clearFloorAround(room, -9.7, 3.5);
    // Tighter still than the lobby/garden nooks' 0.9 m — this nook has both
    // the lift alcove *and* its own doorway for neighbours.
    this.buildBathroomFixtures(shell, room, rect, -10.1, 5.6, -9.0, 4.8, -9.8, 2.9, Math.PI / 2, 0.6);
  }

  private dressSuite(): void {
    const shell = this.roomShell(SUITE);

    // Rainbow bands round the walls — "the room is rainbow coloured, only
    // for the top room" — six stripes, the game's own rainbow.
    //
    // `ART.rainbow`, not six hand-typed hexes: they were six near-copies of
    // it, and ART_DIRECTION §5's rule against a second definition of a colour
    // the game already names is exactly the "two definitions kept in step by
    // hand" trap CLAUDE.md opens with. The rug and the blankets below take the
    // same six, so the suite is one rainbow rather than three.
    // **The north run is broken around the windows.** The bands span y 0.43 to
    // 2.87 and the suite's three north panes sit at 1.5–2.6, so an unbroken
    // run would paint the rainbow straight across the glass — the stripes are
    // `decal`s 5 cm proud of a pane that is itself 5 cm proud of the wall, so
    // it would genuinely be a rainbow drawn over a window rather than a
    // z-fight. Threading them through the wall's clear spans keeps both, which
    // is the whole reason the panes are declared as data: the spans below are
    // worked out from `SUITE.windows` rather than typed out beside it, so
    // moving a window moves the gaps in the rainbow.
    const panes = SUITE.windows.north;
    const clearSpans: [number, number][] = [];
    if (panes) {
      let cursor = -SUITE.halfX + 0.15;
      for (const at of [...panes.at].sort((a, b) => a - b)) {
        clearSpans.push([cursor, at - panes.width / 2 - 0.15]);
        cursor = at + panes.width / 2 + 0.15;
      }
      clearSpans.push([cursor, SUITE.halfX - 0.15]);
    } else {
      clearSpans.push([-SUITE.halfX + 0.15, SUITE.halfX - 0.15]);
    }

    ART.rainbow.forEach((colour, index) => {
      const y = 0.6 + index * 0.42;
      const material = toonMaterial(colour);
      // North, in the clear spans only.
      for (const [a, b] of clearSpans) {
        if (b - a < 0.3) continue;
        const stripe = decal(new Mesh(new BoxGeometry(b - a, 0.34, 0.12), material));
        stripe.position.set((a + b) / 2, y, -SUITE.halfZ + 0.4);
        shell.add(stripe);
      }
      // South and east, which have no windows and run unbroken.
      for (const [w, d, x, z] of [
        [SUITE.halfX * 2 - 0.3, 0.12, 0, SUITE.halfZ - 0.4],
        [0.12, SUITE.halfZ * 2 - 0.3, SUITE.halfX - 0.4, 0],
      ] as const) {
        const stripe = decal(new Mesh(new BoxGeometry(w, 0.34, d), material));
        stripe.position.set(x, y, z);
        shell.add(stripe);
      }
    });

    // **One bed per bedroom now.** The suite is four rooms (Jim, 7 August
    // 2026), so the three beds that used to stand in a row along one wall get
    // a room each — which is what makes "which is my bed" a question with a
    // door on the answer. Each still keeps its own rainbow band, and the
    // jumpy-jumpy platform on top is unchanged.
    //
    // The positions live in `layout.ts` because `check:hotel` needs them too;
    // it used to keep its own copy and all three went stale the day the suite
    // was split.
    const spots = SUITE_BED_SPOTS;
    spots.forEach(([x, z], index) => {
      const bed = createHotelBed();
      repaintPart(bed.root, 'bed-blanket', ART.rainbow[index * 2] ?? PALETTE.markerMint);
      // **Soft on purpose.** A bed is a `WalkSurfaces` platform — Eleri's
      // "sleep, or go jumpy jumpy!" — and `Collision`'s height rule is fed
      // the player's height above *the sampler's* ground, which is 0 when she
      // is stood on the mattress. A wall round its edge would therefore shove
      // her straight back off the thing she climbed onto. See `place.ts`'s
      // header: anything you can stand on is placed soft.
      this.props.place(shell, SUITE, bed.root, {
        x,
        z,
        halfX: 0.7,
        halfZ: 1,
        top: BED_MATTRESS_TOP,
        solid: false,
      });
      const id = `bed-${index}`;
      // The tucked blanket she naps under, in the bed's own rainbow, hidden
      // until `nap` shows it — built here so a bed and its blanket can never
      // drift apart.
      const blanket = napBlanket(ART.rainbow[index * 2] ?? PALETTE.markerMint);
      blanket.position.set(x, 0, z);
      blanket.visible = false;
      shell.add(blanket);
      this.beds.push({ x: SUITE.originX + x, z: SUITE.originZ + z, id, blanket });
      this.surfaces.addPlatform(
        new Plate(
          BED_MATTRESS_TOP,
          SUITE.originX + x - 0.7,
          SUITE.originX + x + 0.7,
          SUITE.originZ + z - 1,
          SUITE.originZ + z + 1,
        ),
      );
    });

    // A bedside table and its little crystal lamp beside each bed. The lamp
    // is the top, and a lamp is not a floor.
    for (const x of SUITE_BEDSIDE_X) {
      this.props.place(shell, SUITE, bedsideTable(), {
        x,
        z: SUITE_BEDSIDE_Z,
        radius: 0.36,
        top: 1.0,
        stand: false,
      });
    }

    // **The pet's four-poster**, in the middle bedroom, with the pet lying in
    // it — Eleri's own brief for the bed, and Jim's for who is in it. See
    // `dressPetBed`.
    this.dressPetBed(shell);

    // The rainbow rug, in the hall between the bedrooms and the lounge, under
    // the disco ball — which is where a child actually stands when the ball is
    // spinning, and now also the first floor she steps onto through her door.
    //
    // **Sized from the hall it lies in, never by hand.** It used to be a
    // hand-sized 2.6 m radius in a hall whose clear half-width is 1.5 m, so
    // it ran a metre under both partitions and surfaced in the rooms beyond
    // — Jim: *"The rainbow rug goes under the walls."* `clearFloorAround`
    // owns the answer now; the ring keeps its old proportions (cream core
    // 0.8 : band 0.3) at whatever radius the hall actually has.
    const HALL_RUG_X = -3.4;
    const hall = clearFloorAround(SUITE, HALL_RUG_X, 0);
    const hallRadius =
      Math.min(HALL_RUG_X - hall.minX, hall.maxX - HALL_RUG_X, -hall.minZ, hall.maxZ) -
      RUG_CLEARANCE;
    const mat = rainbowRug(hallRadius * (0.8 / 2.6), hallRadius * (0.3 / 2.6));
    mat.position.set(HALL_RUG_X, 0, 0);
    shell.add(mat);

    this.dressLounge(shell);
    this.dressBathroom(shell);

    const suiteCrystals: readonly number[] = [
      PALETTE.markerPink,
      PALETTE.markerLilac,
      PALETTE.markerMint,
      PALETTE.markerSky,
    ];
    this.placeProps(shell, SUITE, [
      { prop: () => crystalCluster(0x40b1, 1, suiteCrystals), x: -9.6, z: -7, top: CLUSTER_TOP },
      { prop: () => crystalCluster(0x40b2, 1, suiteCrystals), x: 9.8, z: -7, top: CLUSTER_TOP },
      { prop: () => crystalPlanter(0x40b3, PALETTE.markerPink, suiteCrystals), x: -9.6, z: 6.6, top: PLANTER_TOP },
    ]);
    this.hangOnWalls(shell, SUITE, {
      // Threaded between the three north windows, one per bedroom.
      north: [-3.6, 3.6],
      // The south sconce moved off z = 5.6 when the west pane did (the pane
      // now spans 5.15–6.65 there — see `SUITE.windows`); 3.6 lights the
      // bathroom from beside its own wall junction instead of from on the
      // glass.
      west: [-5.6, 3.6],
      // One west painting, in bedroom 1 — at −4.8 for the corridor doorway's
      // full finger of tap clearance (8 Aug 2026). Its old twin at +4.8 went
      // with the bathroom: that stretch of wall now holds the bathroom's
      // window, and a painting's "Look" zone in there would crowd the
      // bathroom's own tap targets (`world/tapSpacing.ts`).
      pictures: [{ wall: 'west', along: -4.8, width: 1.5, height: 1.15, seed: 0x40c1 }],
    });

    // Over the hall, where all four rooms can see it.
    this.hangDiscoBall(shell, -3.4, SUITE.wallHeight + 0.9, 0);
  }

  /**
   * The pet's four-poster, with the pet asleep in it — Eleri asked for the bed
   * (*"half-human half-cat bed … with a pillow and a blanket and even a toy"*)
   * and Jim asked for it to be **occupied when you walk in**.
   *
   * ## Which pet, and why it is read once
   *
   * Hers, if she has one: the first paradeable pet in the inventory, which is
   * the same thing that walks behind her in the park. Read **once, here**,
   * rather than subscribed to — the hotel's rooms are built at construction
   * and a pet that changed mid-visit would be a pet that pops. If she has no
   * pet yet the bed is not empty either: a bunny is asleep in it, because an
   * empty pet bed in the room of a child who has not been to the pet shop reads
   * as something missing rather than as something to look forward to.
   *
   * ## Lying down, from the asset's own two numbers
   *
   * `PET_BED_CUSHION_TOP` and `PET_BED_CUSHION_RADIUS` are exported for
   * exactly this, and the artist's note asks callers to take them rather than
   * measure the mesh. The pet is tipped onto its side about its own long axis
   * and dropped so it rests on the cushion; the pillow is at −Z, so a pet
   * lying with its head on it faces the camera without being turned.
   */
  private dressPetBed(shell: Group): void {
    // **Where the camera can actually see it** (QA, 7 Aug 2026): the bed used
    // to stand at (2.2, −6.4), which is 1.2 m behind the bedroom partition at
    // x = 3.4 — squarely inside that wall's 1.28·H occlusion band, so Eleri's
    // four-poster and its sleeping pet were invisible in play, canopy ring
    // excepted. The partition at x = 3.4 hides x 0.6…3.4 and the one at
    // x = −4.2 hides −7.0…−4.2; this spot sits in the clear strip between,
    // beside her own bed.
    const PET_BED_X = -2.6;
    const PET_BED_Z = -6.4;
    const bed = createPetBed();
    // Solid and standable, like every other flat-topped prop now — QA found
    // it walk-through, and a pet bed is a cushion, which is a thing a child
    // may absolutely bounce onto.
    this.props.place(shell, SUITE, bed.root, {
      x: PET_BED_X,
      z: PET_BED_Z,
      radius: 0.62,
      top: PET_BED_CUSHION_TOP,
    });

    const pet = createPet(this.paradePetKind());
    // Onto its side, head toward the pillow at −Z. A quarter turn about X lays
    // a standing pet down; the drop is the cushion plus roughly the radius of
    // the body now resting on it.
    pet.root.rotation.set(-Math.PI / 2, 0, 0);
    pet.root.position.set(
      PET_BED_X,
      PET_BED_CUSHION_TOP + PET_BED_CUSHION_RADIUS * 0.72,
      PET_BED_Z - 0.1,
    );
    shell.add(pet.root);
    // Kept so it breathes — a pet that is perfectly still in a bed reads as an
    // ornament of a pet. `setWalkPhase(phase, 0)` is the pets' own idle: no
    // stride, just the body's bob.
    this.sleepingPet = pet;
  }

  /**
   * The kind of pet walking behind her, or a bunny if there is not one yet.
   *
   * **The species is in the catalogue `id`, not in `kind`.** An
   * `InventoryItem`'s `kind` is its *category* — `'pet'`, `'toy'`, `'hat'` —
   * and the species is the second half of ids like `pet.bunny`. So this
   * matches the id's tail against `PET_KINDS`, which means a pet the shop
   * gains tomorrow is recognised here the day it is added, with no table to
   * keep in step. A `toy.ripika` in the parade is deliberately not a match:
   * it is paradeable, but it is a toy and it does not sleep.
   */
  private paradePetKind(): PetKind {
    for (const item of gameStore.get().inventory) {
      if (item.kind !== 'pet' || !item.paradeable || item.stowed) continue;
      const species = item.id.slice(item.id.lastIndexOf('.') + 1);
      const kind = PET_KINDS.find((known) => known === species);
      if (kind) return kind;
    }
    return 'bunny';
  }

  /**
   * The suite's lounge — Jim, 7 August 2026: *"a lounge with sofa,
   * `createHotelTv` facing sofa AND camera, Game Boy on a low table."*
   *
   * ## The one genuinely awkward constraint, and how it resolves
   *
   * A television has to face the sofa *and* the camera, and those are
   * different directions: the camera looks from (+X, +Y, +Z) and the sofa
   * faces whatever it is pointed at. If the telly faces the camera squarely
   * its back is to the sofa; if it faces the sofa squarely you are looking at
   * its back.
   *
   * The answer is that neither has to be square. The sofa sits at the room's
   * **east** end facing −X, the telly stands at the **west** end turned about
   * 40° off that axis — so it faces down the room at the sofa while its screen
   * is still turned toward the lens. A real living room is arranged exactly
   * like this and for exactly this reason: nobody puts a sofa dead square to a
   * television either.
   */
  private dressLounge(shell: Group): void {
    const FLOOR_Z = 4.9;

    // The rug the room is arranged on — wanting 9 × 5, taking whatever the
    // lounge's clear floor (`clearFloorAround`) actually allows, so the
    // bathroom wall arriving at x = −4.2 can never put a wall on the rug.
    const RUG_X = 2.5;
    const lounge = clearFloorAround(SUITE, RUG_X, FLOOR_Z);
    const rugWidth = Math.min(
      9,
      2 * (RUG_X - lounge.minX - RUG_CLEARANCE),
      2 * (lounge.maxX - RUG_X - RUG_CLEARANCE),
    );
    const rugDepth = Math.min(
      5,
      2 * (FLOOR_Z - lounge.minZ - RUG_CLEARANCE),
      2 * (lounge.maxZ - FLOOR_Z - RUG_CLEARANCE),
    );
    const mat = rug(rugWidth, rugDepth, PALETTE.markerLilac, PALETTE.blossomWhite);
    mat.position.set(RUG_X, 0, FLOOR_Z);
    shell.add(mat);

    // The sofa, mid-room on the rug, turned partway between "facing the
    // telly" (−X) and "facing the lens" (+Z) — the same both-at-once
    // compromise the telly itself plays in the other direction (see the
    // method header). A square −90° yaw showed the camera nothing but its
    // back panel (QA, 7 Aug 2026); the east end at x = 8.2 stood it inside
    // the low east wall's sight shadow, where the fixed lens sees only the
    // sliver above the wall top — "a teal sliver, barely recognisable"
    // (QA, 8 Aug 2026). Same rule as the lobby's crystal columns: the
    // camera looks along (−X, −Z), so nothing worth seeing lives close
    // behind a +X or +Z wall.
    //
    // **z = 3.4 used to reach into the hall partition's own doorway** (the
    // north wall of this room is that partition, run 2 of `SUITE.partitions`,
    // whose one door sits at x = 4.4) — `HotelProps.assertDoorwaysClear`
    // (issue #273) caught the sofa's north edge at z = 2.1 sitting inside the
    // door's `PLAYER_RADIUS`-widened clearance zone.
    //
    // **z = 3.9 was the second miss, and the one Jim actually found live**
    // (18 Aug 2026, `/hotel-suite`: *"dumb furniture clearly still in the
    // way … non-functional by any degree"*). It cleared the doorway zone as
    // it stood then by 0.28 m — but that zone only ever reached
    // `PLAYER_RADIUS` past the wall, a band sized to keep the *opening*
    // clear, not to promise any floor beyond it. A 2.6 m-deep sofa parked
    // 0.28 m past that band still put its own front edge across most of the
    // doorway's width, so a body who had just stepped through walked
    // straight into it one stride later — confirmed on the real collision
    // world: `scripts/check-hotel.mts`'s doorway-crossing probe stopped
    // 0.42 m short of clearing this exact doorway. `doorwayClearanceZones`
    // now reaches `DOORWAY_THROUGH_DEPTH` further into the room on top of
    // that band (`layout.ts`).
    //
    // **z = 4.4 was the third miss, and it was never actually clear.** This
    // sofa also carries a `spin` (below), and `place.ts`'s own footprint
    // check used to measure the *unrotated* 2.2×2.6 m box — `place.ts`'s
    // `effectiveHalfExtents` now measures the true, rotated box a −0.9 rad
    // turn sweeps (3.40×3.34 m), which reaches 0.21 m further toward the
    // doorway than the axis-aligned one ever admitted. 4.8 clears the
    // strengthened zone against that honest, rotated footprint by 0.19 m and
    // is still on the rug the sofa sits on.
    this.props.place(shell, SUITE, sofa(3.2, PALETTE.markerSky, PALETTE.blossomWhite), {
      x: 5.6,
      z: 4.8,
      spin: -0.9,
      halfX: 1.1,
      halfZ: 1.3,
      top: SOFA_SEAT_TOP,
    });

    // The telly, at the west end. See this method's header for the angle.
    const tv = createHotelTv();
    paintTvScreen(tv.screen);
    // **Pull the screen proud of the cabinet.** As authored, the screen panel
    // sits ~7 cm behind the cabinet's front face — QA's raycast hit tv-body
    // at 5.33 m before tv-screen at 5.40 m — so the set rendered as a blank
    // wooden box with a perfectly good picture buried inside it. The set is
    // authored facing +Z with nodes at identity, so one local-Z nudge stands
    // the picture 2 cm in front of the wood.
    tv.screen.position.z += 0.09;
    // A hand east of where it stood: the bathroom wall now runs at x = −4.2
    // (face −4.0), and the set's 0.7 m footprint at −3.4 backed 10 cm into
    // it. At −3.0 it backs *against* the wall, which is where a telly goes.
    //
    // **z stands off `FLOOR_Z` by 0.7** — that same bathroom wall carries its
    // own doorway at z = 2.9 (`SUITE.partitions`'s z-run at x = −4.2), and
    // `HotelProps.assertDoorwaysClear` (issue #273) measured the set's
    // 0.7 m radius at `FLOOR_Z` reaching 0.093 m into that door's old,
    // wall-hugging clearance zone. Widening that zone's *depth*
    // (`DOORWAY_THROUGH_DEPTH`, the 18 Aug 2026 fix alongside the sofa's
    // above) pushed the set's own margin to −0.12 m — its footprint was
    // already fully inside the zone's through-wall span, only barely outside
    // the along-wall one, so a deeper zone reached it from the corner.
    // `FLOOR_Z + 0.7` clears the strengthened zone by 0.18 m and keeps the
    // set backed against the same stretch of wall, just further from the
    // doorway along it.
    this.props.place(shell, SUITE, tv.root, {
      x: -3.0,
      z: FLOOR_Z + 0.7,
      spin: Math.PI / 2 - 0.7,
      radius: 0.7,
      top: tv.height,
      stand: false,
    });

    // The low table between them, with the Game Boy on it.
    const table = createBreakfastTable();
    this.props.place(shell, SUITE, table.root, { x: 3.4, z: FLOOR_Z, radius: 0.6, top: TABLE_TOP });
    const gameBoy = createGameBoy();
    paintGameBoyScreen(gameBoy.screen);
    gameBoy.root.position.set(3.4, 0.74, FLOOR_Z);
    // Turned to face the camera, since it is a 12 cm object seen from ten
    // metres up: square to the lens is the only angle it reads at.
    gameBoy.root.rotation.y = 0.5;
    shell.add(gameBoy.root);

    // A planter in the corner and a picture over the sofa, so the lounge is
    // dressed to the same standard as the rest of the hotel.
    this.props.place(shell, SUITE, crystalPlanter(0x41a1, PALETTE.markerPink), {
      x: 9.8,
      z: 7.2,
      radius: 0.6,
      top: PLANTER_TOP,
      stand: false,
    });
  }

  /**
   * The one place a room's own geometry is wired to the castle's toilet code
   * — issue #272: *"every floor needs a bathroom with a toilet, reusing the
   * castle's toilet code."*
   *
   * The models ARE the castle's: `buildPan`, `buildBasin` and
   * `buildPrivacyRoof` are imported from `building/Toilets.ts`, and the rules
   * ride along in the shared `ToiletRoutine` — walk in and the roof slides
   * over you (on before you are out of sight); use it and the flush plays,
   * then the tap while you wash (*"good manners are part of the game"*); the
   * wash beat lifts the roof, and stepping out always clears everything, so
   * it can never trap her. The one thing the castle's room could not have is
   * the one thing every room here adds: **real solidity** — the castle's
   * collision is height-blind across decks so its toilet room is open
   * geometry, while the hotel's fixtures go through `place.ts` like every
   * other prop, solid and (the pan) mountable.
   *
   * Every caller hands this the room, the rectangle its own walls (real
   * ones, or `layout.ts` partition data) already enclose, and where the two
   * fittings should stand inside it — the walls own the room, the fittings
   * follow. `standX`/`standZ` is the one thing worth choosing with care: it
   * must sit on the nook's own open (doorless) side, or the "Use" chip walks
   * her into a wall instead of the pan.
   *
   * `pickRadius` defaults to the suite's own 1.8 m; the floor nooks — built
   * into corners of rooms that already have chairs and a lift alcove nearby
   * — pass a tighter one where `check:tap-spacing` measures theirs crowding
   * a neighbour (a full finger, `TAP_FINGER_METRES`, is the rule; a smaller
   * pick area is the one knob this call has to buy that back without moving
   * the neighbour).
   */
  private buildBathroomFixtures(
    shell: Group,
    room: HotelRoom,
    rect: ClearRect,
    panX: number,
    panZ: number,
    standX: number,
    standZ: number,
    basinX: number,
    basinZ: number,
    basinYaw = 0,
    pickRadius = 1.8,
  ): void {
    const centreX = (rect.minX + rect.maxX) / 2;
    const centreZ = (rect.minZ + rect.maxZ) / 2;

    // Shiny tiles wall to wall — the castle's "a different sort of place the
    // moment you catch sight of it" — as the bottom rung of the rug ladder,
    // fitted to the clear floor like every rug now is, with a soft mat on the
    // tier above.
    const tiles = rug(
      rect.maxX - rect.minX - 2 * RUG_CLEARANCE,
      rect.maxZ - rect.minZ - 2 * RUG_CLEARANCE,
      PALETTE.glassTint,
      PALETTE.blossomWhite,
    );
    tiles.position.set(centreX, 0, centreZ);
    shell.add(tiles);
    // A mat under the pan, sized to whatever clear floor actually surrounds
    // *where the pan stands* — the suite's own bathroom has room for the
    // full 2.0 × 1.6; the smaller floor nooks take whatever is left. Measured
    // from the pan's own position rather than the rect's total size: the pan
    // is rarely centred in its nook, and a mat sized only off the rect's
    // extent can reach past the nearer wall on one side even while fitting
    // the rect's average easily (check:hotel found exactly this — a rug
    // "reaching under a wall").
    const matWidth = Math.min(2.0, 2 * Math.min(panX - rect.minX, rect.maxX - panX) - 0.2);
    const matDepth = Math.min(1.6, 2 * Math.min(panZ - rect.minZ, rect.maxZ - panZ) - 0.2);
    const bathMat = rug(matWidth, matDepth, PALETTE.markerMint, PALETTE.blossomWhite, 1);
    bathMat.position.set(panX, 0, panZ);
    shell.add(bathMat);
    const pan = buildPan(0, 0);
    this.props.place(shell, room, pan.group, { x: panX, z: panZ, radius: 0.45, top: 0.7 });
    const basin = buildBasin(0, 0);
    this.props.place(shell, room, basin.group, {
      x: basinX,
      z: basinZ,
      spin: basinYaw,
      radius: 0.4,
      top: 1.0,
      stand: false,
    });

    const roof = buildPrivacyRoof(
      centreX,
      centreZ,
      rect.maxX - rect.minX,
      rect.maxZ - rect.minZ,
    );
    shell.add(roof.group);

    this.bathrooms.set(room, {
      routine: new ToiletRoutine(pan, basin, roof),
      rect,
      panX,
      panZ,
      basinX,
      basinZ,
      standX,
      standZ,
      pickRadius,
    });
  }

  /**
   * The suite's bathroom — Jim, 8 Aug 2026: *"Add a bathroom using the models
   * and rules from the bathroom in the other big building."* The room itself
   * is partition data in `layout.ts` (the z-run at x = −4.2 across the south
   * half, doorway off the hall at −7.6); `clearFloorAround` turns that into
   * the rectangle below, so the walls own the room and the fittings follow.
   */
  private dressBathroom(shell: Group): void {
    // Any interior point of the bathroom yields its whole clear floor.
    const rect = clearFloorAround(SUITE, -7.6, 4.8);
    // The pan stands mid-room on its own mat, facing the lens, because the
    // walls this room got are exactly the ones a prop cannot stand against:
    // the east partition hides 2.8 m of floor behind it (2.2 m of wall at the
    // 38° pitch — watched in the browser: a pan by the doorway was simply
    // absent from the frame), the hall wall's west end belongs to the basin,
    // and the west wall is owned by the corridor door's tap band and the
    // pane. Mid-room is also honestly where a child can walk all round it,
    // which is what the mat says. The exact spot keeps the zone's pick area
    // a full finger clear of the bathroom doorway's own band — measured by
    // check:tap-spacing, found the hard way by a phone tap in the doorway
    // selecting the pan instead of walking through. The basin stands west of
    // the doorway, its mirror against the hall wall.
    this.buildBathroomFixtures(
      shell,
      SUITE,
      rect,
      -7.8,
      4.6,
      -7.8,
      4.6 - 1.1,
      rect.minX + 1.1,
      rect.minZ + 0.55,
    );
  }

  /**
   * Whether the player is standing in `room`'s bathroom, by the castle's own
   * generous-margin rule ({@link TOILET_APPROACH} — the roof has to lead
   * her). Only meaningful while she is actually in `room`; {@link update}
   * checks that first.
   */
  private bathroomOccupied(room: HotelRoom, bathroom: Bathroom): boolean {
    const player = this.player;
    if (!player || !this.inside) return false;
    const x = player.position.x - room.originX;
    const z = player.position.z - room.originZ;
    return (
      x >= bathroom.rect.minX - TOILET_APPROACH &&
      x <= bathroom.rect.maxX + TOILET_APPROACH &&
      z >= bathroom.rect.minZ - TOILET_APPROACH &&
      z <= bathroom.rect.maxZ + TOILET_APPROACH
    );
  }

  /**
   * What stands **on** the landing and the gallery — the artist's balustrade,
   * newels and nosing, and the furniture that makes the gallery worth the
   * climb. The rails' *physics* are `buildMezzanine`'s banded colliders;
   * these are their portrait, tiled at exactly `BRIDGE_RAIL_TILE` so the
   * baluster rhythm runs unbroken across every join. The artist's schedule,
   * followed to the tile:
   *
   * - landing front: **6 tiles**, no newels — the curves' own top newels are
   *   the run's ends;
   * - landing sides: **5 tiles** each, a newel at each end;
   * - gallery front: **11 tiles** each side of a 4.06 m gap for the straight
   *   flight, a newel each side of the gap, the last tile buried a quarter
   *   metre in the side wall — overlapping solids, never a part-tile, which
   *   is the one thing the tile cannot do.
   *
   * Everything rail-like drops by `STAIR_SINK` with the flights, so the
   * bridge rail keeps meeting the stair's handrail where it eases level.
   */
  private dressMezzanine(shell: Group): void {
    const plan = LOBBY.mezzanine;
    if (!plan) return;
    // Everything this method makes stands at 3.84 m or 5.44 m — rails,
    // newels, nosings, the gallery's own seating — so it all belongs to the
    // mass that can hide a child underneath, and all of it ghosts together.
    const overhang = this.lobbyOverhang ?? shell;
    const { maxX, minZ, maxZ, height, landing, straight } = plan;
    const tile = BRIDGE_RAIL_TILE;
    // Set in from the edge by half the rail's depth, so the plinth's outer
    // face lands exactly on the edge line — the artist's placing recipe.
    const railInset = 0.115;
    const landingRailY = landing.height + STAIR_SINK;
    const deckRailY = height + STAIR_SINK;

    const addRail = (x: number, z: number, yaw: number, y: number): void => {
      const segment = createBridgeRailing();
      segment.root.position.set(x, y, z);
      segment.root.rotation.y = yaw;
      overhang.add(segment.root);
    };
    const addNewel = (x: number, z: number, y: number): void => {
      const post = createBridgeNewel();
      post.root.position.set(x, y, z);
      overhang.add(post.root);
    };
    const addNose = (x: number, z: number, yaw: number, y: number): void => {
      const nose = createLandingNosing();
      nose.root.position.set(x, y, z);
      nose.root.rotation.y = yaw;
      overhang.add(nose.root);
    };

    // --- the landing's front: six tiles between the curves' top newels ------
    const frontHalf = Math.abs(plan.stairs[0]?.centreX ?? 0) - STAIR_RAIL_RADIUS;
    const frontTiles = Math.round((frontHalf * 2) / tile);
    for (let i = 0; i < frontTiles; i += 1) {
      addRail(-frontHalf + (i + 0.5) * tile, landing.maxZ - railInset, 0, landingRailY);
    }
    // The nosing finishes the whole front edge — nine tiles centred, their
    // ends tucked into the curves' string laps. Origin on the edge line,
    // overhang toward the face a child below looks up at.
    const noseTiles = Math.floor((landing.maxX - landing.minX) / tile);
    for (let i = 0; i < noseTiles; i += 1) {
      addNose((i - (noseTiles - 1) / 2) * tile, landing.maxZ, 0, landingRailY);
    }

    // --- the landing's sides: five tiles and a newel each end ---------------
    const sideTiles = Math.round((landing.maxZ - landing.minZ) / tile);
    for (const side of [-1, 1] as const) {
      const railX = side * (landing.maxX - railInset);
      // rotation.y maps the authored +Z face to ±X — outward, over the edge.
      const yaw = (side * Math.PI) / 2;
      for (let i = 0; i < sideTiles; i += 1) {
        addRail(railX, landing.minZ + (i + 0.5) * tile, yaw, landingRailY);
        addNose(side * landing.maxX, landing.minZ + (i + 0.5) * tile, yaw, landingRailY);
      }
      addNewel(railX, landing.minZ, landingRailY);
      addNewel(railX, landing.maxZ, landingRailY);
    }

    // --- the gallery front: tiles from the flight's gap out to the walls ----
    // Eleven per side: ten whole tiles reach 0.77 m short of the wall, and a
    // gap at a rail's end is a place to fall through, so the eleventh runs
    // its surplus quarter-metre *into* the wall's own solid box.
    const gapX = straight.centreX + straight.flankX + 0.02;
    const deckEdgeTiles = Math.ceil((maxX - gapX) / tile);
    for (const side of [-1, 1] as const) {
      const start = side * gapX;
      for (let i = 0; i < deckEdgeTiles; i += 1) {
        addRail(start + side * (i + 0.5) * tile, maxZ - railInset, 0, deckRailY);
        addNose(start + side * (i + 0.5) * tile, maxZ, 0, deckRailY);
      }
      addNewel(start, maxZ - railInset, deckRailY);
    }

    // --- the seating nooks, one each end of the gallery ---------------------
    // Mirrored, because the whole composition below is; both face +Z, out
    // over the balustrade at the statue and the disco ball — the view is the
    // reason to climb, and it is now two flights up instead of one.
    //
    // **Every z here carries `-LOBBY_FOYER_GROWTH`**, same as the rest of the
    // hall/mezzanine composition — these were the one part of it missed when
    // that shift went in: they're hardcoded literals, not derived from
    // `plan`, so they stayed put while the gallery/landing box moved out from
    // under them. That left this whole seating nook floating 7 m south of the
    // deck it used to sit on — no longer over the (now-relocated) landing at
    // all, but hanging in open air above the main lobby floor, where
    // `mezzanineHidesPoint`'s box no longer reaches it. Found by check:hotel
    // probe 25: ground-floor spots the sofa/rug now occluded with nothing
    // fading them.
    for (const side of [-1, 1] as const) {
      const nookX = side * 8.4;
      // Radius fitted to the deck's own clear depth: the north wall's face is
      // at −19.15 (was −12.15 before `LOBBY_FOYER_GROWTH`), and a 1.9 m rug
      // at this centre reached 0.15 m under it — found by probe 19 on the
      // first build of this gallery.
      const nook = roundRug(1.7, LOBBY.theme.accent, PALETTE.stonePinkLight);
      nook.position.set(nookX, height + 0.01, -10.4 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT);
      overhang.add(nook);
      for (const [x, colour] of [
        [nookX - side * 1.2, PALETTE.markerLilac],
        [nookX + side * 1.3, PALETTE.markerPink],
      ] as const) {
        this.props.place(overhang, LOBBY, sofa(2.3, colour, PALETTE.blossomWhite), {
          x,
          y: height,
          z: -10.9 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
          halfX: 1.15,
          halfZ: 0.48,
          base: height,
          top: SOFA_SEAT_TOP,
        });
      }
      this.props.place(overhang, LOBBY, bedsideTable(), {
        x: nookX,
        y: height,
        z: -9.4 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
        radius: 0.36,
        base: height,
        top: 1.0,
        stand: false,
      });
    }

    // Planters bookending the gallery, and a pair on the landing's back
    // corners so the stage a child arrives on is dressed without being
    // cluttered — its middle stays clear for the walk to the grand flight.
    // z carries `-LOBBY_FOYER_GROWTH` with the rest of the hall (see the
    // seating-nook comment above — same bug, same fix).
    for (const [x, z, base, seed] of [
      [-11.8, -8.8 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT, height, 0x11a1],
      [11.8, -8.8 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT, height, 0x11a2],
      [-4.1, -7.0 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT, landing.height, 0x11a3],
      [4.1, -7.0 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT, landing.height, 0x11a4],
    ] as const) {
      this.props.place(overhang, LOBBY, crystalPlanter(seed), {
        x,
        y: base,
        z,
        radius: 0.6,
        base,
        top: PLANTER_TOP,
        stand: false,
      });
    }

    // Sconces on the north wall above the deck — the one wall up here, and
    // otherwise three metres of blank paint under the clerestory. Spaced
    // between the panes, never across them.
    for (const x of [-8.4, -3.6, 1.6, 6.4]) {
      const light = sconce(LOBBY.theme.glow);
      light.position.set(x, height + 1.85, minZ + 0.28);
      overhang.add(light);
    }
  }

  // ------------------------------------------------------ dressing helpers

  /**
   * The mosaic plate — Jim's *"an interesting and playful mosaic on the tiles
   * of the floor"*, laid over the room's own floor slab rather than replacing
   * it.
   *
   * A separate `decal` plate, not a map on the slab's material, for two
   * reasons: the slab is a `BoxGeometry` whose UVs run over all six faces, and
   * the plate stops 0.3 m short of every wall so the floor's own themed colour
   * survives as a border. One canvas per 4 m, which puts a tile at ~0.5 m —
   * chunky enough to survive being toon-banded (see `mosaicTexture`).
   */
  private layMosaic(shell: Group, room: HotelRoom): void {
    const width = room.halfX * 2 - 0.6;
    const depth = room.halfZ * 2 - 0.6;
    const METRES_PER_CANVAS = 4;
    const plate = decal(
      new Mesh(
        new PlaneGeometry(width, depth),
        toonMaterial(PALETTE.blossomWhite, {
          map: mosaicTexture(width / METRES_PER_CANVAS, depth / METRES_PER_CANVAS),
          // The same cosy lift `interiorMaterial` gives every other interior
          // surface, in the grout's own colour — a white emissive would wash
          // the tile colours out to pastel mush after dark.
          emissive: PALETTE.stonePinkLight,
          emissiveIntensity: 0.14,
        }),
      ),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = DECAL_STEP;
    shell.add(plate);
  }

  /** Bowls laid the length of a buffet counter, cycling the three breakfasts. */
  private layBuffet(shell: Group, x: number, z: number, length: number): void {
    const rng = new Rng(0x21b0f);
    const count = 9;
    for (let i = 0; i < count; i += 1) {
      const food = BREAKFASTS[i % BREAKFASTS.length];
      if (!food) continue;
      const bowl = createBreakfastBowl(food.kind);
      bowl.root.position.set(
        x - length / 2 + 0.9 + (i / (count - 1)) * (length - 1.8),
        BUFFET_TOP,
        z + rng.range(-0.1, 0.2),
      );
      shell.add(bowl.root);
    }
    // The bowls need no footprint of their own: they stand on the counter,
    // whose own footprint (registered where it was placed) is already between
    // them and anybody who could reach them.
  }

  /**
   * Stands a list of small round props on the floor.
   *
   * A thin wrapper over {@link HotelProps.place} for the case that repeats —
   * a scatter of crystals, all round, all on the floor. The default radius is
   * a crystal cluster's own spread; anything with a different shape is placed
   * directly instead, so the call site shows what shape it is.
   */
  private placeProps(
    shell: Group,
    room: HotelRoom,
    items: readonly { prop: () => Group; x: number; z: number; radius?: number; top: number }[],
  ): void {
    for (const item of items) {
      this.props.place(shell, room, item.prop(), {
        x: item.x,
        z: item.z,
        radius: item.radius ?? 0.6,
        top: item.top,
        // The scatter props are crystals, seaweed and tufts: real heights,
        // never floors, so none of them offers a landing plate.
        stand: false,
      });
    }
  }

  /**
   * Sconces and pictures, on the two walls the camera can actually see.
   *
   * The camera sits at focus + (+X, +Y, +Z), so it looks at the **inside faces
   * of the north (−Z) and west (−X) walls** and at the *outside* of the other
   * two — anything hung on the south or east wall is a prop nobody will ever
   * see. That is why this helper only offers those two.
   */
  private hangOnWalls(shell: Group, room: HotelRoom, plan: WallPlan): void {
    const SCONCE_Y = 1.85;
    for (const x of plan.north ?? []) {
      const light = sconce(room.theme.glow);
      light.position.set(x, SCONCE_Y, -room.halfZ + 0.28);
      shell.add(light);
    }
    for (const z of plan.west ?? []) {
      const light = sconce(room.theme.glow);
      light.position.set(-room.halfX + 0.28, SCONCE_Y, z);
      light.rotation.y = Math.PI / 2;
      shell.add(light);
    }
    // **Real paintings now, and each one is something to walk up to.**
    //
    // Jim, 7 August 2026: he wanted actual artwork rather than the abstract
    // shapes `picture` composes. `paintedPicture` hangs one of five shared
    // canvases (see `dressing.ts` — five, because §7's texture budget is forty
    // for the whole game and this round has already spent three), and every
    // frame also registers itself as somewhere she can stand and look.
    //
    // The frame's own `seed` picks which of the five it gets, so the choice is
    // stable across reloads and spread across the hotel without anybody having
    // to allocate them by hand.
    (plan.pictures ?? []).forEach((frame, index) => {
      const art = frame.seed % ARTWORK_COUNT;
      // **Never across the glass.** Jim, live play, 7 Aug 2026: *"some
      // paintings overlap the windows and clip into them."* The declared
      // spot is only a wish: the same glazed-span authority `glazeWall`
      // builds the panes from decides whether a picture may hang there, and
      // slides it along the wall to the nearest clear stretch when not —
      // so moving a window can never quietly re-cover a painting.
      // `check:hotel` probe 12 measures the built frames against the built
      // panes.
      const along = clearOfGlass(room, frame.wall, frame.along, frame.width, frame.height);
      if (along === null) {
        console.warn(
          `hotel: no clear wall for the ${room.space} ${frame.wall} picture at ${frame.along} — dropped`,
        );
        return;
      }
      const painting = paintedPicture(frame.width, frame.height, art);
      // The way the picture faces, which is also the way the camera has to
      // come at it. North-wall pictures face +Z; west-wall ones face +X.
      const normalX = frame.wall === 'north' ? 0 : 1;
      const normalZ = frame.wall === 'north' ? 1 : 0;
      if (frame.wall === 'north') {
        painting.position.set(along, PICTURE_Y, -room.halfZ + PICTURE_WALL_INSET);
      } else {
        painting.position.set(-room.halfX + PICTURE_WALL_INSET, PICTURE_Y, along);
        painting.rotation.y = Math.PI / 2;
      }
      shell.add(painting);
      this.artworks.push({
        id: `${room.space}-${index}`,
        art,
        x: room.originX + painting.position.x,
        y: PICTURE_Y,
        z: room.originZ + painting.position.z,
        normalX,
        normalZ,
        room,
      });
    });
  }

  /**
   * Standing back to look at a painting properly — Jim's *"Look!"*.
   *
   * The same `hotel/cinematic.ts` shot the food moment and the window views
   * use, which is why this is nine lines: come off the wall along the
   * picture's own normal, frame the **whole** canvas (see
   * {@link ART_VIEW_DISTANCE} for the distance/lens pair), hold until she
   * presses something.
   */
  private lookAtArt(art: (typeof this.artworks)[number]): void {
    const player = this.player;
    if (!player || player.riding) return;
    this.controls.cancelWalk();
    player.beginRide();
    player.setRidePose(
      art.x + art.normalX * 1.9,
      0,
      art.z + art.normalZ * 1.9,
      Math.atan2(-art.normalX, -art.normalZ),
    );
    this.moment = 'art';
    // The camera is her eyes for this moment, so the body steps out of the
    // frame entirely. The lens ends 0.3 m in front of where her face is
    // posed — inside the hair shell, a screenful of colour bands (QA, on
    // all three paintings tested) — and no offset that keeps the canvas
    // square-on can also miss a head posed on the canvas's own normal.
    player.group.visible = false;
    this.cine.play(this.artShotFor(art), () => {
      this.moment = null;
      player.group.visible = true;
      player.endRide();
    });
  }

  /**
   * **"Look outside!"** — Jim, 7 August 2026.
   *
   * Every room in this hotel is six hundred metres from the tower it is
   * supposedly inside, so a window cannot simply be transparent: the view has
   * to be *fetched*. The camera goes to the tower's **real position in the
   * park**, at the height this storey would be on its 28 m spire, and looks at
   * the fountain — so Floor 50's window really is higher than Floor 1's, and
   * both are looking at the park a child has actually walked around.
   *
   * ## What has to be true while it is out there, and what does not
   *
   * - **The hotel's own rooms are hidden.** They sit 600 m out — past
   *   `FOG_FAR` (258 m), so they would in fact be fogged to invisibility — but
   *   "invisible because it is far away" is the accident the ferris wheel
   *   found out the hard way when it pushed the fog out and the castle's
   *   insides appeared floating in the middle distance. Hidden outright is a
   *   fact rather than a coincidence.
   * - **The park has to be lit.** `DayNight` switches the sun, the fill and
   *   the ambient off while the player is indoors, so a view of the park taken
   *   from inside would be a view of an unlit park. `playerIsInside` reports
   *   false for the duration — see its own doc comment.
   * - **The fog does not need touching**, and deliberately is not. The whole
   *   park is about 110 m across and `FOG_NEAR` is 132 m, so nothing in this
   *   shot ever reaches the fog at all. The ferris wheel's `setSpaceFactor`
   *   would have brought the stars out over an afternoon.
   */
  private lookOutside(room: HotelRoom): void {
    const player = this.player;
    if (!player || player.riding) return;
    const eye = this.windowVantage(room);

    this.controls.cancelWalk();
    player.beginRide();
    this.moment = 'window';

    // Behind the soft fade, both ways — the camera is jumping four hundred
    // metres and an ease would be a flight over the void between the spaces.
    this.controls.iris(() => {
      this.hotelRoot.visible = false;
      this.cine.play(
        {
          from: eye,
          to: eye,
          lookAt: new Vector3(PLAZA.x, 2, PLAZA.z),
          easeSeconds: 0,
          holdSeconds: null,
          // A slow orbit of the fountain, so the park moves and it reads as a
          // view rather than a photograph.
          drift: 0.045,
          fov: 46,
        },
        () => {
          this.moment = null;
          this.hotelRoot.visible = this.inside;
          player.endRide();
        },
      );
    });
  }

  private roomShell(room: HotelRoom): Group {
    const name = `hotel:${room.space}`;
    const shell = this.hotelRoot.children.find((child) => child.name === name);
    if (!shell) throw new Error(`hotel: no shell built for ${room.space}`);
    return shell as Group;
  }

  /**
   * Hangs a disco ball, and — if asked — makes it actually light the room.
   *
   * Jim, 7 August 2026: the lobby's ball should be *"3x size"* and *"should
   * actually project light around the room"*. A mirror ball that only spins is
   * a spinning ornament; what a child is looking for is the beams going round
   * the walls, and there is no way to fake that with an emissive.
   *
   * So the lit version parents {@link DISCO_BEAMS} narrow `SpotLight`s to the
   * **rotating group itself**: they inherit the spin for free, at no per-frame
   * cost, and their cones sweep the room the way the real thing does. Each one
   * needs its target in the graph too — a three.js spot light points at an
   * `Object3D`, not at a direction — and both go under `spin`, so the pair
   * cannot fall out of step.
   *
   * **They are switched off unless she is in the room.** The park's own point
   * lights are already the biggest lighting cost it has (ORDER-OF-WORK's note:
   * fourteen of them, and the ferris wheel's is the brightest thing in the
   * game), so five more that burn while a child is out on the lawn would be
   * five for nothing. `Hotel.update` toggles the group — see {@link discoLit}.
   */
  private hangDiscoBall(
    shell: Group,
    x: number,
    y: number,
    z: number,
    options: { readonly scale?: number; readonly lit?: boolean; readonly room?: HotelRoom } = {},
  ): void {
    const scale = options.scale ?? 1;
    // A slim beam carries the ball — the rooms are open-topped, so there is
    // no ceiling to hang it from, and a ball on nothing reads as a bug.
    const beam = solid(
      new Mesh(new BoxGeometry(3.2 * scale, 0.16, 0.16), softMaterial(PALETTE.stonePinkDark)),
    );
    beam.position.set(x, y + 0.08, z);
    shell.add(beam);
    const ball = createDiscoBall();
    const spin = new Group();
    spin.position.set(x, y, z);
    spin.scale.setScalar(scale);
    spin.add(ball.root);
    shell.add(spin);
    this.discoBalls.push({ spin });

    if (!options.lit || !options.room) return;

    // **Sparkle.** Facet glints on the ball turning with it, and motes drifting
    // down through the beams. Both instanced, neither allocating per frame —
    // see `createDiscoSparkle`. The glints go under `spin` so they rotate with
    // the facets they are lighting up; the motes go under the shell at the
    // ball's own height, because falling specks that rotated with the ball
    // would be a fairground ride rather than dust in a light beam.
    const ballCentreY = -ball.height * 0.64;
    const sparkle = createDiscoSparkle(0.45, 0x1d15c0);
    spin.add(sparkle.glints);
    sparkle.glints.position.y = ballCentreY;
    sparkle.motes.position.set(x, y + ballCentreY * scale, z);
    sparkle.motes.scale.setScalar(scale);
    shell.add(sparkle.motes);
    this.sparkles.push({ room: options.room, sparkle });

    // The ball's own middle, in the (unscaled) local metres of `spin` — the
    // beams have to leave the ball, not the hook 2.4 m above it.
    const centreY = -ball.height * 0.64;
    const lights: Object3D[] = [];
    for (let i = 0; i < DISCO_BEAMS; i += 1) {
      const angle = (i / DISCO_BEAMS) * Math.PI * 2;
      const colour = DISCO_COLOURS[i % DISCO_COLOURS.length] ?? PALETTE.markerPink;
      const light = new SpotLight(
        colour,
        DISCO_INTENSITY,
        DISCO_REACH / scale,
        DISCO_CONE,
        0.55,
        1,
      );
      light.castShadow = false;
      light.position.set(0, centreY, 0);
      // Down and out: the beam lands on the floor a little way from the ball
      // and sweeps the room as the ball turns. Alternating pitches so the
      // beams do not all trace the same circle.
      const reach = i % 2 === 0 ? 5.4 : 8.2;
      light.target.position.set(
        Math.cos(angle) * reach,
        centreY - 4.6,
        Math.sin(angle) * reach,
      );
      spin.add(light, light.target);
      lights.push(light);
    }
    this.discoLights.push({ room: options.room, lights });
  }

  /**
   * One laid table with a chair on either side.
   *
   * `spin` yaws the whole setting — chairs, bowls and the sit-down pose all
   * take it, because they are all derived from it rather than written down
   * separately. It exists because seven tables at the same yaw is a canteen:
   * Jim asked for the breakfast room to *"vary rotation/position so it doesn't
   * grid"*, and a per-table angle is the cheapest way to buy that.
   */
  private placeBreakfastTable(
    shell: Group,
    room: HotelRoom,
    x: number,
    z: number,
    id: string,
    spin = 0,
  ): void {
    // The table top is 1.2 m across, so a disc is the honest footprint —
    // which is also why `spin` never has to reach the collider.
    const table = createBreakfastTable();
    // TABLE_TOP: a jump onto the breakfast table works, and should.
    this.props.place(shell, room, table.root, { x, z, spin, radius: 0.6, top: TABLE_TOP });
    BREAKFASTS.forEach((food, index) => {
      const bowl = createBreakfastBowl(food.kind);
      const angle = (index / BREAKFASTS.length) * Math.PI * 2 + 0.4 + spin;
      bowl.root.position.set(x + Math.cos(angle) * 0.34, 0.74, z + Math.sin(angle) * 0.34);
      shell.add(bowl.root);
    });
    [spin, spin + Math.PI].forEach((yaw, index) => {
      const chair = createBreakfastChair();
      const cx = x + Math.sin(yaw) * 1.05;
      const cz = z + Math.cos(yaw) * 1.05;
      // 0.3 m — the seat is 0.44 across and the legs sit inside that, so this
      // is the chair's own outline and not a metre of air around it. Small
      // enough that the zone's stand point (0.9 m out, and a player is 0.62 m
      // wide) is still reachable, which is the number that had to be checked.
      this.props.place(shell, room, chair.root, {
        x: cx,
        z: cz,
        spin: yaw + Math.PI,
        radius: 0.3,
        top: CHAIR_SEAT_Y,
      });
      this.chairs.push({
        x: room.originX + cx,
        z: room.originZ + cz,
        facing: yaw + Math.PI,
        room,
        id: `${id}-${index}`,
        taken: false,
      });
    });
  }

  /**
   * The painted "this way to the lift" arrow — "an arrow showing the way to
   * your floor, on the floors of the hotel" (Eleri).
   *
   * The chevrons are real arrow geometry (`dressing.ts`'s `floorChevron`)
   * rather than the rotated rectangles they started as: QA's note was that
   * from the play camera a rectangle reads as a stripe, not as a direction.
   * They stay the same lemon on every floor on purpose — the *colour* is the
   * wayfinding, and a way-out sign that changes colour per storey is one a
   * child has to re-learn each time she leaves the lift.
   */
  /**
   * `y` rides the decal ladder (`dressing.ts`): four steps clears the rugs a
   * chevron ordinarily crosses; the garden passes six because its arrow runs
   * over the *stacked* lawn rug.
   */
  private paintArrow(
    shell: Group,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    y: number = 4 * DECAL_STEP,
  ): void {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const length = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const chevrons = Math.max(2, Math.floor(length / 2.2));
    for (let i = 0; i < chevrons; i += 1) {
      const t = (i + 0.5) / chevrons;
      const chevron = floorChevron(PALETTE.markerLemon);
      chevron.position.set(fromX + dx * t, y, fromZ + dz * t);
      chevron.rotation.set(-Math.PI / 2, yaw, 0);
      shell.add(chevron);
    }
  }
}

// ----------------------------------------------------------------- helpers

/**
 * The glazed stretches of one wall, straight from the room's declaration —
 * **the one owner of "where is there glass"**. Two readers: `glazeWall`
 * builds the panes inside these spans (clipped to the wall's solid spans),
 * and `clearOfGlass` refuses to hang a picture across them. They used to
 * read the declaration independently — which is to say the pictures did not
 * read it at all, and hung straight over the lobby's west window.
 */
function glazedSpans(
  room: HotelRoom,
  side: WallSide,
): readonly { readonly from: number; readonly to: number; readonly sill: number; readonly head: number }[] {
  const plan = room.windows[side];
  if (!plan) return [];
  return plan.at.map((at) => ({
    from: at - plan.width / 2,
    to: at + plan.width / 2,
    sill: plan.sill,
    head: plan.head,
  }));
}

/**
 * Where a picture of `width` × `height` may actually hang on this wall, at or
 * near the declared `along` — slid to the nearest clear stretch when the
 * declared spot would put it over a pane (at the picture's own heights),
 * across the wall's doorway gap, or **behind the room's mezzanine** as seen
 * from the fixed camera, or `null` when the whole wall is spoken for. The
 * declared position is a wish; the glazing, the doorway and the deck overhead
 * are the law.
 *
 * **Issue #271.** A painting hung where `mezzanineHidesPoint` says the deck
 * stands between it and the camera is a painting that is never actually on
 * screen — the highlight ring and the "Look" chip still fire off distance
 * alone, so a child can select and walk to something she can never see. This
 * is exactly the same shape of guard as the glass and the doorway above it:
 * catch the bad spot where the picture is *placed*, so nothing downstream
 * (the highlight, the interact zone, the cinematic "Look!" shot) ever has to
 * know the wall had a shadow on it. `check:hotel` proves the built paintings
 * against the same function, on the built scene, so the two cannot drift.
 */
function clearOfGlass(
  room: HotelRoom,
  side: 'north' | 'west',
  along: number,
  width: number,
  height: number,
): number | null {
  const bandLow = PICTURE_Y - height / 2;
  const bandHigh = PICTURE_Y + height / 2;
  // Panes that share any height with the picture, plus the doorway gap,
  // which is forbidden at every height.
  const forbidden: [number, number][] = glazedSpans(room, side)
    .filter((pane) => pane.sill < bandHigh && pane.head > bandLow)
    .map((pane) => [pane.from, pane.to]);
  const gap = room.gaps[side];
  if (gap) forbidden.push([gap[0], gap[1]]);

  const wallHalf = side === 'north' ? room.halfX : room.halfZ;
  const reach = width / 2 + PICTURE_GLASS_MARGIN;
  // The wall-local point a candidate `at` would actually hang at — the same
  // formula `hangOnWalls` places the mesh with, so the two can never place a
  // picture somewhere different from what this asked about.
  const hidden = (at: number): boolean => {
    if (!room.mezzanine) return false;
    const localX = side === 'north' ? at : -room.halfX + PICTURE_WALL_INSET;
    const localZ = side === 'north' ? -room.halfZ + PICTURE_WALL_INSET : at;
    return mezzanineHidesPoint(room.mezzanine, localX, PICTURE_Y, localZ);
  };
  const fits = (at: number): boolean =>
    at - reach >= -wallHalf + 0.3 &&
    at + reach <= wallHalf - 0.3 &&
    forbidden.every(([from, to]) => at + reach <= from || at - reach >= to) &&
    !hidden(at - reach) &&
    !hidden(at) &&
    !hidden(at + reach);

  if (fits(along)) return along;
  for (let step = 0.1; step <= wallHalf * 2; step += 0.1) {
    if (fits(along + step)) return along + step;
    if (fits(along - step)) return along - step;
  }
  return null;
}

/**
 * Moves `current` toward `target` at the automatic doors' own rate.
 *
 * Framerate-independent and linear rather than exponential, because a door is
 * a motor: it opens at one speed and stops. An eased approach would leave the
 * last centimetre of the leaf creeping for ever, which is exactly what a
 * sliding door does not do.
 */
function ease(current: number, target: number, dt: number): number {
  const step = dt / AUTO_DOOR_SECONDS;
  if (target > current) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

/**
 * The floor numbers, painted onto the dial's own UV map.
 *
 * **`flipY = false`, via `glbCanvasTexture`** — this face's UVs came out of a
 * `.glb`, where v runs *down* from the top left, and three.js's default flip
 * would cancel out the wrong way and paint the numbers upside down. That is
 * the bug that ate a day on the tower's signboard; see that helper's header.
 *
 * The face's UVs are `u = x / 0.9 + 0.5`, `v = z / 0.9 + 0.5` off the disc's
 * own vertices (`hotel_build.py`'s `uv_from_xz`), so a point at dial angle φ
 * lands at `u = cos φ / 2 + 0.5`, `v = sin φ / 2 + 0.5`. With the flip off,
 * v = 1 is the *bottom* of the canvas while it is the *top* of the dial — so
 * the canvas is mirrored vertically once, here, and everything below can then
 * be written in ordinary dial coordinates.
 *
 * Only the floors that exist are labelled. Eleven evenly-spaced numbers is
 * what a real lift dial has and what a six-year-old cannot read; four is the
 * hotel she is actually in.
 */
function paintDialFace(face: Mesh): void {
  const SIZE = 512;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#fff3c9';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // The one mirror, so the arithmetic below is in dial space: +y is up the
  // dial, and a glyph drawn upright here reads upright on the plaque.
  ctx.translate(0, SIZE);
  ctx.scale(1, -1);

  ctx.fillStyle = '#4a3a52';
  ctx.font = 'bold 46px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Radius the labels sit at, as a fraction of the face — inside the ticks,
  // which are geometry and stand at about 0.85 of it.
  const LABEL_RADIUS = 0.64;
  for (const [storey, label] of [
    [0, 'G'],
    [12, '12'],
    [33, '33'],
    [50, '50'],
  ] as const) {
    // Left-hand end of the arc is the ground floor, right-hand end the top.
    const phi = Math.PI * (1 - storey / TOP_STOREY);
    ctx.fillText(
      label,
      SIZE / 2 + Math.cos(phi) * LABEL_RADIUS * (SIZE / 2),
      SIZE / 2 - Math.sin(phi) * LABEL_RADIUS * (SIZE / 2),
    );
  }

  face.material = new MeshToonMaterial({ map: glbCanvasTexture(canvas) });
}

/**
 * What is on the telly: the park, from the hotel, in four bands.
 *
 * Painted onto the set's **own** UV map via `glbCanvasTexture` — `flipY` off,
 * because these UVs came out of a `.glb` (see that helper). Not a decal mesh
 * floated in front of the cabinet: CLAUDE.md's hood-face rule, and the artist
 * authored `tv-screen` as an inset panel of the cabinet's front precisely so
 * there is nothing to keep in step.
 *
 * A picture rather than a pattern, because a child will look: it is the park
 * she is staying above — green below, a pink castle, the ferris wheel, sky.
 */
function paintTvScreen(screen: Mesh): void {
  const W = 512;
  const H = 384;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = hexToCss(PALETTE.skyDayBottom);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = hexToCss(PALETTE.grass);
  ctx.fillRect(0, H * 0.66, W, H * 0.34);

  // The castle: a block with a pink roof and a flag.
  ctx.fillStyle = hexToCss(PALETTE.buildingWall);
  ctx.fillRect(W * 0.14, H * 0.34, W * 0.24, H * 0.32);
  ctx.fillStyle = hexToCss(PALETTE.buildingTrim);
  ctx.beginPath();
  ctx.moveTo(W * 0.12, H * 0.34);
  ctx.lineTo(W * 0.26, H * 0.16);
  ctx.lineTo(W * 0.4, H * 0.34);
  ctx.closePath();
  ctx.fill();

  // The ferris wheel: a rim, a hub and six spokes.
  const cx = W * 0.68;
  const cy = H * 0.4;
  const r = H * 0.22;
  ctx.strokeStyle = hexToCss(PALETTE.markerSky);
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 6;
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    ctx.stroke();
  }
  ctx.fillStyle = hexToCss(PALETTE.markerLemon);
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, Math.PI * 2);
  ctx.fill();

  // A sun, because every picture a six-year-old draws has one.
  ctx.fillStyle = hexToCss(PALETTE.flowerYellow);
  ctx.beginPath();
  ctx.arc(W * 0.9, H * 0.13, H * 0.09, 0, Math.PI * 2);
  ctx.fill();

  screen.material = new MeshToonMaterial({
    map: glbCanvasTexture(canvas),
    emissive: PALETTE.blossomWhite,
    emissiveIntensity: 0.45,
  });
}

/** The Game Boy's little screen: a green field with a tiny RiPika on it. */
function paintGameBoyScreen(screen: Mesh): void {
  const SIZE = 256;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = hexToCss(PALETTE.markerMint);
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Chunky pixels, which is the whole joke of a Game Boy screen.
  const PIXEL = SIZE / 16;
  ctx.fillStyle = hexToCss(PALETTE.leafDeep);
  for (const [x, y] of [
    [6, 5], [7, 5], [8, 5],
    [5, 6], [6, 6], [7, 6], [8, 6], [9, 6],
    [5, 7], [7, 7], [9, 7],
    [5, 8], [6, 8], [7, 8], [8, 8], [9, 8],
    [6, 9], [8, 9],
    [6, 10], [8, 10],
  ] as const) {
    ctx.fillRect(x * PIXEL, y * PIXEL, PIXEL, PIXEL);
  }

  screen.material = new MeshToonMaterial({
    map: glbCanvasTexture(canvas),
    emissive: PALETTE.markerMint,
    emissiveIntensity: 0.5,
  });
}

/**
 * How long one spoken line stays on screen.
 *
 * Proportional to its length, because a four-word line held as long as a
 * twelve-word one reads as the game having stalled. Floored well above reading
 * speed: nobody in this family is reading these — a six-year-old is looking at
 * the shape of a speech bubble and waiting for the next one.
 */
function lineSeconds(line: string): number {
  return Math.min(3.8, Math.max(2.1, 1.5 + line.split(' ').length * 0.22));
}

/**
 * What reception says when she hands the key over.
 *
 * Jim, 7 August 2026: *"good afternoon/morning, here is your key, enjoy your
 * stay etc, maybe a bit longer and more embellished."* So: a greeting that
 * knows what time it is, three warm lines that quietly tell her where the good
 * bits are, and *then* the key — which is the beat the rainbow flashes on (see
 * `Hotel.checkIn`'s `cheerAt`).
 *
 * Every line obeys GAME_DESIGN.md's BREVITY RULE on its own terms — one
 * sentence, under fifty characters — because the rule is about the line a child
 * reads at once, not about the total. Six short lines she watches go by is a
 * conversation; one long one is a wall of text.
 */
function checkInLines(timeOfDay: number): readonly string[] {
  return [
    `${greetingFor(timeOfDay)}, and welcome to The Land Hotel!`,
    'Breakfast is on Floor 1, all morning long.',
    'Do visit the garden on 12 and the sea on 33!',
    'Here is your key — the whole top floor is yours!',
    'Enjoy your stay!',
  ];
}

/** …and what she says to somebody who has already checked in. Shorter, warmer. */
function returningLines(timeOfDay: number): readonly string[] {
  return [`${greetingFor(timeOfDay)}! Your room is still Floor 50.`];
}

/**
 * "Good morning", "Good afternoon" or "Good evening", off the park's own clock.
 *
 * `timeOfDay` is `DayNight`'s 0..1 through one day, so the boundaries are noon
 * and six in the evening — the ones a six-year-old would name.
 */
function greetingFor(timeOfDay: number): string {
  const hour = (((timeOfDay % 1) + 1) % 1) * 24;
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** "The Land Hotel", painted onto the tower's signboard. */
function paintSign(signboard: Mesh): void {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#3d2b4f';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#ffe9f4';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('The Land Hotel', 256, 68);
  signboard.material = new MeshToonMaterial({ map: glbCanvasTexture(canvas) });
}

/**
 * A canvas texture for a mesh whose UVs came out of a **glTF file**.
 *
 * three.js defaults `Texture.flipY` to `true`, which is right for the whole
 * rest of this game: a `CanvasTexture` is painted with y running *down* the
 * page, and geometry built here has v running *up*, so the flip is what makes
 * the two agree. glTF stores its UVs the other way up — v runs down, top-left
 * origin — and the loader does not rewrite them, so the same default flip
 * applied to an authored mesh cancels out the wrong way and the writing comes
 * out **upside-down**. QA found exactly that on the tower's signboard
 * (6 August 2026), and the "yours" plaque had it too — it was simply harder to
 * spot on a five-letter word in a rounded panel.
 *
 * Both painted panels in this hotel are authored nodes (`hotel_build.py` UV-maps
 * them), so both go through here. **Anything else that paints words onto an
 * asset from a `.glb` must do the same** — the failure is silent, symmetrical
 * and looks like a modelling mistake rather than a texture setting.
 */
function glbCanvasTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Recolours one named part of an authored asset, outline included.
 *
 * The `.glb` owns shape and code owns colour (`art/models/hotelAssets.ts`'s
 * header) — normally through that file's `STYLES` table, which is the right
 * home for "what colour is a bed blanket". This is the other case: *these
 * three beds want three different blankets*, which is a fact about the suite,
 * not about the asset, exactly as the rail cart's lane colour is a fact about
 * the race. Each `hotelMesh` builds its own material, so this touches one bed.
 *
 * **The outline has to move with it.** `addOutline` bakes `inkTint(colour)`
 * into a `MeshBasicMaterial` at build time, so a repaint that skipped it would
 * leave a mint-tinted line drawn round a red blanket — the sort of thing that
 * reads as a lighting bug rather than as a missed line of code.
 */
function repaintPart(root: Group, name: string, colour: number): void {
  const mesh = root.getObjectByName(name);
  if (!(mesh instanceof Mesh)) return;
  const material = mesh.material;
  if (material instanceof MeshToonMaterial) material.color.setHex(colour);
  for (const child of mesh.children) {
    if (child instanceof Mesh && child.material instanceof MeshBasicMaterial) {
      child.material.color.setHex(inkTint(colour));
    }
  }
}

/** "yours", on the suite door's plaque — Eleri's exact word, lowercase. */
function paintYours(plaque: Mesh): void {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#fff3c9';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#3d2b4f';
  ctx.font = 'bold 72px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('yours', 128, 66);
  plaque.material = new MeshToonMaterial({ map: glbCanvasTexture(canvas) });
}

/**
 * The tower's collision shell — an octagon of this circumradius, in metres.
 * Sized to the crystal cluster's own standing-height mass (measured 6.0–8.4 m
 * out from the plot centre), so what looks solid is solid.
 */
export const TOWER_SHELL_RADIUS = 7.2;

/** The shell walls' own half-thickness. */
const TOWER_SHELL_HALF_THICKNESS = 0.4;

/**
 * Half the doorway's clear width, in metres — where its jambs stand. Wider
 * than the door leaves themselves ({@link DOOR_HALF}) so the aperture is
 * generous to walk at, and it is this, not the octagon's own corners, that
 * says how much of the facade is open.
 */
export const TOWER_DOOR_HALF = DOOR_HALF + 0.5;

/** How far in the lobby back wall stands, along the door's axis. */
export const TOWER_BACK_ALONG = TOWER_SHELL_RADIUS - 2.2;

/**
 * The facade plane: the flat of the octagon face the doorway is cut into,
 * along the door's axis. The doorway sits in the *middle* of a face rather
 * than across a corner, so this is a single distance rather than a range.
 */
export const TOWER_FACADE_ALONG = TOWER_SHELL_RADIUS * Math.cos(Math.PI / 8);

/**
 * The tower's collision: a **closed** octagon around the crystal cluster with
 * exactly one hole in it — the doorway, as wide as the gap between its own
 * jambs — plus those jambs and a lobby back wall a couple of metres in.
 * Walking on through the doorway is what enters the hotel, and the back wall
 * is what stops a sprinting child ending up inside solid crystal while the
 * iris closes.
 *
 * ### It was not closed, and a child found it
 *
 * Jim, playing, 9 August 2026: *"the hotel building is not solid, I can walk
 * straight through it."* The ring was built by walking eight sectors and
 * trimming each one's *start* by the door's arc, when only the two sectors
 * beside the doorway ever wanted trimming. Every face therefore began 0.32 rad
 * late and ended on the nominal line, leaving **six 0.32 rad gaps** evenly
 * spaced round the tower — 2.29 m of arc each, 1.49 m of it clear of both
 * walls' half-thickness, against a 1.24 m-wide child. Measured on the built
 * park before the fix: of 48 bearings marched at the facade, 22 got inside the
 * 7.2 m shell and 8 reached the middle of it (radius 0.00 m). The doorway
 * itself was a 1.43 rad hole — 9.4 m of chord for a 2.6 m door — so three
 * quarters of the "doorway" was open wall you could walk in through beside the
 * jambs and miss the entry trigger entirely, which is the other half of what
 * he reported.
 *
 * So it is built as geometry now rather than as trimmed angles: a ring of
 * chords that closes, and one aperture cut in the middle of the face the door
 * is in. `scripts/check-hotel.mts` marches at it from 32 bearings and is the
 * thing that would say so again.
 */
function registerTowerCollision(
  collision: CollisionWorld,
  x: number,
  z: number,
  yaw: number,
): void {
  const R = TOWER_SHELL_RADIUS;
  const SIDES = 8;
  const sector = (Math.PI * 2) / SIDES;

  // The facade's own frame: `along` runs out through the door, `across` it.
  const alongX = Math.sin(yaw);
  const alongZ = Math.cos(yaw);
  const acrossX = Math.sin(yaw + Math.PI / 2);
  const acrossZ = Math.cos(yaw + Math.PI / 2);
  const wall = (
    along1: number,
    across1: number,
    along2: number,
    across2: number,
    halfThickness: number,
  ): void => {
    collision.addWall(
      x + alongX * along1 + acrossX * across1,
      z + alongZ * along1 + acrossZ * across1,
      x + alongX * along2 + acrossX * across2,
      z + alongZ * along2 + acrossZ * across2,
      halfThickness,
    );
  };

  // Vertices half a sector either side of the door's axis, so the doorway sits
  // in the **middle of one face** rather than straddling a corner: the face it
  // is in is then a chord at a constant distance out
  // ({@link TOWER_FACADE_ALONG}), and the aperture is a plain gap in the
  // middle of it.
  const vertexAcross = R * Math.sin(sector / 2);

  // The seven faces the door is not in — the ring, closed, corner to corner.
  for (let face = 1; face < SIDES; face += 1) {
    const a1 = yaw + (face - 0.5) * sector;
    const a2 = yaw + (face + 0.5) * sector;
    collision.addWall(
      x + Math.sin(a1) * R,
      z + Math.cos(a1) * R,
      x + Math.sin(a2) * R,
      z + Math.cos(a2) * R,
      TOWER_SHELL_HALF_THICKNESS,
    );
  }

  // The facade itself: the same chord, in two stubs either side of the
  // doorway. `TOWER_DOOR_HALF` (1.80 m) is well inside `vertexAcross`
  // (2.76 m), so each stub is a real 0.96 m of wall meeting its jamb at the
  // corner — and probe 22 in `scripts/check-hotel.mts` is what would notice
  // if a wider door ever turned a stub inside out and reopened the shell.
  for (const side of [-1, 1]) {
    wall(
      TOWER_FACADE_ALONG,
      side * TOWER_DOOR_HALF,
      TOWER_FACADE_ALONG,
      side * vertexAcross,
      TOWER_SHELL_HALF_THICKNESS,
    );
  }

  // The jambs, running from the back wall out past the facade plane, and the
  // lobby back wall across the far end between them.
  for (const side of [-1, 1]) {
    wall(TOWER_BACK_ALONG, side * TOWER_DOOR_HALF, R + 0.4, side * TOWER_DOOR_HALF, 0.35);
  }
  wall(TOWER_BACK_ALONG, TOWER_DOOR_HALF, TOWER_BACK_ALONG, -TOWER_DOOR_HALF, 0.35);
}
