import { PALETTE } from '../core/palette';
import { DAY_START_TIME, PLAYER_DEFAULT_NAME } from '../core/constants';
import type {
  CuteCategory,
  CutePlacement,
  GameMode,
  GameState,
  GameTime,
  InventoryItem,
  InventoryKind,
} from './types';

/**
 * Everything a shop has to say about a thing for the store to file it away.
 *
 * The catalogue (`world/building/shops/catalogue.ts`) owns the prices, the
 * models and the icons; the store only wants the bit it remembers.
 */
export interface PurchaseSpec {
  readonly id: string;
  readonly kind: InventoryKind;
  readonly displayName: string;
  readonly icon: string;
  readonly category: CuteCategory;
  readonly shopId: string;
  readonly price: number;
  readonly carryable: boolean;
}

type Listener = (state: GameState) => void;

/**
 * A tiny observable store — the single source of truth for money, the
 * collection, the clock and the game mode.
 *
 * Why not just a module-level object? Because the HUD needs to know when a value
 * changes without polling, and later features (shops, the Cute-o-dex, mayhem
 * mode) all mutate the same handful of fields. One place, one notification.
 *
 * Usage:
 * ```ts
 * gameStore.subscribe((s) => hud.render(s));
 * gameStore.earn(50);
 * ```
 *
 * Mutations go through named actions rather than a generic `set`, so the intent
 * ("spend", "collect") stays readable and mode rules live in one place.
 */
class GameStore {
  private state: GameState = createInitialState();
  private readonly listeners = new Set<Listener>();
  /** Only ever counts up; it is what makes an inventory `uid` unique. */
  private purchaseCount = 0;
  /** Guards against re-entrant notifications when a listener writes back. */
  private notifyQueued = false;

  /** Current state. Treat as read-only; use the actions below to change it. */
  get(): Readonly<GameState> {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  // ------------------------------------------------------------- actions

  setParkName(name: string): void {
    const trimmed = name.trim();
    this.state.parkName = trimmed.length > 0 ? trimmed : 'Land of Good Places';
    this.notify();
  }

  setPlayerName(name: string): void {
    const trimmed = name.trim();
    this.state.player.name = trimmed.length > 0 ? trimmed : PLAYER_DEFAULT_NAME;
    this.notify();
  }

  setMode(mode: GameMode): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    // Coming back to normal mode always restores the player to full beans.
    if (mode === 'normal') this.state.player.health = this.state.player.maxHealth;
    this.notify();
  }

  earn(amount: number): void {
    if (amount <= 0) return;
    this.state.money += amount;
    this.notify();
  }

  /**
   * Attempts a purchase. In normal mode the purse is bottomless, so this always
   * succeeds and money is topped straight back up — Eleri's rule.
   */
  spend(amount: number): boolean {
    if (this.state.mode === 'normal') {
      this.notify();
      return true;
    }
    if (this.state.money < amount) return false;
    this.state.money -= amount;
    this.notify();
    return true;
  }

  /**
   * Buys one thing.
   *
   * Returns the new inventory entry, or `null` if the purse said no (which in
   * normal mode it never does). One entry per purchase rather than a stack
   * count, because the parade needs to put *two* toys behind you if you bought
   * two — the Cute-o-dex keeps the counts, and is updated here as well so the
   * two can never disagree.
   *
   * The newest carryable thing goes straight into the player's hands, which is
   * how a six-year-old finds out the purchase worked.
   */
  buy(spec: PurchaseSpec): InventoryItem | null {
    if (!this.spend(spec.price)) return null;

    this.purchaseCount += 1;
    const item: InventoryItem = {
      uid: `${spec.id}#${this.purchaseCount}`,
      id: spec.id,
      kind: spec.kind,
      displayName: spec.displayName,
      icon: spec.icon,
      category: spec.category,
      shopId: spec.shopId,
      acquiredAt: this.gameTime(),
      carryable: spec.carryable,
    };
    this.state.inventory.push(item);
    if (item.carryable) this.state.carriedUid = item.uid;
    // Placement is what the parade system (step 5) will read; carried things
    // start in the hands, everything else waits in the backpack.
    this.collect(item.id, item.displayName, item.category, item.carryable ? 'carried' : 'backpack');
    this.notify();
    return item;
  }

  /** Puts one owned thing in the player's hands, or empties them with `null`. */
  setCarried(uid: string | null): void {
    if (uid !== null && !this.state.inventory.some((item) => item.uid === uid)) return;
    if (this.state.carriedUid === uid) return;
    this.state.carriedUid = uid;
    this.notify();
  }

  /** The park clock, as a value an inventory entry can keep. */
  gameTime(): GameTime {
    return { day: this.state.world.dayCount, timeOfDay: this.state.world.timeOfDay };
  }

  /** Records a cute thing in the Cute-o-dex, creating the entry if it is new. */
  collect(
    id: string,
    name: string,
    category: CuteCategory,
    placement: CutePlacement = 'parade',
  ): void {
    const existing = this.state.collection[id];
    if (existing) {
      existing.count += 1;
      existing.discovered = true;
    } else {
      this.state.collection[id] = {
        id,
        name,
        category,
        count: 1,
        placement,
        discovered: true,
      };
    }
    this.notify();
  }

  setTimeOfDay(timeOfDay: number, dayCount: number, lightsOn: boolean): void {
    const world = this.state.world;
    // The clock ticks every frame; only wake listeners on visible changes.
    const changed =
      world.dayCount !== dayCount ||
      world.lightsOn !== lightsOn ||
      Math.abs(world.timeOfDay - timeOfDay) > 1 / 1440;
    world.timeOfDay = timeOfDay;
    world.dayCount = dayCount;
    world.lightsOn = lightsOn;
    if (changed) this.notify();
  }

  setPaused(paused: boolean): void {
    if (this.state.paused === paused) return;
    this.state.paused = paused;
    this.notify();
  }

  toggleDebugOverlay(): void {
    this.state.debugOverlay = !this.state.debugOverlay;
    this.notify();
  }

  // ------------------------------------------------------------ internal

  private notify(): void {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    // Coalesce to a microtask so a burst of actions produces one UI update.
    queueMicrotask(() => {
      this.notifyQueued = false;
      for (const listener of this.listeners) listener(this.state);
    });
  }
}

function createInitialState(): GameState {
  return {
    parkName: 'Land of Good Places',
    mode: 'normal',
    money: 500,
    splashPoints: 0,
    bestSplashPoints: 0,
    player: {
      name: PLAYER_DEFAULT_NAME,
      kind: 'kid',
      hairColour: PALETTE.hair,
      outfitColour: PALETTE.outfit,
      health: 5,
      maxHealth: 5,
    },
    world: {
      timeOfDay: DAY_START_TIME,
      dayCount: 0,
      lightsOn: false,
    },
    collection: {},
    inventory: [],
    carriedUid: null,
    paused: false,
    debugOverlay: false,
  };
}

/** The one and only store instance. Import this, don't construct your own. */
export const gameStore = new GameStore();
