import { isTouchDevice } from './core/device';
import type { FrameContext, GameSystem } from './core/types';
import { CarriedItem } from './entities/CarriedItem';
import type { Player } from './entities/Player';
import type { World } from './world';
import type { ShopStand } from './world/building/shops/Shops';
import {
  eggPrize,
  itemsForShop,
  rainbowFlossAvailable,
  shopItem,
  type ShopItem,
} from './world/building/shops/catalogue';
import { gameStore, type PurchaseSpec } from './state';
import type { Hud } from './ui/Hud';
import { InventoryDrawer } from './ui/InventoryDrawer';
import { ShopPanel, type ShopPanelItem } from './ui/ShopPanel';
import { playOpenChime, playPurchaseChime, playSurpriseChime } from './ui/chime';

/**
 * Buying things.
 *
 * This is the join between three layers that otherwise do not know about each
 * other: the shop geometry in `world/building/shops`, the purchase panel and
 * backpack drawer in `ui/`, and the store that remembers what you own. It lives
 * at the top level next to {@link Game} for the same reason `Game` does —
 * everything below it stays one-directional.
 *
 * How a purchase happens, both ways round:
 *
 * - **Walking up.** Stand at a counter and the HUD says so; press E and the
 *   panel opens.
 * - **Tapping.** Every shop registers an interact zone
 *   (`world/building/interactZones.ts`), so a tap walks the character to the
 *   serving spot and fires the same `interact` action on arrival. There is one
 *   opening path, not two.
 *
 * While a panel is open the game is paused and this object owns the keyboard:
 * arrows choose, E/Enter buys, Esc closes. The game's own `menu` binding is
 * suppressed by {@link uiOpen} so that Escape does not close the shop *and*
 * pause the park behind it.
 */
export class Shopping implements GameSystem {
  readonly name = 'shopping';

  private readonly player: Player;
  private readonly world: World;
  private readonly hud: Hud;
  private readonly panel: ShopPanel;
  private readonly drawer: InventoryDrawer;
  private readonly carried: CarriedItem;

  private wasPausedByUs = false;

  constructor(uiRoot: HTMLElement, player: Player, world: World, hud: Hud) {
    this.player = player;
    this.world = world;
    this.hud = hud;

    this.panel = new ShopPanel(uiRoot, {
      onBuy: (itemId) => this.buy(itemId),
      onClose: () => this.closeUi(),
    });
    this.drawer = new InventoryDrawer(uiRoot, {
      onCarry: (uid) => gameStore.setCarried(uid),
    });
    this.carried = new CarriedItem(player.model.holdAnchor);

    hud.setBackpackHandler(() => this.toggleDrawer());
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** True while a shop panel or the backpack owns the screen. */
  get uiOpen(): boolean {
    return this.panel.isOpen || this.drawer.isOpen;
  }

  update(context: FrameContext): void {
    const { dt, elapsed, input } = context;

    this.carried.update(dt, elapsed);

    if (this.uiOpen) {
      // Esc / B on a pad closes whatever is open; nothing else gets through.
      if (input.justPressed('menu') || input.justPressed('cancel')) this.closeUi();
      else if (input.justPressed('inventory')) this.toggleDrawer();
      this.hud.setPrompt(null);
      return;
    }

    if (input.justPressed('inventory')) {
      this.toggleDrawer();
      return;
    }

    const stand = this.world.building.shops.shopAt(
      this.player.position.x,
      this.player.position.y,
      this.player.position.z,
    );
    this.hud.setPrompt(stand ? promptFor(stand) : null);

    if (stand && input.justPressed('interact') && !this.player.riding) this.openShop(stand);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.panel.dispose();
    this.drawer.dispose();
    this.carried.dispose();
  }

  // -------------------------------------------------------------- internals

  /**
   * Keys for the open panel.
   *
   * A DOM listener rather than the InputSystem, because the panel needs the
   * *keys* (which row, which direction) and not the game's action vocabulary.
   * It only ever acts while a panel is open, so ordinary play is untouched.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (!this.uiOpen) return;
    const used = this.panel.handleKey(event.code) || this.drawer.handleKey(event.code);
    if (used) event.preventDefault();
  };

  private openShop(stand: ShopStand): void {
    const world = gameStore.get().world;
    const items = itemsForShop(stand.id).map((item): ShopPanelItem => ({
      id: item.id,
      displayName: item.displayName,
      blurb: item.blurb,
      icon: item.icon,
      price: item.price,
      // The rainbow candy floss is the only thing that comes and goes.
      available: !item.rare || rainbowFlossAvailable(world.dayCount, world.timeOfDay),
    }));

    this.panel.openWith({
      title: stand.title,
      glyph: stand.glyph,
      greeting: stand.greeting,
      accent: stand.accent,
      items,
    });
    playOpenChime();
    this.setPaused(true);
  }

  private toggleDrawer(): void {
    if (this.panel.isOpen) this.panel.close();
    this.drawer.toggle();
    if (this.drawer.isOpen) {
      playOpenChime();
      this.setPaused(true);
    } else {
      this.setPaused(false);
    }
  }

  private closeUi(): void {
    this.panel.close();
    this.drawer.close();
    this.setPaused(false);
  }

  /**
   * Buys one thing, and hatches it if it was an egg.
   *
   * The egg is bought first and *then* opened, so both the egg and what was
   * inside it are in the backpack — a six-year-old who buys three eggs should be
   * able to see that they bought three eggs.
   */
  private buy(itemId: string): void {
    const item = shopItem(itemId);
    if (!item) return;

    const bought = gameStore.buy(specFor(item));
    if (!bought) return;
    playPurchaseChime();

    if (item.id !== 'egg.surprise') return;

    const prize = eggPrize(gameStore.get().inventory.length);
    this.panel.showSurprise(prize.icon, prize.displayName, prize.blurb, () => {
      gameStore.buy(specFor(prize));
      playSurpriseChime();
    });
  }

  /**
   * Pausing is shared with the game's own pause, so this only ever *un*-pauses
   * something it paused itself — otherwise closing a shop would resume a park a
   * grown-up had deliberately paused.
   */
  private setPaused(paused: boolean): void {
    if (paused) {
      if (!gameStore.get().paused) {
        this.wasPausedByUs = true;
        gameStore.setPaused(true);
      }
      return;
    }
    if (this.wasPausedByUs) {
      this.wasPausedByUs = false;
      gameStore.setPaused(false);
    }
  }
}

function specFor(item: ShopItem): PurchaseSpec {
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

function promptFor(stand: ShopStand): string {
  return isTouchDevice() ? `Tap the counter — ${stand.title}` : `Press E — ${stand.title}`;
}
