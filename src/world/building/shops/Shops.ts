import type { Group } from 'three';
import { PALETTE } from '../../../core/palette';
import { ART } from '../../../art/style/artPalette';
import { createKeeper, type KeeperHandle } from '../../../art/models/keeper';
import { gameStore } from '../../../state';
import { SHOP_UNITS, deckY, shopLocalToBuilding, worldX, worldZ, type ShopUnitDefinition } from '../layout';
import type { ShopUnits } from '../ShopUnits';
import { buildKiosk } from './kiosk';
import { buildFitout, type Fitout } from './fitouts';
import { rainbowFlossAvailable, type ShopId } from './catalogue';

/**
 * The seven fitted-out shops.
 *
 * {@link ShopUnits} owns the empty alcoves; this owns what is in them. Each unit
 * gets the shared kiosk shell (counter, shelves, awning, name board), its own
 * stock on the shelves, and a shopkeeper behind the counter.
 *
 * **Two visibility tiers, and the reason is the draw-call budget.** The shell
 * lives with the floor and is hidden by the cutaway along with it. The *detail*
 * — the stock, the pets, the shopkeeper — is shown only while the player is on
 * that shop's deck. Standing in the garden the whole tower is drawn, and seven
 * fully-modelled shop interiors nobody can see would cost more than the rest of
 * the park put together. Walk in and the shop you are in is complete.
 */

/** Where a child stands to be served, in unit-local metres. */
export const SHOP_STAND_Z = 2.4;
/** How close to that spot counts as "at the counter". */
export const SHOP_REACH = 2.2;

export interface ShopStand {
  readonly id: ShopId;
  readonly title: string;
  /** The shop's emoji, from `SHOP_UNITS` — the same one on its name board. */
  readonly glyph: string;
  readonly greeting: string;
  readonly accent: number;
  readonly deck: number;
  /** World position of the spot in front of the counter. */
  readonly x: number;
  readonly z: number;
  /** World height of the deck it is on. */
  readonly y: number;
}

interface FittedShop {
  readonly unit: ShopUnitDefinition;
  readonly detail: Group;
  readonly fitout: Fitout;
  readonly keeper: KeeperHandle;
  readonly seed: number;
}

/** A line of patter and a keeper's colours for each shop. */
interface Skin {
  readonly greeting: string;
  readonly subtitle: string;
  readonly apron: number;
  readonly hair: number;
  readonly skin: number;
}

const SKINS: Readonly<Record<ShopId, Skin>> = {
  toy: {
    greeting: 'Hello! Would you like a cuddly one?',
    subtitle: 'cuddly things!',
    apron: PALETTE.markerSky,
    hair: PALETTE.hair,
    skin: PALETTE.skin,
  },
  balloon: {
    greeting: 'Hold on tight — they do float off!',
    subtitle: 'hold on tight!',
    apron: PALETTE.markerLemon,
    hair: ART.ripikaTip,
    skin: ART.biscuitMuzzle,
  },
  candyFloss: {
    greeting: 'Freshly spun. Mind your fingers!',
    subtitle: 'freshly spun',
    apron: PALETTE.markerMint,
    hair: PALETTE.markerLilac,
    skin: ART.corgiTanDark,
  },
  iceCream: {
    greeting: 'Three scoops is allowed. Four is showing off.',
    subtitle: 'silly flavours',
    apron: PALETTE.markerPink,
    hair: ART.ripikaTip,
    skin: PALETTE.skin,
  },
  hat: {
    greeting: 'Every hat here fits everybody. It is magic.',
    subtitle: 'one for everyone',
    apron: PALETTE.markerSky,
    hair: PALETTE.flowerYellow,
    skin: ART.biscuitMuzzle,
  },
  stickerPet: {
    greeting: 'The little ones like being carried.',
    subtitle: 'stickers & tiny pets',
    apron: PALETTE.markerLilac,
    hair: PALETTE.hair,
    skin: ART.corgiTanDark,
  },
  surpriseEgg: {
    greeting: 'Nobody knows what is inside. Not even me!',
    subtitle: 'what is inside?',
    apron: PALETTE.blossomPink,
    hair: PALETTE.markerMint,
    skin: PALETTE.skin,
  },
};

/**
 * Takes a shop's contents out of the shadow pass altogether.
 *
 * Two reasons, and the second one is a trap worth knowing about:
 *
 * 1. The art assets are authored as free-standing park objects, so every solid
 *    part of them casts — quite right for RiPika running about the garden, quite
 *    wrong for a 40 cm RiPika on a shelf inside a shell that already drops a
 *    deep shadow across the whole floor plate.
 * 2. **Under `VSMShadowMap`, `receiveShadow` costs a shadow-pass draw call too.**
 *    three.js renders receivers as well as casters into a VSM shadow map, so the
 *    house convention of "castShadow = false, receiveShadow = true" for interior
 *    fittings still draws everything twice. Measured on the balloon shop: 82
 *    meshes, 124 draw calls with `receiveShadow`, 82 without.
 *
 * Nothing inside a kiosk casts a shadow, so nothing inside one has anything to
 * receive but the building's own — which the toon ramp and the interior lift
 * already stand in for.
 */
