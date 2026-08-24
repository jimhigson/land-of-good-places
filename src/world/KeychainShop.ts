import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../core/palette';
import { STALL_PLACEMENTS, STALL_STANDS_BY_ID } from '../minigames/stallPlacement';
import { CAMERA_YAW_DEGREES } from '../core/constants';
import { DEG, lerp, Rng, turnTowards } from '../core/mathUtils';
import { ART } from '../art/style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../art/style/materials';
import { KEYCHAIN_KINDS, createKeychain, type KeychainKind } from '../art/models/keychains';
import { pressAction, type InteractZone, type ZoneAction } from './interact';
import { highlightObject } from './highlight';
import { terrainHeight } from './terrain';
import type { CollisionWorld } from './Collision';
import type { FrameContext, GameSystem } from '../core/types';
import type { Player } from '../entities/Player';
import { gameStore, discoverSecret, type InventoryItem } from '../state';
import { shopWords } from '../state/wording';
import { playOpenChime, playSurpriseChime } from '../ui/chime';
import { keychainItems, type ShopItem } from './building/shops/catalogue';

/**
 * The keychain stall — a little cart in the garden where the player collects
 * charms and picks which one dangles off her backpack.
 *
 * `world/FacePaintStall.ts`'s sibling, built the same way and for the same
 * reason (see that file's own header): a *garden* stall that hands something
 * over without being a mini-game, borrowing placement conventions from
 * `minigames/stallPlacement.ts` but not one line of code from `minigames/`
 * itself — importing `minigames/` into `world/` would be backwards layering.
 *
 * ## The rack IS the picker (23 August 2026) — now entered, not walked (23 August 2026)
 *
 * This used to build the display rack purely as set-dressing and open a
 * separate 2D list panel (`ui/KeychainPanel.ts`) for the actual picking —
 * two presentations of the same six charms. Jim, having seen a screenshot of
 * the real rack: *"I like this much better than the menu style - let's keep
 * it this way for the shop."* So the rack is the only picker, and there is
 * no modal to open: tapping a charm equips it immediately and
 * `WornKeychain.ts` draws it on her actual back on the very next frame —
 * better confirmation than the old panel's stylised preview ever gave,
 * because it is the real thing.
 *
 * **The first cut made every charm its own walk-up `InteractZone`.** Jim,
 * having tried it live: *"Interesting take. You should still be able to
 * 'enter' the shop, but the menu is the camera zooming in on the wares and
 * select by clicking or tapping the one you want."* Six charms 0.32 m apart
 * meant six almost-identical stand points to shuffle between — workable, but
 * fiddlier than every other shop in the park, which is entered once. So the
 * cart is now **one** `InteractZone` ({@link shopEntryZone}, `stall:keychain`
 * — the same walk-up-and-press-E/tap-it convention `FacePaintStall` and every
 * mini-game stall use, `MiniGameHost.enter`'s own doc comment is the
 * canonical statement of it), and pressing it calls {@link openView} instead
 * of opening a panel: the park camera itself glides in on the rack
 * (`Game.tick`, reading {@link viewOpen}/{@link viewFocus} and driving
 * `IsoCamera.setFocusOverride`/`setZoomTarget`), and **only then** do the six
 * charms become their own tappable things ({@link charmZone}) — the exact
 * same `InteractZone`s, rainbow-outlined on their own real silhouette
 * (`highlightObject`) with the live "Wear the Star!"/"Collect the
 * Heart!"/"Take off the RiPika!" chip {@link charmActions} always built, now
 * simply reachable from one spot instead of six. Closing the view
 * ({@link closeView} — the on-screen ✕, Esc/cancel, or simply walking away,
 * `update`'s own job) swaps them back out for the one entry zone and hands
 * the camera back to the ordinary follow.
 *
 * **Why the two zone shapes never coexist.** `interactZones()` returns
 * *either* the one entry zone *or* the six charm zones, never both: they sit
 * on the very same small cart, so a snapshot holding both would fail
 * `check:tap-spacing`'s "different actions must sit a finger apart" rule
 * outright — a tap anywhere near the rack would be within a finger of a zone
 * offering a completely different action. That check (and the procgen
 * reachability invariant, `keychainStallStandIsUsable`) exercise both real
 * states of this object explicitly — `scripts/check-tap-spacing.mts` opens
 * the view for one snapshot the same way it moves the probe player between
 * hotel rooms; `test/procgen/parkFacts.ts`'s `keychainCharmEntrances` does
 * the same for the invariant — rather than the checks accidentally seeing
 * only whichever state happens to be default.
 *
 * Within the six-open state, the same tap-spacing problem the previous cut
 * solved still applies and is solved the same way: every charm zone declares
 * the same **static** `verb: 'Wear'`, so the check classifies them as
 * same-action (a harmless-ambiguity warning) even though the live chip label
 * — built fresh per zone, per frame, in {@link charmActions} — says something
 * different for each.
 *
 * Collected, not chosen for the moment (`HANDOFF-keychain-shop.md`'s
 * decisions 2 and 3, unchanged by any of the above): tapping an unowned charm
 * both collects it (`gameStore.buy`, price 0 — see `shops/catalogue.ts`'s
 * `keychainStall` entries) and wears it in the same motion; tapping an owned
 * one just wears it; tapping the one already worn takes it off.
 *
 * ## Locked, isolated, and turning to show you (24 August 2026)
 *
 * Jim, having seen the zoomed picker live: *"enter the shop, and then the
 * camera zooms in on the charms on the table, and you click or tap to choose
 * each one, not that the player moves around like normal outside gameplay
 * … the player is now non-controllable, but they can turn around to show you
 * the new charm on their bag when you choose one. So, in view: only the
 * charms, and the player's model."* Three real gaps against the
 * just-verified zoom, each fixed the way this codebase already fixes it
 * elsewhere rather than by inventing a fresh mechanism:
 *
 * - **Non-controllable.** {@link openView} hands the character to
 *   `Player.beginRide()` — the exact same "input, collision and gravity stop
 *   applying" switch every ride and the cat-bus arrival already use
 *   (`MiniGameHost.riding`'s own doc comment states the convention), not a
 *   bespoke input lock. `ridePosture = 'walking'` at zero scripted speed
 *   ({@link Player.setScriptedWalk}) rather than the default `'seated'`
 *   posture, because `'seated'` poses her as "holding on, delighted" (arms
 *   thrown back) — the pose a ride wears, not the pose a girl standing at a
 *   counter wears. The six charm zones need `selectableWhileRiding: true`
 *   (see {@link charmZone}) or `Selection.ts`'s own riding gate would block
 *   the very taps this view exists for. {@link closeView} hands her back
 *   with `endRide()`. This also retires the third way out the previous round
 *   documented ("simply walking away") — she cannot wander any more, so the
 *   ✕ and Esc/cancel are the only two now.
 * - **Only the charms and her, in shot.** Measured against the real zoomed
 *   frame: a lamp post, a hedge, a nearby stall and a wandering NPC all sat
 *   inside it. {@link buildViewBackdrop} pops a screen up round the back of
 *   the cart — see that method's own doc comment for why a real wall beats
 *   hiding the world's own systems by hand for everything *behind* the
 *   subject. It cannot reach a crowd member loitering on the same,
 *   camera-facing side as the player, so `World.update` also folds the one
 *   system whose whole job is roaming loose around the park
 *   (`npcs.group.visible`) away for the same beat — a single, named
 *   exception, not the fragile "hide everything" this method's own doc
 *   comment argues against.
 * - **Turns to show you.** {@link pickKeychain}'s {@link showBack} points
 *   {@link viewFacingTarget} at the far side of {@link facingCamera}, and
 *   {@link updateTurn} — run every frame from {@link update} — eases
 *   {@link viewFacing} towards it with `turnTowards` and writes it onto the
 *   player via `setRidePose`, the same "the ride drives the pose from
 *   outside, every frame" contract `ArrivalSequence.ts` already follows for
 *   its own scripted walk. Deliberately a real turn, not a snap — see
 *   `KEYCHAIN_TURN_RATE`'s own comment — and deliberately eases back to
 *   facing the rack after a beat ({@link SHOW_BACK_SECONDS}) rather than
 *   staying turned, so she is ready-looking for the next charm.
 *
 * ## Composed for the shot (24 August 2026)
 *
 * The zoom above got the right *things* into frame; Jim's next note was
 * about *where*: *"make Eleri stand next to the short edge of the table,
 * looking at the table, and the camera straight-on to the table from a 45º
 * angle looking down/forward onto it, and the camera at the right distance
 * so the character and the stall both fit into the view with only a very
 * small gap around the edge of the screen."* The 45° angle needed no new
 * work — the park's one camera never turns (`CAMERA_YAW_DEGREES`,
 * `CAMERA_PITCH_DEGREES`, ARCHITECTURE.md's "One camera angle, forever"), so
 * this view was always shot at exactly that angle; "straight-on to the
 * table" is a framing question, not an angle one. What did need work:
 *
 * - **The short edge, not the long one.** She used to end up wherever she
 *   pressed the entry chip from — the long display side, since that is
 *   where {@link standX}/{@link standZ} (the path network's own walk-up
 *   point) sits. {@link openView} now teleports her to a second, dedicated
 *   point ({@link viewStandX}/{@link viewStandZ}, see
 *   {@link VIEW_STAND_CLEARANCE}'s own doc comment) beside the cart's short
 *   end every time the view opens, so the composition is the same whether
 *   she walked up or arrived by deep link (`requestOpen`) — collision does
 *   not apply while riding, so this is a plain teleport, not a walk.
 * - **Facing the table, not the camera.** The resting pose used to be a
 *   fixed "face the camera" angle, with the turn ({@link showBack}) as the
 *   only moment she faced away. Jim's new framing wants her looking at the
 *   table instead; {@link facingTable} (solved once, from the new stand
 *   point towards {@link rackFocus}'s own centre) is the resting target now,
 *   and {@link updateTurn} eases back to *it* rather than to
 *   {@link facingCamera}. The turn itself is untouched: it still eases to
 *   {@link facingCamera} `+ π` — the direction that puts her back, and the
 *   charm on it, towards the viewer — because that has nothing to do with
 *   which way she rests.
 * - **A tighter, two-subject focus and zoom.** {@link rackFocus} used to be
 *   the rack's own centre alone; it is now pulled part-way towards
 *   {@link viewStandX}/{@link viewStandZ} ({@link VIEW_FOCUS_PLAYER_WEIGHT}),
 *   so the shot centres between her and the rack rather than on the rack
 *   with her off to one side. The zoom moved off the general pinch-zoom
 *   ceiling (`CAMERA_ZOOM_MAX`) onto its own constant, {@link KEYCHAIN_VIEW_ZOOM}
 *   — see that constant's own doc comment for why the ceiling itself had to
 *   move to make room for it.
 *
 * ## Which side of the table (24 August 2026)
 *
 * Jim, on the shot the previous round composed: *"the keyring stall in the
 * last shot looks basically good, but position the camera so Eleri is on the
 * far side of the stall, not the near side."* The angle, zoom and tightness
 * that round tuned were already right and stayed untouched; only
 * {@link VIEW_STAND_SIDE} flipped, from the local `+X` short edge to the
 * local `-X` one — see that constant's own doc comment for why one sign is
 * the whole *intended* fix. Everything downstream of {@link viewStandX}/
 * {@link viewStandZ} ({@link facingTable}, {@link rackFocus}) is solved
 * generically off wherever that stand point actually is, so flipping the
 * side moved the camera to the table's opposite edge without a second
 * formula to keep in step.
 *
 * **Flipping it live turned up a real bug the flag itself never exercised
 * before.** {@link viewStandX}/{@link viewStandZ}'s own `toWorld` call had
 * only ever mirrored `STALL_WIDTH / 2` through {@link VIEW_STAND_SIDE},
 * adding {@link VIEW_STAND_CLEARANCE} unmirrored — invisible while the flag
 * held `1` (the clearance still pushed further out), but on `-1` it pulled
 * the *opposite* way, landing her a bare 0.5 m from the rack's centre
 * (`1.05 − 0.55`) instead of the intended 1.6 m (`1.05 + 0.55`) — close
 * enough that her own head, now turned to face the camera instead of away
 * from it (the far side's own facing, `atan2` pointing the other way), stood
 * in front of four of the six charms on the very first render. See that
 * call's own doc comment for the fix (mirror the whole sum, not just the
 * half-width) — confirmed against a real screenshot with all six charms
 * clear, not just against the maths, per this repo's own "a check can pass
 * without checking anything" rule.
 */

