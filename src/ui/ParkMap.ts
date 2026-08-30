import { Vector3 } from 'three';
import { BUILDING_FLOOR_COUNT, INTERIOR_HALF_X, INTERIOR_HALF_Z, INTERIOR_ORIGIN_X, INTERIOR_ORIGIN_Z, PLAYER_RADIUS } from '../core/constants';
import { PALETTE, hexToCss } from '../core/palette';
import { isTouchDevice } from '../core/device';
import { minTextPx, uiUnitPx } from '../core/uiScale';
import { gameStore } from '../state';
import { ANCHORS_BY_ID } from '../world/anchors';
import { PARK_BOUNDARY } from '../world/boundary';
import { PLAZA, type RouteDefinition } from '../world/paths';
import { ROUTES, routeCurve } from '../world/pathGraph';
import { STALLS } from '../minigames';
import { ENTRANCE_GATE_HALF_WIDTH } from '../world/entrance/layout';
import { CAT_BUS_LENGTH, CAT_BUS_ROUTE_NUMBER } from '../world/entrance/catBus';
import { capture, wheelNotches } from '../core/input/PointerControls';
import {
  TAP_MAX_DRIFT_PX,
  completesTap,
  tapCandidate,
  tapDriftedTooFar,
  type TapCandidate,
} from '../core/input/tapGesture';
import { MAP_PALETTE, drawIcon } from './parkMapArt';
import { parkMapFeatures, type MapFeature } from './parkMapContent';
import {
  clampMapView,
  defaultMapView,
  frameHalfExtent,
  outdoorParkMapProjection,
  pannedBy,
  zoomedAboutPoint,
  type MapProjection,
  type MapView,
} from './parkMapProjection';
import type { World } from '../world/World';
import type { Player } from '../entities/Player';
import { SLIDE_PLAN } from '../world/slide/plan';
import {
  GROWN_UP_X,
  GROWN_UP_Z,
  HELTER_DECK,
  HELTER_ENTRY_X,
  HELTER_ENTRY_Z,
  LIFT_CAR_X,
  LIFT_CAR_Z,
  ROOF_PAVILION_HALF_X,
  ROOF_PAVILION_HALF_Z,
  ROOF_PAVILION_X,
  ROOF_PAVILION_Z,
  SHOP_UNITS,
  STAIR_STAND_X,
  STAIR_STAND_Z,
  TOILET_DECK,
  TOILET_STAND_X,
  TOILET_STAND_Z,
  TOP_DECK,
  TRAMPOLINE_X,
  TRAMPOLINE_Z,
  insideInterior,
  worldX,
  worldZ,
} from '../world/building/layout';

/**
 * The park map — GAME_DESIGN.md #24, and the tap-to-travel half of it, #30d.
 *
 * A full-screen overlay, opened by a HUD pill or the `M` key, that draws the
 * park (or, indoors, the current floor) **from the same data everything else in
 * the game is built from** — `world/anchors.ts`'s plots, `world/paths.ts`'s
 * route control points, `world/building/layout.ts`'s floor plan, the solved
 * train loop, the fairground stalls — rather than a hand-drawn picture. Move an
 * anchor, add a shop, re-route the train, and the map simply draws it in its new
 * place next time it opens: there is nothing here for a builder to remember to
 * update.
 *
 * Two views, chosen automatically by where the player actually is
 * (`world.building.playerIsInside`):
 *
 * - **Outdoors**: the whole park from above — paths, the fountain plaza, every
 *   ride plot, the train loop and its stations, the stalls, and a marker for the
 *   player showing position and facing.
 * - **Indoors**: the current floor's plan — shop units, the stairs/lift/
 *   escalator/trampoline/helter-skelter, the toilets, the roof pavilion —
 *   with buttons and the arrow keys to look at other floors. Opens on the
 *   player's own floor.
 *
 * Tapping a reachable spot closes the map and sends the character there through
 * `TapNavigator.navigateTo` — the same walk everything else in the game uses,
 * not a second movement system. A tap on a wall, off the edge of the park, or
 * (indoors) on a floor other than the one being viewed politely refuses with a
 * little wobble instead of doing something odd.
 *
 * **A tap that lands on an attraction is the one exception** (GitHub issue
 * #309): a ride, a stall, the hotel lobby, a garden cart — every one of them
 * has a collision footprint, which used to be indistinguishable from a wall as
 * far as this map was concerned, so tapping a ride's plot got the same
 * "can't walk there" refusal as tapping its fence. `Game.useZoneNear` is
 * tried before the plain reachability check: if the tap lands on a
 * registered `InteractZone`, she walks to its stand point and uses it on
 * arrival — the ordinary walk-up-and-press-E flow, not a second one — and
 * only a tap that names nothing at all falls through to the old rule.
 *
 * Pause discipline follows `CuteODex` exactly: opening pauses the park only if
 * it was not already paused by something else, and closing only ever undoes
 * that — the same "every close path restores movement, hop and zoom" rule
 * QA-PLAYBOOK.md holds every overlay to.
 */

const PLAYER_MARKER_COLOUR = PALETTE.markerPink;
const REACHABLE_TOLERANCE_SQ = 0.05 * 0.05;


/**
 * Names for the two booths whose own copy lives inside a three.js module
 * (`world/FacePaintStall.ts`, `world/KeychainShop.ts`) as an interact-zone
 * label rather than in a data table the map can read. Map captions, in the
 * same spirit as the map's other captions — short enough to sit under a small
 * picture on a phone. Everything else on the map gets its name from the owner
 * that already holds it, joined on id in {@link featureCopy}.
 */
const MAP_ONLY_TITLES: Readonly<Record<string, string>> = {
  facePaint: 'Face Painting',
  keychain: 'Keyrings',
};

/**
 * How many of the park's real trees to draw.
 *
 * The park plants hundreds; drawing all of them would bury the attractions in
 * foliage and lose the reference's "generous empty lawn between attractions"
 * composition entirely. So the biggest ones are drawn — a real subset of real
 * trees, chosen by the radius the park itself gave them, never a scatter of
 * invented ones. Which trees appear is therefore still a fact about the park.
 */
const MAP_TREE_COUNT = 26;

/**
 * Closest two drawn trees may be, in metres of park.
 *
 * Chosen so 26 trees can still be found on every seed while spreading them
 * right across an ~80 m park rather than clumping wherever the foliage scatter
 * rolled its biggest canopies.
 */
const MAP_TREE_SPACING_M = 11;

/**
 * How big each kind of thing is drawn, in `uiUnitPx()` units.
 *
 * A hierarchy rather than one size: the castle and the hotel are the landmarks
 * a child orients by and are drawn biggest, rides next, small furniture
 * smallest. In `uiUnitPx` so the whole map grows with GAME_DESIGN.md's
 * UI-SCALE rule — the icons get bigger on a phone exactly as the text does,
 * rather than staying a fixed pixel size that only suits a desktop.
 *
 * Note these are *drawing* sizes and deliberately not the attraction's true
 * footprint: the reference's idiom is a chunky recognisable object, and a
 * to-scale plan view of a ticket booth is a dot nobody can read. The
 * **position** stays exact — which is the half that has to be true for the map
 * to be navigable, and the half `check:park-map` pins.
 */
const FEATURE_ICON_SIZE: Readonly<Record<MapFeature['kind'], number>> = {
  castle: 4.4,
  anchor: 3.4,
  stall: 2.9,
  fountain: 2.4,
  station: 2.2,
  // The gate and the bus are the way in, so they are drawn at ride size rather
  // than furniture size — a child looking for "where I came in" should find it
  // as easily as she finds a ride.
  gate: 3.2,
  catBus: 3.2,
};

/**
 * The most park, in metres, any one picture may cover.
 *
 * **Why a second limit exists.** `FEATURE_ICON_SIZE` is in `uiUnitPx()`, which
 * tracks the *screen* so icons stay tappable and legible under GAME_DESIGN.md's
 * UI-SCALE rule. The map's `scale` tracks the *canvas*. Those two are
 * independent, and on a small canvas they diverge badly: measured in review of
 * PR #353, one stall icon covered 18 m of park on a desktop and **47 m** in
 * phone landscape. At 47 m everything overlapped everything, `drawLabel`
 * discarded the losers, and a phone drew 4 of 14 names — a picture with no
 * name, against Jim's explicit "(still labelled)".
 *
 * So an icon is the smaller of "what the screen wants" and "what the park can
 * spare". These figures are the real thing's own rough extent: the castle is a
 * genuinely large building, a station hut is small.
 */