function leaveTheShadowPass(root: Group): void {
  root.traverse((object) => {
    const mesh = object as {
      isMesh?: boolean;
      isInstancedMesh?: boolean;
      castShadow?: boolean;
      receiveShadow?: boolean;
    };
    if (!mesh.isMesh && !mesh.isInstancedMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
}

export class Shops {
  readonly stands: readonly ShopStand[];

  private readonly shops: FittedShop[] = [];
  private visibleDeck: number | null = null;
  private rainbowOn = false;

  constructor(units: ShopUnits) {
    const stands: ShopStand[] = [];

    for (const unit of SHOP_UNITS) {
      const skin = SKINS[unit.id as ShopId];
      if (!skin) continue;

      const anchor = units.getGroup(unit.id);
      const kiosk = buildKiosk(unit, skin.subtitle);
      leaveTheShadowPass(kiosk.group);
      anchor.add(kiosk.group);

      const fitout = buildFitout(unit.id);
      const detail = fitout.detail;
      detail.name = `shop-detail:${unit.id}`;
      detail.visible = false;

      // Behind the counter and off to one side, so the stock stays in view.
      const keeper = createKeeper({ colour: skin.apron, hair: skin.hair, skin: skin.skin });
      keeper.root.position.set(-1.3, 0, 0.5);
      detail.add(keeper.root);

      leaveTheShadowPass(detail);
      anchor.add(detail);
      units.setPlaceholderVisible(unit.id, false);

      this.shops.push({ unit, detail, fitout, keeper, seed: stands.length * 1.7 });

      const [standX, standZ] = shopLocalToBuilding(unit, 0, SHOP_STAND_Z);
      stands.push({
        id: unit.id as ShopId,
        title: unit.title,
        glyph: unit.glyph,
        greeting: skin.greeting,
        accent: unit.accent,
        deck: unit.deck,
        x: worldX(standX),
        z: worldZ(standZ),
        y: deckY(unit.deck),
      });
    }

    this.stands = stands;
  }

  /**
   * Shows the detail of the shops on `deck` and hides the rest. `null` (the
   * player is outside the building) hides all of it.
   */
  setVisibleDeck(deck: number | null): void {
    if (deck === this.visibleDeck) return;
    this.visibleDeck = deck;
    for (const shop of this.shops) shop.detail.visible = deck !== null && shop.unit.deck === deck;
  }

  update(dt: number, elapsed: number): void {
    this.updateRainbowFloss();

    for (const shop of this.shops) {
      if (!shop.detail.visible) continue;
      shop.fitout.update(dt, elapsed);
      // The keeper sways, looks about and bobs — a shopkeeper standing perfectly
      // still reads as a mannequin, which is the opposite of what a shop wants.
      const t = elapsed + shop.seed;
      shop.keeper.body.rotation.z = Math.sin(t * 1.1) * 0.03;
      shop.keeper.head.rotation.y = Math.sin(t * 0.6) * 0.35;
      shop.keeper.head.rotation.z = Math.sin(t * 1.4) * 0.05;
      shop.keeper.setWalkPhase((t * 0.35) % 1, 0.5);
    }
  }

  /** The shop counter the player is standing at, or null. */
  shopAt(x: number, y: number, z: number): ShopStand | null {
    let best: ShopStand | null = null;
    let bestDistance = SHOP_REACH;
    for (const stand of this.stands) {
      // Height matters: shops sit above one another on different decks, and a
      // counter two floors up is not one you can lean on.
      if (Math.abs(y - stand.y) > 1.6) continue;
      const distance = Math.hypot(x - stand.x, z - stand.z);
      if (distance >= bestDistance) continue;
      best = stand;
      bestDistance = distance;
    }
    return best;
  }

  /**
   * Rare rainbow candy floss: on sale in one short window on some days, so a
   * child has to come back and look. The stand's display follows the catalogue,
   * never the other way round.
   */
  private updateRainbowFloss(): void {
    const world = gameStore.get().world;
    const on = rainbowFlossAvailable(world.dayCount, world.timeOfDay);
    if (on === this.rainbowOn) return;
    this.rainbowOn = on;
    for (const shop of this.shops) shop.fitout.setRainbowVisible?.(on);
  }
}
