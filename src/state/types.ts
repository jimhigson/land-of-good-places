/**
 * The shape of everything the game remembers.
 *
 * This is deliberately a plain data description with no behaviour: systems read
 * it, a handful of actions write it, and the UI subscribes to it. Adding a new
 * feature usually means adding a field here plus an action in `store.ts`.
 */

/**
 * ## Why the string unions below are written as `as const` arrays
 *
 * Every one of them is also a *runtime* question, because a save file read
 * back off disk is untyped: `state/save.ts` has to ask "is this string still a
 * hair style?" before handing it to the art layer. Writing the union as a bare
 * `type` would mean keeping a second, hand-written list of the same words in
 * the validator — and the day somebody adds a ninth hair style and forgets the
 * second list, every save with that hair in it quietly loads as `bunches`.
 *
 * Deriving the type *from* the list makes that drift impossible: there is one
 * list, the type follows it, and adding a value is a one-line change that the
 * validator picks up for free.
 */

/** Normal = you cannot lose. Mayhem = grown-up mode with health and real money. */
export const GAME_MODES = ['normal', 'mayhem'] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** Which body the player is wearing. Only `kid` exists so far (step 7 adds animals). */
export const CHARACTER_KINDS = ['kid', 'bunny', 'kitten', 'mouse'] as const;
export type CharacterKind = (typeof CHARACTER_KINDS)[number];

/**
 * Where a collected cute thing currently lives.
 *
 * `eaten` is the odd one out: it is not a place at all, it is the absence of
 * one. The family's rule — *"keeping ice cream in a backpack doesn't really
 * make sense"* — means an edible thing is enjoyed and then gone, so the book
 * remembers that it happened and the bag stays empty. See `isEdible` in
 * `state/store.ts` for who decides, and `GameStore.refreshPlacement` for why a
 * placement with nothing left to derive it from is left alone.
 */
export const CUTE_PLACEMENTS = ['parade', 'backpack', 'bedroom', 'carried', 'worn', 'eaten'] as const;
export type CutePlacement = (typeof CUTE_PLACEMENTS)[number];

/**
 * Hair style chosen in the character creator.
 *
 * Kept as a bare string union rather than importing `KidOptions['hairStyle']`
 * from `art/models/kid.ts` — the same reason `PlayerState.hairColour` is a bare
 * hex number rather than a `Color`: `state/` never depends on `art/`. The two
 * unions are kept in sync by hand; TypeScript's structural typing means a
 * `HairStyle` is already assignable wherever `KidOptions['hairStyle']` is
 * expected, so nothing has to convert between them.
 *
 * The canonical list lives in `art/models/hair.ts` (which also knows what each
 * one is made of, and which of them a background child may wear). Keep these
 * two in step: they are checked against each other every build, because
 * `ui/CharacterCreation.ts` types its picker from *this* union and feeds the
 * result straight into `KidOptions.hairStyle`, so a name that exists in only
 * one of the two files fails to compile.
 */
export const HAIR_STYLES = [
  'bunches',
  'bob',
  'short',
  'long',
  'ponytail',
  'longPonytail',
  'bowl',
  'spiky',
  'messy',
] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

/**
 * Backpack shape chosen in the character creator.
 *
 * Written out here for exactly the reasons {@link HairStyle} above is: `state/`
 * never imports `art/`, a save file read back off disk is untyped and needs a
 * runtime list to validate against, and the two unions are structurally
 * assignable so nothing has to convert between them.
 *
 * The canonical list lives in `art/models/backpacks.ts`, which also knows what
 * each shape is made of and which of them a background child may wear. Keep
 * these two in step: `ui/CharacterCreation.ts` types its picker from *this*
 * union and feeds the result straight into `KidOptions.backpackKind`, so a name
 * that exists in only one of the two files fails to compile.
 */
export const BACKPACK_KINDS = ['satchel', 'bubble', 'heart', 'ripikaHead', 'trillaHead'] as const;
export type BackpackKind = (typeof BACKPACK_KINDS)[number];

