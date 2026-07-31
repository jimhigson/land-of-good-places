import { PALETTE } from '../core/palette';
import { DAY_START_TIME, PLAYER_DEFAULT_NAME } from '../core/constants';
import type { SaveFile, SavedGame } from './save';
import type {
  BackpackKind,
  CuteCategory,
  CutePlacement,
  FacePaintId,
  FlowerColour,
  GameMode,
  GameState,
  GameTime,
  HairStyle,
  InventoryItem,
  InventoryKind,
} from './types';

/**
 * Every flower colour there is to find, in a fixed display order.
 *
 * Defined in `./types` next to the `FlowerColour` union it produces — see the
 * note at the top of that file — and re-exported here so the rest of the game
 * keeps importing it from the same place it always has.
 */
export { FLOWER_COLOURS } from './types';

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

/**
 * What the character creator hands the store once, at the very start of a
 * fresh browser (see `ui/CharacterCreation.ts` and `main.ts`'s `boot()`,
 * which runs it before `new Game(...)` exists at all).
 *
 * `hat` and `pet` are full catalogue entries (`ShopItem` from
 * `world/building/shops/catalogue.ts` satisfies `PurchaseSpec` with fields to
 * spare) rather than bare ids, so the store never has to import the catalogue
 * itself to look them up — the one place that already knows both the
 * catalogue and the store is the UI layer, which is where this is built.
 */
export interface CharacterCreationChoice {
  readonly name: string;
  readonly skinColour: number;
  readonly hairColour: number;
  readonly hairStyle: HairStyle;
  readonly outfitColour: number;
  readonly eyeColour: number;
  readonly backpackKind: BackpackKind;
  readonly backpackColour: number;
  readonly hat: PurchaseSpec;
  readonly pet: PurchaseSpec;
}

type Listener = (state: GameState) => void;

/** The one refusal, shared — it carries no data, so it never needs allocating. */
const REFUSED: Acquisition = { outcome: 'refused' };

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
 * Which bit of the player a thing goes on, or `null` for something that is not
 * worn at all.
 *
 * There are exactly three slots, because there are exactly three `worn*Uid`
 * fields and three systems that draw them: `entities/WornHat.ts` on the head,
 * `entities/WornFlower.ts` in the hair and `entities/WornJetpack.ts` on the
 * back. Deriving the slot from {@link InventoryKind} here — rather than in the
 * drawer that happens to be the first caller — is what stops "can I wear this?"
 * from being answered differently by the backpack, the Cute-o-dex and whatever
 * asks next.
 *
 * A hat is also `carryable`, so both a wear and a carry are defensible answers
 * to tapping one. The backpack picks wearing: a child who bought a crown wants
 * it on their head, and a hat still lands in the hands on purchase
 * ({@link GameStore.buy}) so nothing became unreachable.
 */
export function wearableSlot(kind: InventoryKind): 'hat' | 'flower' | 'jetpack' | null {
  if (kind === 'hat') return 'hat';
  if (kind === 'flower') return 'flower';
  if (kind === 'jetpack') return 'jetpack';
  return null;
}

/**
 * Whether a thing is eaten on the spot rather than kept.
 *
 * GAME_DESIGN.md, the family's words: *"keeping ice cream in a backpack
 * doesn't really make sense — in this case make an eating sound effect and
 * show a 3d model of the ice cream for a few seconds, add it as eaten to the
 * cute-o-dex and the player doesn't carry it around."*
 *
 * `wearableSlot`'s twin, and here for the same reason: "what sort of thing is
 * this, and where does it go?" is one question with one answer, asked of the
 * {@link InventoryKind} and nowhere else. Before this existed the shop, the
 * spooky house and the backpack would each have had to know that an ice cream
 * is different, and the day a fourth caller forgot, a candy floss would have
 * followed a child around the park forever.
 *
 * Every `treat` is edible — the candy flosses, the ice creams, and the sweet
 * that falls out of the spooky house's mouth. Nothing else is.
 */
export function isEdible(kind: InventoryKind): boolean {
  return kind === 'treat';
}

/**
 * What became of a thing taken from a shop.
 *
 * {@link GameStore.buy} used to answer with `InventoryItem | null`, which had
 * exactly two answers for three outcomes: since food stopped being kept, "you
 * own it now" and "you ate it" are both real successes and only one of them
 * produces an inventory entry. Callers that used to write `if (!bought)
 * return;` would have quietly treated a happily-eaten ice cream as a failed
 * purchase.
 */