const FEATURE_ICON_MAX_METRES: Readonly<Record<MapFeature['kind'], number>> = {
  castle: 27,
  anchor: 20,
  stall: 15,
  fountain: 13,
  station: 11,
  // These two are the only entries taken from the thing itself rather than
  // estimated, because both are already measured constants: the arch is
  // `ENTRANCE_GATE_HALF_WIDTH` either side of centre, and the bus is
  // `CAT_BUS_LENGTH` long. A picture no wider than the real thing cannot
  // over-claim ground, which is what this cap is for.
  gate: ENTRANCE_GATE_HALF_WIDTH * 2,
  catBus: CAT_BUS_LENGTH,
};

/** An icon's drawn size: legible on the screen, honest about the park. */
function featureIconPx(kind: MapFeature['kind'], scale: number): number {
  return Math.min(FEATURE_ICON_SIZE[kind] * uiUnitPx(), FEATURE_ICON_MAX_METRES[kind] * scale);
}

/** Which drawing a feature gets. Stations and the fountain share one each. */
function iconKey(feature: MapFeature): string {
  if (feature.kind === 'station') return 'station';
  if (feature.kind === 'fountain') return 'fountain';
  return feature.id;
}

export interface ParkMapDeps {
  readonly world: World;
  readonly player: Player;
  /** Walk the character to a world point — wraps `TapNavigator.navigateTo`. */
  walkTo(x: number, y: number, z: number): void;
  /** True while something else already owns the screen (a ride, a mini-game). */
  blocked(): boolean;
  /**
   * GitHub issue #309: a tap that landed on an attraction (ride, stall, the
   * hotel lobby, a garden cart…) — walks her to its stand point and uses it
   * on arrival, the same walk-up-and-press-E plumbing a chip commit already
   * uses. Returns false for anything that isn't a real, usable attraction, so
   * the ordinary reachability check and plain walk below still run for open
   * ground. Wraps `Game.useZoneNear`.
   */
  useAttraction(x: number, y: number, z: number): boolean;
}

/** Where a place name ended up on the canvas, so the next one can avoid it. */
interface LabelBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** A name that found room: where it goes, and the box it reserved. */
interface LabelPlacement {
  readonly lines: readonly string[];
  readonly px: number;
  readonly py: number;
  readonly size: number;
  readonly lineHeight: number;
  readonly box: LabelBox;
}

interface FloorFeature {
  readonly x: number;
  readonly z: number;
  readonly glyph: string;
  readonly label: string;
  /** Which decks show this feature. */
  readonly decks: readonly number[];
}

/** Fixed floor furniture, straight out of `layout.ts` — never hand-copied. */
const FLOOR_FEATURES: readonly FloorFeature[] = (() => {
  const everyDeck = Array.from({ length: BUILDING_FLOOR_COUNT }, (_, i) => i);
  return [
    { x: STAIR_STAND_X, z: STAIR_STAND_Z, glyph: '🪜', label: 'Stairs', decks: everyDeck },
    { x: LIFT_CAR_X, z: LIFT_CAR_Z, glyph: '🛗', label: 'Lift', decks: everyDeck },
    // The escalator shaft is the same XZ footprint on every deck it serves —
    // ground floor up to the roof.
    { x: -12.05, z: 0.2, glyph: '⬆️', label: 'Escalator', decks: everyDeck },
    { x: TRAMPOLINE_X, z: TRAMPOLINE_Z, glyph: '🤸', label: 'Trampoline', decks: [0] },
    { x: HELTER_ENTRY_X, z: HELTER_ENTRY_Z, glyph: '🌀', label: 'Helter-skelter', decks: [HELTER_DECK] },
    { x: TOILET_STAND_X, z: TOILET_STAND_Z, glyph: '🚻', label: 'Toilets', decks: [TOILET_DECK] },
    {
      x: SLIDE_PLAN.entryX,
      z: SLIDE_PLAN.entryZ,
      glyph: '🎢',
      label: 'Ginormous slide',
      decks: [TOP_DECK],
    },
    { x: GROWN_UP_X, z: GROWN_UP_Z, glyph: '🤗', label: 'Grown-up', decks: [TOP_DECK] },
    {
      x: ROOF_PAVILION_X,
      z: ROOF_PAVILION_Z,
      glyph: '🏡',
      label: 'Pavilion',
      decks: [TOP_DECK],
    },
  ];
})();

export class ParkMap {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly canvasWrap: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly floorRow: HTMLElement;
  private readonly floorLabel: HTMLElement;
  private readonly upButton: HTMLButtonElement;
  private readonly downButton: HTMLButtonElement;
  private readonly hint: HTMLElement;

  private open = false;
  private pausedByUs = false;
  private indoor = false;
  private viewingDeck = 0;
  private playerDeck: number | null = null;

  private projection: MapProjection = frameHalfExtent(1, 1, 1, 1);
  private scale = 1;

  /**
   * How far in the child has zoomed and what she is looking at (#359).
   *
   * `null` means "not chosen yet" — the first render frames the whole park via
   * `defaultMapView`, which needs a canvas size and so cannot be settled in a
   * field initialiser. Reset to `null` on close, so the map always opens
   * showing the whole park rather than wherever she left it: a six-year-old
   * who opens the map to find out where she is wants the overview, and a map
   * that reopens zoomed into a corner reads as broken.
   *
   * Outdoor only. The indoor floor plan has one screen's worth of building and
   * nothing to pan to.
   */
  private view: MapView | null = null;

  /**
   * The finger currently down on the dimmed backdrop, if it is still a
   * candidate for a definite tap. `null` the moment it drifts far enough to be
   * a drag, or a second finger joins it — see the listener wiring above.
   */
  private backdropTap: (TapCandidate & { readonly pointerId: number }) | null = null;

  /** Live pointers on the map canvas, for drag-to-pan and pinch-to-zoom. */
  private readonly mapPointers = new Map<number, { x: number; y: number }>();
  /** Finger separation when the current pinch began, in canvas pixels. */
  private pinchStartDistance = 0;
  /** Zoom when the current pinch began — pinch is relative to it, not cumulative. */
  private pinchStartZoom = 1;
  /**
   * Set once a gesture has moved far enough to be a drag rather than a tap.
   *
   * Without this, panning the map would also walk the child to wherever her
   * finger came to rest — the tap-to-walk plumbing of #309/#315 fires on
   * pointer *up*. The threshold is in CSS pixels and generous, because a
   * six-year-old's tap is not still.
   */
  private gestureMoved = false;
  /**
   * Where and when the current one-finger gesture began, for the drag-slop and
   * time tests. In canvas pixels, and a `TapCandidate` so the canvas answers
   * "was that a tap?" with `tapGesture.ts`'s definition rather than a second
   * one — it used to use 8 px and no time limit at all while tap-to-walk in the
   * park used 18 px and 600 ms.
   */
  private gestureStart: TapCandidate | null = null;
  /** Features on screen at the current zoom — the honest label denominator. */
  private visibleFeatureCount = 0;
  /**
   * Which names were painted, and which were dropped, on the last render.
   *
   * Both lists come from the renderer's own placement loop, so QA reads names
   * off the DOM rather than eyeballing a screenshot: "four attractions lose
   * their labels" is only actionable if it says *which* four. Counting painted
   * text runs from outside cannot do it — a long name is drawn as two lines.
   */
  private drawnLabelNames: string[] = [];
  private missingLabelNames: string[] = [];
  private canvasCssWidth = 0;
  private canvasCssHeight = 0;
  /** Rebuilt every render; see `drawLabel`. */
  private readonly labelBoxes: LabelBox[] = [];
  /** The pictures' own solid cores, so no name is written across one. */
  private readonly iconBoxes: LabelBox[] = [];

  private readonly deps: ParkMapDeps;

