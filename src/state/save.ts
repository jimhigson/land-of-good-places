/**
 * The save file: what is written to `localStorage`, and how it is read back.
 *
 * One key, one object. Before this existed the game had four separate flags in
 * four separate places (`ui/characterCreationFlag.ts`,
 * `world/entrance/arrivalFlag.ts`, `ui/DexPrize.ts`, `ui/WhatsNew.ts`), each
 * with its own key and its own private opinion about what "remembered" means.
 * They are all folded in here, as {@link SavedFlags}.
 *
 * ## The two rules this file exists to enforce
 *
 * **1. Adding a field must be trivial, and must never be fatal.** Reading is
 * tolerant *per field*, never all-or-nothing: every field on {@link SavedGame}
 * is optional, and a field that is missing, the wrong type, or no longer a
 * legal value is simply left out of the result. `gameStore.hydrate` then
 * overlays what did survive onto a fresh initial state, so an absent field
 * keeps its default. That means a new field needs **no version bump at all** —
 * yesterday's save just doesn't have it — and a *removed* value (the day a
 * hair style is renamed, say) degrades to the default instead of handing the
 * art layer a word it has never heard of.
 *
 * The string unions are validated against the `as const` lists in `./types`,
 * which the unions themselves are derived from, so the validator can never
 * drift from the types it is validating.
 *
 * **2. When it cannot be read, offer a fresh start — never crash, never
 * half-load.** {@link loadSave} returns `null` for anything it cannot make
 * sense of: unparseable JSON, a missing or non-numeric `v`, a `v` newer than
 * this build understands, a `v` older than this build can migrate, or a
 * migration step that throws. `null` is not an error path — it is the ordinary
 * "brand new player" answer, and the boot screen simply offers the character
 * creator. The first autosave then overwrites the unreadable blob.
 *
 * `localStorage` itself is wrapped throughout: Safari private mode throws on
 * *access*, not just on write, which the flags this file replaces already
 * handled and which is treated here the same way — as "no save".
 */

import {
  BACKPACK_KINDS,
  CHARACTER_KINDS,
  CUTE_CATEGORIES,
  CUTE_PLACEMENTS,
  FLOWER_COLOURS,
  GAME_MODES,
  HAIR_STYLES,
  INVENTORY_KINDS,
  SHOE_KINDS,
  type BackpackKind,
  type CharacterKind,
  type CuteThing,
  type FacePaintId,
  type GameMode,
  type GameTime,
  type HairStyle,
  type InventoryItem,
  type ShoeKind,
} from './types';

/** The one and only key the game writes. */
export const SAVE_KEY = 'lgp:save';

/**
 * The schema version.
 *
 * Bumped **only** for a change tolerance cannot absorb — a field whose meaning
 * changes, or a restructure. Adding a field is not one of those; see the note
 * at the top of this file.
 */
export const SAVE_VERSION = 1;

/**
 * Where the player was standing — a **space id plus a position local to that
 * space**, never a raw world coordinate.
 *
 * ARCHITECTURE-DECISIONS Decision 3 splits the castle into five spaces at
 * origins 300 m apart. A world `x` of 612 means "beside the lift" today and
 * "empty air a long way from anywhere" the week the split lands. A space id
 * plus a local offset survives that: when `castle` stops being a space that
 * exists, the id resolves to nothing, the player spawns at the default place,
 * and **every other field in the save still loads**. That graceful shrug is
 * the whole reason the id is a string rather than an index.
 *
 * The id ↔ origin table lives in `world/spaces.ts`, which is where the world
 * coordinates it needs already live; this file only carries the value.
 */
export interface SavedPlace {
  readonly space: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Yaw, in radians — which way she was looking. */
  readonly facing: number;
}

/** The one-time things that have already happened on this device. */
export interface SavedFlags {
  /** Was `lgp:hasCreatedCharacter`. */
  readonly createdCharacter?: boolean;
  /** Was `lgp:hasArrivedByBus` — the cat-bus arrival sequence. */
  readonly arrivedByBus?: boolean;
  /** Was `lgp:dexPrizeSeen` — the Cute-o-dex 100% celebration. */
  readonly dexPrizeSeen?: boolean;
  /** Was `lgp:lastSeenWhatsNewId` — newest what's-new entry already read. */
  readonly whatsNewSeenId?: number;
}

