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
import { MAP_PALETTE, drawIcon } from './parkMapArt';
import { parkMapFeatures, type MapFeature } from './parkMapContent';
import { frameHalfExtent, outdoorParkMapProjection, type MapProjection } from './parkMapProjection';
import type { World } from '../world/World';
import type { Player } from '../entities/Player';
import { SLIDE_PLAN } from '../world/slide/plan';
import {
  BUBBLE_X,
  BUBBLE_Z,
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
 *   escalator/bubble/trampoline/helter-skelter, the toilets, the roof pavilion —
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
    { x: BUBBLE_X, z: BUBBLE_Z, glyph: '🫧', label: 'Bubble', decks: everyDeck },
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
    // Tapping the dimmed backdrop is a "no thanks", same as every other panel.
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.close();
    });

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
    this.canvas.addEventListener('pointerdown', (event) => this.onCanvasTap(event));
    this.canvasWrap.append(this.canvas);

    this.hint = document.createElement('p');
    this.hint.className = 'shop-hint';
    this.hint.textContent = isTouchDevice()
      ? 'Tap where to go, or tap outside to close.'
      : 'Click where to go · Esc or M to close.';

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
    this.syncCanvasSize();

    // The viewport, from `parkMapProjection.ts` — the one owner of the
    // world-to-canvas transform, and the thing #234 was a bug in. Outdoors it
    // frames the real boundary's own extent, so nothing the park generated can
    // fall off the edge of the map whatever shape the seed rolled.
    const projection = this.indoor
      ? frameHalfExtent(INTERIOR_HALF_X + 6, INTERIOR_HALF_Z + 4, this.canvasCssWidth, this.canvasCssHeight)
      : outdoorParkMapProjection(this.canvasCssWidth, this.canvasCssHeight);
    this.projection = projection;
    this.scale = projection.scale;

    if (this.indoor) {
      this.titleEl.textContent = `Map: ${floorLabelText(this.viewingDeck)}`;
      this.renderIndoor();
    } else {
      this.titleEl.textContent = 'Map of the Park';
      this.renderOutdoor();
    }
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
    for (const feature of features) {
      const [fx, fy] = this.planeToCanvas(feature.x, feature.z);
      const { label, accent } = this.featureCopy(feature);
      const size = featureIconPx(feature.kind, this.scale);
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
    // Under the picture by preference, above it if that spot is taken. A name
    // that simply cannot be placed is still dropped rather than written over
    // something, but trying the second spot is what turns most of the drops
    // back into readable names on a phone.
    // Try the name in several places round its own picture before giving up:
    // under it, over it, then shouldered left and right. Every extra candidate
    // turns a dropped name back into a readable one, which matters most on a
    // phone where the park is small and everything is close together.
    for (const item of placed) {
      const below = item.py + item.size * 0.46;
      const above = item.py - item.size * 0.44 - minTextPx() * 1.2;
      const shoulder = item.size * 0.55;
      const candidates: readonly (readonly [number, number])[] = [
        [item.px, below],
        [item.px, above],
        [item.px - shoulder, below],
        [item.px + shoulder, below],
        [item.px - shoulder, above],
        [item.px + shoulder, above],
      ];
      for (const [lx, ly] of candidates) {
        if (this.drawLabel(item.label, lx, ly)) break;
      }
    }

    // --- the player ----------------------------------------------------------
    if (!this.indoor) {
      const { x, z } = this.deps.player.position;
      this.drawPlayerMarker(x, z);
    }
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
  private drawLabel(text: string, px: number, py: number): boolean {
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
    if (collides) {
      ctx.restore();
      return false;
    }
    this.labelBoxes.push(box);

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.fillStyle = hexToCss(PALETTE.ink);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] as string;
      const ly = py + i * lineHeight;
      ctx.strokeText(line, px, ly);
      ctx.fillText(line, px, ly);
    }
    ctx.restore();
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