  constructor(container: HTMLElement, deps: ParkMapDeps) {
    this.deps = deps;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'pill pill--map';
    this.button.setAttribute('aria-label', 'Open the park map');
    this.button.innerHTML = '<span class="emoji">🗺️</span><span>Map</span>';
    this.button.addEventListener('click', () => {
      this.button.blur();
      this.toggle();
    });
    // Into the HUD's menu drawer, with the other pills — see `ui/Hud.ts`.
    (container.querySelector('.hud-menu-items') ?? container).append(this.button);

    this.root = document.createElement('div');
    this.root.className = 'parkmap';
    this.root.dataset.open = 'false';
    // **A definite tap on the dimmed backdrop is a "no thanks" — a press is
    // not.** This used to close on `pointerdown` alone, which is the bug Jim
    // reported on 29 August 2026: on landscape, tablet and desktop the map
    // vanished before his finger lifted, and a finger that landed in the
    // margin and then moved — the start of a pinch, or a pan, or a
    // six-year-old steadying her thumb — dismissed it instantly. Measured
    // before the fix at 390x844/844x390/768x1024/1440x900: closed on
    // `pointerdown` at every viewport that has a backdrop at all.
    //
    // Down *and* up on the backdrop itself, within `tapGesture.ts`'s drift and
    // time window — the same definition tap-to-walk uses, not a second one.
    this.root.addEventListener('pointerdown', this.onBackdropPointerDown);
    this.root.addEventListener('pointermove', this.onBackdropPointerMove);
    this.root.addEventListener('pointerup', this.onBackdropPointerUp);
    this.root.addEventListener('pointercancel', this.onBackdropPointerLost);

    this.card = document.createElement('div');
    this.card.className = 'parkmap-card';

    const head = document.createElement('div');
    head.className = 'shop-head';
    const glyph = document.createElement('span');
    glyph.className = 'shop-glyph';
    glyph.textContent = '🗺️';
    const titles = document.createElement('div');
    titles.className = 'shop-titles';
    this.titleEl = document.createElement('h2');
    this.titleEl.className = 'shop-title';
    this.titleEl.textContent = 'The Park';
    const greeting = document.createElement('p');
    greeting.className = 'shop-greeting';
    greeting.textContent = 'Tap a spot to walk there!';
    titles.append(this.titleEl, greeting);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'shop-close';
    close.setAttribute('aria-label', 'Close the map');
    close.textContent = '✕';
    close.addEventListener('click', () => {
      close.blur();
      this.close();
    });
    head.append(glyph, titles, close);

    this.floorRow = document.createElement('div');
    this.floorRow.className = 'parkmap-floors';
    this.downButton = document.createElement('button');
    this.downButton.type = 'button';
    this.downButton.className = 'parkmap-floor-btn';
    this.downButton.setAttribute('aria-label', 'Look at the floor below');
    this.downButton.textContent = '⬇️';
    this.downButton.addEventListener('click', () => {
      this.downButton.blur();
      this.changeDeck(-1);
    });
    this.floorLabel = document.createElement('span');
    this.floorLabel.className = 'parkmap-floor-label';
    this.upButton = document.createElement('button');
    this.upButton.type = 'button';
    this.upButton.className = 'parkmap-floor-btn';
    this.upButton.setAttribute('aria-label', 'Look at the floor above');
    this.upButton.textContent = '⬆️';
    this.upButton.addEventListener('click', () => {
      this.upButton.blur();
      this.changeDeck(1);
    });
    this.floorRow.append(this.downButton, this.floorLabel, this.upButton);

    this.canvasWrap = document.createElement('div');
    this.canvasWrap.className = 'parkmap-canvas-wrap';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'parkmap-canvas';
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('ParkMap: 2D canvas context unavailable');
    this.ctx = ctx;
    // **Tap fires on pointer *up*, not down (#359).** It used to fire on
    // `pointerdown`, which cannot coexist with drag-to-pan: the walk would be
    // committed before the child had moved her finger far enough for the
    // gesture to be recognised as a pan. `onCanvasPointerUp` runs the same tap
    // handler, but only when the gesture never became a drag.
    this.canvas.addEventListener('pointerdown', (event) => this.onCanvasPointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.onCanvasPointerMove(event));
    this.canvas.addEventListener('pointerup', (event) => this.onCanvasPointerUp(event));
    this.canvas.addEventListener('pointercancel', (event) => this.onCanvasPointerLost(event));
    // `{ passive: false }`: the wheel must zoom the map, never scroll the page
    // behind it. Scoped to the map's own canvas, so the shop and the Cute-o-dex
    // keep scrolling normally — the same rule `PointerControls` follows.
    this.canvas.addEventListener('wheel', (event) => this.onCanvasWheel(event), { passive: false });
    this.canvasWrap.append(this.canvas);

    this.hint = document.createElement('p');
    this.hint.className = 'shop-hint';
    // Text set in `updateHint`, from the layout that actually rendered — see
    // there for why it cannot be settled here.

    this.card.append(head, this.floorRow, this.canvasWrap, this.hint);
    this.root.append(this.card);
    container.append(this.root);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openMap();
  }

  openMap(): void {
    // Never open on top of another paused overlay (a shop, the Cute-o-dex, the
    // backpack…) or while a ride/mini-game already owns the screen.
    if (gameStore.get().paused && !this.pausedByUs) return;
    if (this.deps.blocked()) return;

    this.indoor = this.deps.world.building.playerIsInside;
    const { x, y, z } = this.deps.player.position;
    this.playerDeck = this.indoor ? this.deps.world.building.surfaces.deckAt(x, z, y) : null;
    this.viewingDeck = this.playerDeck ?? 0;

    this.open = true;
    this.root.dataset.open = 'true';
    this.button.dataset.active = 'true';
    if (!gameStore.get().paused) {
      this.pausedByUs = true;
      gameStore.setPaused(true);
    }
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.dataset.open = 'false';
    this.button.dataset.active = 'false';
    // Next open frames the whole park again (#359). A child opening the map
    // wants to know where she is; reopening zoomed into the corner she left it
    // in reads as the map being broken. Gesture state goes with it, so a
    // finger lifted outside the canvas cannot leave a pinch half-started.
    this.view = null;
    this.backdropTap = null;
    this.mapPointers.clear();
    this.pinchStartDistance = 0;
    this.gestureMoved = false;
    this.gestureStart = null;
    if (this.pausedByUs) {
      this.pausedByUs = false;
      gameStore.setPaused(false);
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
    this.button.remove();
  }

  // -------------------------------------------------------------- internals

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    if (event.code === 'KeyM') {
      event.preventDefault();
      this.toggle();
      return;
    }
    if (!this.open) return;
    if (event.code === 'ArrowUp' && this.indoor) {
      event.preventDefault();
      this.changeDeck(1);
    } else if (event.code === 'ArrowDown' && this.indoor) {
      event.preventDefault();
      this.changeDeck(-1);
    }
  };

  private readonly onResize = (): void => {
    if (this.open) this.render();
  };

  private changeDeck(delta: number): void {
    if (!this.indoor) return;
    const next = this.viewingDeck + delta;
    if (next < 0 || next > TOP_DECK) return;
    this.viewingDeck = next;
    this.render();
  }

  // ------------------------------------------------------------- the hint

  /**
   * **Is there any dimmed backdrop to tap?** Measured, not assumed.
   *
   * On a phone in portrait the card is full-bleed — `.parkmap-card` is
   * `100%` of an unpadded container below 34rem — so there is no margin
   * around it and nothing outside to tap. The hint nevertheless read "Tap
   * where to go, or tap outside to close" on every screen, which told a
   * six-year-old to do something impossible and is most likely why Jim's
   * report reads as intermittent: in portrait he could not hit the backdrop at
   * all, while landscape surrounds the card with a wide margin.
   *
   * Layout metrics rather than `getBoundingClientRect`, deliberately:
   * `.parkmap-card` opens with a `shop-pop` scale animation, and a
   * transform-aware rect measured on the opening frame reports a card smaller
   * than the one that settles — which would claim a backdrop that is about to
   * vanish. `offsetWidth`/`clientWidth` are untransformed layout, so this
   * reads the same on the first frame as on the last.
   *
   * And a threshold rather than "greater than zero": a two-pixel seam is not
   * something to tell a child to aim at. It is
   * `TAP_MAX_DRIFT_PX` either side — a tap allowed to wander that far needs at
   * least that much band to land in — so it is derived from the same one
   * definition of a tap the backdrop listener uses, not a fresh guess.
   */
  private hasTappableBackdrop(): boolean {
    const slackX = this.root.clientWidth - this.card.offsetWidth;
    const slackY = this.root.clientHeight - this.card.offsetHeight;
    // The card is centred, so each side gets half the slack.
    return Math.max(slackX, slackY) / 2 >= TAP_MAX_DRIFT_PX;
  }