/**
 * The slice of `GameState` that is worth remembering.
 *
 * Every field is optional because reading is tolerant (see the file comment) —
 * not because the game ever writes a partial one. Deliberately absent:
 * `paused` and `debugOverlay`, which are about this moment rather than this
 * park (nobody should ever load back into a paused game), and `moneyIsFinite`,
 * which is derived from `mode` and is recomputed on hydration.
 */
export interface SavedGame {
  readonly parkName?: string;
  readonly mode?: GameMode;
  readonly money?: number;
  readonly splashPoints?: number;
  readonly bestSplashPoints?: number;
  readonly player?: SavedPlayer;
  readonly world?: SavedWorld;
  /** The Cute-o-dex, keyed by catalogue id. */
  readonly collection?: Record<string, CuteThing>;
  /**
   * Everything owned, oldest first.
   *
   * This is also the parade and the backpack: membership is derived from
   * `paradeable && !stowed` rather than being a second list, so saving the
   * inventory saves all three (see `entities/parade/Parade.ts`).
   */
  readonly inventory?: InventoryItem[];
  readonly carriedUid?: string | null;
  readonly wornFlowerUid?: string | null;
  readonly wornHatUid?: string | null;
  readonly wornJetpackUid?: string | null;
}

/** The character: her name, and everything the creator let her choose. */
export interface SavedPlayer {
  readonly name?: string;
  readonly kind?: CharacterKind;
  readonly skinColour?: number;
  readonly hairColour?: number;
  readonly hairStyle?: HairStyle;
  readonly outfitColour?: number;
  readonly eyeColour?: number;
  readonly backpackKind?: BackpackKind;
  readonly backpackColour?: number;
  readonly shoeKind?: ShoeKind;
  readonly shoeColour?: number;
  readonly health?: number;
  readonly maxHealth?: number;
  readonly facePaint?: FacePaintId;
}

/** The park clock. */
export interface SavedWorld {
  readonly timeOfDay?: number;
  readonly dayCount?: number;
  readonly lightsOn?: boolean;
}

export interface SaveFile {
  /** Schema version. See {@link SAVE_VERSION}. */
  readonly v: number;
  /** `Date.now()` at write. Informational — "last played". */
  readonly at: number;
  /**
   * The store's private purchase counter, which is what makes an inventory
   * `uid` unique.
   *
   * Saved because it has to be: without it a restored game restarts the
   * counter at zero and the very next purchase mints `toy.ripika#1` a second
   * time, colliding with a uid a restored item is already holding — and
   * `carriedUid` / `wornHatUid` point at uids.
   */
  readonly purchases: number;
  readonly game: SavedGame;
  /** Absent when the save predates position, or when it did not survive checks. */
  readonly place?: SavedPlace;
  readonly flags: SavedFlags;
}

/**
 * Steps from one schema version to the next, keyed by the version they read.
 *
 * Empty at v1, and that is the point: the table exists from day one so that
 * the *first* breaking change is an entry here rather than an argument about
 * whether saves are worth migrating. A step takes the raw parsed object at
 * version `n` and returns it at version `n + 1`; it may throw, and throwing
 * means the same thing as a missing step — unreadable, offer a fresh start.
 */
const MIGRATIONS: Readonly<Record<number, (old: Record<string, unknown>) => Record<string, unknown>>> =
  {};

// --------------------------------------------------------------- writing

/**
 * Writes the save. Returns false if storage refused it (full, disabled, or
 * private mode), which nothing needs to act on — the next tick tries again.
 */
export function writeSave(file: SaveFile): boolean {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(file));
    return true;
  } catch {
    // A full quota or a disabled store is not something the park can fix, and
    // it is certainly not worth interrupting a six-year-old about.
    return false;
  }
}

/** Throws the save away — what "start again" does before character creation. */
export function clearSave(): void {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Same as above. A save we cannot delete is a save the fresh game will
    // overwrite within five seconds anyway.
  }
}

// ------------------------------------------------------ reopen-creator flag