export type Acquisition =
  /** The purse said no. Only possible in mayhem mode; nothing happened. */
  | { readonly outcome: 'refused' }
  /** Kept. It is in the inventory now, in the hands / parade / backpack. */
  | { readonly outcome: 'kept'; readonly item: InventoryItem }
  /** Eaten on the spot: recorded in the book, never owned. `id` is the catalogue id. */
  | { readonly outcome: 'eaten'; readonly id: string };

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
  /** Monotonic change counter — see the {@link revision} getter. */
  private changes = 0;

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

  /**
   * The face-painting stall (additive feature): free, and swappable any time —
   * picking a new design just overwrites the old one, and `null` washes it off.
   */
  setFacePaint(design: FacePaintId): void {
    if (this.state.player.facePaint === design) return;
    this.state.player.facePaint = design;
    this.notify();
  }

  /**
   * Applies the character creator's choices — name, hair, clothes, the
   * starting hat and the starting pet — in one go, the moment "Let's go!" is
   * pressed.
   *
   * Runs before the player has ever been spawned (see the doc comment on
   * {@link CharacterCreationChoice}), so there is no live model to update:
   * `Player`'s own constructor simply reads `player.hairColour` /
   * `player.hairStyle` / `player.outfitColour` off this store when it builds
   * the kid a moment later. The hat and pet are filed exactly like a shop
   * purchase (`buy()`'s own `InventoryItem` + Cute-o-dex bookkeeping) but
   * free, and routed straight to their real placement instead of into the
   * player's hands: the hat goes on the head (`wornHatUid`), the pet joins
   * the parade immediately.
   */
  completeCharacterCreation(choice: CharacterCreationChoice): void {
    const trimmedName = choice.name.trim();
    this.state.player.name = trimmedName.length > 0 ? trimmedName : PLAYER_DEFAULT_NAME;
    this.state.player.skinColour = choice.skinColour;
    this.state.player.hairColour = choice.hairColour;
    this.state.player.hairStyle = choice.hairStyle;
    this.state.player.outfitColour = choice.outfitColour;
    this.state.player.eyeColour = choice.eyeColour;
    this.state.player.backpackKind = choice.backpackKind;
    this.state.player.backpackColour = choice.backpackColour;

    const hatItem = this.grantFree(choice.hat, true);
    this.state.wornHatUid = hatItem.uid;
    this.grantFree(choice.pet, false);

    this.notify();
  }

  setMode(mode: GameMode): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    this.state.moneyIsFinite = mode === 'mayhem';
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
   * Buys one thing, and puts it wherever that kind of thing goes.
   *
   * **This is the routing.** Not the shop panel, not the spooky house: one
   * place asks {@link isEdible} and {@link PARADE_KINDS} what sort of thing
   * this is, and everything downstream follows. See {@link Acquisition} for
   * why the answer is a small union rather than `InventoryItem | null`.
   *
   * Food never reaches the inventory at all — it is eaten where it is bought,
   * so there is no entry to stow, nothing to peek out of the backpack and
   * nothing to follow her in the parade. All that is left of it is the
   * Cute-o-dex line saying she had one, which is filed the same way a secret
   * is (see `state/secrets.ts`): a deed rather than a possession.
   *
   * Everything else is one entry per purchase rather than a stack count,
   * because the parade needs to put *two* toys behind you if you bought two —
   * the Cute-o-dex keeps the counts, and is updated here as well so the two
   * can never disagree.
   *
   * The newest carryable thing goes straight into the player's hands, which is
   * how a six-year-old finds out the purchase worked.
   */
  buy(spec: PurchaseSpec): Acquisition {
    if (!this.spend(spec.price)) return REFUSED;

    if (isEdible(spec.kind)) {
      // No inventory entry, no uid, no `purchaseCount` — nothing owns it. The
      // book still counts it, so eating three ice creams reads as `×3`.
      this.collect(spec.id, spec.displayName, spec.category, 'eaten');
      this.notify();
      return { outcome: 'eaten', id: spec.id };
    }

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
    // A jet pack goes straight on. Every other wearable lands in the hands and
    // is put on from the backpack drawer, which is right for a hat — there are
    // eight of them and choosing is half the fun. There is one jet pack, it is
    // the most exciting thing in the shop, and a six-year-old who has just
    // bought it wants to fly, not to open a menu. Same reasoning as the
    // character creator's starting hat going straight onto the head.
    if (wearableSlot(item.kind) === 'jetpack') this.state.wornJetpackUid = item.uid;
    // Placement is what the parade reads; the newest carryable thing goes into
    // the hands, a toy or a pet falls in behind you, and the rest wait in the bag.
    this.collect(
      item.id,
      item.displayName,
      item.category,
      item.uid === this.state.wornJetpackUid
        ? 'worn'
        : item.carryable
          ? 'carried'
          : item.paradeable
            ? 'parade'
            : 'backpack',
    );
    this.notify();
    return { outcome: 'kept', item };
  }

  /**
   * Files one catalogue item as owned, for free, without touching the purse
   * or the player's hands — `buy()`'s sibling for the one other place a thing
   * can enter the inventory: the character creator's starting hat and pet.
   *
   * `worn` picks the placement directly rather than deriving it the way
   * `buy()` does, because the two callers want opposite answers for an
   * otherwise-identical `PurchaseSpec` shape: the hat (not paradeable at all)
   * still needs to read as "in use" rather than "in the backpack", and the pet
   * (paradeable) needs to start unstowed so it falls in behind the player on
   * the very first frame instead of waiting in the bag until nudged out.
   */
  private grantFree(spec: PurchaseSpec, worn: boolean): InventoryItem {
    this.purchaseCount += 1;
    const paradeable = PARADE_KINDS.has(spec.kind);
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
      paradeable,
      stowed: worn ? false : !paradeable,
    };
    this.state.inventory.push(item);
    this.collect(item.id, item.displayName, item.category, worn ? 'worn' : paradeable ? 'parade' : 'backpack');
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
   * Called by the Cute-o-dex's flower cards and by the backpack drawer; picking
   * a flower already wears it, via `collectFlower`.
   */
  setWornFlower(uid: string | null): void {
    if (uid !== null && !this.state.inventory.some((item) => item.uid === uid && item.kind === 'flower')) {
      return;
    }
    if (this.state.wornFlowerUid === uid) return;
    const previous = this.state.inventory.find((item) => item.uid === this.state.wornFlowerUid);
    this.state.wornFlowerUid = uid;
    if (previous) this.refreshPlacement(previous.id);
    const next = this.state.inventory.find((item) => item.uid === uid);
    if (next) this.refreshPlacement(next.id);
    this.notify();
  }

  /**
   * Puts an owned hat on the player's head, or takes it off with `null`.
   *
   * `setWornFlower`'s twin, and deliberately shaped the same way: the wearing
   * systems are store subscribers (`entities/WornHat.ts`), so this one field is
   * the whole of "what am I wearing?" and nothing has to be told twice. Only
   * one hat at a time — asking for a second simply replaces the first, which is
   * what a child expects from a head.
   *
   * A hat in the hands moves to the head rather than being in both places: the
   * same model would otherwise be drawn twice, once at `holdAnchor` and once at
   * `hatAnchor`.
   */
  setWornHat(uid: string | null): void {
    if (uid !== null && !this.state.inventory.some((item) => item.uid === uid && item.kind === 'hat')) {
      return;
    }
    if (this.state.wornHatUid === uid) return;
    const previous = this.state.inventory.find((item) => item.uid === this.state.wornHatUid);
    this.state.wornHatUid = uid;

    const next = this.state.inventory.find((item) => item.uid === uid);
    if (uid !== null && this.state.carriedUid === uid) this.state.carriedUid = null;

    if (previous) this.refreshPlacement(previous.id);
    if (next) this.refreshPlacement(next.id);
    this.notify();
  }

  /**
   * Straps an owned jet pack to the player's back, or takes it off with `null`.
   *
   * {@link setWornHat}'s twin, shaped identically on purpose: one field, one
   * store subscriber drawing it (`entities/WornJetpack.ts`), nothing told
   * twice. Taking it off mid-flight is safe — `entities/Player.ts` watches the
   * same field and lands her rather than leaving her hanging in the sky.
   */
  setWornJetpack(uid: string | null): void {
    if (uid !== null && !this.state.inventory.some((item) => item.uid === uid && item.kind === 'jetpack')) {
      return;
    }
    if (this.state.wornJetpackUid === uid) return;
    const previous = this.state.inventory.find((item) => item.uid === this.state.wornJetpackUid);
    this.state.wornJetpackUid = uid;

    const next = this.state.inventory.find((item) => item.uid === uid);
    if (uid !== null && this.state.carriedUid === uid) this.state.carriedUid = null;

    if (previous) this.refreshPlacement(previous.id);
    if (next) this.refreshPlacement(next.id);
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

  /** The splash-point record, kept here so it survives a save — see `setSplashPoints`. */
  setSplashPoints(points: number, best: number): void {
    if (this.state.splashPoints === points && this.state.bestSplashPoints === best) return;
    this.state.splashPoints = points;
    this.state.bestSplashPoints = Math.max(best, this.state.bestSplashPoints);
    this.notify();
  }

  // --------------------------------------------------------------- saving

  /**
   * Counts every change anything has made, so the autosave can tell "nothing
   * happened in the last five seconds" from "she has been shopping".
   *
   * Bumped synchronously in {@link notify}, ahead of its microtask coalescing:
   * a save that fires between the mutation and the notification must still see
   * the mutation.
   */
  get revision(): number {
    return this.changes;
  }

  /** The uid counter, for the save file — see `SaveFile.purchases`. */
  get purchases(): number {
    return this.purchaseCount;
  }

  /**
   * The part of the state worth writing to disk, as a **small literal that
   * points at the live sub-objects** rather than a copy of them.
   *
   * That is deliberate and it is the whole trick that keeps the five-second
   * autosave cheap: `JSON.stringify` walks `player`, `world`, `collection` and
   * `inventory` in place, so a save allocates one small object and one string
   * instead of cloning the object graph every tick. ARCHITECTURE-REVIEW keeps
   * an allocation-suspect list; this stays off it.
   *
   * The returned object must therefore be serialised immediately and never
   * stashed — it aliases live state.
   */
  savedGame(): SavedGame {
    const s = this.state;
    return {
      parkName: s.parkName,
      mode: s.mode,
      money: s.money,
      splashPoints: s.splashPoints,
      bestSplashPoints: s.bestSplashPoints,
      player: s.player,
      world: s.world,
      collection: s.collection,
      inventory: s.inventory,
      carriedUid: s.carriedUid,
      wornFlowerUid: s.wornFlowerUid,
      wornHatUid: s.wornHatUid,
      wornJetpackUid: s.wornJetpackUid,
    };
  }

  /**
   * Restores a save over a fresh initial state.
   *
   * Overlaying rather than replacing is what makes "adding a field is never
   * fatal" true: `state/save.ts` leaves anything it could not read *absent*,
   * and an absent field simply keeps the value `createInitialState` gave it.
   * Nothing here has to know a second set of defaults.
   *
   * Must run **before `new Game(...)`**, exactly like character creation:
   * `Player`'s constructor reads `player.hairStyle` the moment it builds the
   * kid, and a hair style change swaps meshes rather than a colour, so there
   * is no path that rebuilds a live character model.
   */
  hydrate(file: SaveFile): void {
    const next = createInitialState();
    const g = file.game;

    if (g.parkName !== undefined) next.parkName = g.parkName;
    if (g.mode !== undefined) next.mode = g.mode;
    if (g.money !== undefined) next.money = g.money;
    if (g.splashPoints !== undefined) next.splashPoints = g.splashPoints;
    if (g.bestSplashPoints !== undefined) next.bestSplashPoints = g.bestSplashPoints;

    const p = g.player;
    if (p) {
      if (p.name !== undefined) next.player.name = p.name;
      if (p.kind !== undefined) next.player.kind = p.kind;
      if (p.skinColour !== undefined) next.player.skinColour = p.skinColour;
      if (p.hairColour !== undefined) next.player.hairColour = p.hairColour;
      if (p.hairStyle !== undefined) next.player.hairStyle = p.hairStyle;
      if (p.outfitColour !== undefined) next.player.outfitColour = p.outfitColour;
      if (p.eyeColour !== undefined) next.player.eyeColour = p.eyeColour;
      if (p.backpackKind !== undefined) next.player.backpackKind = p.backpackKind;
      if (p.backpackColour !== undefined) next.player.backpackColour = p.backpackColour;
      if (p.maxHealth !== undefined) next.player.maxHealth = Math.max(1, p.maxHealth);
      if (p.health !== undefined) next.player.health = p.health;
      if (p.facePaint !== undefined) next.player.facePaint = p.facePaint;
    }

    const w = g.world;
    if (w) {
      if (w.timeOfDay !== undefined) next.world.timeOfDay = w.timeOfDay;
      if (w.dayCount !== undefined) next.world.dayCount = w.dayCount;
      if (w.lightsOn !== undefined) next.world.lightsOn = w.lightsOn;
    }

    if (g.collection) next.collection = g.collection;
    if (g.inventory) next.inventory = g.inventory;
    if (g.carriedUid !== undefined) next.carriedUid = g.carriedUid;
    if (g.wornFlowerUid !== undefined) next.wornFlowerUid = g.wornFlowerUid;
    if (g.wornHatUid !== undefined) next.wornHatUid = g.wornHatUid;
    if (g.wornJetpackUid !== undefined) next.wornJetpackUid = g.wornJetpackUid;

    // Derived rather than saved, so it can never contradict the mode.
    next.moneyIsFinite = next.mode === 'mayhem';
    if (next.mode === 'normal') next.player.health = next.player.maxHealth;
    else next.player.health = Math.min(Math.max(0, next.player.health), next.player.maxHealth);

    this.state = next;
    this.purchaseCount = Math.max(0, Math.floor(file.purchases));

    // Food used to be kept. A save written before that changed still has ice
    // creams and candy flosses sitting in the backpack, and leaving them there
    // would mean the rule only applied to children who started today — the one
    // player who matters most has a save going back weeks. They are eaten now:
    // the book keeps every one of them, the bag lets them go. Runs before the
    // `owns` checks below, so a treat that was in her hands is let go of too.
    if (next.inventory.some((item) => isEdible(item.kind))) {
      for (const item of next.inventory) {
        if (!isEdible(item.kind)) continue;
        const entry = next.collection[item.id];
        if (entry) entry.placement = 'eaten';
      }
      next.inventory = next.inventory.filter((item) => !isEdible(item.kind));
    }

    // A uid that names nothing owned is worse than nothing: `WornHat` and
    // `CarriedItem` would look it up every frame and quietly draw air. Same
    // slot rules as `setWornHat` / `setWornFlower`, applied once on the way in.
    const owns = (uid: string | null, kind?: InventoryKind): boolean =>
      uid !== null && next.inventory.some((item) => item.uid === uid && (!kind || item.kind === kind));
    if (!owns(next.carriedUid)) next.carriedUid = null;
    if (!owns(next.wornHatUid, 'hat')) next.wornHatUid = null;
    if (!owns(next.wornFlowerUid, 'flower')) next.wornFlowerUid = null;
    if (!owns(next.wornJetpackUid, 'jetpack')) next.wornJetpackUid = null;

    // The Cute-o-dex's `placement` is derived from what is owned, so a save
    // written mid-change can never leave the book disagreeing with the bag.
    for (const id of Object.keys(next.collection)) this.refreshPlacement(id);

    this.notify();
  }

  // ------------------------------------------------------------ internal

  /**
   * Re-derives a Cute-o-dex entry's placement from the copies actually owned.
   *
   * `CuteThing.placement` is one word about a whole kind, so it takes the most
   * interesting answer: in your hands beats being worn, which beats walking
   * behind you, which beats sitting in the bag.
   */
  private refreshPlacement(id: string): void {
    const entry = this.state.collection[id];
    if (!entry) return;
    const copies = this.state.inventory.filter((item) => item.id === id);
    // An eaten thing owns no copies to derive anything from, and "she has none
    // of these" is not the same fact as "she never had one" — deriving here
    // would file every ice cream she has ever finished under `backpack`.
    if (copies.length === 0 && entry.placement === 'eaten') return;
    const isWorn = (item: InventoryItem): boolean =>
      item.uid === this.state.wornHatUid ||
      item.uid === this.state.wornFlowerUid ||
      item.uid === this.state.wornJetpackUid;
    if (copies.some((item) => item.uid === this.state.carriedUid)) entry.placement = 'carried';
    else if (copies.some(isWorn)) entry.placement = 'worn';
    else if (copies.some((item) => item.paradeable && !item.stowed)) entry.placement = 'parade';
    else entry.placement = 'backpack';
  }

  private notify(): void {
    // Ahead of the coalescing guard on purpose: the autosave asks "has
    // anything changed?", and every change must count even when three of them
    // share one listener callback.
    this.changes += 1;
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
    moneyIsFinite: false,
    splashPoints: 0,
    bestSplashPoints: 0,
    player: {
      name: PLAYER_DEFAULT_NAME,
      kind: 'kid',
      skinColour: PALETTE.skin,
      hairColour: PALETTE.hair,
      hairStyle: 'bunches',
      outfitColour: PALETTE.outfit,
      eyeColour: PALETTE.iris,
      backpackKind: 'satchel',
      backpackColour: PALETTE.backpack,
      health: 5,
      maxHealth: 5,
      facePaint: null,
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
    wornHatUid: null,
    wornJetpackUid: null,
    paused: false,
    debugOverlay: false,
  };
}

/** The one and only store instance. Import this, don't construct your own. */
export const gameStore = new GameStore();