// ---------------------------------------------------------------- placement

const KEYCHAIN_PLACEMENT = STALL_PLACEMENTS.keychain;
const [STALL_X, STALL_Z] = KEYCHAIN_PLACEMENT.position;
const STALL_FACING = KEYCHAIN_PLACEMENT.facing;

/** A garden cart, not a walk-in booth — smaller than the face-paint counter. */
const STALL_WIDTH = 2.1;
const STALL_DEPTH = 1.5;
/** How close counts as "at the stall" for the proximity/interact check. */
const REACH = 3.1;

/**
 * How fast she turns to show (or stop showing) the charm on her back, in
 * radians/second — deliberately much slower than the ordinary walking turn
 * (`PLAYER_TURN_SPEED`, ~13 rad/s, close enough to a snap that it reads as
 * instant): Jim asked for a real "turn around to show you" beat, not a flip.
 * A full 180° turn takes a touch over 0.8 s at this rate.
 */
const KEYCHAIN_TURN_RATE = Math.PI / 0.85;

/**
 * How long she holds facing away — showing the charm — before turning back
 * to face the rack, ready for the next pick. Comfortably longer than the
 * sparkle burst ({@link SPARKLE_DURATION}) so the "got one!" sparkle and the
 * turn are never fighting for the same beat.
 */
const SHOW_BACK_SECONDS = 1.6;

/**
 * How far behind the counter the pop-up screen stands, in metres along the
 * camera's own away-from-viewer axis — past the cart's own footprint
 * (`STALL_WIDTH`/`STALL_DEPTH`, both under 2.2 m) with real clearance, and on
 * the opposite side from the stand point ({@link KeychainShop.standLocalZ},
 * which sits on the *camera-facing* side — see {@link KeychainShop.buildViewBackdrop}),
 * so the two can never collide however either is retuned later.
 */
const BACKDROP_OFFSET = 2.4;