  /** The truth about how to close this map, on the screen it is actually on. */
  private updateHint(): void {
    if (!isTouchDevice()) {
      this.hint.textContent = 'Click where to go · Esc or M to close.';
      return;
    }
    this.hint.textContent = this.hasTappableBackdrop()
      ? 'Tap where to go, or tap outside to close.'
      : 'Tap where to go, or tap ✕ to close.';
  }

  // ---------------------------------------------------------- the backdrop

  /**
   * A press on the dimmed margin around the card starts a *candidate* tap and
   * nothing else. Only `pointerup` can close the map, and only if the finger
   * never went anywhere.
   *
   * Scoped to `event.target === this.root`: a finger that came down on the
   * card, the canvas, or a button is not on the backdrop at all, and must not
   * arm this even though its event bubbles through here.
   */
  private readonly onBackdropPointerDown = (event: PointerEvent): void => {
    if (event.target !== this.root) {
      // Something inside the card has it. Any tap candidate we were holding is
      // no longer the only finger down, so it is not a tap any more.
      this.backdropTap = null;
      return;
    }
    // A second finger on the backdrop is a pinch that happened to start wide,
    // not two taps. Neither is a tap after this.
    if (this.backdropTap) {
      this.backdropTap = null;
      return;
    }
    this.backdropTap = {
      // `event.timeStamp`, not `performance.now()` — see `TapCandidate`.
      ...tapCandidate(event.clientX, event.clientY, event.timeStamp),
      pointerId: event.pointerId,
    };
  };

  private readonly onBackdropPointerMove = (event: PointerEvent): void => {
    const candidate = this.backdropTap;
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    // Travelled: this is a drag, and a drag that began on the backdrop must
    // leave the map alone. Measured from where it began, never summed per
    // frame, so a slow drift still counts.
    if (!completesTap(candidate, event.clientX, event.clientY, event.timeStamp)) {
      this.backdropTap = null;
    }
  };

  private readonly onBackdropPointerUp = (event: PointerEvent): void => {
    const candidate = this.backdropTap;
    this.backdropTap = null;
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    // Up on the backdrop too, not merely down on it — lifting over the card
    // after sliding off the margin is not a tap on the margin.
    if (event.target !== this.root) return;
    if (!completesTap(candidate, event.clientX, event.clientY, event.timeStamp)) return;
    this.close();
  };

  private readonly onBackdropPointerLost = (event: PointerEvent): void => {
    if (this.backdropTap?.pointerId === event.pointerId) this.backdropTap = null;
  };

  // --------------------------------------------------------- pan and zoom

  /** Canvas-relative pixel for a pointer event. */
  private canvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** The live view, framing the whole park until the child moves it. */
  private currentView(): MapView {
    if (!this.view) this.view = defaultMapView(this.canvasCssWidth, this.canvasCssHeight);
    return this.view;
  }

  private setView(next: MapView): void {
    this.view = clampMapView(next, this.canvasCssWidth, this.canvasCssHeight);
    this.render();
  }

  private onCanvasPointerDown(event: PointerEvent): void {
    // Via `PointerControls.capture`, which swallows the `NotFoundError` a
    // released or synthesised pointer throws. Called raw it threw for the
    // reviewer of #372, and because it was the first line the rest of this
    // handler never ran — a pan or pinch silently failed to start.
    capture(this.canvas, event.pointerId, true);
    this.mapPointers.set(event.pointerId, this.canvasPoint(event));
    if (this.mapPointers.size === 1) {
      this.gestureMoved = false;
      const point = this.canvasPoint(event);
      this.gestureStart = tapCandidate(point.x, point.y, event.timeStamp);
    }
    if (this.mapPointers.size === 2) {
      // Two fingers: a pinch, and neither finger is a tap any more.
      this.gestureMoved = true;
      this.pinchStartDistance = this.pointerSeparation();
      this.pinchStartZoom = this.currentView().zoom;
    }
  }

  private onCanvasPointerMove(event: PointerEvent): void {
    const previous = this.mapPointers.get(event.pointerId);
    if (!previous) return;
    const point = this.canvasPoint(event);
    this.mapPointers.set(event.pointerId, point);

    // The floor plan is one screen of building; nothing to pan to.
    if (this.indoor) return;

    if (this.mapPointers.size >= 2) {
      const distance = this.pointerSeparation();
      if (this.pinchStartDistance > 0 && distance > 0) {
        const centre = this.pointerCentre();
        this.setView(
          zoomedAboutPoint(
            this.currentView(),
            this.pinchStartZoom * (distance / this.pinchStartDistance),
            centre.x,
            centre.y,
            this.canvasCssWidth,
            this.canvasCssHeight,
          ),
        );
      }
      return;
    }

    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    if (Math.hypot(dx, dy) > 0 && !this.gestureMoved) {
      // Measured from where the gesture started, not summed per frame, so a
      // slow drift over many small moves still becomes a drag.
      const start = this.gestureStart ?? tapCandidate(previous.x, previous.y);
      if (tapDriftedTooFar(start, point.x, point.y)) this.gestureMoved = true;
    }
    if (this.gestureMoved) {
      this.setView(pannedBy(this.currentView(), dx, dy, this.canvasCssWidth, this.canvasCssHeight));
    }
  }

  private onCanvasPointerUp(event: PointerEvent): void {
    const wasDrag = this.gestureMoved;
    const hadTwo = this.mapPointers.size >= 2;
    const started = this.gestureStart;
    const point = this.canvasPoint(event);
    this.onCanvasPointerLost(event);
    // A tap only when this gesture never became a pan or a pinch, and only
    // when down-and-up make a definite tap by `tapGesture.ts`'s one definition.
    // `hadTwo` covers lifting one finger of a pinch: the second lift must not
    // walk her.
    if (wasDrag || hadTwo) return;
    if (started && !completesTap(started, point.x, point.y, event.timeStamp)) return;
    this.onCanvasTap(event);
  }

  private onCanvasPointerLost(event: PointerEvent): void {
    this.mapPointers.delete(event.pointerId);
    capture(this.canvas, event.pointerId, false);
    if (this.mapPointers.size < 2) this.pinchStartDistance = 0;
    if (this.mapPointers.size === 0) this.gestureStart = null;
  }

  private onCanvasWheel(event: WheelEvent): void {
    if (this.indoor) return;
    // Always, so the page never scrolls under a wheel that landed on the map.
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    // One notch is a fixed ratio rather than a fixed step, so zooming feels
    // the same at every level — the same reason the camera's own zoom damps.
    // `wheelNotches` from PointerControls, not a hand-divided deltaY: it is
    // the one owner of "how much is one notch", including the deltaMode
    // normalisation a line-mode (Firefox) or page-mode wheel needs.
    const factor = Math.exp(wheelNotches(event) * 0.2);
    this.setView(
      zoomedAboutPoint(
        this.currentView(),
        this.currentView().zoom * factor,
        event.clientX - rect.left,
        event.clientY - rect.top,
        this.canvasCssWidth,
        this.canvasCssHeight,
      ),
    );
  }

