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
import { KEYCHAIN_KINDS, createKeychain } from '../art/models/keychains';
import { pressZone, type InteractZone } from './interact';
import { highlightObject } from './highlight';
import { terrainHeight } from './terrain';
import type { CollisionWorld } from './Collision';
import type { FrameContext, GameSystem } from '../core/types';
import type { Player } from '../entities/Player';
import { gameStore, discoverSecret, type InventoryItem } from '../state';
import { shopWords } from '../state/wording';
import { playOpenChime, playSurpriseChime } from '../ui/chime';
import { KeychainPanel, type KeychainLook } from '../ui/KeychainPanel';
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
 * The one real difference from face paint: a keychain is **collected, not
 * chosen for the moment** — `HANDOFF-keychain-shop.md`'s decisions 2 and 3.
 * Tapping an unowned charm both collects it (`gameStore.buy`, price 0 — see
 * `shops/catalogue.ts`'s `keychainStall` entries) and wears it in the same
 * motion; tapping an owned one just wears it; "Take it off" leaves the bag
 * bare. `WornKeychain.ts` draws whichever one is worn on the player's actual
 * back — this file only ever announces a pick through `gameStore`, exactly as
 * `FacePaintStall.pickDesign` does for a design.
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

const SPARKLE_COUNT = 6;
/** How long the little "got one!" sparkle burst lasts. */
const SPARKLE_DURATION = 1.1;

export class KeychainShop implements GameSystem {
  readonly name = 'keychainShop';
  readonly group = new Group();

  private readonly standX: number;
  private readonly standZ: number;

  private panel: KeychainPanel | null = null;
  private readonly sparkles: Mesh[] = [];
  private readonly sparkleBase: { angle: number; radius: number; rise: number }[] = [];
  private readonly sparkleRng = new Rng(0x1eec4a1);
  private sparkleStartedAt: number | null = null;

  /** `FrameContext.elapsed` as of the last frame — DOM handlers fire between frames. */
  private frameElapsed = 0;

  private player: Player | null = null;

  private hint: HTMLElement | null = null;

  constructor(collision: CollisionWorld) {
    this.group.name = 'keychainShop';

    const ground = terrainHeight(STALL_X, STALL_Z);
    this.group.position.set(STALL_X, ground, STALL_Z);
    this.group.rotation.y = STALL_FACING;

    const stand = STALL_STANDS_BY_ID.get('keychain');
    if (!stand) throw new Error('KeychainShop: no stand point in STALL_PLACEMENTS.keychain');
    this.standX = stand.x;
    this.standZ = stand.z;

    this.buildCart();
    this.buildCollision(collision);
    this.buildSparklePool();
  }

  /**
   * Builds the stall's HUD into the overlay root. Not done in the
   * constructor — see `FacePaintStall.mountUi`'s doc comment, which spells
   * out why: `Hud` clears `#ui-root` on construction, and `World` (so this
   * stall) is built before the HUD is.
   */
  mountUi(uiRoot: HTMLElement): void {
    if (this.panel) return;
    this.panel = new KeychainPanel(uiRoot, {
      onPick: (id) => this.pickKeychain(id),
      onTakeOff: () => this.takeOff(),
      onClose: () => this.closePanel(),
    });
    this.hint = buildHint(uiRoot);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** True while the picker owns the screen. Mirrors `FacePaintStall.uiOpen`. */
  get uiOpen(): boolean {
    return this.panel?.isOpen ?? false;
  }

  attachPlayer(player: Player): void {
    this.player = player;
  }

  interactZones(): InteractZone[] {
    return [
      pressZone(
        {
          id: 'stall:keychain',
          label: 'Keychains!',
          x: STALL_X,
          y: terrainHeight(STALL_X, STALL_Z),
          z: STALL_Z,
          pickRadius: REACH,
          standX: this.standX,
          standZ: this.standZ,
          // GAME_DESIGN.md's HIGHLIGHT RULE — the cart outlines in rainbow
          // when it is selected.
          highlight: highlightObject(this.group),
        },
        () => this.requestOpen(),
        '🔑',
        // The handoff's own gotcha: without an explicit label the id falls
        // through `DEFAULT_VERBS`' generic `stall:` prefix to "Play", which
        // is not what collecting a charm is. `shopWords().verb` matches
        // `candy.spookyHouse`'s own "Collect!" outside Mayhem.
        `${shopWords().verb}!`,
      ),
    ];
  }

  update(context: FrameContext): void {
    const { elapsed, input } = context;
    this.frameElapsed = elapsed;

    this.updateSparkles(elapsed);

    const panel = this.panel;
    if (!this.player || !panel) return;

    const dx = context.playerPosition.x - this.standX;
    const dz = context.playerPosition.z - this.standZ;
    const inRange = Math.hypot(dx, dz) <= REACH;

    setHintVisible(this.hint, inRange && !this.uiOpen);

    if (panel.isOpen) {
      if (input.justPressed('menu') || input.justPressed('cancel')) this.closePanel();
    }
  }

  /**
   * Opens the picker regardless of range — the deep link's own entry point
   * (`Game.ts`'s `boardRide` table, `/keychain-stall`), teleporting her to the
   * stand point first exactly as walking there would have. `Hotel.
   * requestEnterLobby` is the pattern this follows.
   */
  requestOpen(): boolean {
    if (!this.player || !this.panel || this.uiOpen || this.player.riding) return false;
    this.player.teleport(this.standX, this.standZ);
    this.openPanel();
    return true;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.panel?.dispose();
    this.hint?.remove();
    disposeGroup(this.group);
  }

  // -------------------------------------------------------------- internals

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const panel = this.panel;
    if (!panel?.isOpen) return;
    if (panel.handleKey(event.code)) event.preventDefault();
  };

  private openPanel(): void {
    const state = gameStore.get();
    const worn = state.inventory.find((item) => item.uid === state.wornKeychainUid);
    this.panel?.openWith(keychainItems(), worn?.id ?? '', ownedKeychainIds(state.inventory), playerLook());
    playOpenChime();
  }

  private closePanel(): void {
    this.panel?.close();
  }

  /**
   * "I want that one" — for an owned charm this only ever wears it; for an
   * unowned one it collects it first (`gameStore.buy`, price 0) and wears the
   * copy just bought, the same "it's yours, and it's on you" beat a purchased
   * jet pack gets (`GameStore.buy`'s own `wornJetpackUid` line).
   */
  private pickKeychain(id: string): void {
    const state = gameStore.get();
    const existing = state.inventory.find((item) => item.id === id);
    if (existing) {
      gameStore.setWornKeychain(existing.uid);
      this.syncPanel();
      return;
    }

    const item = keychainItems().find((entry) => entry.id === id);
    if (!item) return;
    const firstEver = ownedKeychainIds(state.inventory).size === 0;
    const acquisition = gameStore.buy(shopItemToPurchase(item));
    if (acquisition.outcome !== 'kept') return; // price 0 never refuses, but the type still allows it

    gameStore.setWornKeychain(acquisition.item.uid);
    if (firstEver) discoverSecret('secret.keychain');
    this.spawnSparkles();
    playSurpriseChime();
    this.syncPanel();
  }

  private takeOff(): void {
    gameStore.setWornKeychain(null);
    playOpenChime();
    this.syncPanel();
  }

  /** Tells the open panel what she owns/wears now, without a full reopen. */
  private syncPanel(): void {
    const state = gameStore.get();
    const worn = state.inventory.find((item) => item.uid === state.wornKeychainUid);
    this.panel?.setOwnership(worn?.id ?? '', ownedKeychainIds(state.inventory));
  }

  private spawnSparkles(): void {
    this.sparkleStartedAt = this.frameElapsed;
    for (let i = 0; i < this.sparkleBase.length; i += 1) {
      this.sparkleBase[i] = {
        angle: this.sparkleRng.range(0, Math.PI * 2),
        radius: this.sparkleRng.range(0.14, 0.34),
        rise: this.sparkleRng.range(0.3, 0.55),
      };
    }
  }

  /** Same rise-and-fade beat `FacePaintStall.updatePaintingCutscene` draws, over the cart rather than the player. */
  private updateSparkles(elapsed: number): void {
    const startedAt = this.sparkleStartedAt;
    if (startedAt === null) return;
    const t = (elapsed - startedAt) / SPARKLE_DURATION;
    if (t >= 1) {
      this.sparkleStartedAt = null;
      for (const sparkle of this.sparkles) sparkle.visible = false;
      return;
    }
    for (let i = 0; i < this.sparkles.length; i += 1) {
      const sparkle = this.sparkles[i];
      const base = this.sparkleBase[i];
      if (!sparkle || !base) continue;
      const phase = Math.min(1, t + i * 0.06);
      const rise = phase * base.rise;
      const fade = Math.sin(phase * Math.PI);
      sparkle.visible = fade > 0.02;
      sparkle.position.set(Math.cos(base.angle) * base.radius, 1.05 + rise, Math.sin(base.angle) * base.radius);
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
   * The cart: a little two-wheeled trolley with a counter, and the five real
   * charm models stood up on it as a display rack — the origin-at-the-base
   * convention `art/models/keychains.ts` was built for means they can stand
   * here with no offset maths at all, the same courtesy that file's own doc
   * comment promises a shop shelf.
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

    // The five charms themselves, stood along the counter as a display rack —
    // small (they are 20 cm charms; a 1.5x scale keeps them readable from the
    // fixed camera without dwarfing the cart), spaced evenly, alternating a
    // slight lean so the row does not read as a static shelf of identical
    // ranks.
    const rackWidth = STALL_WIDTH - 0.5;
    KEYCHAIN_KINDS.forEach((kind, index) => {
      const handle = createKeychain(kind);
      const t = KEYCHAIN_KINDS.length > 1 ? index / (KEYCHAIN_KINDS.length - 1) : 0.5;
      handle.root.position.set(-rackWidth / 2 + t * rackWidth, 0.885, -0.02);
      handle.root.scale.setScalar(1.5);
      handle.root.rotation.y = (index % 2 === 0 ? 1 : -1) * 0.18;
      this.group.add(handle.root);
    });
  }

  private buildCollision(collision: CollisionWorld): void {
    const halfWidth = STALL_WIDTH / 2 + 0.08;
    const front = STALL_DEPTH / 2 + 0.08;
    const back = -STALL_DEPTH / 2 - 0.08;
    const sin = Math.sin(STALL_FACING);
    const cos = Math.cos(STALL_FACING);
    const toWorld = (lx: number, lz: number): [number, number] => [
      STALL_X + lx * cos + lz * sin,
      STALL_Z - lx * sin + lz * cos,
    ];

    const frontLeft = toWorld(-halfWidth, front);
    const frontRight = toWorld(halfWidth, front);
    const backLeft = toWorld(-halfWidth, back);
    const backRight = toWorld(halfWidth, back);

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

/**
 * How the player looks right now, for the picker's preview to wear — the
 * `FacePaintStall.playerLook` twin, minus the face paint this stall does not
 * touch and plus nothing this stall needs to add: `keychainId` is supplied by
 * the panel itself from whichever row is hovered/selected, never from here.
 */
function playerLook(): KeychainLook {
  const state = gameStore.get();
  const hat = state.inventory.find((item) => item.uid === state.wornHatUid);
  return {
    skin: state.player.skinColour,
    hair: state.player.hairColour,
    hairStyle: state.player.hairStyle,
    outfit: state.player.outfitColour,
    outfitArms: state.player.outfitArmsColour,
    eye: state.player.eyeColour,
    backpack: state.player.backpackKind,
    backpackColour: state.player.backpackColour,
    shoes: state.player.shoeKind,
    shoesColour: state.player.shoeColour,
    hatId: hat?.id ?? '',
    petId: '',
    glasses: state.player.glassesKind,
  };
}

function buildHint(uiRoot: HTMLElement): HTMLElement {
  const hint = document.createElement('div');
  hint.className = 'pill keychain-hint';
  hint.dataset.show = 'false';
  hint.innerHTML = '<span class="emoji">🔑</span><span>Tap for keychains!</span>';
  uiRoot.append(hint);
  return hint;
}

function setHintVisible(hint: HTMLElement | null, visible: boolean): void {
  if (!hint) return;
  hint.dataset.show = visible ? 'true' : 'false';
}

function disposeGroup(root: Group): void {
  root.traverse((object) => {
    const mesh = object as Partial<Mesh>;
    mesh.geometry?.dispose();
  });
}