/**
 * How wide and tall the screen is built, in metres.
 *
 * The camera is orthographic (ARCHITECTURE.md), so a flat panel's occluding
 * power does not fall off with distance the way a perspective one's would —
 * only whether it is *big enough* matters, not how far back it stands. Sized
 * generously past the widest real frame this view itself is ever framed at
 * (`CAMERA_VIEW_HEIGHT` / `KEYCHAIN_VIEW_ZOOM` gives ~3.5 m tall at the zoom
 * this view holds; width grows with the screen's own aspect ratio, so this
 * errs large rather than tuning to one browser window) — cheap to overshoot,
 * expensive to leave a gap nobody notices until a wide screen finds it.
 */
const BACKDROP_WIDTH = 42;

/**
 * How tall the screen is built, centred on {@link KeychainShop.groundY} itself
 * (see {@link KeychainShop.buildViewBackdrop} — there is deliberately no
 * separate "centre height" to tune). Pushing the screen back along the away
 * axis ({@link BACKDROP_OFFSET}) shifts its apparent position on screen —
 * the camera is pitched (`CAMERA_PITCH_DEGREES`) — by an amount not worth
 * deriving by hand and re-checking on every future change to either
 * constant: massively over-tall, centred where it already visibly stands
 * (ground level), is robust to that shift in either direction instead of
 * chasing it with a second number.
 */
const BACKDROP_HEIGHT = 24;

/** Thin on purpose — this is a backdrop, not a wall anyone can stand behind. */
const BACKDROP_THICKNESS = 0.4;

/**
 * Tap/hit radius for one charm's own zone, in metres — deliberately small (a
 * charm at the display scale is ~15-20 cm wide); the precise hit test is
 * {@link highlightObject}'s real silhouette box, so this only sizes the
 * fallback sphere a hover ray uses when it misses that box, and the coarse
 * circle `check:tap-spacing` measures separation with.
 */
const CHARM_PICK_RADIUS = 0.16;

const SPARKLE_COUNT = 6;
/** How long the little "got one!" sparkle burst lasts. */
const SPARKLE_DURATION = 1.1;

// -------------------------------------------------------- rack composition

/**
 * How big a charm stands on the rack's own counter — independent of
 * `art/models/keychains.ts`'s `KEYCHAIN_WORN_SCALE` (the scale a charm gets
 * once actually worn on the bag; that file's own header explains why the two
 * do not have to match). Was a bare `1.5`. Jim, 24 August 2026, looking at
 * the locked shop view: *"the charms displayed on the table should be about
 * 2.5x their current on-table size."* `1.5 * 2.5 = 3.75` — the same number as
 * `KEYCHAIN_WORN_SCALE`, but arrived at independently and not derived from it;
 * a future change to one is not expected to move the other.
 */
const RACK_CHARM_SCALE = 3.75;

/**
 * The rack display grid: three columns, two rows — Jim, 24 August 2026,
 * confirming the layout once the charms above got too big for one row to
 * hold: *"six charms total ... 3 columns x 2 rows works."* `KEYCHAIN_KINDS`
 * reads left-to-right, back-row-then-front-row into this grid (see
 * {@link KeychainShop.buildCart}).
 */
const RACK_COLUMNS = 3;
const RACK_ROWS = 2;

/**
 * How far apart the two rows sit, in local metres along the counter's own
 * depth axis — centred on the same {@link RACK_CENTRE_LOCAL_Z} the old
 * single row used, so the grid's own centre does not drift from where the
 * counter (and the backdrop clearance built around it) already expects the
 * display to sit. Comfortably inside {@link STALL_DEPTH}'s own usable top
 * (the counter surface itself is `STALL_DEPTH - 0.06` deep) even with
 * {@link RACK_CHARM_SCALE}'s now-much-larger charms, which is what "grid, not
 * two rows hanging off the edges" needs.
 */
const RACK_ROW_GAP = 0.5;

/** Where the single-row rack used to sit, and where the grid's own depth centres on. */
const RACK_CENTRE_LOCAL_Z = -0.02;

/**
 * How far outside the cart's short edge she stands for the locked view's own
 * composition — **not** {@link KeychainShop.standX}/{@link KeychainShop.standZ}
 * (the ordinary walk-up point the path network reaches, on the display's long
 * side). Jim, 24 August 2026: *"make Eleri stand next to the short edge of
 * the table, looking at the table."* {@link KeychainShop.openView} teleports
 * her here the instant the view opens, regardless of which side of the cart
 * she walked up from — so the shot composes the same way every time, not
 * only when she happened to approach from this side.
 */
const VIEW_STAND_CLEARANCE = 0.55;

/**
 * Which short edge she stands beside: `1` is the local `+X` end, `-1` the
 * local `-X` end. Named rather than inlined so the choice — picked by eye,
 * against a real screenshot of this game's one fixed camera angle, for how
 * the shot reads (PR #331) — is a single flag to flip if it ever needs
 * revisiting, not a sign buried in the stand-point maths.
 *
 * `-1`, not `1`: Jim, on the first composed shot (which used `1`): *"position
 * the camera so Eleri is on the far side of the stall, not the near side"* —
 * the camera looks past her at the rack instead of past the rack at her.
 * {@link viewStandX}/{@link viewStandZ} share the rack's own depth
 * ({@link RACK_CENTRE_LOCAL_Z}) and only differ from the rack's centre by
 * this flag's sign along local X, so which side reads as "near" the fixed
 * camera is entirely this sign (the rest of the geometry — angle, zoom,
 * tightness — is untouched, per {@link facingTable} and {@link rackFocus}
 * both being solved generically off {@link viewStandX}/{@link viewStandZ}
 * rather than hard-coded per side).
 */
const VIEW_STAND_SIDE = -1;

/**
 * How much of the camera's own focus point is pulled from the rack's centre
 * towards where she stands (0 = centred on the rack alone, 1 = centred on
 * her alone) — see {@link KeychainShop.buildCart}'s own solving of
 * {@link KeychainShop.rackFocus}. Not `0.5`: the two subjects are not the
 * same size on screen (she reads taller and narrower than the rack's own
 * footprint), so the point that actually balances the *frame's* left/right
 * margins sits off the geometric midpoint — found by screenshotting the
 * built view and nudging this until the gap either side of the two subjects
 * came out even, the same way every constant below it did.
 */
const VIEW_FOCUS_PLAYER_WEIGHT = 0.43;

/**
 * How high above the ground {@link KeychainShop.rackFocus} sits, in metres —
 * roughly chest height on the standing character and just above the taller
 * charms' own top, so the frame does not centre low with headroom wasted
 * above, nor high with feet cut off below.
 */
const VIEW_FOCUS_HEIGHT = 1.6;

/**
 * The zoom the park camera holds for the whole locked view. Its own constant
 * rather than reaching for the general pinch-zoom ceiling (`CAMERA_ZOOM_MAX`)
 * the way this view used to: Jim, 24 August 2026, on this exact shot: *"the
 * camera at the right distance so the character and the stall both fit into
 * the view with only a very small gap around the edge of the screen."* Tuned
 * by eye against a real screenshot of the built view, not computed from the
 * frustum maths — the subject is two separate, oddly-shaped things (her, and
 * the cart) rather than one bounding sphere the way the cat bus's own
 * derived zoom (`ArrivalSequence.ts`'s `ARRIVAL_CAMERA_ZOOM`) gets to assume,
 * so a formula here would only be a screenshot's worth of margin allowance
 * dressed up as maths. The rack plus the character beside it is a small
 * subject next to what `CAMERA_ZOOM_MAX` was previously sized for (a person
 * walking the park), so that ceiling itself had to rise to make room for
 * this constant — see `CAMERA_ZOOM_MAX`'s own comment — rather than this
 * view silently getting clamped short of the framing it asked for.
 */