/**
 * A same-tab flag: "the next boot should reopen the character creator over
 * the existing save, instead of the usual welcome-back prompt."
 *
 * `sessionStorage`, not the save file — this is about the *next page load
 * only*. `Hud`'s "Look" pill (`Game.reopenCharacterCreator`) reloads the page
 * to get there, because the character creator has to run *before* a `Game`
 * exists (see `main.ts`'s `boot()` doc comment — there is no "rebuild the
 * live player model" path, so reopening the creator mid-session means going
 * back through boot rather than mounting it over the running game). If the
 * reload never happens — the tab is closed instead — there is nothing to
 * clean up: `sessionStorage` dies with the tab.
 */
const REOPEN_CREATOR_KEY = 'lgp:reopenCreator';

/** Set just before the reload that `Game.reopenCharacterCreator` triggers. */
export function markReopenCharacterCreator(): void {
  try {
    window.sessionStorage.setItem(REOPEN_CREATOR_KEY, '1');
  } catch {
    // Same tolerance as `writeSave` — private mode, a full quota. Worst case
    // the next boot falls back to the ordinary continue/restart prompt.
  }
}

/**
 * Reads and clears the flag in one step — it must only ever fire once, so a
 * later reload (say, the update gate) does not reopen the creator a second
 * time.
 */
export function consumeReopenCharacterCreator(): boolean {
  try {
    const value = window.sessionStorage.getItem(REOPEN_CREATOR_KEY);
    if (value !== null) window.sessionStorage.removeItem(REOPEN_CREATOR_KEY);
    return value !== null;
  } catch {
    return false;
  }
}

// --------------------------------------------------------------- reading

/**
 * Reads the save, or `null` for "there isn't a usable one".
 *
 * Never throws. See the file comment for what `null` covers and why it is the
 * ordinary answer rather than an error.
 */
export function loadSave(): SaveFile | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const migrated = migrate(parsed);
  if (migrated === null) return null;
  return readSaveFile(migrated);
}

/**
 * Brings a parsed blob up to {@link SAVE_VERSION}, or returns `null` if it
 * cannot be brought.
 *
 * A version from the *future* is refused rather than guessed at: it happens
 * when a browser has a newer deploy's save but is serving an older cached
 * bundle, and reading it optimistically is exactly how a half-loaded game
 * happens.
 */
function migrate(parsed: unknown): Record<string, unknown> | null {
  if (!isRecord(parsed)) return null;
  const version = readNumber(parsed['v']);
  if (version === undefined || !Number.isInteger(version)) return null;
  if (version > SAVE_VERSION) return null;

  let current = parsed;
  for (let from = version; from < SAVE_VERSION; from += 1) {
    const step = MIGRATIONS[from];
    if (!step) return null;
    try {
      const next = step(current);
      if (!isRecord(next)) return null;
      current = next;
    } catch {
      // A migration that throws is a migration that does not exist, as far as
      // the family is concerned: they get offered a fresh start either way.
      return null;
    }
  }
  return current;
}

function readSaveFile(raw: Record<string, unknown>): SaveFile {
  const file: Mutable<SaveFile> = {
    v: SAVE_VERSION,
    at: readNumber(raw['at']) ?? 0,
    purchases: 0,
    game: readGame(raw['game']),
    flags: readFlags(raw['flags']),
  };
  const place = readPlace(raw['place']);
  if (place !== undefined) file.place = place;

  // Belt and braces on the uid counter: take the larger of what was saved and
  // what the restored inventory actually implies, so even a hand-edited or
  // truncated save cannot make the store mint a uid something already holds.
  const saved = readNumber(raw['purchases']) ?? 0;
  file.purchases = Math.max(saved, highestPurchaseNumber(file.game.inventory));
  return file;
}

