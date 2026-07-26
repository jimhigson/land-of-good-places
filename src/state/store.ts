import { PALETTE } from '../core/palette';
import { DAY_START_TIME, PLAYER_DEFAULT_NAME } from '../core/constants';
import type {
  CuteCategory,
  CutePlacement,
  FlowerColour,
  GameMode,
  GameState,
  GameTime,
  InventoryItem,
  InventoryKind,
} from './types';

/** Every flower colour there is to find, in a fixed display order. */
export const FLOWER_COLOURS: readonly FlowerColour[] = [
  'yellow',
  'red',
  'blue',
  'violet',
  'pink',
  'white',
];

/** The true palette colour each flower blooms into. */
export const FLOWER_HEX: Readonly<Record<FlowerColour, number>> = {
  yellow: PALETTE.flowerYellow,
  red: PALETTE.flowerRed,
  blue: PALETTE.flowerBlue,
  violet: PALETTE.flowerViolet,
  pink: PALETTE.blossomPink,
  white: PALETTE.blossomWhite,
};

/** One emoji per colour, for the HUD and the Cute-o-dex. */
export const FLOWER_ICON: Readonly<Record<FlowerColour, string>> = {
  yellow: '🌼',
  red: '🌺',
  blue: '🌷',
  violet: '🪻',
  pink: '🌸',
  white: '💮',
};

function flowerDisplayName(colour: FlowerColour): string {
  return `${colour[0]?.toUpperCase()}${colour.slice(1)} flower`;
}

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
 * The kinds of thing that walk or float behind you.
 *
 * Everything else — treats, hats, stickers, eggs — rides in the backpack, which
 * is where the peeking heads come from. Kept here rather than in the parade
 * system so that an inventory entry knows what it is the moment it is bought,
 * and the Cute-o-dex can say "this one can come out with you" without asking
 * anything in `entities/`.
 */
const PARADE_KINDS: ReadonlySet<InventoryKind> = new Set<InventoryKind>(['toy', 'pet', 'balloon']);

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
      paradeable: PARADE_KINDS.has(spec.kind),
      // Everything comes out of the shop keen to join in. A thing that cannot
      // parade is stowed for good — nothing ever un-stows it.
      stowed: !PARADE_KINDS.has(spec.kind),
    };
    this.state.inventory.push(item);
    if (item.carryable) this.state.carriedUid = item.uid;
    // Placement is what the parade reads; the newest carryable thing goes into
    // the hands, a toy or a pet falls in behind you, and the rest wait in the bag.
    this.collect(
      item.id,
      item.displayName,
      item.category,
      item.carryable ? 'carried' : item.paradeable ? 'parade' : 'backpack',
    );
    this.notify();
    return item;
  }

  /**
   * Picks a free flower straight out of the meadow — no shop, no price.
   *
   * Unlike `buy()` it never touches the purse and it is never carryable or
   * paradeable: a picked flower's only home is the hair (`WornFlower`), which
   * is why it goes straight to `wornFlowerUid` — "wear immediately by
   * default, most recently picked wins" is the whole of the wearing rule.
   */
  collectFlower(colour: FlowerColour): InventoryItem {
    this.purchaseCount += 1;
    const id = `flower.${colour}`;
    const displayName = flowerDisplayName(colour);
    const item: InventoryItem = {
      uid: `${id}#${this.purchaseCount}`,
      id,
      kind: 'flower',
      displayName,
      icon: FLOWER_ICON[colour],
      category: 'flower',
      shopId: 'meadow',
      acquiredAt: this.gameTime(),
      carryable: false,
      paradeable: false,
      stowed: true,
      flowerColour: colour,
    };
    this.state.inventory.push(item);
    this.collect(id, displayName, 'flower', 'worn');
    this.state.wornFlowerUid = item.uid;
    this.notify();
    return item;
  }

  /**
   * Wears a picked flower in the hair, or takes it off with `null`.
   *
   * Exposed mainly for a future Cute-o-dex / drawer toggle — picking a flower
   * already wears it, via `collectFlower`.
   */
  setWornFlower(uid: string | null): void {
    if (uid !== null && !this.state.inventory.some((item) => item.uid === uid && item.kind === 'flower')) {
      return;
    }
    if (this.state.wornFlowerUid === uid) return;
    this.state.wornFlowerUid = uid;
    this.notify();
  }

  /** Puts one owned thing in the player's hands, or empties them with `null`. */
  setCarried(uid: string | null): void {
    if (uid !== null && !this.state.inventory.some((item) => item.uid === uid)) return;
    if (this.state.carriedUid === uid) return;
    const previous = this.state.inventory.find((item) => item.uid === this.state.carriedUid);
    this.state.carriedUid = uid;
    // Picking a thing up takes it out of the parade, and putting it down hands
    // it back — both are just a placement refresh on the ids either side.
    if (previous) this.refreshPlacement(previous.id);
    const next = this.state.inventory.find((item) => item.uid === uid);
    if (next) this.refreshPlacement(next.id);
    this.notify();
  }

  /**
   * Sends one owned thing to the backpack, or brings it back out.
   *
   * This is what tapping a member of the parade does. Only paradeable things
   * can come *out* — asking for a candy floss to walk behind you is quietly
   * ignored rather than treated as an error, because the only caller that could
   * ask is a mis-click.
   */
  setStowed(uid: string, stowed: boolean): void {
    const item = this.state.inventory.find((entry) => entry.uid === uid);
    if (!item) return;
    if (!stowed && !item.paradeable) return;
    if (item.stowed === stowed) return;
    item.stowed = stowed;
    // Coming out of the bag also means letting go of it — a thing cannot be in
    // your hands and walking behind you at the same time.
    if (!stowed && this.state.carriedUid === uid) this.state.carriedUid = null;
    this.refreshPlacement(item.id);
    this.notify();
  }

  /**
   * Stows or un-stows *every* copy of a catalogue id.
   *
   * The Cute-o-dex is a book of kinds, not of individual purchases: a child who
   * bought three bunnies pressed one bunny picture, and expects all three to do
   * the same thing.
   */
  setStowedById(id: string, stowed: boolean): void {
    let changed = false;
    for (const item of this.state.inventory) {
      if (item.id !== id) continue;
      if (!stowed && !item.paradeable) continue;
      if (item.stowed === stowed) continue;
      item.stowed = stowed;
      if (!stowed && this.state.carriedUid === item.uid) this.state.carriedUid = null;
      changed = true;
    }
    if (!changed) return;
    this.refreshPlacement(id);
    this.notify();
  }

  /** True when at least one copy of this catalogue id is out of the bag. */
  isOut(id: string): boolean {
    return this.state.inventory.some((item) => item.id === id && item.paradeable && !item.stowed);
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

  /**
   * Re-derives a Cute-o-dex entry's placement from the copies actually owned.
   *
   * `CuteThing.placement` is one word about a whole kind, so it takes the most
   * interesting answer: in your hands beats walking behind you, which beats
   * sitting in the bag.
   */
  private refreshPlacement(id: string): void {
    const entry = this.state.collection[id];
    if (!entry) return;
    const copies = this.state.inventory.filter((item) => item.id === id);
    if (copies.some((item) => item.uid === this.state.carriedUid)) entry.placement = 'carried';
    else if (copies.some((item) => item.paradeable && !item.stowed)) entry.placement = 'parade';
    else entry.placement = 'backpack';
  }

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
    wornFlowerUid: null,
    paused: false,
    debugOverlay: false,
  };
}

/** The one and only store instance. Import this, don't construct your own. */
export const gameStore = new GameStore();