export const KEYCHAIN_VIEW_ZOOM = 4.25;

/** One charm on the rack: its kind, its catalogue id, the model itself, and where it is in the world. */
interface RackCharm {
  readonly kind: KeychainKind;
  /** `shops/catalogue.ts`'s id for this charm — `keychain.${kind}`. */
  readonly id: string;
  readonly root: Group;
  /** Where the tap has to land — on the counter, inside the cart's own footprint. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /**
   * Where a child's feet actually go to reach this charm — out in front of
   * the cart, same as every stall's stand point, **not** {@link x}/{@link z}:
   * those sit on the counter, inside `buildCollision`'s own walls, and a
   * zone whose stand point is somewhere solid is a zone `check:park` rightly
   * refuses to certify as reachable. Offset sideways per charm (see
   * {@link KeychainShop.buildCart}) so proximity naturally favours whichever
   * one she's actually stood in front of, at the same depth the stall's own
   * `STALL_STANDS_BY_ID` point already proved clear.
   */
  readonly standX: number;
  readonly standZ: number;
}

export class KeychainShop implements GameSystem {
  readonly name = 'keychainShop';
  readonly group = new Group();

  private readonly standX: number;
  private readonly standZ: number;
  private readonly groundY: number;
  /** {@link standX}/{@link standZ}, in the cart's own local frame — how far out in front of it counts as "arrived". */
  private readonly standLocalZ: number;

  /**
   * Where she stands for the locked view's own composition — beside the
   * cart's short edge, **not** {@link standX}/{@link standZ} (the ordinary
   * walk-up point on the display's long side). See {@link VIEW_STAND_CLEARANCE}'s
   * own doc comment.
   */
  private readonly viewStandX: number;
  private readonly viewStandZ: number;

  /** Every charm stood on the counter, built once in {@link buildCart}. */
  private readonly rack: RackCharm[] = [];

  private readonly sparkles: Mesh[] = [];
  private readonly sparkleBase: { angle: number; radius: number; rise: number }[] = [];
  private readonly sparkleRng = new Rng(0x1eec4a1);
  private sparkleStartedAt: number | null = null;
  /** Local (to `this.group`) centre the current sparkle burst radiates from — the charm just picked. */
  private sparkleOrigin = { x: 0, y: 1.05, z: 0 };

  /** `FrameContext.elapsed` as of the last frame — DOM handlers fire between frames. */
  private frameElapsed = 0;

  private player: Player | null = null;

  /**
   * True while the zoomed rack picker owns the camera — `Game.tick` reads
   * this (and {@link viewFocus}) to drive `IsoCamera.setFocusOverride`/
   * `setZoomTarget`, and {@link interactZones} reads it to decide which zone
   * shape to offer. See this file's own header for why the two never
   * coexist.
   */
  private open = false;

  /**
   * World point the camera orbits while {@link viewOpen} — the rack's own
   * centre, averaged across the six charms once in {@link buildCart} (they
   * do not move afterwards, so this is solved once rather than every frame).
   */
  private readonly rackFocus = new Vector3();

  private closeButton: HTMLElement | null = null;

  /** The pop-up privacy screen round the back of the cart — see {@link buildViewBackdrop}. */
  private readonly backdrop = new Group();

  /**
   * The facing (radians, `Player.facing`'s own convention) driven onto the
   * player every frame while {@link open} — see {@link updateTurn}. Eased
   * towards {@link viewFacingTarget}, never assigned outright, so the turn
   * Jim asked for is a real turn and not a snap.
   */
  private viewFacing = 0;

  /** Where {@link viewFacing} is currently headed: {@link facingTable}, or {@link facingCamera} plus π. */
  private viewFacingTarget = 0;

  /**
   * Facing away from the camera — not a resting pose any more (see
   * {@link facingTable} for that), only the turn target {@link showBack} eases
   * towards: turning to exactly this angle is what puts her *back* — and the
   * charm just worn on it — towards the viewer. A plain constant, not solved
   * from her position, for the same reason `Player.ts`'s own default spawn
   * facing is: the camera's direction is fixed for the life of the app
   * (ARCHITECTURE.md), so "facing the camera" never depends on where anyone
   * is standing.
   */
  private readonly facingCamera = CAMERA_YAW_DEGREES * DEG;

  /**
   * Facing the rack — the resting pose while browsing. Jim, 24 August 2026,
   * on this exact view's composition: *"looking at the table."* Solved once,
   * in {@link buildCart}, from {@link viewStandX}/{@link viewStandZ} towards
   * {@link rackFocus}'s own local centre, so it stays correct however either
   * point is retuned later rather than a second hand-picked angle drifting
   * out of step with them.
   */
  private facingTable = 0;

  /**
   * Elapsed time the current "facing away, showing the charm" beat began, or
   * `null` when not mid-beat. Read against {@link SHOW_BACK_SECONDS} in
   * {@link updateTurn} to know when to turn back. Set from
   * {@link frameElapsed}, not a fresh clock read — same reason
   * {@link spawnSparkles} does: DOM handlers fire between frames.
   */
  private turnedAt: number | null = null;

  constructor(collision: CollisionWorld) {
    this.group.name = 'keychainShop';

    this.groundY = terrainHeight(STALL_X, STALL_Z);
    this.group.position.set(STALL_X, this.groundY, STALL_Z);
    this.group.rotation.y = STALL_FACING;

    const stand = STALL_STANDS_BY_ID.get('keychain');
    if (!stand) throw new Error('KeychainShop: no stand point in STALL_PLACEMENTS.keychain');
    this.standX = stand.x;
    this.standZ = stand.z;
    [, this.standLocalZ] = this.toLocal(this.standX, this.standZ);

    // The locked view's own stand point: beside the cart's short edge
    // (`VIEW_STAND_SIDE`'s local +X end, or the -X end), out by
    // `VIEW_STAND_CLEARANCE` — see that constant's own doc comment for why
    // this is not `standX`/`standZ`.
    //
    // `VIEW_STAND_SIDE * (STALL_WIDTH / 2 + VIEW_STAND_CLEARANCE)`, **not**
    // `VIEW_STAND_SIDE * STALL_WIDTH / 2 + VIEW_STAND_CLEARANCE`: the earlier
    // form only mirrored the half-width through `VIEW_STAND_SIDE`, adding the
    // clearance unmirrored — harmless while the flag only ever held `1` (it
    // still pushed further out), but on `-1` it pulls the *opposite* way,
    // partly cancelling the half-width instead of extending past it. At this
    // file's actual constants that put her only 0.5 m out (`1.05 - 0.55`)
    // instead of the intended 1.6 m (`1.05 + 0.55`) — nearly on top of the
    // rack rather than beside it, which is what briefly turned this into a
    // literal on-camera face-plant into the charms once the flag was first
    // flipped for real (PR #331, 24 August 2026). Mirroring the whole sum
    // keeps the two sides at an equal, correct distance from the cart.
    [this.viewStandX, this.viewStandZ] = this.toWorld(
      VIEW_STAND_SIDE * (STALL_WIDTH / 2 + VIEW_STAND_CLEARANCE),
      RACK_CENTRE_LOCAL_Z,
    );

    this.buildCart();
    this.buildCollision(collision);
    this.buildSparklePool();
    this.buildViewBackdrop();
  }