  private pointerSeparation(): number {
    const [a, b] = [...this.mapPointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  private pointerCentre(): { x: number; y: number } {
    const [a, b] = [...this.mapPointers.values()];
    if (!a || !b) return { x: this.canvasCssWidth / 2, y: this.canvasCssHeight / 2 };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  // ------------------------------------------------------------------ tap

  private onCanvasTap(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const worldPoint = this.canvasToPlane(px, py);

    if (this.indoor) {
      if (this.viewingDeck !== this.playerDeck) {
        // Out of scope for now (see brief item 4): walking to a different
        // floor from the map needs the stairs/lift ride wired in as well.
        this.showRefusal(event.clientX, event.clientY, "Can't get there from here yet!");
        return;
      }
      const [localX, localZ] = worldPoint;
      if (!insideInterior(localX, localZ, 3)) {
        this.showRefusal(event.clientX, event.clientY, 'Too far!');
        return;
      }
      const wx = worldX(localX);
      const wz = worldZ(localZ);
      const y = this.deps.world.building.surfaces.sample(wx, wz, this.deps.player.position.y);
      // Issue #309: an attraction's stand point may sit inside its own
      // collision footprint — a shop counter, a booth — which is exactly what
      // `isReachable` exists to reject for open ground. Try the attraction
      // first, so a tap that lands on one walks her there and uses it rather
      // than being told "can't walk there" for standing on solid scenery.
      if (this.deps.useAttraction(wx, y, wz)) {
        this.close();
        return;
      }
      if (!this.isReachable(wx, wz)) {
        this.showRefusal(event.clientX, event.clientY, "Can't walk there!");
        return;
      }
      this.close();
      this.deps.walkTo(wx, y, wz);
      return;
    }

    const [wx, wz] = worldPoint;
    const y = this.deps.world.building.surfaces.sample(wx, wz, this.deps.player.position.y);
    if (this.deps.useAttraction(wx, y, wz)) {
      this.close();
      return;
    }
    if (!this.isReachable(wx, wz)) {
      this.showRefusal(event.clientX, event.clientY, "Can't walk there!");
      return;
    }
    this.close();
    this.deps.walkTo(wx, y, wz);
  }

  /**
   * "Would a walker fit here?" — the same collider set the character bumps
   * into, used as a query rather than a movement (the same trick the train's
   * route-solver uses on the same `CollisionWorld`): put a probe at the tapped
   * point and see how far it has to be pushed to stop overlapping anything.
   * Barely moved at all means clear ground; shoved a real distance means a
   * wall, a ride's fence, or outside the park/floor's soft boundary.
   */
  private isReachable(x: number, z: number): boolean {
    const probe = new Vector3(x, 0, z);
    this.deps.world.collision.resolve(probe, PLAYER_RADIUS);
    const dx = probe.x - x;
    const dz = probe.z - z;
    return dx * dx + dz * dz < REACHABLE_TOLERANCE_SQ;
  }

  private showRefusal(clientX: number, clientY: number, message: string): void {
    const rect = this.canvasWrap.getBoundingClientRect();
    const chip = document.createElement('div');
    chip.className = 'parkmap-refuse';
    chip.style.left = `${clientX - rect.left}px`;
    chip.style.top = `${clientY - rect.top}px`;
    chip.textContent = `🚫 ${message}`;
    this.canvasWrap.append(chip);
    chip.addEventListener('animationend', () => chip.remove());
    window.setTimeout(() => chip.remove(), 900);
  }

  // --------------------------------------------------------------- drawing

  private syncCanvasSize(): void {
    const rect = this.canvasWrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvasCssWidth = Math.max(1, rect.width);
    this.canvasCssHeight = Math.max(1, rect.height);
    this.canvas.width = Math.max(1, Math.round(this.canvasCssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(this.canvasCssHeight * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * World (outdoor) or interior-local (indoor) metres -> canvas CSS pixels.
   *
   * Delegates to the live `MapProjection` rather than repeating its arithmetic.
   * These two used to be a second copy of `toCanvas`/`toPlane` — correct, but
   * the same shape of thing as the bug this whole PR is about, and the check
   * measures the projection, so the renderer had better be using it.
   */
  private planeToCanvas(x: number, z: number): [number, number] {
    const [px, py] = this.projection.toCanvas(x, z);
    return [px, py];
  }

  private canvasToPlane(px: number, py: number): [number, number] {
    const [x, z] = this.projection.toPlane(px, py);
    return [x, z];
  }

  private render(): void {
    // Fresh page, fresh list of where the labels ended up (see `drawLabel`).
    this.labelBoxes.length = 0;
    this.iconBoxes.length = 0;
    this.canvasWrap.dataset.mode = this.indoor ? 'indoor' : 'outdoor';
    this.floorRow.hidden = !this.indoor;
    this.upButton.disabled = this.viewingDeck >= TOP_DECK;
    this.downButton.disabled = this.viewingDeck <= 0;
    // Before the canvas is measured: the hint is a card row, and what it says
    // depends on the card's own layout, which `render` re-runs on every resize
    // and rotation.
    this.updateHint();
    this.syncCanvasSize();

    // The viewport, from `parkMapProjection.ts` — the one owner of the
    // world-to-canvas transform, and the thing #234 was a bug in. Outdoors it
    // frames the real boundary's own extent, so nothing the park generated can
    // fall off the edge of the map whatever shape the seed rolled.
    const projection = this.indoor
      ? frameHalfExtent(INTERIOR_HALF_X + 6, INTERIOR_HALF_Z + 4, this.canvasCssWidth, this.canvasCssHeight)
      : outdoorParkMapProjection(this.canvasCssWidth, this.canvasCssHeight, this.currentView());
    this.projection = projection;
    this.scale = projection.scale;

    if (this.indoor) {
      this.titleEl.textContent = `Map: ${floorLabelText(this.viewingDeck)}`;
      this.renderIndoor();
    } else {
      this.titleEl.textContent = 'Map of the Park';
      this.renderOutdoor();
    }
    // How many names actually got placed, for QA to read off the DOM.
    // Counting painted text runs from outside over-counts, because a long name
    // is drawn as two lines — which is exactly how a "9 of 14" was reported to
    // a reviewer who had correctly measured 8.
    this.canvas.dataset.labelCount = String(this.labelBoxes.length);
    // So QA can report counts against the zoom they were measured at.
    this.canvas.dataset.zoom = this.indoor ? '1' : this.currentView().zoom.toFixed(3);
    // The denominator, from the same list the renderer drew — so "11 of 16" is
    // two numbers read off the DOM rather than one read and one remembered.
    // The remembered one is what went wrong last time.
    this.canvas.dataset.featureCount = String(this.indoor ? 0 : this.visibleFeatureCount);
    // By name, so a report can say which attraction lost its name rather than
    // only how many did.
    this.canvas.dataset.labelNames = JSON.stringify(this.drawnLabelNames);
    this.canvas.dataset.missingLabels = JSON.stringify(this.missingLabelNames);
  }

  private renderOutdoor(): void {
    const ctx = this.ctx;
    const w = this.canvasCssWidth;
    const h = this.canvasCssHeight;
    ctx.clearRect(0, 0, w, h);

    // --- the paper the park is drawn on -------------------------------------
    ctx.fillStyle = MAP_PALETTE.paper;
    ctx.fillRect(0, 0, w, h);

    // --- the lawn: the park's REAL outline ----------------------------------
    // `PARK_BOUNDARY.outline()` is the same 512-point closed polygon the
    // terrain, the boundary wall and the player's clamp are all built from —
    // so the island of grass on this map is the shape of the park that was
    // generated, not a circle standing in for one (issues #234, #334).
    const outline = PARK_BOUNDARY.outline();
    ctx.save();
    ctx.beginPath();
    const [o0x, o0z] = outline[0] ?? [0, 0];
    const [os0, os1] = this.planeToCanvas(o0x, o0z);
    ctx.moveTo(os0, os1);
    for (let i = 1; i < outline.length; i += 1) {
      const [ox, oz] = outline[i] as readonly [number, number];
      const [opx, opy] = this.planeToCanvas(ox, oz);
      ctx.lineTo(opx, opy);
    }
    ctx.closePath();
    // A soft drop shadow under the whole island, so the lawn sits on the
    // paper the same way each object sits on the lawn.
    ctx.save();
    ctx.translate(0, Math.max(2, 0.12 * uiUnitPx()));
    ctx.fillStyle = 'rgba(58, 51, 64, 0.10)';
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = MAP_PALETTE.lawn;
    ctx.fill();
    ctx.strokeStyle = MAP_PALETTE.lawnEdge;
    ctx.lineWidth = Math.max(2, 0.14 * uiUnitPx());
    ctx.stroke();
    // Everything else is clipped to the lawn, so a path or a tree can never
    // spill onto the paper outside the park.
    ctx.clip();

    // --- the real trees, thinned to the biggest few -------------------------
    for (const tree of this.mapTrees()) {
      const [tx, ty] = this.planeToCanvas(tree.x, tree.z);
      drawIcon(ctx, 'tree', tx, ty, 1.5 * uiUnitPx(), MAP_PALETTE.lawnDeep);
    }

    // --- paths, rebuilt from the same control points the real path network
    // uses (world/pathGraph.ts), so this can never draw a path that has moved,
    // now as the reference's broad cream ribbons.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const route of ROUTES) this.strokeRoute(route);

    // --- the fountain plaza, a wider circle of the same paving --------------
    const [px, py] = this.planeToCanvas(PLAZA.x, PLAZA.z);
    ctx.fillStyle = MAP_PALETTE.path;
    ctx.beginPath();
    ctx.arc(px, py, PLAZA.radius * this.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = MAP_PALETTE.pathEdge;
    ctx.lineWidth = Math.max(1.5, 0.08 * uiUnitPx());
    ctx.stroke();

    // --- the train loop -----------------------------------------------------
    const trainRoute = this.deps.world.train.route;
    const trainPoints: [number, number][] = [];
    const trainProbe = new Vector3();
    for (let i = 0; i < 140; i += 1) {
      trainRoute.pointAt((i / 140) * trainRoute.length, trainProbe);
      trainPoints.push([trainProbe.x, trainProbe.z]);
    }
    this.strokeCurvePoints(trainPoints, true, MAP_PALETTE.grey, 1.8, [7, 6]);

    ctx.restore();

    // --- every attraction: its own little picture, and its name -------------
    // Positions come from `parkMapContent.ts` and nowhere else, so what is
    // drawn here is exactly what `check:park-map` measures.
    // Two passes, and the order matters. Every picture is drawn first, then
    // every name on top — drawing each name straight after its own picture
    // let the *next* attraction's picture paint over the last one's name, so
    // "The Castle" read as "The C" behind the ball pit. Labels are also the
    // thing that must stay legible when the park is crowded, so they get the
    // last word on every pixel they need.
    const features = this.features();

    // A ride's real footprint, as a patch of worn grass under its picture.
    // The picture is a chunky storybook object and deliberately not to scale;
    // this is, so the ground the ride actually occupies is on the map even
    // where the icon over-covers or under-covers it.
    ctx.save();
    // Faint, not solid: this is a hint that the ride occupies ground, not a
    // shape competing with the picture standing on it. Drawn opaque it read
    // as a rendering glitch — a dark square with a ride sitting in it.
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = MAP_PALETTE.lawnDeep;
    for (const feature of features) {
      if (feature.kind !== 'anchor' && feature.kind !== 'castle') continue;
      const anchor = ANCHORS_BY_ID[feature.id as keyof typeof ANCHORS_BY_ID];
      if (!anchor) continue;
      const [ax, ay] = this.planeToCanvas(feature.x, feature.z);
      ctx.beginPath();
      if (anchor.footprint.kind === 'circle') {
        ctx.ellipse(ax, ay, anchor.footprint.radius * this.scale, anchor.footprint.radius * this.scale, 0, 0, Math.PI * 2);
      } else {
        const halfW = anchor.footprint.halfX * this.scale;
        const halfH = anchor.footprint.halfZ * this.scale;
        const radius = Math.min(halfW, halfH) * 0.35;
        if (ctx.roundRect) ctx.roundRect(ax - halfW, ay - halfH, halfW * 2, halfH * 2, radius);
        else ctx.rect(ax - halfW, ay - halfH, halfW * 2, halfH * 2);
      }
      ctx.fill();
    }
    ctx.restore();

    const placed: { px: number; py: number; size: number; label: string }[] = [];
    // Counted, not assumed: how many features are actually on screen at this
    // zoom. `dataset.featureCount` reports this rather than the whole park, so
    // "11 of 16" zoomed out and "5 of 5" zoomed in are both honest — a
    // denominator that ignored the viewport would make every zoomed-in reading
    // look like a failure while the child could in fact read every name in
    // front of her. This is the number #359 is actually about.
    let visibleFeatures = 0;
    for (const feature of features) {
      const [fx, fy] = this.planeToCanvas(feature.x, feature.z);
      const { label, accent } = this.featureCopy(feature);
      const size = featureIconPx(feature.kind, this.scale);
      // Off-screen once zoomed in. Skipped entirely rather than drawn into the
      // void: an icon box outside the canvas can still block a label that
      // wanted to sit near the edge, so leaving them in would cost names for
      // pictures nobody can see.
      if (
        fx + size < 0 ||
        fx - size > this.canvasCssWidth ||
        fy + size < 0 ||
        fy - size > this.canvasCssHeight
      ) {
        continue;
      }
      visibleFeatures += 1;
      drawIcon(ctx, iconKey(feature), fx, fy, size, accent);
      // Reserve the picture's own box, so a *later* name cannot be written
      // across it — labels used to test only against other labels, which is
      // why "The Castle" painted straight over the Ball Pit.
      // The picture's solid core only. A sprite's box is mostly air at the
      // corners, and reserving the whole of it starved the labels: measured at
      // 7 names of 14 on a desktop, worse than the bug being fixed.
      this.iconBoxes.push({
        left: fx - size * 0.3,
        right: fx + size * 0.3,
        top: fy - size * 0.42,
        bottom: fy + size * 0.4,
      });
      placed.push({ px: fx, py: fy, size, label });
    }
    this.visibleFeatureCount = visibleFeatures;
    // Under the picture by preference, above it if that spot is taken, then
    // marching outward until the paper runs out — see `labelCandidates`. A
    // name that still cannot be placed is dropped rather than written over
    // something, and is reported by name in `dataset.missingLabels`.
    this.drawnLabelNames = [];
    this.missingLabelNames = [];
    const placements: { placement: LabelPlacement; anchorX: number; anchorY: number }[] = [];
    for (const item of placed) {
      let placement: LabelPlacement | null = null;
      for (const [lx, ly] of this.labelCandidates(item)) {
        placement = this.placeLabel(item.label, lx, ly);
        if (placement) break;
      }
      if (placement) placements.push({ placement, anchorX: item.px, anchorY: item.py });
      (placement ? this.drawnLabelNames : this.missingLabelNames).push(item.label);
    }
    // Every leader first, then every name — so no line can be stroked across a
    // finished name. See `placeLabel`.
    for (const { placement, anchorX, anchorY } of placements) {
      this.drawLabelLeader(placement, anchorX, anchorY);
    }
    for (const { placement } of placements) this.paintLabel(placement);

    // --- the player ----------------------------------------------------------
    if (!this.indoor) {
      const { x, z } = this.deps.player.position;
      this.drawPlayerMarker(x, z);
    }
  }

  /**
   * Where a name may go, best spot first.
   *
   * Under the picture, then over it, then shouldered left and right — and then
   * the same six rungs again, stepped further and further out until the
   * candidates have reached the edge of the canvas.
   *
   * **The far rungs are how the map uses the paper it has.** The projection is
   * uniform (a metre across is a metre down, and it must stay that way or every
   * bearing on the map becomes a lie), so on a portrait phone the park is
   * width-limited and the canvas is left with large blank bands: measured at
   * 390x844, the park draws 380x336 px inside a 380x693 px canvas — **357 px,
   * 52% of the paper, empty**. There is no honest way to fill that with *park*
   * — filling the height would mean showing 92 m of a 190 m-wide park, so half
   * the park would be off the map at the default zoom, which is the opposite of
   * what a map is for. But there is an honest way to fill it with **names**,
   * which is the thing that was actually scarce: a name that has nowhere to sit
   * beside its picture goes out into the band, with a leader line back to the
   * picture it belongs to (see `drawLabel`).
   *
   * The ladder is generated rather than listed so its reach follows the canvas.
   * It used to be twelve hand-written positions stopping two steps out, which
   * on a portrait phone stopped well short of the empty band.
   */
  private labelCandidates(item: { px: number; py: number; size: number }): readonly (readonly [
    number,
    number,
  ])[] {
    const below = item.py + item.size * 0.46;
    const above = item.py - item.size * 0.44 - minTextPx() * 1.2;
    const shoulder = item.size * 0.55;
    const step = minTextPx() * 1.35;
    // Sideways as well as up and down, because which way the paper is spare
    // depends on the screen: a portrait phone leaves 357 px of band above and
    // below the park, and a landscape phone leaves 320 px to its left and
    // right (park drawn 306x270 in a 626x270 canvas). A ladder that only
    // marched vertically used the first and ignored the second.
    const sideStep = step * 1.6; // names are wider than they are tall
    // Enough rungs to cross the canvas from anywhere in it; `drawLabel` clamps
    // anything that overshoots, so an over-long ladder costs a few failed
    // collision tests and nothing else.
    const rungs = Math.max(2, Math.ceil(Math.max(this.canvasCssHeight / step, this.canvasCssWidth / sideStep)));
    const out: (readonly [number, number])[] = [];
    for (let rung = 0; rung <= rungs; rung += 1) {
      const drop = rung * step;
      const push = shoulder + rung * sideStep;
      out.push(
        [item.px, below + drop],
        [item.px, above - drop],
        [item.px - shoulder, below + drop],
        [item.px + shoulder, below + drop],
        [item.px - shoulder, above - drop],
        [item.px + shoulder, above - drop],
        // Level with the picture and pushed out to the side — the rung that
        // reaches a landscape phone's spare paper.
        [item.px - push, item.py - minTextPx() * 0.6],
        [item.px + push, item.py - minTextPx() * 0.6],
      );
    }
    return out;
  }

  /** The map's features for the park as it stands — see `parkMapContent.ts`. */
  private features(): readonly MapFeature[] {
    const fountain = this.deps.world.fountain;
    return parkMapFeatures({
      stations: this.deps.world.train.stations.map((station) => ({
        id: `station:${station.name}`,
        x: station.standX,
        z: station.standZ,
      })),
      fountain: { x: fountain.centre.x, z: fountain.centre.z },
    });
  }

  /**
   * The biggest {@link MAP_TREE_COUNT} trees the park actually planted.
   *
   * Sorted by the radius the foliage scatter gave each one, so the map shows
   * the landmarks a child would steer by rather than every shrub. Real trees
   * throughout — the abandoned `stylized-map` branch scattered invented ones,
   * which is a picture of a park rather than a picture of *this* park.
   */
  private mapTrees(): readonly { readonly x: number; readonly z: number }[] {
    // Biggest first, but never two within `MAP_TREE_SPACING_M` of each other.
    // Taking the top 26 by radius alone was spatially biased: wherever the
    // scatter happened to roll big trees, the map grew a forest, and the rest
    // of the park was bare lawn (found in review of PR #353). Enforcing a
    // spacing spreads them over the park while still only ever drawing trees
    // the park really planted.
    const chosen: { readonly x: number; readonly z: number }[] = [];
    const bySize = [...this.deps.world.scenery.foliageOccluders].sort((a, b) => b.radius - a.radius);
    for (const tree of bySize) {
      if (chosen.length >= MAP_TREE_COUNT) break;
      const clear = chosen.every(
        (other) => Math.hypot(other.x - tree.x, other.z - tree.z) >= MAP_TREE_SPACING_M,
      );
      if (clear) chosen.push({ x: tree.x, z: tree.z });
    }
    return chosen;
  }

  /**
   * A feature's name and accent colour, from whichever module already owns
   * them — never restated here. The join is on `id`, so a renamed ride is
   * renamed on the map with no second edit.
   */
  private featureCopy(feature: MapFeature): { label: string; accent: string } {
    if (feature.kind === 'castle' || feature.kind === 'anchor') {
      const anchor = ANCHORS_BY_ID[feature.id as keyof typeof ANCHORS_BY_ID];
      if (anchor) return { label: anchor.signTitle, accent: hexToCss(anchor.accent) };
    }
    if (feature.kind === 'stall') {
      const stall = STALLS.find((candidate) => candidate.id === feature.id);
      if (stall) return { label: stall.title, accent: hexToCss(stall.accent) };
      const title = MAP_ONLY_TITLES[feature.id];
      if (title) return { label: title, accent: MAP_PALETTE.mustard };
    }
    if (feature.kind === 'station') {
      // `parkMapContent` carries the id it was handed; the name is after the
      // one colon it was built with.
      return { label: feature.id.slice('station:'.length), accent: MAP_PALETTE.grey };
    }
    if (feature.kind === 'fountain') return { label: 'Fountain', accent: MAP_PALETTE.water };
    if (feature.kind === 'gate') return { label: 'The Gates', accent: MAP_PALETTE.stone };
    // The bus's own owned strings are its destination blind ("Land of Good
    // Places" — the park's name, useless as a caption on a map *of* the park)
    // and its route number, which is joined in here rather than restated.
    if (feature.kind === 'catBus') {
      return { label: `Cat Bus ${CAT_BUS_ROUTE_NUMBER}`, accent: MAP_PALETTE.mustard };
    }
    return { label: feature.id, accent: MAP_PALETTE.mustard };
  }

  private renderIndoor(): void {
    const ctx = this.ctx;
    const w = this.canvasCssWidth;
    const h = this.canvasCssHeight;
    ctx.clearRect(0, 0, w, h);

    // --- the floor plate -----------------------------------------------------
    this.drawRect(
      0,
      0,
      INTERIOR_HALF_X,
      INTERIOR_HALF_Z,
      hexToCss(PALETTE.buildingFloor),
      hexToCss(PALETTE.buildingWall),
    );

    // --- shafts and machinery on this floor ----------------------------------
    for (const feature of FLOOR_FEATURES) {
      if (!feature.decks.includes(this.viewingDeck)) continue;
      const [fx, fy] = this.planeToCanvas(feature.x, feature.z);
      this.drawPin(fx, fy, feature.glyph, feature.label, hexToCss(PALETTE.markerMint));
    }

    // --- the roof pavilion's own footprint, on the roof only -----------------
    if (this.viewingDeck === TOP_DECK) {
      this.drawRect(
        ROOF_PAVILION_X,
        ROOF_PAVILION_Z,
        ROOF_PAVILION_HALF_X,
        ROOF_PAVILION_HALF_Z,
        hexToCss(PALETTE.buildingFloorAlt),
        hexToCss(PALETTE.buildingTrimDeep),
      );
    }

    // --- shops on this floor ---------------------------------------------------
    for (const unit of SHOP_UNITS) {
      if (unit.deck !== this.viewingDeck) continue;
      const [ux, uy] = this.planeToCanvas(unit.x, unit.z);
      this.drawPin(ux, uy, unit.glyph, unit.title, hexToCss(unit.accent));
    }

    // --- the player, only when looking at the floor they are actually on -----
    if (this.viewingDeck === this.playerDeck) {
      const { x, z } = this.deps.player.position;
      this.drawPlayerMarker(x - INTERIOR_ORIGIN_X, z - INTERIOR_ORIGIN_Z);
    }
  }

  private strokeRoute(route: RouteDefinition): void {
    // The one owner of the drawn shape — the map strokes what the park paves.
    const curve = routeCurve(route);
    const samples = Math.max(16, Math.round(curve.getLength() / 1.2));
    const points: [number, number][] = [];
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const p = curve.getPoint(t);
      points.push([p.x, p.z]);
    }
    // A broad cream ribbon with a soft edge under it — the reference's
    // connective tissue. Two strokes rather than a stroke-and-fill so the
    // ribbon keeps a constant width along the whole curve; the widths are the
    // route's own `width`, so a path the park paved wider is drawn wider.
    this.strokeCurvePoints(points, route.closed, MAP_PALETTE.pathEdge, route.width * 1.02);
    this.strokeCurvePoints(points, route.closed, MAP_PALETTE.path, route.width * 0.82);
  }

  private strokeCurvePoints(
    points: readonly (readonly [number, number])[],
    closed: boolean,
    colour: string,
    metreWidth: number,
    dash?: readonly number[],
  ): void {
    if (points.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1.5, metreWidth * this.scale);
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    const [firstX, firstZ] = points[0] ?? [0, 0];
    const [startX, startY] = this.planeToCanvas(firstX, firstZ);
    ctx.moveTo(startX, startY);
    for (const [x, z] of points.slice(1)) {
      const [px, py] = this.planeToCanvas(x, z);
      ctx.lineTo(px, py);
    }
    if (closed) ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  private drawRect(
    cx: number,
    cz: number,
    halfX: number,
    halfZ: number,
    fill: string,
    stroke: string,
  ): void {
    const [x0, y0] = this.planeToCanvas(cx - halfX, cz - halfZ);
    const [x1, y1] = this.planeToCanvas(cx + halfX, cz + halfZ);
    const ctx = this.ctx;
    const radius = Math.min(10, Math.abs(x1 - x0) * 0.12, Math.abs(y1 - y0) * 0.12);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect?.(
      Math.min(x0, x1),
      Math.min(y0, y1),
      Math.abs(x1 - x0),
      Math.abs(y1 - y0),
      radius,
    ) ?? ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.fill();
    ctx.stroke();
  }

  private drawPin(px: number, py: number, glyph: string, label: string, colour: string): void {
    const ctx = this.ctx;
    const r = 0.65 * uiUnitPx();
    ctx.fillStyle = colour;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    this.drawGlyph(glyph, px, py, 0.75 * uiUnitPx());
    this.drawLabel(label, px, py + r + 0.3 * uiUnitPx());
  }

  private drawGlyph(glyph: string, px: number, py: number, size: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, px, py + 1);
    ctx.restore();
  }

  /**
   * A place name under a pin.
   *
   * Two things changed here for GAME_DESIGN.md's TEXT RULE. The size is now
   * `minTextPx()` rather than 11px — and note the old font string named a CSS
   * custom property, which a canvas cannot resolve, so the whole declaration
   * was being rejected and these were painting at the 2D context's 10px
   * default. Second, at a readable size the names are wide enough to collide,
   * so a name that would land on top of one already drawn is dropped: its pin
   * and glyph are still there, and an unreadable pile of overlapping words
   * helps nobody. Draw order is therefore priority order — the big attractions
   * in `ANCHORS` are drawn before the smaller features.
   */
  /**
   * Where a name would go, if it fits — measured and reserved, not painted.
   *
   * Split from the painting (see {@link paintLabel}) so the outdoor map can do
   * **all** its placement first, then every leader line, then every name last.
   * Drawn in one pass instead, a later attraction's leader line was stroked
   * across an earlier attraction's finished name: measured on an 844x390
   * phone, The Spooky House's leader took the final "l" off "Space Ferris
   * Wheel". Text last means nothing can be drawn over it.
   *
   * Returns `null` when the name would land on top of something already there;
   * its picture is still drawn, and an unreadable pile of overlapping words
   * helps nobody. Draw order is priority order — the big attractions in
   * `ANCHORS` are placed before the smaller features.
   */
  private placeLabel(text: string, px: number, py: number): LabelPlacement | null {
    const ctx = this.ctx;
    ctx.save();
    const size = minTextPx();
    ctx.font = `700 ${size}px 'Baloo 2', 'Nunito', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const lines = this.wrapLabel(text, size);
    const lineHeight = size * 1.15;
    const halfWidth = Math.max(...lines.map((line) => ctx.measureText(line).width)) / 2 + 2;
    const height = lineHeight * lines.length;
    ctx.restore();

    // Keep the whole name on the canvas. An attraction near the park's edge
    // sits near the canvas edge too, and a centred label then runs off the
    // side — "Sunny Side Halt" lost its last word this way.
    px = Math.min(
      Math.max(px, halfWidth + 2),
      Math.max(halfWidth + 2, this.canvasCssWidth - halfWidth - 2),
    );
    py = Math.min(Math.max(py, 0), Math.max(0, this.canvasCssHeight - height));

    const box: LabelBox = {
      left: px - halfWidth,
      right: px + halfWidth,
      top: py,
      bottom: py + height,
    };
    const collides = [...this.labelBoxes, ...this.iconBoxes].some(
      (other) =>
        box.left < other.right &&
        box.right > other.left &&
        box.top < other.bottom &&
        box.bottom > other.top,
    );
    if (collides) return null;
    this.labelBoxes.push(box);
    return { lines, px, py, size, lineHeight, box };
  }

  /**
   * A leader line from a picture to the name that had to go and sit out in the
   * spare paper, drawn only when the name is far enough away that which
   * picture it belongs to is not already obvious — a line under a name tucked
   * beneath its own icon is clutter.
   *
   * Stops at the **nearest point on the name's box**, so it never runs into
   * the words, and it is stroked before any text is painted.
   */
  private drawLabelLeader(placement: LabelPlacement, anchorX: number, anchorY: number): void {
    const { box, size } = placement;
    const nearX = Math.min(Math.max(anchorX, box.left), box.right);
    const nearY = Math.min(Math.max(anchorY, box.top), box.bottom);
    if (Math.hypot(nearX - anchorX, nearY - anchorY) <= size) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(3, 0.16 * uiUnitPx());
    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    ctx.lineTo(nearX, nearY);
    ctx.stroke();
    ctx.strokeStyle = MAP_PALETTE.grey;
    ctx.lineWidth = Math.max(1.2, 0.06 * uiUnitPx());
    ctx.stroke();
    ctx.restore();
  }

  /** Paints a name that {@link placeLabel} already found room for. */
  private paintLabel(placement: LabelPlacement): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `700 ${placement.size}px 'Baloo 2', 'Nunito', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.fillStyle = hexToCss(PALETTE.ink);
    for (let i = 0; i < placement.lines.length; i += 1) {
      const line = placement.lines[i] as string;
      const ly = placement.py + i * placement.lineHeight;
      ctx.strokeText(line, placement.px, ly);
      ctx.fillText(line, placement.px, ly);
    }
    ctx.restore();
  }

  /**
   * Place and paint in one go — the indoor floor plan, which has few enough
   * pins that it has never needed a leader line or a second pass.
   */
  private drawLabel(text: string, px: number, py: number): boolean {
    const placement = this.placeLabel(text, px, py);
    if (!placement) return false;
    this.paintLabel(placement);
    return true;
  }

  /**
   * Breaks a long name onto two lines when it is wide for the canvas.
   *
   * On a portrait phone the map is only ~325 px across, and "Space Ferris
   * Wheel" at the TEXT rule's minimum size is most of that — so laid out on
   * one line, most names overlapped something and were dropped, measured at 4
   * of 14 painted. Split at the space nearest the middle, a name is about half
   * as wide and fits beside its neighbours. Nothing is abbreviated: a
   * six-year-old gets the whole name either way, which is the point of Jim's
   * "(still labelled)".
   */
  private wrapLabel(text: string, size: number): readonly string[] {
    const ctx = this.ctx;
    const maxWidth = this.canvasCssWidth * 0.34;
    if (ctx.measureText(text).width <= maxWidth) return [text];
    const words = text.split(' ');
    if (words.length < 2) return [text];
    // The split closest to halfway, so neither line is a stray word.
    let best = 1;
    let bestGap = Infinity;
    for (let i = 1; i < words.length; i += 1) {
      const left = ctx.measureText(words.slice(0, i).join(' ')).width;
      const right = ctx.measureText(words.slice(i).join(' ')).width;
      const gap = Math.abs(left - right);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    void size;
    return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
  }

  private drawPlayerMarker(planeX: number, planeZ: number): void {
    const [px, py] = this.planeToCanvas(planeX, planeZ);
    const facing = this.deps.player.group.rotation.y;
    // Forward on the ground plane, matching the (sin, cos) convention every
    // yaw in this game uses (see `anchors.ts`'s `signYaw` doc).
    const dx = Math.sin(facing);
    const dz = Math.cos(facing);

    const ctx = this.ctx;
    ctx.save();
    ctx.translate(px, py);

    // A little cone of facing, so which way she is looking reads at a glance.
    const coneAngle = Math.atan2(dx, dz);
    ctx.fillStyle = 'rgba(255, 143, 192, 0.35)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 24, coneAngle - Math.PI / 2 - 0.5, coneAngle - Math.PI / 2 + 0.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = hexToCss(PLAYER_MARKER_COLOUR);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // A little beak pointing the way she is facing.
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(dx * 15, dz * 15);
    ctx.lineTo(dz * 5, -dx * 5);
    ctx.lineTo(-dz * 5, dx * 5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}

/** Matches `Game.ts`'s own `floorName`, so the map and the stairs menu agree. */
function floorLabelText(deck: number): string {
  if (deck <= 0) return 'Ground floor';
  if (deck >= BUILDING_FLOOR_COUNT - 1) return 'The roof';
  return `Floor ${deck}`;
}