/** The `n` in the highest `${id}#${n}` the inventory holds. */
function highestPurchaseNumber(inventory: InventoryItem[] | undefined): number {
  if (!inventory) return 0;
  let highest = 0;
  for (const item of inventory) {
    const hash = item.uid.lastIndexOf('#');
    if (hash < 0) continue;
    const n = Number.parseInt(item.uid.slice(hash + 1), 10);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return highest;
}

function readGame(value: unknown): SavedGame {
  const game: Mutable<SavedGame> = {};
  if (!isRecord(value)) return game;

  put(game, 'parkName', readString(value['parkName']));
  put(game, 'mode', readMember(value['mode'], GAME_MODES));
  put(game, 'money', readNumber(value['money']));
  put(game, 'splashPoints', readNumber(value['splashPoints']));
  put(game, 'bestSplashPoints', readNumber(value['bestSplashPoints']));
  put(game, 'player', readPlayer(value['player']));
  put(game, 'world', readWorld(value['world']));
  put(game, 'collection', readCollection(value['collection']));
  put(game, 'inventory', readInventory(value['inventory']));
  put(game, 'carriedUid', readUid(value['carriedUid']));
  put(game, 'wornFlowerUid', readUid(value['wornFlowerUid']));
  put(game, 'wornHatUid', readUid(value['wornHatUid']));
  put(game, 'wornJetpackUid', readUid(value['wornJetpackUid']));
  return game;
}

function readPlayer(value: unknown): SavedPlayer | undefined {
  if (!isRecord(value)) return undefined;
  const player: Mutable<SavedPlayer> = {};
  put(player, 'name', readString(value['name']));
  put(player, 'kind', readMember(value['kind'], CHARACTER_KINDS));
  put(player, 'skinColour', readColour(value['skinColour']));
  put(player, 'hairColour', readColour(value['hairColour']));
  put(player, 'hairStyle', readMember(value['hairStyle'], HAIR_STYLES));
  put(player, 'outfitColour', readColour(value['outfitColour']));
  put(player, 'eyeColour', readColour(value['eyeColour']));
  put(player, 'backpackKind', readMember(value['backpackKind'], BACKPACK_KINDS));
  put(player, 'backpackColour', readColour(value['backpackColour']));
  put(player, 'shoeKind', readMember(value['shoeKind'], SHOE_KINDS));
  put(player, 'shoeColour', readColour(value['shoeColour']));
  put(player, 'health', readNumber(value['health']));
  put(player, 'maxHealth', readNumber(value['maxHealth']));
  // `facePaint` is a design id or `null` for a clean face, and `null` is a
  // real answer rather than a missing one — so it is read like a uid.
  put(player, 'facePaint', readUid(value['facePaint']));
  return player;
}

function readWorld(value: unknown): SavedWorld | undefined {
  if (!isRecord(value)) return undefined;
  const world: Mutable<SavedWorld> = {};
  const timeOfDay = readNumber(value['timeOfDay']);
  // 0 and 1 are both midnight; anything outside is not a time of day at all.
  if (timeOfDay !== undefined && timeOfDay >= 0 && timeOfDay <= 1) world.timeOfDay = timeOfDay;
  const dayCount = readNumber(value['dayCount']);
  if (dayCount !== undefined && dayCount >= 0) world.dayCount = Math.floor(dayCount);
  put(world, 'lightsOn', readBoolean(value['lightsOn']));
  return world;
}

/**
 * The Cute-o-dex. A malformed entry is dropped rather than failing the book:
 * losing one line of a collection is a much smaller loss than losing the park.
 */
function readCollection(value: unknown): Record<string, CuteThing> | undefined {
  if (!isRecord(value)) return undefined;
  const collection: Record<string, CuteThing> = {};
  for (const [key, entry] of Object.entries(value)) {
    const thing = readCuteThing(entry, key);
    if (thing) collection[key] = thing;
  }
  return collection;
}

function readCuteThing(value: unknown, key: string): CuteThing | null {
  if (!isRecord(value)) return null;
  const category = readMember(value['category'], CUTE_CATEGORIES);
  const count = readNumber(value['count']);
  if (category === undefined || count === undefined) return null;
  return {
    id: readString(value['id']) ?? key,
    name: readString(value['name']) ?? key,
    category,
    count: Math.max(0, Math.floor(count)),
    placement: readMember(value['placement'], CUTE_PLACEMENTS) ?? 'backpack',
    discovered: readBoolean(value['discovered']) ?? true,
  };
}

/** Everything owned. A malformed entry is dropped, for the same reason. */
function readInventory(value: unknown): InventoryItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: InventoryItem[] = [];
  for (const entry of value) {
    const item = readInventoryItem(entry);
    if (item) items.push(item);
  }
  return items;
}

