import {
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
import { Rng } from '../core/mathUtils';
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
 * How far she may drift from the stand point before the zoomed view gives up
 * and closes on its own (see `update`) — looser than {@link REACH} itself, so
 * standing at the very edge of "in reach" does not flicker the view open and
 * shut. One of the view's three ways out, alongside the on-screen ✕ and
 * Esc/cancel — see this file's own header.
 */
const VIEW_EXIT_REACH = REACH + 1.5;

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

    this.buildCart();
    this.buildCollision(collision);
    this.buildSparklePool();
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
    const { input, playerPosition } = context;
    const dx = playerPosition.x - this.standX;
    const dz = playerPosition.z - this.standZ;
    const wandered = Math.hypot(dx, dz) > VIEW_EXIT_REACH;
    if (wandered || input.justPressed('menu') || input.justPressed('cancel')) this.closeView();
  }

  /**
   * Opens the zoomed rack picker — the run body of {@link shopEntryZone}'s
   * chip. Pure state; the camera move itself lives in `Game.tick`, which
   * re-derives it every frame from {@link viewOpen}/{@link viewFocus} exactly
   * the way the cat-bus arrival re-derives its own zoom (see
   * `IsoCamera.setFocusOverride`'s doc comment).
   */
  openView(): void {
    this.open = true;
  }

  /**
   * Leaves the zoomed picker and hands the camera back to the ordinary
   * follow. Three ways in: the on-screen ✕, Esc/cancel, or walking far enough
   * from the stand point (`update`, above) — the last one is new precisely
   * because, unlike a paused panel, this view never stops her walking (see
   * this file's own header on why it deliberately does not pause the park).
   */
  closeView(): void {
    this.open = false;
  }

  /**
   * Teleports her to the stand point and opens the view in one motion — the
   * deep link's own entry point (`Game.ts`'s `boardRide` table,
   * `/keychain-stall`). A real walk-up would press the chip after arriving;
   * this does both at once so the deep link lands on the feature itself
   * rather than one press short of it.
   */
  requestOpen(): boolean {
    if (!this.player || this.player.riding) return false;
    this.player.teleport(this.standX, this.standZ);
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
  }

  private takeOff(): void {
    gameStore.setWornKeychain(null);
    playOpenChime();
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

    // The six charms themselves, stood along the counter as a display
    // rack — small (they are 20 cm charms; a 1.5x scale keeps them readable
    // from the fixed camera without dwarfing the cart), spaced evenly,
    // alternating a slight lean so the row does not read as a static shelf
    // of identical ranks. Each one's real world position is recorded into
    // {@link rack} for {@link interactZones} to build a tap target from.
    const rackWidth = STALL_WIDTH - 0.5;
    const charmLocalY = 0.885;
    const charmLocalZ = -0.02;
    KEYCHAIN_KINDS.forEach((kind, index) => {
      const handle = createKeychain(kind);
      const t = KEYCHAIN_KINDS.length > 1 ? index / (KEYCHAIN_KINDS.length - 1) : 0.5;
      const localX = -rackWidth / 2 + t * rackWidth;
      handle.root.position.set(localX, charmLocalY, charmLocalZ);
      handle.root.scale.setScalar(1.5);
      handle.root.rotation.y = (index % 2 === 0 ? 1 : -1) * 0.18;
      this.group.add(handle.root);

      const [x, z] = this.toWorld(localX, charmLocalZ);
      // Same lateral offset as the charm itself, but out at the stall's own
      // proven-clear stand depth — never the counter's own `charmLocalZ`,
      // which sits inside `buildCollision`'s walls (see `RackCharm.standX`'s
      // own doc comment).
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

    // {@link rackFocus}: the six charms' own world centre, solved once here
    // rather than every frame — they never move afterwards. A touch above
    // the counter height (not the charms' own y) so the framed shot centres
    // on the display rather than sitting low with the parasol looming over
    // an empty top half.
    let sumX = 0;
    let sumZ = 0;
    for (const charm of this.rack) {
      sumX += charm.x;
      sumZ += charm.z;
    }
    this.rackFocus.set(sumX / this.rack.length, this.groundY + 1.05, sumZ / this.rack.length);
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
