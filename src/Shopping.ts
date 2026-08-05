import type { FrameContext, GameSystem } from './core/types';
import { CarriedItem } from './entities/CarriedItem';
import { EatenTreat } from './entities/EatenTreat';
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
import { playEatingSound, playOpenChime, playPurchaseChime, playSurpriseChime } from './ui/chime';

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
 * Once it is open, **one press buys**: every item in the list has its own Buy
 * button beside its description, and there is no chosen item to get wrong (see
 * `ui/ShopPanel.ts`). Whatever is bought goes wherever that kind of thing goes
 * — the hands, the parade behind you, or the backpack — and that routing is
 * `gameStore.buy`'s job, not this panel's; nothing about the one-click change
 * touched it.
 *
 * While a panel is open the game is paused and this object owns the keyboard:
 * arrows move between the Buy buttons, Enter/Space/E presses the focused one,
 * Esc closes. The game's own `menu` binding is suppressed by {@link uiOpen} so
 * that Escape does not close the shop *and* pause the park behind it.
 *
 * Pausing is re-derived from {@link uiOpen} every frame ({@link syncPaused}),
 * rather than toggled at each individual open/close call site. A close
 * affordance that forgets to tell `Shopping` about it — the backpack's own
 * ✕ button used to close the drawer directly and leave the park paused
 * forever — can no longer desync the pause state: whatever the panel/drawer's
 * `isOpen` says, the next frame's `update()` puts the park back in step.
 */
export class Shopping implements GameSystem {
  readonly name = 'shopping';

  private readonly player: Player;
  private readonly world: World;
  private readonly panel: ShopPanel;
  private readonly drawer: InventoryDrawer;
  private readonly carried: CarriedItem;
  private readonly eating: EatenTreat;

  private wasPausedByUs = false;

  constructor(uiRoot: HTMLElement, player: Player, world: World, hud: Hud) {
    this.player = player;
    this.world = world;

    this.panel = new ShopPanel(uiRoot, {
      onBuy: (itemId) => this.buy(itemId),
      onClose: () => this.closeUi(),
    });
    this.drawer = new InventoryDrawer(uiRoot, {
      // Wearing goes straight to the store from the drawer — see the note on
      // `InventoryDrawer.useSelected`. Only the hands come through here.
      onCarry: (uid) => gameStore.setCarried(uid),
    });
    // The anchor is a closure, not a captured `Group` — see `WornHat.ts`'s
    // doc comment on the same pattern. It reads `player.model.holdAnchor`
    // fresh every time either of these actually draws something, so the HUD's
    // "Look" pill rebuilding `player.model` in place never leaves them
    // reaching into a disposed hand.
    this.carried = new CarriedItem(() => player.model.holdAnchor);
    // The same hand: a treat is eaten out of it, and whatever she was already
    // holding steps aside for a couple of seconds — see `CarriedItem.setVisible`.
    this.eating = new EatenTreat(() => player.model.holdAnchor);

    hud.setBackpackHandler(() => this.toggleDrawer());
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** True while a shop panel or the backpack owns the screen. */
  get uiOpen(): boolean {
    return this.panel.isOpen || this.drawer.isOpen;
  }

  /**
   * The HUD's "Look" pill, by way of `Game.applyLiveLook`: `player.model` has
   * just been rebuilt, so whatever `carried`/`eating` had reached into the
   * old `holdAnchor` is gone with it. Neither needs reconstructing — each
   * already reads the anchor live (see the constructor's own doc comment) —
   * they just need telling, since neither can tell on its own that the mesh
   * it was tracking has already been disposed out from under it.
   */
  rebindPlayerModel(): void {
    this.carried.rebind();
    this.eating.rebind();
  }

  update(context: FrameContext): void {
    const { dt, elapsed, input } = context;

    this.carried.update(dt, elapsed);
    this.eating.update(dt, elapsed);
    // Re-derived every frame rather than toggled at the start and end of a
    // munch, the same way `syncPaused` below re-derives the pause: there is
    // then no path — a swapped item, a finished treat, a disposed system —
    // that can leave her holding an invisible teddy.
    this.carried.setVisible(!this.eating.active);
    this.syncPaused();

    if (this.uiOpen) {
      // Esc / B on a pad closes whatever is open; nothing else gets through.
      if (input.justPressed('menu') || input.justPressed('cancel')) this.closeUi();
      else if (input.justPressed('inventory')) this.toggleDrawer();
      return;
    }

    if (input.justPressed('inventory')) {
      this.toggleDrawer();
      return;
    }

    // No "Press E to shop" prompt of its own any more: GAME_DESIGN.md's
    // SELECTION RULE puts a "Shop!" chip over the counter instead, from the one
    // system that offers every action in the park (`world/Selection.ts`). The
    // press itself is still handled here, exactly as it always was — the chip
    // fires the same virtual E.
    const stand = this.world.building.shops.shopAt(
      this.player.position.x,
      this.player.position.y,
      this.player.position.z,
    );

    if (stand && input.justPressed('interact') && !this.player.riding) this.openShop(stand);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.panel.dispose();
    this.drawer.dispose();
    this.carried.dispose();
    this.eating.dispose();
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
  }

  private toggleDrawer(): void {
    if (this.panel.isOpen) this.panel.close();
    this.drawer.toggle();
    if (this.drawer.isOpen) playOpenChime();
  }

  private closeUi(): void {
    this.panel.close();
    this.drawer.close();
  }

  /**
   * Buys one thing, hatches it if it was an egg, and eats it if it was food.
   *
   * *Where* the thing goes is not decided here — `gameStore.buy` routes it and
   * says what happened (see `Acquisition` in `state/store.ts`). This only
   * chooses the noise and, for a treat, starts the munch: an ice cream is
   * enjoyed on the spot rather than kept, so it gets its own sound instead of
   * the purchase chime, and the model is in her hand for a couple of seconds.
   *
   * The egg is bought first and *then* opened, so both the egg and what was
   * inside it are in the backpack — a six-year-old who buys three eggs should be
   * able to see that they bought three eggs.
   */
  private buy(itemId: string): void {
    const item = shopItem(itemId);
    if (!item) return;

    const bought = gameStore.buy(specFor(item));
    if (bought.outcome === 'refused') return;
    if (bought.outcome === 'eaten') {
      // The panel comes down first. It covers most of the screen, and a park
      // that is paused behind it runs on `dt = 0` (see `Game.tick`) — so
      // leaving it up would hide the one thing the family asked to be shown
      // and freeze the munch under it while the sound played on regardless.
      this.closeUi();
      this.eating.start(bought.id);
      playEatingSound();
      return;
    }
    playPurchaseChime();

    if (item.id !== 'egg.surprise') return;

    const prize = eggPrize(gameStore.get().inventory.length);
    this.panel.showSurprise(prize.icon, prize.displayName, prize.blurb, () => {
      gameStore.buy(specFor(prize));
      playSurpriseChime();
    });
  }

  /**
   * Keeps the park's pause state a mirror of {@link uiOpen}, checked fresh
   * every frame rather than threaded through every place that opens or closes
   * a panel. That is what makes it impossible for a close path to forget to
   * unpause: however `panel.isOpen` / `drawer.isOpen` got to their current
   * values — the ✕ button, tap-outside, Esc, the I key, a toggle — this is the
   * one and only place that reconciles them against `gameStore.paused`.
   *
   * Pausing is shared with the game's own pause, so this only ever *un*-pauses
   * something it paused itself — otherwise closing a shop would resume a park a
   * grown-up had deliberately paused.
   */
  private syncPaused(): void {
    if (this.uiOpen) {
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


