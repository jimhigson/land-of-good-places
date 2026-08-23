import { CatmullRomCurve3, Vector3 } from 'three';
import { BUILDING_FLOOR_COUNT, BUILDING_HALF_X, BUILDING_HALF_Z, GARDEN_HALF_SIZE, INTERIOR_HALF_X, INTERIOR_HALF_Z, INTERIOR_ORIGIN_X, INTERIOR_ORIGIN_Z, PLAYER_RADIUS } from '../core/constants';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from '../world/building/layout';
import { PALETTE, hexToCss } from '../core/palette';
import { isTouchDevice } from '../core/device';
import { minTextPx, uiUnitPx } from '../core/uiScale';
import { gameStore } from '../state';
import { ANCHORS, type AnchorDefinition, type AnchorFootprint } from '../world/anchors';
import { PLAZA, ROUTES, type RouteDefinition } from '../world/paths';
import { STALLS } from '../minigames';
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
 * Anchors whose ride already has a fairground stall standing in for its ticket
 * booth (`minigames/stalls.ts`) — the stall's own pin already names the ride, so
 * the anchor is drawn as a footprint only, rather than doubling up the label.
 */
const ANCHORS_WITH_STALL_ENTRY = new Set(['ferrisWheel', 'dodgems', 'waterFight']);

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

  private scale = 1;
  private originPxX = 0;
  private originPxY = 0;
  private canvasCssWidth = 0;
  private canvasCssHeight = 0;
  /** Rebuilt every render; see `drawLabel`. */
  private readonly labelBoxes: LabelBox[] = [];

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

  /** World (outdoor) or interior-local (indoor) metres -> canvas CSS pixels. */
  private planeToCanvas(x: number, z: number): [number, number] {
    return [this.originPxX + x * this.scale, this.originPxY + z * this.scale];
  }

  private canvasToPlane(px: number, py: number): [number, number] {
    return [(px - this.originPxX) / this.scale, (py - this.originPxY) / this.scale];
  }

  private render(): void {
    // Fresh page, fresh list of where the labels ended up (see `drawLabel`).
    this.labelBoxes.length = 0;
    this.canvasWrap.dataset.mode = this.indoor ? 'indoor' : 'outdoor';
    this.floorRow.hidden = !this.indoor;
    this.upButton.disabled = this.viewingDeck >= TOP_DECK;
    this.downButton.disabled = this.viewingDeck <= 0;
    this.syncCanvasSize();

    const halfW = this.indoor ? INTERIOR_HALF_X + 6 : GARDEN_HALF_SIZE + 4;
    const halfH = this.indoor ? INTERIOR_HALF_Z + 4 : GARDEN_HALF_SIZE + 4;
    this.scale = Math.min(this.canvasCssWidth / (2 * halfW), this.canvasCssHeight / (2 * halfH));
    this.originPxX = this.canvasCssWidth / 2;
    this.originPxY = this.canvasCssHeight / 2;

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

    // --- terrain + boundary --------------------------------------------------
    const [cx, cy] = this.planeToCanvas(0, 0);
    ctx.fillStyle = hexToCss(PALETTE.grassLight);
    ctx.beginPath();
    ctx.arc(cx, cy, GARDEN_HALF_SIZE * this.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexToCss(PALETTE.stonePinkDark);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, (GARDEN_HALF_SIZE - 2) * this.scale, 0, Math.PI * 2);
    ctx.stroke();

    // --- paths, rebuilt from the same control points the real path network
    // uses (world/paths.ts), so this can never draw a path that has moved.
    ctx.strokeStyle = hexToCss(PALETTE.pathSand);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const route of ROUTES) this.strokeRoute(route);

    // --- fountain plaza --------------------------------------------------
    const [px, py] = this.planeToCanvas(PLAZA.x, PLAZA.z);
    ctx.fillStyle = hexToCss(PALETTE.pathSand);
    ctx.beginPath();
    ctx.arc(px, py, PLAZA.radius * this.scale, 0, Math.PI * 2);
    ctx.fill();
    const fountain = this.deps.world.fountain;
    const [fx, fy] = this.planeToCanvas(fountain.centre.x, fountain.centre.z);
    ctx.fillStyle = hexToCss(PALETTE.waterTop);
    ctx.beginPath();
    ctx.arc(fx, fy, fountain.rimRadius * this.scale, 0, Math.PI * 2);
    ctx.fill();
    this.drawGlyph('⛲', fx, fy, uiUnitPx());

    // --- ride plots, straight from the anchor table -----------------------
    for (const anchor of ANCHORS) this.drawAnchor(anchor);

    // --- stalls -------------------------------------------------------------
    for (const stall of STALLS) {
      const [sx, sz] = stall.position;
      const [cx2, cy2] = this.planeToCanvas(sx, sz);
      this.drawPin(cx2, cy2, stall.glyph, stall.title, hexToCss(stall.accent));
    }

    // --- the train loop and its stations ------------------------------------
    const trainRoute = this.deps.world.train.route;
    const trainPoints: [number, number][] = [];
    const trainProbe = new Vector3();
    for (let i = 0; i < 140; i += 1) {
      trainRoute.pointAt((i / 140) * trainRoute.length, trainProbe);
      trainPoints.push([trainProbe.x, trainProbe.z]);
    }
    this.strokeCurvePoints(
      trainPoints,
      true,
      hexToCss(PALETTE.markerLemon),
      2.2,
      [7, 6],
    );
    for (const station of this.deps.world.train.stations) {
      const [stx, sty] = this.planeToCanvas(station.standX, station.standZ);
      this.drawPin(stx, sty, '🚉', station.name, hexToCss(PALETTE.markerLemon));
    }

    // --- the castle, drawn at its real facade footprint ---------------------
    this.drawRect(
      BUILDING_CENTRE_X,
      BUILDING_CENTRE_Z,
      BUILDING_HALF_X,
      BUILDING_HALF_Z,
      hexToCss(PALETTE.buildingWall),
      hexToCss(PALETTE.buildingTrim),
    );
    const [bx, by] = this.planeToCanvas(BUILDING_CENTRE_X, BUILDING_CENTRE_Z);
    this.drawGlyph('🏰', bx, by, 1.2 * uiUnitPx());
    this.drawLabel('The Big Building', bx, by + 0.9 * uiUnitPx());

    // --- the player ----------------------------------------------------------
    if (!this.indoor) {
      const { x, z } = this.deps.player.position;
      this.drawPlayerMarker(x, z);
    }
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
    const vectors = route.points.map(([x, z]) => new Vector3(x, 0, z));
    const curve = new CatmullRomCurve3(vectors, route.closed, 'catmullrom', 0.4);
    const samples = Math.max(16, Math.round(curve.getLength() / 1.2));
    const points: [number, number][] = [];
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const p = curve.getPoint(t);
      points.push([p.x, p.z]);
    }
    this.strokeCurvePoints(points, route.closed, hexToCss(PALETTE.pathSand), route.width * 0.7);
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

  private drawAnchor(anchor: AnchorDefinition): void {
    // The castle is drawn separately at its real, nudged-in facade footprint
    // (see `renderOutdoor`) rather than its reserved plot, so it is skipped here.
    if (anchor.id === 'building') return;

    const [ax, az] = anchor.position;
    const accent = hexToCss(anchor.accent);
    this.drawFootprint(ax, az, anchor.footprint, hexToCss(PALETTE.buildingWall), accent);

    // A ride with its own fairground stall gets its name from that stall's pin
    // instead (drawn separately, below) — one label per ride, not two.
    if (ANCHORS_WITH_STALL_ENTRY.has(anchor.id)) return;

    const [ex, ez] = anchor.entrance;
    const [cx, cy] = this.planeToCanvas(ex, ez);
    this.drawPin(cx, cy, anchor.glyph, anchor.signTitle, accent);
  }

  private drawFootprint(
    x: number,
    z: number,
    footprint: AnchorFootprint,
    fill: string,
    stroke: string,
  ): void {
    if (footprint.kind === 'circle') {
      const [cx, cy] = this.planeToCanvas(x, z);
      const ctx = this.ctx;
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, footprint.radius * this.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    }
    this.drawRect(x, z, footprint.halfX, footprint.halfZ, fill, stroke);
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
  private drawLabel(text: string, px: number, py: number): void {
    const ctx = this.ctx;
    ctx.save();
    const size = minTextPx();
    ctx.font = `700 ${size}px 'Baloo 2', 'Nunito', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const halfWidth = ctx.measureText(text).width / 2 + 2;
    const box: LabelBox = {
      left: px - halfWidth,
      right: px + halfWidth,
      top: py,
      bottom: py + size * 1.2,
    };
    const collides = this.labelBoxes.some(
      (other) =>
        box.left < other.right &&
        box.right > other.left &&
        box.top < other.bottom &&
        box.bottom > other.top,
    );
    if (collides) {
      ctx.restore();
      return;
    }
    this.labelBoxes.push(box);

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText(text, px, py);
    ctx.fillStyle = hexToCss(PALETTE.ink);
    ctx.fillText(text, px, py);
    ctx.restore();
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