  /** True while a ride owns the character — matches every other stall's own gate on its zones. */
  attachPlayer(player: Player): void {
    this.player = player;
  }

  /**
   * Builds the on-screen ✕, one of the zoomed view's three ways out (the
   * other two are Esc/cancel and simply walking away — see `update`). Called
   * by `World.mountUi`, after the HUD exists — see `FacePaintStall.mountUi`'s
   * own doc comment for why this cannot happen from the constructor.
   */
  mountUi(uiRoot: HTMLElement): void {
    if (this.closeButton) return;
    this.closeButton = buildCloseButton(uiRoot, () => this.closeView());
  }

  /** True while the zoomed rack picker owns the camera. `Game.tick` reads this. */
  get viewOpen(): boolean {
    return this.open;
  }

  /** {@link rackFocus}, for `Game.tick` to hand to `IsoCamera.setFocusOverride`. */
  get viewFocus(): Readonly<Vector3> {
    return this.rackFocus;
  }

  /**
   * Either the one "enter the shop" zone, or the six charms — never both at
   * once. See this file's own header for why, and `scripts/check-tap-spacing.mts`
   * / `test/procgen/parkFacts.ts` for how both states get checked even though
   * a single snapshot only ever shows one.
   */
  interactZones(): InteractZone[] {
    return this.open ? this.rack.map((charm) => this.charmZone(charm)) : [this.shopEntryZone()];
  }

  update(context: FrameContext): void {
    this.frameElapsed = context.elapsed;
    this.updateSparkles(context.elapsed);
    setCloseButtonVisible(this.closeButton, this.open);

    if (!this.open) return;
    this.updateTurn(context);

    const { input } = context;
    if (input.justPressed('menu') || input.justPressed('cancel')) this.closeView();
  }

  /**
   * Opens the zoomed rack picker — the run body of {@link shopEntryZone}'s
   * chip. The camera move itself lives in `Game.tick`, which re-derives it
   * every frame from {@link viewOpen}/{@link viewFocus} exactly the way the
   * cat-bus arrival re-derives its own zoom (see `IsoCamera.setFocusOverride`'s
   * doc comment); this method's own job is everything else the view needs the
   * instant it opens — see this file's own header, "Locked, isolated, and
   * turning to show you".
   *
   * Guarded on {@link player}, and safe to call with none attached
   * (`scripts/check-tap-spacing.mts`, `test/procgen/parkFacts.ts` both open
   * the view headless to read {@link interactZones} back): everything past
   * the backdrop toggle is about the real character, and there isn't one
   * there.
   */
  openView(): void {
    this.open = true;
    // Attached here, not merely shown: real procgen geometry checks
    // (`test/procgen/invariants.ts`'s Sky Cruiser flight-clearance sweep)
    // traverse the actual scene graph regardless of `visible`, and a screen
    // 24 m tall left permanently parented under the cart failed that check
    // outright — a real mesh a ride can hit, sitting there all the time
    // whether a child ever opens the picker or not. Parenting it in only
    // while the view is genuinely open is the fix, not a `visible` flag:
    // nothing that isn't part of the scene graph can be flown through.
    this.group.add(this.backdrop);

    const player = this.player;
    if (!player || player.riding) return;

    // Hands the character over exactly the way every ride and the cat-bus
    // arrival already do (`MiniGameHost.riding`'s own doc comment states the
    // convention) — GAME_DESIGN.md's CONTROL rule is about never steering
    // her like a tank, not about a deliberate "you are in a menu, not
    // walking around" state, which this codebase already has a mechanism
    // for. `'walking'`, not the default `'seated'`: `'seated'` poses her as
    // "holding on, delighted" (arms thrown back), which is a ride's pose,
    // not a girl standing at a counter's. At zero scripted speed
    // (`setScriptedWalk`) that posture is simply her ordinary standing idle.
    player.beginRide();
    player.ridePosture = 'walking';
    player.setScriptedWalk(0);

    // Composes the shot the same way every time, regardless of which side
    // of the cart she walked up from to press the chip (or whether a deep
    // link dropped her at the ordinary `standX`/`standZ` instead) — see
    // {@link viewStandX}'s own doc comment. Collision does not apply while
    // riding (`Player.beginRide`'s own doc comment), so this is a plain
    // teleport, not a walk.
    player.teleport(this.viewStandX, this.viewStandZ);

    this.viewFacing = this.facingTable;
    this.viewFacingTarget = this.facingTable;
    this.turnedAt = null;
    player.setRidePose(player.position.x, player.position.y, player.position.z, this.viewFacing);
  }

  /**
   * Leaves the zoomed picker, folds the backdrop away and hands the
   * character back. Two ways in now: the on-screen ✕ and Esc/cancel — a
   * previous round's third way, walking away, is gone along with the free
   * walking itself (see this file's own header).
   */
  closeView(): void {
    this.open = false;
    this.backdrop.removeFromParent();

    const player = this.player;
    if (player?.riding) player.endRide();
    this.turnedAt = null;
  }

  /**
   * Eases {@link viewFacing} towards {@link viewFacingTarget} and writes it
   * onto the player every frame — the same "the ride drives the pose from
   * outside, every frame" contract `ArrivalSequence.ts` follows for its own
   * scripted walk (`Player.setRidePose`'s own doc comment). Also owns the
   * "hold, then turn back" timing on top of a pick — see {@link turnedAt}.
   */
  private updateTurn(context: FrameContext): void {
    const player = this.player;
    if (!player) return;

    if (this.turnedAt !== null && context.elapsed - this.turnedAt > SHOW_BACK_SECONDS) {
      this.viewFacingTarget = this.facingTable;
      this.turnedAt = null;
    }

    this.viewFacing = turnTowards(this.viewFacing, this.viewFacingTarget, KEYCHAIN_TURN_RATE * context.dt);
    player.setRidePose(player.position.x, player.position.y, player.position.z, this.viewFacing);
  }

  /**
   * Opens the view straight away — the deep link's own entry point
   * (`Game.ts`'s `boardRide` table, `/keychain-stall`). A real walk-up would
   * press the chip after arriving at `standX`/`standZ`; this skips that,
   * since {@link openView} itself teleports her to the view's own composed
   * stand point the instant it opens regardless of where she started from.
   */
  requestOpen(): boolean {
    if (!this.player || this.player.riding) return false;
    this.beginView();
    return true;
  }

  dispose(): void {
    this.closeButton?.remove();
    disposeGroup(this.group);
  }

