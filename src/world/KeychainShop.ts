import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
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
 * ## The rack IS the picker (23 August 2026)
 *
 * This used to build the display rack purely as set-dressing and open a
 * separate 2D list panel (`ui/KeychainPanel.ts`) for the actual picking —
 * two presentations of the same six charms. Jim, having seen a screenshot of
 * the real rack: *"I like this much better than the menu style - let's keep
 * it this way for the shop."* So the rack is now the only picker: each charm
 * already stood on the counter (`buildCart`) is its own
 * `InteractZone` (GAME_DESIGN.md's SELECTION RULE — `world/Selection.ts`,
 * `world/Flowers.ts` is the closest existing precedent, a cluster of
 * individually-tappable things), rainbow-outlined on its own real silhouette
 * (`highlightObject`), with a chip that reads "Wear the Star!", "Collect the
 * Heart!" or "Take off the RiPika!" depending on what she owns and wears —
 * live, the same way the train's platform swaps "Get on" for "Get off".
 * There is no modal to open any more, so `KeychainShop` no longer has a
 * `uiOpen`; tapping a charm equips it immediately and `WornKeychain.ts` draws
 * it on her actual back on the very next frame — better confirmation than
 * the old panel's stylised preview ever gave, because it is the real thing.
 *
 * Six charms this close together on one small cart (≈0.32 m apart) would
 * ordinarily fail `check:tap-spacing`'s "different actions must sit a
 * finger apart" rule the moment their chip text differs — which it does,
 * constantly, as she collects them one by one. The fix is the same one
 * `tapSpacing.ts` already carves out for two flowers in one bed: every charm
 * zone declares the same **static** `verb: 'Wear'`, so the check classifies
 * them as same-action (a harmless-ambiguity warning) even though the live
 * chip label — built fresh per zone, per frame, in {@link charmActions} — says
 * something different for each.
 *
 * Collected, not chosen for the moment (`HANDOFF-keychain-shop.md`'s
 * decisions 2 and 3, unchanged by the rack becoming the picker): tapping an
 * unowned charm both collects it (`gameStore.buy`, price 0 — see
 * `shops/catalogue.ts`'s `keychainStall` entries) and wears it in the same
 * motion; tapping an owned one just wears it; tapping the one already worn
 * takes it off.
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
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class KeychainShop implements GameSystem {
  readonly name = 'keychainShop';
  readonly group = new Group();

  private readonly standX: number;
  private readonly standZ: number;
  private readonly groundY: number;

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

  constructor(collision: CollisionWorld) {
    this.group.name = 'keychainShop';

    this.groundY = terrainHeight(STALL_X, STALL_Z);
    this.group.position.set(STALL_X, this.groundY, STALL_Z);
    this.group.rotation.y = STALL_FACING;

    const stand = STALL_STANDS_BY_ID.get('keychain');
    if (!stand) throw new Error('KeychainShop: no stand point in STALL_PLACEMENTS.keychain');
    this.standX = stand.x;
    this.standZ = stand.z;

    this.buildCart();
    this.buildCollision(collision);
    this.buildSparklePool();
  }

  /** True while a ride owns the character — matches every other stall's own gate on its zones. */
  attachPlayer(player: Player): void {
    this.player = player;
  }

  /**
   * One `InteractZone` per charm on the rack — see this file's own header
   * for why they can sit this close together and still pass
   * `check:tap-spacing`.
   */
  interactZones(): InteractZone[] {
    return this.rack.map((charm) => this.charmZone(charm));
  }

  update(context: FrameContext): void {
    this.frameElapsed = context.elapsed;
    this.updateSparkles(context.elapsed);
  }

  /**
   * Teleports her to the stand point in front of the rack — the deep link's
   * own entry point (`Game.ts`'s `boardRide` table, `/keychain-stall`).
   * There is nothing to "open" any more: standing this close to the cart
   * selects whichever charm she's nearest to on its own, through the
   * ordinary SELECTION RULE proximity pick (`interactZones()`, above), the
   * same as walking there ever did.
   */
  requestOpen(): boolean {
    if (!this.player || this.player.riding) return false;
    this.player.teleport(this.standX, this.standZ);
    return true;
  }

  dispose(): void {
    disposeGroup(this.group);
  }

  // -------------------------------------------------------------- internals

  private charmZone(charm: RackCharm): InteractZone {
    return {
      id: `keychain:${charm.kind}`,
      label: charm.kind,
      x: charm.x,
      y: charm.y,
      z: charm.z,
      pickRadius: CHARM_PICK_RADIUS,
      standX: charm.x,
      standZ: charm.z,
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
      this.rack.push({ kind, id: `keychain.${kind}`, root: handle.root, x, y: this.groundY + charmLocalY, z });
    });
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
