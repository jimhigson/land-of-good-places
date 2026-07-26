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
export type CutePlacement = 'parade' | 'backpack' | 'bedroom' | 'carried';

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
  | 'secret';

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

export interface PlayerState {
  name: string;
  kind: CharacterKind;
  /** Chosen in the character creator (step 7). Hex numbers, three.js friendly. */
  hairColour: number;
  outfitColour: number;
  /** Only meaningful in mayhem mode; in normal mode health never drops. */
  health: number;
  maxHealth: number;
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
  splashPoints: number;
  bestSplashPoints: number;
  player: PlayerState;
  world: WorldState;
  /** Cute-o-dex contents, keyed by `CuteThing.id`. */
  collection: Record<string, CuteThing>;
  /** Set while a menu, shop or cutscene owns the input. */
  paused: boolean;
  /** Developer overlay visibility. */
  debugOverlay: boolean;
}