/** Which shop / activity a cute thing came from — drives Cute-o-dex grouping. */
export const CUTE_CATEGORIES = [
  'toy',
  'balloon',
  'candyfloss',
  'icecream',
  'hat',
  'sticker',
  'pet',
  'egg',
  'flower',
  'secret',
] as const;
export type CuteCategory = (typeof CUTE_CATEGORIES)[number];

/**
 * A picked flower's colour variant — free, found in the meadow, never sold.
 * Each is its own little hair accessory (see `entities/WornFlower.ts`).
 *
 * The list is also the fixed display order the Cute-o-dex and the HUD use; it
 * is re-exported from `state/store.ts` (with its colour and icon tables) as
 * `FLOWER_COLOURS`, which is the name the rest of the game imports.
 */
export const FLOWER_COLOURS = ['yellow', 'red', 'blue', 'violet', 'pink', 'white'] as const;
export type FlowerColour = (typeof FLOWER_COLOURS)[number];

export interface CuteThing {
  /** Stable id, e.g. `toy.ripika`. Used as the Cute-o-dex key. */
  readonly id: string;
  readonly name: string;
  readonly category: CuteCategory;
  /** How many the player owns. */
  count: number;
  placement: CutePlacement;
  /** Seen at least once — a Cute-o-dex silhouette becomes a full entry. */
  discovered: boolean;
}

/**
 * What sort of thing an inventory entry is.
 *
 * Coarser than {@link CuteCategory} on purpose: the Cute-o-dex groups by which
 * shop something came from, while the *kind* decides how the game treats it —
 * a `treat` is eaten, a `hat` is worn, a `pet` walks in the parade.
 */
export const INVENTORY_KINDS = [
  'toy',
  'balloon',
  'treat',
  'hat',
  'sticker',
  'pet',
  'egg',
  'flower',
  /**
   * Worn on the back, and the only kind that changes how the player *moves* —
   * see `entities/WornJetpack.ts` and the flight in `entities/Player.ts`. Its
   * own kind rather than a `hat` on a different anchor, because
   * {@link wearableSlot} is what decides which `worn*Uid` a thing goes in, and
   * a head and a back are two slots that must both be usable at once.
   */
  'jetpack',
] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

/** A moment on the park clock. `day` counts from 0, `timeOfDay` is 0..1. */
export interface GameTime {
  readonly day: number;
  readonly timeOfDay: number;
}

/**
 * One thing the player owns.
 *
 * Entries are *individual purchases*, not stack counts: buy two pink candy
 * flosses and there are two entries. That is what lets the parade (build step 5)
 * put two of them behind you, and what lets `acquiredAt` mean something. The
 * Cute-o-dex still wants counts, so `gameStore.buy` also files the purchase in
 * `collection`, which is keyed by catalogue id.
 */
export interface InventoryItem {
  /** Unique per purchase — `${id}#${n}`. This is what `carriedUid` points at. */
  readonly uid: string;
  /** Catalogue id, e.g. `toy.ripika`. Shared by every copy the player owns. */
  readonly id: string;
  readonly kind: InventoryKind;
  readonly displayName: string;
  /** One emoji, for the HUD list. The 3D model comes from the shop catalogue. */
  readonly icon: string;
  readonly category: CuteCategory;
  /** Which shop unit sold it. */
  readonly shopId: string;
  readonly acquiredAt: GameTime;
  /** Can be held in the hands, and later can join the parade. */
  readonly carryable: boolean;
  /**
   * Can walk (or float) behind you in the parade.
   *
   * Toys, pets and balloons can; candy floss, ice creams, hats, stickers and
   * eggs cannot — those live in the backpack and peek out of the top instead.
   * Decided once, at purchase, from {@link InventoryKind}.
   */
  readonly paradeable: boolean;
  /**
   * True when the player has tucked this one away in the backpack.
   *
   * The one mutable field on an inventory entry, because "is my bunny out?" is
   * a thing a child changes over and over — by tapping the bunny itself, or from
   * the Cute-o-dex. Non-paradeable things are always stowed.
   */
  stowed: boolean;
  /** Set only on `kind: 'flower'` entries — which colour it was picked as. */
  readonly flowerColour?: FlowerColour;
}