function readInventoryItem(value: unknown): InventoryItem | null {
  if (!isRecord(value)) return null;
  const uid = readString(value['uid']);
  const id = readString(value['id']);
  const kind = readMember(value['kind'], INVENTORY_KINDS);
  const category = readMember(value['category'], CUTE_CATEGORIES);
  // Without a uid nothing can point at it, and without a kind the game does
  // not know whether it is worn, eaten or walked. Those two are the floor.
  if (uid === undefined || id === undefined || kind === undefined || category === undefined) {
    return null;
  }

  const item: Mutable<InventoryItem> = {
    uid,
    id,
    kind,
    displayName: readString(value['displayName']) ?? id,
    icon: readString(value['icon']) ?? '✨',
    category,
    shopId: readString(value['shopId']) ?? '',
    acquiredAt: readGameTime(value['acquiredAt']),
    carryable: readBoolean(value['carryable']) ?? false,
    paradeable: readBoolean(value['paradeable']) ?? false,
    stowed: readBoolean(value['stowed']) ?? true,
  };
  // Omitted rather than set to undefined — `exactOptionalPropertyTypes`, and
  // only a picked flower has one at all.
  const flowerColour = readMember(value['flowerColour'], FLOWER_COLOURS);
  if (flowerColour !== undefined) item.flowerColour = flowerColour;
  return item;
}

function readGameTime(value: unknown): GameTime {
  if (!isRecord(value)) return { day: 0, timeOfDay: 0 };
  return {
    day: readNumber(value['day']) ?? 0,
    timeOfDay: readNumber(value['timeOfDay']) ?? 0,
  };
}

/**
 * Where she was standing — all or nothing.
 *
 * Unlike everything else here this one is *not* read field by field: half a
 * position is not a degraded position, it is a wrong one, and dropping the
 * whole thing just means spawning at the usual place on the plaza.
 */
function readPlace(value: unknown): SavedPlace | undefined {
  if (!isRecord(value)) return undefined;
  const space = readString(value['space']);
  const x = readNumber(value['x']);
  const y = readNumber(value['y']);
  const z = readNumber(value['z']);
  const facing = readNumber(value['facing']);
  if (space === undefined || x === undefined || y === undefined || z === undefined) {
    return undefined;
  }
  return { space, x, y, z, facing: facing ?? 0 };
}

function readFlags(value: unknown): SavedFlags {
  const flags: Mutable<SavedFlags> = {};
  if (!isRecord(value)) return flags;
  put(flags, 'createdCharacter', readBoolean(value['createdCharacter']));
  put(flags, 'arrivedByBus', readBoolean(value['arrivedByBus']));
  put(flags, 'dexPrizeSeen', readBoolean(value['dexPrizeSeen']));
  put(flags, 'whatsNewSeenId', readNumber(value['whatsNewSeenId']));
  return flags;
}

// ------------------------------------------------------------- primitives

/** Drops `readonly` while a value is being assembled field by field. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Assigns only when there is something to assign.
 *
 * This is the whole of the tolerance rule in one function: a reader that
 * returned `undefined` leaves the key **absent**, which is what
 * `exactOptionalPropertyTypes` wants and what lets hydration fall back to the
 * initial-state default without a second list of defaults living here.
 */
function put<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value as T[K];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A uid-shaped field, where `null` ("nothing worn") is a real answer. */
function readUid(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  // NaN and Infinity are not numbers the park can do anything with, and JSON
  // turns them into `null` on the way out anyway.
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A three.js hex colour: an integer in `0x000000`–`0xffffff`. */
function readColour(value: unknown): number | undefined {
  const n = readNumber(value);
  if (n === undefined || !Number.isInteger(n) || n < 0 || n > 0xffffff) return undefined;
  return n;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * A string that is still one of the legal values.
 *
 * `allowed` is one of the `as const` lists in `./types` that the union itself
 * is derived from — which is what stops a validator and a type union from ever
 * disagreeing about what a hair style is.
 */
function readMember<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}
