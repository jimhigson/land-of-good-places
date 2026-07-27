/**
 * The shape of everything the game remembers.
 *
 * This is deliberately a plain data description with no behaviour: systems read
 * it, a handful of actions write it, and the UI subscribes to it. Adding a new
 * feature usually means adding a field here plus an action in `store.ts`.
 */

/** Normal = you cannot lose. Mayhem = grown-up mode with health and real money. */
export type GameMode = 'normal' | 'mayhem';

/** Which body the player is wearing. Only `kid` exists so far (step 7 adds animals). */
export type CharacterKind = 'kid' | 'bunny' | 'kitten' | 'mouse';

/** Where a collected cute thing currently lives. */
export type CutePlacement = 'parade' | 'backpack' | 'bedroom' | 'carried' | 'worn';

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
export type HairStyle =
  | 'bunches'
  | 'bob'
  | 'short'
  | 'long'
  | 'ponytail'
  | 'longPonytail'
  | 'bowl'
  | 'spiky'
  | 'messy';

/** Which shop / activity a cute thing came from — drives Cute-o-dex grouping. */
export type CuteCategory =
  | 'toy'
  | 'balloon'
  | 'candyfloss'
  | 'icecream'
  | 'hat'
  | 'sticker'
  | 'pet'
  | 'egg'
  | 'flower'
  | 'secret';

/**
 * A picked flower's colour variant — free, found in the meadow, never sold.
 * Each is its own little hair accessory (see `entities/WornFlower.ts`).
 */
export type FlowerColour = 'yellow' | 'red' | 'blue' | 'violet' | 'pink' | 'white';

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
export type InventoryKind = 'toy' | 'balloon' | 'treat' | 'hat' | 'sticker' | 'pet' | 'egg' | 'flower';

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
   * `entities/WornHat.ts`. Set once by the character creator today; the hat
   * shop has no "wear this" button yet, so a hat bought mid-game still only
   * goes into the player's hands, same as before this field existed.
   */
  wornHatUid: string | null;
  /** Set while a menu, shop or cutscene owns the input. */
  paused: boolean;
  /** Developer overlay visibility. */
  debugOverlay: boolean;
}