/**
 * A face-painting stall design, or `null` for a clean face.
 *
 * Additive field (face painting stall feature, see `world/FacePaintStall.ts`).
 * The design ids themselves live in `art/style/faces.ts`
 * (`FacePaintDesign`) — kept as a plain `string | null` here so `state/`
 * never has to import the art layer, the same reason `PlayerState.hairColour`
 * is a bare hex number rather than a `Color`.
 */
export type FacePaintId = string | null;

export interface PlayerState {
  name: string;
  kind: CharacterKind;
  /**
   * Chosen in the character creator. A bare hex number, like `hairColour` —
   * see `HairStyle`'s doc comment for why `state/` never imports `art/`.
   */
  skinColour: number;
  /** Chosen in the character creator (step 7). Hex numbers, three.js friendly. */
  hairColour: number;
  /** Chosen in the character creator — see `HairStyle` for why it's a bare union. */
  hairStyle: HairStyle;
  outfitColour: number;
  /** Iris colour, chosen in the character creator. Defaults to the game's violet. */
  eyeColour: number;
  /** Which bag she wears — see `BackpackKind`. Chosen in the character creator. */
  backpackKind: BackpackKind;
  /** What colour that bag is painted. A bare hex, like every other colour here. */
  backpackColour: number;
  /** Only meaningful in mayhem mode; in normal mode health never drops. */
  health: number;
  maxHealth: number;
  /** The design currently painted on, or `null` for a clean face. Free, swappable. */
  facePaint: FacePaintId;
}

export interface WorldState {
  /** Normalised time of day: 0 and 1 are midnight, 0.5 is noon. */
  timeOfDay: number;
  /** How many full days have elapsed since the park opened. */
  dayCount: number;
  /** True once the fairy lights have switched on. */
  lightsOn: boolean;
}

export interface GameState {
  /** Renameable in the title screen; "RiPika's Park" is the suggested alternative. */
  parkName: string;
  mode: GameMode;
  /** Infinite in normal mode — see `spend()` in the store. */
  money: number;
  /**
   * True once money can actually run out (mayhem mode).
   *
   * Kept as its own field, derived from `mode`, so UI that only cares "is this
   * number worth showing" — the HUD money pill — doesn't have to know mode
   * names or rules. Set by `setMode`.
   */
  moneyIsFinite: boolean;
  splashPoints: number;
  bestSplashPoints: number;
  player: PlayerState;
  world: WorldState;
  /** Cute-o-dex contents, keyed by `CuteThing.id`. */
  collection: Record<string, CuteThing>;
  /** Everything bought, oldest first. One entry per purchase. */
  inventory: InventoryItem[];
  /** `uid` of the item held in the hands, or null for empty-handed. */
  carriedUid: string | null;
  /** `uid` of the flower worn in the hair, or null for none — see `WornFlower`. */
  wornFlowerUid: string | null;
  /**
   * `uid` of the hat worn on the head, or null for bare-headed — see
   * `entities/WornHat.ts`. Set by the character creator at the start, and
   * thereafter by tapping a hat in the backpack drawer
   * (`gameStore.setWornHat`), which is how a hat bought mid-game gets onto the
   * player.
   */
  wornHatUid: string | null;
  /**
   * `uid` of the jet pack strapped to the player's back, or null for none —
   * see `entities/WornJetpack.ts`.
   *
   * `wornHatUid`'s twin down to the shape of it, and its own field for the same
   * reason there are two of those: a head and a back are separate slots, and
   * one field per slot is what stops "am I wearing this?" from needing a search
   * through the inventory. It is also the gate on the HUD's fly button — no jet
   * pack on, no button (`ui/ScreenControls.ts`, `entities/Player.ts`).
   */
  wornJetpackUid: string | null;
  /** Set while a menu, shop or cutscene owns the input. */
  paused: boolean;
  /** Developer overlay visibility. */
  debugOverlay: boolean;
}