  /**
   * The whole cart — the one "enter the shop" trigger (see this file's own
   * header). Standing this close and pressing E, or tapping the rack, opens
   * the zoomed picker; the six charms are not their own zones again until it
   * does. `highlight` names the whole group so the rainbow outline (and the
   * tap hit-test, which prefers a named object's real bounding box over
   * `pickRadius`) reads as "the cart", not a plain circle floating over it.
   */
  private shopEntryZone(): InteractZone {
    return {
      id: 'stall:keychain',
      label: 'Charm Rack!',
      x: STALL_X,
      y: this.groundY,
      z: STALL_Z,
      pickRadius: REACH,
      standX: this.standX,
      standZ: this.standZ,
      standRadius: REACH,
      highlight: highlightObject(this.group),
      actions: () =>
        !this.player || this.player.riding
          ? []
          : pressAction('See the charms!', () => this.beginView(), '🔑'),
    };
  }

  /** {@link shopEntryZone}'s run body: the chime, then the state flip. */
  private beginView(): void {
    playOpenChime();
    this.openView();
  }

  // -------------------------------------------------------------- internals

  private charmZone(charm: RackCharm): InteractZone {
    return {
      // `stall:` prefixed, not `keychain:`, so `parkFacts.ts`'s `entrances`
      // (which filters on that prefix — every other stall's zone id starts
      // this way) picks all six up automatically, the same way
      // `keychainStallStandIsUsable` in `test/procgen/invariants.ts` now
      // reads them back. A bare `keychain:${kind}` id silently fell outside
      // that filter and made the whole rack invisible to the reachability
      // invariant — caught by CI, not locally.
      id: `stall:keychain:${charm.kind}`,
      label: charm.kind,
      x: charm.x,
      y: charm.y,
      z: charm.z,
      pickRadius: CHARM_PICK_RADIUS,
      standX: charm.standX,
      standZ: charm.standZ,
      standRadius: REACH,
      // A single static classification, the same for every charm regardless
      // of what its live chip actually says — see this file's own header.
      verb: 'Wear',
      // The character is riding for the whole life of this view (see this
      // file's own header, "Non-controllable") — without this,
      // `Selection.ts`'s own riding gate would block every one of these taps,
      // the one thing this view exists for.
      selectableWhileRiding: true,
      highlight: highlightObject(charm.root),
      actions: () => this.charmActions(charm),
    };
  }

  /**
   * "Wear the Star!" / "Collect the Heart!" / "Take off the RiPika!" — one
   * chip, evaluated live off the real inventory, exactly the way the train's
   * platform swaps "Get on" for "Get off" (`ParkTrain.stationActions`).
   */
  private charmActions(charm: RackCharm): readonly ZoneAction[] {
    const item = keychainItems().find((entry) => entry.id === charm.id);
    if (!item) return [];
    const shortName = item.displayName.replace(/ Keychain$/, '');

    const state = gameStore.get();
    const wornId = state.inventory.find((entry) => entry.uid === state.wornKeychainUid)?.id;
    if (wornId === charm.id) {
      return pressAction(`Take off the ${shortName}!`, () => this.takeOff(), '🎒');
    }

    const owned = ownedKeychainIds(state.inventory).has(charm.id);
    const verb = owned ? 'Wear' : shopWords().verb;
    return pressAction(`${verb} the ${shortName}!`, () => this.pickKeychain(charm), item.icon);
  }

  /**
   * "I want that one" — for an owned charm this only ever wears it; for an
   * unowned one it collects it first (`gameStore.buy`, price 0) and wears
   * the copy just bought, the same "it's yours, and it's on you" beat a
   * purchased jet pack gets (`GameStore.buy`'s own `wornJetpackUid` line).
   */
  private pickKeychain(charm: RackCharm): void {
    const state = gameStore.get();
    const existing = state.inventory.find((item) => item.id === charm.id);
    if (existing) {
      gameStore.setWornKeychain(existing.uid);
      this.showBack();
      return;
    }

    const item = keychainItems().find((entry) => entry.id === charm.id);
    if (!item) return;
    const firstEver = ownedKeychainIds(state.inventory).size === 0;
    const acquisition = gameStore.buy(shopItemToPurchase(item));
    if (acquisition.outcome !== 'kept') return; // price 0 never refuses, but the type still allows it

    gameStore.setWornKeychain(acquisition.item.uid);
    if (firstEver) discoverSecret('secret.keychain');
    this.spawnSparkles(charm);
    playSurpriseChime();
    this.showBack();
  }

  private takeOff(): void {
    gameStore.setWornKeychain(null);
    playOpenChime();
  }

  /**
   * Jim, 24 August 2026: *"the player is now non-controllable, but they can
   * turn around to show you the new charm on their bag when you choose
   * one."* Starts (or refreshes) the "facing away" beat {@link updateTurn}
   * drives every frame. Refreshing rather than only starting matters for a
   * quick second pick mid-turn: {@link turnedAt} simply moves to now, so the
   * hold restarts instead of the turn-back cutting in mid-way through
   * showing the new charm.
   */
  private showBack(): void {
    this.viewFacingTarget = this.facingCamera + Math.PI;
    this.turnedAt = this.frameElapsed;
  }

  private spawnSparkles(charm: RackCharm): void {
    this.sparkleStartedAt = this.frameElapsed;
    // Bursts from the charm actually picked, not the cart's centre, so a
    // child can see which one it was — `charm.root.position` is already the
    // local (to `this.group`) point the sparkle pool's own children share.
    this.sparkleOrigin = {
      x: charm.root.position.x,
      y: charm.root.position.y + 0.16,
      z: charm.root.position.z,
    };
    for (let i = 0; i < this.sparkleBase.length; i += 1) {
      this.sparkleBase[i] = {
        angle: this.sparkleRng.range(0, Math.PI * 2),
        radius: this.sparkleRng.range(0.14, 0.34),
        rise: this.sparkleRng.range(0.3, 0.55),
      };
    }
  }

  /** Same rise-and-fade beat `FacePaintStall.updatePaintingCutscene` draws, over the charm just picked. */
  private updateSparkles(elapsed: number): void {
    const startedAt = this.sparkleStartedAt;
    if (startedAt === null) return;
    const t = (elapsed - startedAt) / SPARKLE_DURATION;
    if (t >= 1) {
      this.sparkleStartedAt = null;
      for (const sparkle of this.sparkles) sparkle.visible = false;
      return;
    }
    const origin = this.sparkleOrigin;
    for (let i = 0; i < this.sparkles.length; i += 1) {
      const sparkle = this.sparkles[i];
      const base = this.sparkleBase[i];
      if (!sparkle || !base) continue;
      const phase = Math.min(1, t + i * 0.06);
      const rise = phase * base.rise;
      const fade = Math.sin(phase * Math.PI);
      sparkle.visible = fade > 0.02;
      sparkle.position.set(
        origin.x + Math.cos(base.angle) * base.radius,
        origin.y + rise,
        origin.z + Math.sin(base.angle) * base.radius,
      );
      sparkle.scale.setScalar(0.35 + fade * 0.8);
      sparkle.rotation.y = elapsed * 3 + base.angle;
      const material = sparkle.material as MeshBasicMaterial;
      material.opacity = fade;
    }
  }

  private buildSparklePool(): void {
    const material = new MeshBasicMaterial({
      color: PALETTE.markerLemon,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    for (let i = 0; i < SPARKLE_COUNT; i += 1) {
      const sparkle = decal(new Mesh(new OctahedronGeometry(0.06, 0), material.clone()));
      sparkle.visible = false;
      sparkle.renderOrder = 5;
      this.group.add(sparkle);
      this.sparkles.push(sparkle);
      this.sparkleBase.push({ angle: 0, radius: 0.24, rise: 0.4 });
    }
  }

  /**
   * Local → world, for this stall's own fixed position and yaw — one owner,
   * shared by {@link buildCollision}'s wall corners and {@link buildCart}'s
   * per-charm zone positions, rather than the same trig written out twice.
   */
  private toWorld(localX: number, localZ: number): [number, number] {
    const sin = Math.sin(STALL_FACING);
    const cos = Math.cos(STALL_FACING);
    return [STALL_X + localX * cos + localZ * sin, STALL_Z - localX * sin + localZ * cos];
  }

  /** {@link toWorld}'s inverse — used once, to read {@link standLocalZ} off the stall's own proven-reachable stand point. */
  private toLocal(worldX: number, worldZ: number): [number, number] {
    const sin = Math.sin(STALL_FACING);
    const cos = Math.cos(STALL_FACING);
    const dx = worldX - STALL_X;
    const dz = worldZ - STALL_Z;
    return [cos * dx - sin * dz, sin * dx + cos * dz];
  }

  /**
   * The cart: a little two-wheeled trolley with a counter, and the six real
   * charm models stood up on it as a display rack — the origin-at-the-base
   * convention `art/models/keychains.ts` was built for means they can stand
   * here with no offset maths at all. This rack is also the shop's whole
   * picker (see this file's own header): every charm built here is handed
   * to {@link interactZones} as its own tappable, wearable thing.
   */
  private buildCart(): void {
    const halfWidth = STALL_WIDTH / 2;
    const woodMaterial = toonMaterial(PALETTE.wood);
    const trimMaterial = toonMaterial(ART.miniLilac);
    const topMaterial = toonMaterial(PALETTE.woodLight);
    const wheelMaterial = toonMaterial(ART.ink);

    const body = solid(new Mesh(new RoundedBoxGeometry(STALL_WIDTH, 0.55, STALL_DEPTH, 3, 0.05), woodMaterial));
    body.position.set(0, 0.55, 0);
    this.group.add(body);
    addOutline(body, 0.014);

    const top = solid(new Mesh(new RoundedBoxGeometry(STALL_WIDTH - 0.08, 0.06, STALL_DEPTH - 0.06, 3, 0.03), topMaterial));
    top.position.set(0, 0.855, 0);
    this.group.add(top);

    // A cheerful trim band round the counter's skirt.
    const skirt = solid(new Mesh(new RoundedBoxGeometry(STALL_WIDTH - 0.04, 0.12, STALL_DEPTH - 0.04, 3, 0.04), trimMaterial));
    skirt.position.set(0, 0.32, 0);
    this.group.add(skirt);

    // Two wheels, so it reads as a cart she could push rather than a fixed
    // booth — a smaller, friendlier silhouette than the face-paint stall's.
    for (const side of [-1, 1] as const) {
      const wheel = solid(new Mesh(new CylinderGeometry(0.16, 0.16, 0.06, 16), wheelMaterial));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * (halfWidth - 0.02), 0.16, STALL_DEPTH / 2 - 0.05);
      this.group.add(wheel);
      addOutline(wheel, 0.01);
    }

    // A parasol overhead — small, round, striped, so the cart still reads
    // clearly from the fixed isometric camera among the garden's foliage.
    const poleMaterial = toonMaterial(ART.cream);
    const pole = solid(new Mesh(new CylinderGeometry(0.03, 0.03, 1.35, 8), poleMaterial));
    pole.position.set(0, 1.55, -STALL_DEPTH / 2 + 0.15);
    this.group.add(pole);

    const canopyColours = [PALETTE.markerPink, ART.miniLilac];
    const wedges = 8;
    for (let i = 0; i < wedges; i += 1) {
      const angle0 = (i / wedges) * Math.PI * 2;
      const wedge = solid(
        new Mesh(
          new CylinderGeometry(0.62, 0.62, 0.1, 1, 1, false, angle0, (Math.PI * 2) / wedges),
          toonMaterial(canopyColours[i % 2] ?? PALETTE.markerPink),
        ),
      );
      wedge.scale.set(1, 0.35, 1);
      wedge.position.set(0, 2.18, -STALL_DEPTH / 2 + 0.15);
      this.group.add(wedge);
    }
    const canopyCap = solid(new Mesh(new SphereGeometry(0.06, 10, 8), poleMaterial));
    canopyCap.position.set(0, 2.24, -STALL_DEPTH / 2 + 0.15);
    this.group.add(canopyCap);

    // The six charms themselves, stood on the counter as a display rack —
    // {@link RACK_COLUMNS} x {@link RACK_ROWS}, at {@link RACK_CHARM_SCALE}
    // (was one row at a smaller scale — see that constant's own doc comment
    // for why it grew and needed the second row), alternating a slight lean
    // so the grid does not read as a static shelf of identical ranks. Each
    // one's real world position is recorded into {@link rack} for
    // {@link interactZones} to build a tap target from.
    const rackWidth = STALL_WIDTH - 0.5;
    const charmLocalY = 0.885;
    KEYCHAIN_KINDS.forEach((kind, index) => {
      const handle = createKeychain(kind);
      const column = index % RACK_COLUMNS;
      const row = Math.floor(index / RACK_COLUMNS);
      const tColumn = RACK_COLUMNS > 1 ? column / (RACK_COLUMNS - 1) : 0.5;
      const tRow = RACK_ROWS > 1 ? row / (RACK_ROWS - 1) : 0.5;
      const localX = -rackWidth / 2 + tColumn * rackWidth;
      const localZ = RACK_CENTRE_LOCAL_Z - RACK_ROW_GAP / 2 + tRow * RACK_ROW_GAP;
      handle.root.position.set(localX, charmLocalY, localZ);
      handle.root.scale.setScalar(RACK_CHARM_SCALE);
      handle.root.rotation.y = (index % 2 === 0 ? 1 : -1) * 0.18;
      this.group.add(handle.root);

      const [x, z] = this.toWorld(localX, localZ);
      // Same lateral offset as the charm itself, but out at the stall's own
      // proven-clear stand depth — never the counter's own `localZ`, which
      // sits inside `buildCollision`'s walls (see `RackCharm.standX`'s own
      // doc comment). Both charms in a column share one stand point: the
      // depth a child stands at to reach the counter does not change row to
      // row, only which column she is squared up to.
      const [standX, standZ] = this.toWorld(localX, this.standLocalZ);
      this.rack.push({
        kind,
        id: `keychain.${kind}`,
        root: handle.root,
        x,
        y: this.groundY + charmLocalY,
        z,
        standX,
        standZ,
      });
    });

    // {@link rackFocus}: pulled {@link VIEW_FOCUS_PLAYER_WEIGHT} of the way
    // from the rack's own world centre (the six charms' average — solved
    // once here rather than every frame, since they never move afterwards)
    // towards {@link viewStandX}/{@link viewStandZ}, so the shot centres
    // between the two subjects Jim asked to both fit in frame, rather than
    // on the rack alone with her off to one side of it.
    let sumX = 0;
    let sumZ = 0;
    for (const charm of this.rack) {
      sumX += charm.x;
      sumZ += charm.z;
    }
    const rackCentreX = sumX / this.rack.length;
    const rackCentreZ = sumZ / this.rack.length;
    const focusX = lerp(rackCentreX, this.viewStandX, VIEW_FOCUS_PLAYER_WEIGHT);
    const focusZ = lerp(rackCentreZ, this.viewStandZ, VIEW_FOCUS_PLAYER_WEIGHT);
    this.rackFocus.set(focusX, this.groundY + VIEW_FOCUS_HEIGHT, focusZ);

    // {@link facingTable}: the bearing from her composed stand point to the
    // rack's own centre — `Player.facing`'s `atan2(x, z)` convention (see
    // `buildViewBackdrop`'s own doc comment, which uses the same one) — so
    // "looking at the table" stays correct however either point is retuned,
    // rather than a hand-picked angle that could drift out of step with them.
    this.facingTable = Math.atan2(rackCentreX - this.viewStandX, rackCentreZ - this.viewStandZ);
  }

  private buildCollision(collision: CollisionWorld): void {
    const halfWidth = STALL_WIDTH / 2 + 0.08;
    const front = STALL_DEPTH / 2 + 0.08;
    const back = -STALL_DEPTH / 2 - 0.08;

    const frontLeft = this.toWorld(-halfWidth, front);
    const frontRight = this.toWorld(halfWidth, front);
    const backLeft = this.toWorld(-halfWidth, back);
    const backRight = this.toWorld(halfWidth, back);

    collision.addWall(frontLeft[0], frontLeft[1], frontRight[0], frontRight[1], 0.25);
    collision.addWall(backLeft[0], backLeft[1], backRight[0], backRight[1], 0.25);
    collision.addWall(frontLeft[0], frontLeft[1], backLeft[0], backLeft[1], 0.25);
    collision.addWall(frontRight[0], frontRight[1], backRight[0], backRight[1], 0.25);
  }

  /**
   * A pop-up screen behind the cart — the "dedicated stripped-down scene"
   * this feature needs without actually needing a second scene.
   *
   * Jim, 24 August 2026, on the just-verified zoom: *"in view: only the
   * charms, and the player's model."* Measured against the real zoomed shot,
   * the rack's own garden setting — a lamp post, a hedge, a neighbouring
   * stall, a wandering NPC — filled a good third of the frame. The camera
   * never turns (ARCHITECTURE.md, "One camera angle, forever") and is
   * orthographic, so a single flat panel standing anywhere behind the
   * subject, facing back along the camera's own fixed direction, occludes
   * *everything* behind it in that direction — near or far, tall building or
   * low hedge, it makes no difference, because an orthographic ray does not
   * converge the way a perspective one does. That is what makes one plank of
   * geometry the cheap, robust fix here, rather than hiding the world's own
   * systems by hand: every system this stall does not know the name of would
   * silently stay visible, which is exactly the "a hole nobody notices"
   * failure shape CLAUDE.md's "anything that looks solid must be solid" is
   * about, aimed at a camera frame instead of a collider.
   *
   * `CAMERA_YAW_DEGREES` is the same constant every other camera-relative
   * thing in this codebase already reads (`entrance/arrivalSightline.ts`'s
   * `TOWARDS_CAMERA`, `Player.ts`'s own default facing) — turned round by π
   * to point *away* from the camera instead of towards it, then converted
   * into this stall's own local frame the same way {@link toWorld} does
   * (`Player.facing`'s `atan2(x, z)` convention: a direction with angle θ is
   * `(sin θ, cos θ)`, and `rotation.y = θ` turns an object's own local +Z to
   * point that way — so setting the panel's `rotation.y` to this angle turns
   * its thin axis, and therefore its wide face, to look straight back down
   * the camera's own line of sight).
   *
   * Offset from the counter along that same away direction
   * ({@link BACKDROP_OFFSET}) — the opposite side from the stand point, which
   * sits on the *camera-facing* side (positive {@link standLocalZ}), so
   * however either number is retuned later the two can never end up
   * intersecting.
   *
   * The mesh itself is built once, here, but {@link backdrop} is deliberately
   * left **unparented** until {@link openView} actually attaches it, and
   * {@link closeView} detaches it again — not merely hidden behind
   * `visible = false`. A screen this tall (`BACKDROP_HEIGHT`) sitting
   * permanently in the scene graph, even invisible, is real geometry a
   * procgen sweep can find: `test/procgen/invariants.ts`'s Sky Cruiser
   * flight-clearance check does exactly that, and did (CI, not a local
   * check — see this feature's own PR). Attached only while a child could
   * conceivably be looking at it is also the more honest description of
   * "pop-up": the rest of the time there is no screen there to trip over,
   * not an invisible one.
   */
  private buildViewBackdrop(): void {
    const awayFromCameraLocalAngle = CAMERA_YAW_DEGREES * DEG + Math.PI - STALL_FACING;
    const awayX = Math.sin(awayFromCameraLocalAngle);
    const awayZ = Math.cos(awayFromCameraLocalAngle);

    const wall = solid(
      new Mesh(
        new BoxGeometry(BACKDROP_WIDTH, BACKDROP_HEIGHT, BACKDROP_THICKNESS),
        toonMaterial(ART.miniLilac),
      ),
    );
    wall.rotation.y = awayFromCameraLocalAngle;
    wall.position.set(awayX * BACKDROP_OFFSET, 0, awayZ * BACKDROP_OFFSET);
    this.backdrop.add(wall);
    // Deliberately not `this.group.add(this.backdrop)` here — see this
    // method's own doc comment. `openView`/`closeView` own attaching it.
  }
}

// ------------------------------------------------------------------ helpers

function ownedKeychainIds(inventory: readonly InventoryItem[]): Set<string> {
  const owned = new Set<string>();
  for (const item of inventory) {
    if (item.kind === 'keychain') owned.add(item.id);
  }
  return owned;
}

/** `ShopItem` already satisfies `PurchaseSpec` with fields to spare — same call `SpookyHouse.collectCandy` makes. */
function shopItemToPurchase(item: ShopItem) {
  return {
    id: item.id,
    kind: item.kind,
    displayName: item.displayName,
    icon: item.icon,
    category: item.category,
    shopId: item.shopId,
    price: item.price,
    carryable: item.carryable,
  };
}

function disposeGroup(root: Group): void {
  root.traverse((object) => {
    const mesh = object as Partial<Mesh>;
    mesh.geometry?.dispose();
  });
}

/**
 * The zoomed view's on-screen ✕ — `.shop-close`, the same class `Shopping`'s
 * own panel and `ParkMap` already use for "leave this view", so it reads as
 * the same button a child has met elsewhere rather than a new one to learn.
 * Hidden (not removed) when the view is shut, via {@link setCloseButtonVisible}.
 */
function buildCloseButton(uiRoot: HTMLElement, onClose: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'keychain-view-close';
  wrap.dataset.show = 'false';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shop-close';
  button.setAttribute('aria-label', 'Close the charm rack');
  button.textContent = '✕';
  button.addEventListener('click', () => {
    button.blur();
    onClose();
  });

  wrap.append(button);
  uiRoot.append(wrap);
  return wrap;
}

function setCloseButtonVisible(button: HTMLElement | null, visible: boolean): void {
  if (!button) return;
  button.dataset.show = visible ? 'true' : 'false';
}
