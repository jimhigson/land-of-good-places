import { hexToCss, PALETTE } from '../core/palette';
import { ART } from '../art/style/artPalette';
import { PLAYER_DEFAULT_NAME } from '../core/constants';
import { KID_EYE_COLOURS, KID_SKIN_TONES } from '../art/models/kid';
import { itemsForShop, shopItem, type ShopItem } from '../world/building/shops/catalogue';
import { gameStore } from '../state';
import type { BackpackKind, CharacterCreationChoice, GlassesKind, HairStyle, PlayerState, ShoeKind } from '../state';
import { saveFlags } from '../state/flags';
import { CharacterPreview, type PreviewFocus } from './characterCreationPreview';
import { ColourWheelPicker } from './ColourWheelPicker';

/**
 * The character creator: name, skin tone, hair colour and style, eye colour,
 * clothes colour, a starting hat and a starting pet — the front door of the
 * game, per GAME_DESIGN.md's "The player" section and design-feedback item 27.
 *
 * Runs once, before `Game` exists at all — see `main.ts`'s `boot()`, which
 * constructs this instead of `Game` on a brand-new browser, and only builds
 * `Game` afterwards, once `gameStore.completeCharacterCreation()` has already
 * written the choice. That ordering (rather than mounting this as a
 * `Game`-owned overlay the way `WhatsNew` does) is what lets a hair *style*
 * choice reach `Player` for free: `Player`'s constructor already reads
 * `hairColour`/`hairStyle`/`outfitColour` off the store when it builds the
 * kid, so nothing here has to know how to rebuild a live player model.
 *
 * A plain, uncontrolled `<form>`: every control is a real `<button>` or
 * `<input>`, so Tab/Enter/Space "just work" without any bespoke key handling
 * — there is no game `InputSystem` running yet to fight over the keyboard
 * with, unlike `ShopPanel`/`FacePaintPanel`.
 *
 * **Tabbed**, one customisation category per tab (see {@link TAB_META}) — the
 * name field is the one exception, fixed above the strip. Every tab is one
 * (or two, for hair and the backpack) of the sections this screen already
 * had; tabbing them did not change what a section builds or how a pick is
 * applied, only which of them are attached to the DOM at once and which one
 * the live preview's camera currently rests on (`characterCreationPreview.
 * ts`'s `CharacterPreview.setResting`) — see that method's doc comment for
 * how this generalises the PREVIEW RULE's existing "camera follows what
 * changed" behaviour from *the last control tapped* to *the tab currently
 * open*.
 */
export interface CharacterCreationHandlers {
  onComplete(choice: CharacterCreationChoice): void;
}

interface Swatch {
  readonly colour: number;
  readonly label: string;
  /**
   * The arms' own colour, for a two-tone shirt — omitted by every swatch that
   * is not one (which today is every swatch but the outfit tab's own
   * `'Red & White'`). `buildSwatchSection` falls back to {@link colour} when
   * this is absent, so an ordinary single-colour swatch's arms always match
   * its body, exactly as they did before this field existed.
   */
  readonly armsColour?: number;
}

/** One button in a glyph-and-label picker grid — a hair style, a bag shape. */
interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly glyph: string;
}

/**
 * A `buildCardSection` grid's own extra "none of these" card — today, only
 * the Hat tab's "No hat" (see {@link CharacterCreation.buildHatSection}).
 * Its own type rather than a `ShopItem` with fields papered over: a "none"
 * card is not a catalogue entry (no price, no shop, no Cute-o-dex page), and
 * `selected`/`onPick` (rather than an `id` matched against `initialId`) are
 * what let the caller decide "is this the current answer" itself, since
 * `null` — the value this always resolves to — cannot be an `initialId` to
 * compare `ShopItem.id` against.
 */
interface NoneCardOption {
  readonly icon: string;
  readonly label: string;
  readonly selected: boolean;
  readonly onPick: () => void;
}

const HAIR_SWATCHES: readonly Swatch[] = [
  { colour: PALETTE.hair, label: 'Brown' },
  { colour: ART.kidHairBlonde, label: 'Blonde' },
  { colour: PALETTE.wood, label: 'Ginger' },
  { colour: PALETTE.blossomPink, label: 'Pink' },
  { colour: PALETTE.flowerBlue, label: 'Blue' },
  { colour: PALETTE.markerLilac, label: 'Lilac' },
];

const OUTFIT_SWATCHES: readonly Swatch[] = [
  { colour: PALETTE.outfit, label: 'Pink' },
  { colour: PALETTE.markerMint, label: 'Mint' },
  { colour: PALETTE.markerSky, label: 'Sky' },
  { colour: PALETTE.markerLemon, label: 'Lemon' },
  { colour: PALETTE.flowerViolet, label: 'Violet' },
  { colour: PALETTE.flowerRed, label: 'Coral' },
  // The one two-tone preset: a red body with white arms. `ART.jumperRed`
  // (Biscuit's own jumper) is the closest thing this game already has to a
  // clean "shirt red" — `PALETTE.flowerRed` above reads as coral/salmon, not
  // red, which is exactly why `flowerRed` is labelled Coral rather than Red.
  // `ART.cream` is the game's general warm off-white (tummies, paw pads);
  // palette.ts's own rule is "softened towards cream rather than white", so
  // it is the arms colour that rule actually points at rather than `#fff`.
  { colour: ART.jumperRed, armsColour: ART.cream, label: 'Red & White' },
];

const BACKPACK_SWATCHES: readonly Swatch[] = [
  { colour: PALETTE.backpack, label: 'Mint' },
  { colour: PALETTE.markerSky, label: 'Sky' },
  { colour: PALETTE.markerLemon, label: 'Lemon' },
  { colour: PALETTE.markerPink, label: 'Pink' },
  { colour: PALETTE.flowerViolet, label: 'Violet' },
  { colour: ART.corgiTan, label: 'Toffee' },
];

/**
 * What a child sees on each hair-style button.
 *
 * A `Record` keyed on the whole `HairStyle` union rather than a list, so a
 * style added to `art/models/hair.ts` and forgotten here does not compile —
 * the alternative is a style that exists in the game and can never be chosen,
 * which is exactly the kind of bug that survives a review.
 */
const HAIR_STYLE_OPTIONS: Readonly<Record<HairStyle, { label: string; glyph: string }>> = {
  bunches: { label: 'Bunches', glyph: '🎀' },
  bob: { label: 'Bob', glyph: '💇' },
  short: { label: 'Short', glyph: '✂️' },
  long: { label: 'Long', glyph: '💁' },
  ponytail: { label: 'Ponytail', glyph: '🐴' },
  longPonytail: { label: 'Swishy Pony', glyph: '✨' },
  bowl: { label: 'Bowl Cut', glyph: '🥣' },
  spiky: { label: 'Spiky', glyph: '⚡' },
  messy: { label: 'Messy', glyph: '🌪️' },
  mohican: { label: 'Rooster', glyph: '🐓' },
};

/**
 * The order the buttons appear in. The three that shipped first stay exactly
 * where they were, so a child who has done this once already still finds them
 * in the same place, and the six new ones follow.
 */
const HAIR_STYLE_ORDER: readonly HairStyle[] = [
  'bunches',
  'bob',
  'short',
  'long',
  'ponytail',
  'longPonytail',
  'bowl',
  'spiky',
  'messy',
  'mohican',
];

/**
 * The picker, in order — with anything missing from {@link HAIR_STYLE_ORDER}
 * swept onto the end rather than dropped. The `Record` above is the thing the
 * compiler guards; this makes the *order* list a preference rather than a
 * second place a style can be lost.
 */
const HAIR_STYLES: readonly Choice<HairStyle>[] = [
  ...HAIR_STYLE_ORDER,
  ...(Object.keys(HAIR_STYLE_OPTIONS) as HairStyle[]).filter(
    (style) => !HAIR_STYLE_ORDER.includes(style),
  ),
].map((value) => ({ value, ...HAIR_STYLE_OPTIONS[value] }));

/**
 * What a child sees on each backpack button.
 *
 * A `Record` over the whole union for the same reason the hair styles are one:
 * a shape added to `art/models/backpacks.ts` and forgotten here would exist in
 * the game and be unchoosable, which is exactly the bug that survives a review.
 *
 * The two creature bags are named after the creatures rather than described
 * ("RiPika", not "RiPika head bag") — a six-year-old picking RiPika is picking
 * RiPika, and the picture on the button says the rest.
 */
const BACKPACK_OPTIONS: Readonly<Record<BackpackKind, { label: string; glyph: string }>> = {
  satchel: { label: 'Backpack', glyph: '🎒' },
  bubble: { label: 'Bubble', glyph: '🫧' },
  heart: { label: 'Heart', glyph: '💗' },
  ripikaHead: { label: 'RiPika', glyph: '⚡' },
  trillaHead: { label: 'Trilla', glyph: '🎵' },
};

const BACKPACK_ORDER: readonly BackpackKind[] = ['satchel', 'bubble', 'heart', 'ripikaHead', 'trillaHead'];

const BACKPACKS: readonly Choice<BackpackKind>[] = [
  ...BACKPACK_ORDER,
  ...(Object.keys(BACKPACK_OPTIONS) as BackpackKind[]).filter(
    (kind) => !BACKPACK_ORDER.includes(kind),
  ),
].map((value) => ({ value, ...BACKPACK_OPTIONS[value] }));

const SHOE_SWATCHES: readonly Swatch[] = [
  { colour: PALETTE.shoe, label: 'Sky' },
  { colour: PALETTE.markerMint, label: 'Mint' },
  { colour: PALETTE.markerLemon, label: 'Lemon' },
  { colour: PALETTE.markerPink, label: 'Pink' },
  { colour: PALETTE.flowerViolet, label: 'Violet' },
  { colour: PALETTE.flowerRed, label: 'Coral' },
];

/**
 * What a child sees on each shoe button.
 *
 * A `Record` over the whole union for the same reason the hair styles and the
 * backpack shapes are one: a pair added to `art/models/shoes.ts` and forgotten
 * here would exist in the game and be unchoosable, exactly the bug that
 * survives a review. `ripika` keeps the RiPika glyph the hat and the backpack
 * both already use — she is the same character wherever she shows up, not a
 * different picture on every screen that happens to feature her.
 */
const SHOE_OPTIONS: Readonly<Record<ShoeKind, { label: string; glyph: string }>> = {
  plain: { label: 'Plain', glyph: '👟' },
  ripika: { label: 'RiPika', glyph: '⚡' },
  sandal: { label: 'Sandal', glyph: '🩴' },
  sparkle: { label: 'Sparkly', glyph: '✨' },
};

const SHOE_ORDER: readonly ShoeKind[] = ['plain', 'ripika', 'sandal', 'sparkle'];

const SHOES: readonly Choice<ShoeKind>[] = [
  ...SHOE_ORDER,
  ...(Object.keys(SHOE_OPTIONS) as ShoeKind[]).filter((kind) => !SHOE_ORDER.includes(kind)),
].map((value) => ({ value, ...SHOE_OPTIONS[value] }));

/**
 * One more than {@link GlassesKind}: the tab's own "no glasses" choice, which
 * `PlayerState.glassesKind` represents as `null` rather than a fourth kind —
 * see that field's doc comment. Kept local to this file rather than asked of
 * the state or art layers, the same way a bare-headed or bare-footed choice
 * has no `HairStyle`/`ShoeKind` member of its own; unlike those two, glasses
 * really do default to "none", so this file needs a word for it.
 */
type GlassesChoiceValue = GlassesKind | 'none';

/**
 * What a child sees on each glasses button.
 *
 * A `Record` over the whole (local) union for the same reason the hair styles,
 * the backpack shapes and the shoe pairs each are one: a kind added to
 * `art/models/glasses.ts` and forgotten here would exist in the game and be
 * unchoosable, exactly the bug that survives a review.
 */
const GLASSES_OPTIONS: Readonly<Record<GlassesChoiceValue, { label: string; glyph: string }>> = {
  none: { label: 'None', glyph: '🙈' },
  sunglasses: { label: 'Sunglasses', glyph: '🕶️' },
  star: { label: 'Star', glyph: '⭐' },
  heart: { label: 'Heart', glyph: '💖' },
};

/** "None" comes first — it is the default, and the state every child starts from. */
const GLASSES_ORDER: readonly GlassesChoiceValue[] = ['none', 'sunglasses', 'star', 'heart'];

const GLASSES_CHOICES: readonly Choice<GlassesChoiceValue>[] = [
  ...GLASSES_ORDER,
  ...(Object.keys(GLASSES_OPTIONS) as GlassesChoiceValue[]).filter(
    (value) => !GLASSES_ORDER.includes(value),
  ),
].map((value) => ({ value, ...GLASSES_OPTIONS[value] }));

/** Every hat the hat shop sells — one source of truth, no duplicated data. */
const HAT_OPTIONS: readonly ShopItem[] = itemsForShop('hat');

/**
 * RiPika first (the family's suggested starter — GAME_DESIGN.md item 21),
 * then the sticker & pet shop's three pets.
 */
const PET_OPTIONS: readonly ShopItem[] = [
  shopItem('toy.ripika'),
  ...itemsForShop('stickerPet').filter((item) => item.kind === 'pet'),
].filter((item): item is ShopItem => item !== null);

const DEFAULT_HAT_ID = HAT_OPTIONS.find((item) => item.id === 'hat.party')?.id ?? HAT_OPTIONS[0]?.id ?? '';
const DEFAULT_PET_ID = PET_OPTIONS[0]?.id ?? '';

/** One tab in the strip below — a customisation category, its own place on the child. */
type TabId = 'skin' | 'hair' | 'eyes' | 'glasses' | 'outfit' | 'shoes' | 'hat' | 'backpack' | 'pet';

/**
 * The tab strip: order, what a child sees on the button, and — the actual
 * point of tabbing this screen at all — which {@link PreviewFocus} the camera
 * settles on while that tab is open.
 *
 * Requested directly (31 July 2026), after the screen had grown to nine
 * stacked sections plus name, hat and pet: "one tab per thing you can
 * change… so each customisation category gets its own tab instead of
 * everything stacked on one long screen." Name stays outside the strip (see
 * the constructor) — typing is not a "look" choice the way the rest of this
 * table is, and it is the one thing every child does exactly once, so it gets
 * to stay the first thing on the screen rather than hide behind a tap.
 *
 * The focus column is GAME_DESIGN.md's PREVIEW RULE generalised one level up:
 * that rule already had the camera zoom to what a single control just
 * changed (`refreshPreview`'s own `focus` argument, unchanged below); this
 * table says the same thing about what a whole *tab* is for, so opening
 * "Hat" alone — before touching a single hat card — already frames the head,
 * and the "hold two seconds then ease back" beat a lone swatch tap gets
 * (`characterCreationPreview.ts`'s `FOCUS_HOLD_SECONDS`) has nowhere to ease
 * *back to* any more, because every control inside a tab already asks for
 * that tab's own focus. `hair` and `backpack` both carry two controls
 * (colour + style, kind + colour) that already agreed on one focus each
 * before tabs existed — which is exactly why grouping them by tab rather than
 * by control needed no new camera tuning at all, only `CharacterPreview.
 * setResting` to move the destination on a switch instead of only a pick.
 */
const TAB_META: readonly { readonly id: TabId; readonly label: string; readonly glyph: string; readonly focus: PreviewFocus }[] = [
  { id: 'skin', label: 'Skin', glyph: '🖐️', focus: 'all' },
  { id: 'hair', label: 'Hair', glyph: '💇', focus: 'hair' },
  { id: 'eyes', label: 'Eyes', glyph: '👀', focus: 'face' },
  // Sits between Eyes and Outfit — glasses sit on the face, right next to what
  // the Eyes tab already frames, and `focus: 'face'` is the same framing that
  // tab already uses, so no new `PreviewFocus` was needed for this tab at all.
  { id: 'glasses', label: 'Glasses', glyph: '🕶️', focus: 'face' },
  { id: 'outfit', label: 'Outfit', glyph: '👕', focus: 'body' },
  { id: 'shoes', label: 'Shoes', glyph: '👟', focus: 'feet' },
  { id: 'hat', label: 'Hat', glyph: '🎩', focus: 'head' },
  { id: 'backpack', label: 'Backpack', glyph: '🎒', focus: 'backpack' },
  { id: 'pet', label: 'Pet', glyph: '🐾', focus: 'pet' },
];

/**
 * Hair styles a hat cannot sit on top of — so far, none: the Mohican that
 * would be the first entry (Jim's words, 31 July 2026: "a Mohican and a hat
 * are mutually exclusive… selecting this should count against the hat,
 * disabling the hat tab") is `'mohican'` — landed 31 July 2026 (PR #138,
 * `feat/mohican-hair`, labelled "Rooster" in the picker: {@link
 * HAIR_STYLE_OPTIONS}), and the whole mechanism below was built and wired
 * against this set while it was still empty, exactly the way the shoe picker
 * was designed against `ShoeKind` before that union existed — turning it on
 * was the one-line edit this comment used to promise.
 *
 * Everything downstream of this set — hiding the Hat tab, remembering and
 * restoring the hat she had on, taking a hat off if she is already wearing
 * one when she picks an exclusive style — needed no further changes the day
 * the style actually landed. See {@link applyHairStyle}.
 *
 * Deliberately a set of styles, not a single hard-coded `'mohican'` check
 * scattered across this file: the rule is "some styles conflict with a hat",
 * not "this one specific style does", and a future second exclusive style
 * (a tall crest, say) is then also just one more entry rather than a second
 * near-identical code path.
 *
 * **Scope, on purpose:** this governs only the character creator's own Hat
 * tab — where a hat is *chosen*, once, before the park exists. It does not
 * reach into the running game's shop-and-backpack-drawer hat-wearing flow
 * (`entities/WornHat.ts`, `state/store.ts`'s `setWornHat`), which has its own,
 * separate mechanism for a style that cannot share the head with a hat
 * (`KidHandle.hairHidesHat` — the *hat* declines to draw itself, not the
 * hair; see `art/models/hair.ts`'s `HairPart.hideUnderHat`). That mechanism
 * covers Mohican too, for whatever hat she happens to still own from before —
 * it is just moot for Mohican specifically, because this file's own
 * exclusivity already keeps `wornHatUid` clear while she is wearing it, so
 * there is nothing left for `hairHidesHat` to hide. NPCs never wear hats at
 * all (`entities/npc/NpcSystem.ts` has no hat-rolling of any kind), so there
 * is no crowd-side mirror of any of this needed either.
 */
const HAT_EXCLUSIVE_HAIR_STYLES: ReadonlySet<HairStyle> = new Set<HairStyle>(['mohican']);

/**
 * The player's current look, if she already has one — read fresh every time
 * this screen is built, so the constructor can seed every field from it
 * instead of this file's own hardcoded defaults.
 *
 * `null` on a genuinely fresh profile (`saveFlags.createdCharacter` still
 * `false` — `main.ts`'s `startFresh`, before `completeCharacterCreation` has
 * ever run): there is no "current" look yet, `gameStore`'s own player is
 * still sitting on `createInitialState`'s defaults, and those already equal
 * this file's own hardcoded ones, so the constructor's fallback to the
 * literal default is exactly the same answer either way.
 *
 * Not `null` whenever a character already exists — most obviously the HUD's
 * "Look" pill reopening this screen over a live save (`main.ts`'s
 * `reopenCharacterCreation`, which hydrates `gameStore` from that save
 * *before* building this screen), which is the exact path that used to reset
 * every field to a hardcoded default the moment she reopened it. `hatId`
 * resolves `wornHatUid` back to the catalogue id this screen actually wants
 * (or `null`, bare-headed, if nothing is worn — a real answer since the Hat
 * tab's own "No hat" card, not a lookup miss); a save that predates hats
 * entirely never sets `wornHatUid` at all, which reads the same way.
 */
function currentAppearance(): { readonly player: PlayerState; readonly hatId: string | null } | null {
  if (!saveFlags.createdCharacter) return null;
  const state = gameStore.get();
  const wornHat = state.inventory.find((item) => item.uid === state.wornHatUid);
  return { player: state.player, hatId: wornHat?.id ?? null };
}

export class CharacterCreation {
  private readonly root: HTMLElement;
  private readonly preview: CharacterPreview;
  private readonly previewWrap: HTMLElement;
  private readonly nameInput: HTMLInputElement;

  private readonly handlers: CharacterCreationHandlers;
  private readonly resizeObserver: ResizeObserver;

  /**
   * Every field below (bar {@link petId} — see its own comment) is seeded in
   * the constructor from {@link currentAppearance}, not from a literal here:
   * a hardcoded initializer is exactly what used to make reopening this
   * screen over an existing character reset her back to a brand-new arrival.
   * Declared without an initializer on purpose — `strictPropertyInitialization`
   * still holds the constructor to assigning every one of these before it
   * returns, it just cannot be a field-literal default any more.
   */
  private skinColour: number;
  private hairColour: number;
  private hairStyle: HairStyle;
  private outfitColour: number;
  /** The arms' own colour — equal to {@link outfitColour} until a two-tone swatch is picked. */
  private outfitArmsColour: number;
  private eyeColour: number;
  private backpackKind: BackpackKind;
  private backpackColour: number;
  private shoeKind: ShoeKind;
  private shoeColour: number;
  /** `'none'` (the default) becomes `null` wherever this leaves the file — see {@link glasses}. */
  private glassesKind: GlassesChoiceValue;

  /**
   * {@link glassesKind}, resolved to what everything downstream of this
   * screen actually wants: `PreviewChoice.glasses` and
   * `CharacterCreationChoice.glassesKind` are both `GlassesKind | null`, with
   * `null` the real "no glasses" answer — `'none'` is this file's own button,
   * not a value either of those ever sees. One conversion, read at both call
   * sites, rather than the same ternary repeated at each.
   */
  private get glasses(): GlassesKind | null {
    return this.glassesKind === 'none' ? null : this.glassesKind;
  }
  /**
   * `null` means "no hat" — either the child's own explicit pick (the Hat
   * tab's own "No hat" card) or the automatic one an exclusive hair style
   * makes for her (see {@link HAT_EXCLUSIVE_HAIR_STYLES}). `complete()`
   * grants nothing and clears any previously-worn hat when this is `null` at
   * submit time — see `state/store.ts`'s `completeCharacterCreation`. Seeded
   * in the constructor from {@link currentAppearance}, not a literal — see
   * the comment on {@link skinColour} and its neighbours above.
   */
  private hatId: string | null;
  /**
   * The hat she had on right before an exclusive style took it off, so
   * switching back to an ordinary style gives it back rather than resetting
   * to {@link DEFAULT_HAT_ID} — see {@link applyHairStyle}. Three states, not
   * two: `undefined` means "not currently in that borrowed state at all"
   * (including "started the screen already on an exclusive style and has
   * never had a hat to lend"); `null` means she *was* borrowed from, and the
   * honest answer is "no hat" — the Hat tab's own "No hat" card, not a lookup
   * miss (see {@link buildHatSection}); anything else is the catalogue id she
   * gets back. `undefined` rather than `null` for "nothing stashed" is the
   * whole reason this is three states: `null` was already spoken for the
   * moment "no hat" became a deliberate, reachable choice rather than
   * something that only ever happened transiently mid-exclusivity-switch.
   * Seeded in the constructor alongside {@link hatId}, for the same reason.
   */
  private hatIdBeforeExclusiveHair: string | null | undefined;
  /**
   * Unlike every other field above, this one has no "current" value to seed
   * from: a pet is a one-time free grant into the parade
   * (`completeCharacterCreation`'s `grantFree`), not an equippable slot with
   * a single live `worn*Uid` the way a hat is, so there is nothing in the
   * store that means "the pet she currently has". The suggested default is
   * exactly as good a starting point on a reopened screen as it always was
   * on a fresh one.
   */
  private petId = DEFAULT_PET_ID;

  /** The Hat tab's own panel and button — see {@link applyHairStyle}. */
  private hatPanel: HTMLElement;
  // Definite-assignment: set inside a `for (const tab of TAB_META) { if
  // (tab.id === 'hat') … }` in the constructor, which always assigns it in
  // practice (`TAB_META` always carries exactly one `'hat'` entry — the
  // `Record<TabId, HTMLElement>` two lines above it would fail to compile
  // otherwise), but is one conditional deeper than TS's control-flow
  // analysis for `strictPropertyInitialization` follows.
  private hatTabButton!: HTMLButtonElement;

  private closed = false;
  private closeTimer: number | null = null;

  constructor(container: HTMLElement, handlers: CharacterCreationHandlers) {
    this.handlers = handlers;

    // Seed every appearance field from her current look when one already
    // exists, rather than this screen's own hardcoded defaults — see
    // `currentAppearance`'s doc comment. `current` is `null` on a genuinely
    // fresh profile, in which case every `??` below falls back to exactly the
    // literal default this screen always started on.
    const current = currentAppearance();
    this.skinColour = current?.player.skinColour ?? ART.kidSkin;
    this.hairColour = current?.player.hairColour ?? PALETTE.hair;
    this.hairStyle = current?.player.hairStyle ?? 'bunches';
    this.outfitColour = current?.player.outfitColour ?? PALETTE.outfit;
    this.outfitArmsColour = current?.player.outfitArmsColour ?? PALETTE.outfit;
    this.eyeColour = current?.player.eyeColour ?? ART.kidEye;
    this.backpackKind = current?.player.backpackKind ?? 'satchel';
    this.backpackColour = current?.player.backpackColour ?? PALETTE.backpack;
    this.shoeKind = current?.player.shoeKind ?? 'plain';
    this.shoeColour = current?.player.shoeColour ?? PALETTE.shoe;
    this.glassesKind = current ? current.player.glassesKind ?? 'none' : 'none';

    // The hat is one step further removed: `currentAppearance` has already
    // resolved `wornHatUid` back to a catalogue id (or `null`, genuinely
    // bare-headed) for a returning character; a fresh one has no worn hat yet
    // at all, so she gets the same suggested default this screen always
    // opened on. Either way, an exclusive hair style already selected (only
    // possible on a returning character — see {@link HAT_EXCLUSIVE_HAIR_STYLES})
    // takes it off immediately, exactly as `applyHairStyle` would if she
    // picked that style by hand a moment after this screen opened, and
    // stashes whatever hat that was so switching hair styles hands it straight
    // back — see that method's own doc comment.
    const resolvedHatId = current ? current.hatId : DEFAULT_HAT_ID;
    if (HAT_EXCLUSIVE_HAIR_STYLES.has(this.hairStyle)) {
      this.hatId = null;
      this.hatIdBeforeExclusiveHair = resolvedHatId;
    } else {
      this.hatId = resolvedHatId;
      // `undefined`, not `null` — "nothing is stashed", not "what's stashed
      // is 'no hat'". See {@link hatIdBeforeExclusiveHair}'s own doc comment.
      this.hatIdBeforeExclusiveHair = undefined;
    }

    this.root = document.createElement('div');
    // `.shop-panel` gives this the same full-screen backdrop and open/close
    // fade for free (see style.css) — this is just always "open" from the
    // moment it is built, and there is no close button: finishing the form is
    // the only way out.
    this.root.className = 'charcreate shop-panel';
    this.root.dataset.open = 'false';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Make your character');

    const form = document.createElement('form');
    form.className = 'charcreate-card shop-card';
    form.noValidate = true;

    // No header. There used to be a `.shop-head` band here — a 🧒 glyph, the
    // title "Make your character!" and the line "Pick how you look, then let's
    // go to the park!". The family's words (28 July 2026): "The character
    // create screen is obvious enough what its purpose is - drop the main
    // heading and subheading." On a phone that band cost about 150px off the
    // top of a screen the controls were already scrolling on, which the layout
    // fix that landed the same day had to work around. The screen is a picture
    // of a child, a name box and a row of colours; it does not need to be
    // announced. The dialog keeps its `aria-label` above, so a screen reader
    // still hears what it is.

    // --- body: preview + controls --------------------------------------
    const body = document.createElement('div');
    body.className = 'charcreate-body';

    this.previewWrap = document.createElement('div');
    this.previewWrap.className = 'charcreate-preview';
    this.preview = new CharacterPreview();
    this.previewWrap.append(this.preview.canvas);
    // Nothing else goes in here. There used to be a `.charcreate-name-preview`
    // caption echoing the name under the picture, which on a phone put the word
    // "Eleri" directly above a name input already reading "Eleri" — the family
    // saw the name twice, one line apart, and only one of them did anything
    // (28 July 2026, GAME_DESIGN.md item 27a). The input is the one that does
    // something, so the caption went.

    const controls = document.createElement('div');
    controls.className = 'charcreate-controls';

    // Name -----------------------------------------------------------------
    const nameSection = document.createElement('div');
    nameSection.className = 'charcreate-section';
    const nameLabel = document.createElement('label');
    nameLabel.className = 'charcreate-label';
    nameLabel.htmlFor = 'charcreate-name-input';
    nameLabel.textContent = 'Your name';
    this.nameInput = document.createElement('input');
    this.nameInput.id = 'charcreate-name-input';
    this.nameInput.className = 'charcreate-name-input';
    this.nameInput.type = 'text';
    this.nameInput.maxLength = 18;
    this.nameInput.autocomplete = 'off';
    this.nameInput.spellcheck = false;
    this.nameInput.value = PLAYER_DEFAULT_NAME;
    this.nameInput.setAttribute('aria-label', 'Your name');
    nameSection.append(nameLabel, this.nameInput);

    // Skin tone ---------------------------------------------------------------
    const skinToneSection = this.buildSwatchSection(
      'Skin tone',
      KID_SKIN_TONES,
      this.skinColour,
      (colour) => {
        this.skinColour = colour;
        // Skin shows on the face, the hands and the legs all at once, so this
        // is the one swatch with no better subject than the whole character.
        this.refreshPreview('all');
      },
    );

    // Hair colour ------------------------------------------------------------
    const hairColourSection = this.buildSwatchSection(
      'Hair colour',
      HAIR_SWATCHES,
      this.hairColour,
      (colour) => {
        this.hairColour = colour;
        // `hair`, not `head`: a head framing crops the styles that hang past
        // the shoulders, and a hair *colour* is mostly shown on the part that
        // hangs — a floor-length ponytail is nearly all of the hair there is.
        this.refreshPreview('hair');
      },
    );

    // Hair style ---------------------------------------------------------
    // `applyHairStyle`, not an inline `this.hairStyle = style` — a style
    // change is also the one thing on this whole screen that can reach across
    // and change the Hat tab, see that method's doc comment.
    const hairStyleSection = this.buildChoiceSection(
      'Hair style',
      HAIR_STYLES,
      this.hairStyle,
      (style) => this.applyHairStyle(style),
    );

    // Eye colour ---------------------------------------------------------------
    const eyeColourSection = this.buildSwatchSection(
      'Eye colour',
      KID_EYE_COLOURS,
      this.eyeColour,
      (colour) => {
        this.eyeColour = colour;
        this.refreshPreview('face');
      },
    );

    // Glasses -------------------------------------------------------------
    const glassesSection = this.buildChoiceSection('Glasses', GLASSES_CHOICES, this.glassesKind, (value) => {
      this.glassesKind = value;
      this.refreshPreview('face');
    });

    // Clothes colour ---------------------------------------------------------
    const outfitSection = this.buildSwatchSection(
      'Clothes colour',
      OUTFIT_SWATCHES,
      this.outfitColour,
      (colour, armsColour) => {
        this.outfitColour = colour;
        this.outfitArmsColour = armsColour;
        this.refreshPreview('body');
      },
    );

    // Shoes -------------------------------------------------------------------
    const shoeKindSection = this.buildChoiceSection('Shoes', SHOES, this.shoeKind, (kind) => {
      this.shoeKind = kind;
      this.refreshPreview('feet');
    });

    // Only `'plain'` actually shows this swatch's colour. Flagged in QA (31
    // July 2026): picking Sparkly leaves "Sky" pressed here while the shoe
    // renders its own fixed pink glitter. That is `art/models/shoes.ts`'s own
    // design, not a bug this file introduced — its `FOOT_COLOUR` table gives
    // `'ripika'`, `'sandal'` and `'sparkle'` each a fixed palette the same way
    // the RiPika/Trilla backpacks keep their own colours (`backpacks.ts`'s
    // `collar()`): a themed pair is that theme's own colours, not a canvas
    // for whichever swatch happens to be selected. Left as-is rather than
    // hiding the swatch for those three kinds — unlike the backpack, none of
    // them has a collar/strap equivalent left over for the chosen colour to
    // paint instead, so hiding it would leave those three tabs with nothing
    // for the swatch row to do at all, which reads as more broken, not less.
    const shoeColourSection = this.buildSwatchSection(
      'Shoe colour',
      SHOE_SWATCHES,
      this.shoeColour,
      (colour) => {
        this.shoeColour = colour;
        this.refreshPreview('feet');
      },
    );

    // Backpack ---------------------------------------------------------------
    // Both halves frame the bag, which means the preview turns her round to
    // show you her back — see `characterCreationPreview.ts`'s `BACK_TURN`.
    const backpackSection = this.buildChoiceSection(
      'Backpack',
      BACKPACKS,
      this.backpackKind,
      (kind) => {
        this.backpackKind = kind;
        this.refreshPreview('backpack');
      },
    );

    const backpackColourSection = this.buildSwatchSection(
      'Backpack colour',
      BACKPACK_SWATCHES,
      this.backpackColour,
      (colour) => {
        this.backpackColour = colour;
        this.refreshPreview('backpack');
      },
    );

    // Starting hat ------------------------------------------------------
    // Built through a method, not inline, because {@link applyHairStyle}
    // needs to rebuild this same card grid later — with a *different*
    // starting selection — the moment a hat comes back from being lent out to
    // an exclusive hair style.
    const hatSection = this.buildHatSection();

    // Starting pet ------------------------------------------------------
    const petSection = this.buildCardSection(
      'Starting pet',
      PET_OPTIONS,
      this.petId,
      (item) => {
        this.petId = item.id;
        this.refreshPreview('pet');
      },
      'toy.ripika',
    );

    // --- the tab strip ----------------------------------------------------
    // Panels grouped exactly as {@link TAB_META} names them — each one the
    // section(s) that already agreed on a single camera focus before tabs
    // existed (see that constant's doc comment).
    const panels: Readonly<Record<TabId, HTMLElement>> = {
      skin: this.buildTabPanel('skin', [skinToneSection]),
      hair: this.buildTabPanel('hair', [hairColourSection, hairStyleSection]),
      eyes: this.buildTabPanel('eyes', [eyeColourSection]),
      glasses: this.buildTabPanel('glasses', [glassesSection]),
      outfit: this.buildTabPanel('outfit', [outfitSection]),
      shoes: this.buildTabPanel('shoes', [shoeKindSection, shoeColourSection]),
      hat: this.buildTabPanel('hat', [hatSection]),
      backpack: this.buildTabPanel('backpack', [backpackSection, backpackColourSection]),
      pet: this.buildTabPanel('pet', [petSection]),
    };

    // Reuses `.charcreate-styles`/`.charcreate-style-btn` verbatim — the same
    // glyph-and-label grid `buildChoiceSection` already draws for a hair style
    // or a backpack shape. A tab **is** a choice grid, one level up: "which
    // category" rather than "which value within one", so it earns the same
    // look rather than a bespoke one, and for free it also carries the fix
    // documented on `.charcreate-styles` in style.css — the row wraps onto a
    // second line instead of ever needing a horizontal scroll to find a tab.
    const tabStrip = document.createElement('div');
    tabStrip.className = 'charcreate-styles';
    tabStrip.setAttribute('role', 'tablist');
    tabStrip.setAttribute('aria-label', 'What to change');

    // Tab + button paired up as they are built, and switched by reference —
    // not by index into two parallel arrays, which `tsconfig`'s
    // `noUncheckedIndexedAccess` (rightly) will not let stand unchecked, and
    // which is more ceremony than this needs anyway.
    interface TabHandle {
      readonly meta: (typeof TAB_META)[number];
      readonly button: HTMLButtonElement;
    }
    const tabHandles: TabHandle[] = [];

    const selectTab = (target: TabHandle): void => {
      for (const handle of tabHandles) {
        const active = handle === target;
        panels[handle.meta.id].hidden = !active;
        handle.button.dataset.selected = active ? 'true' : 'false';
        handle.button.setAttribute('aria-selected', active ? 'true' : 'false');
      }
      // The whole point: the camera's resting place moves with the tab, not
      // just with the last thing tapped inside it. See `setResting`'s own
      // doc comment for why this — not another `refreshPreview` call — is
      // the right primitive here: nothing about the character changed.
      this.preview.setResting(target.meta.focus);
    };

    let isFirstTab = true;
    for (const tab of TAB_META) {
      const active = isFirstTab;
      isFirstTab = false;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'charcreate-style-btn';
      button.id = `charcreate-tab-${tab.id}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panels[tab.id].id);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.dataset.selected = active ? 'true' : 'false';
      button.innerHTML =
        `<span class="charcreate-style-glyph">${tab.glyph}</span><span>${escapeHtml(tab.label)}</span>`;
      const handle: TabHandle = { meta: tab, button };
      button.addEventListener('click', () => selectTab(handle));
      tabHandles.push(handle);
      tabStrip.append(button);
      // The two references `applyHairStyle` needs to hide/show this one tab
      // later — captured here rather than re-derived from `TAB_META`/`panels`
      // each time, since `Record` access by a literal key is the only other
      // safe option and `'hat'` typed out at every call site is worse than
      // naming it once.
      if (tab.id === 'hat') {
        this.hatTabButton = button;
        // Matches what `applyHairStyle` would do a moment later if she picked
        // an exclusive style by hand: hidden from the very first frame, not
        // shown then immediately hidden, on a reopened screen that starts
        // already on one (`this.hairStyle` is seeded above, before this loop
        // runs).
        button.hidden = HAT_EXCLUSIVE_HAIR_STYLES.has(this.hairStyle);
      }
    }
    this.hatPanel = panels.hat;

    // The strip itself is not a `.charcreate-section` (it carries no
    // `.charcreate-label`, a tab button already names itself), but it still
    // wants that class's bottom margin ahead of whichever panel is showing —
    // easiest borrowed the same way `.charcreate-tabpanel` borrows nothing at
    // all below.
    const tabStripSection = document.createElement('div');
    tabStripSection.className = 'charcreate-section';
    tabStripSection.append(tabStrip);

    // Every panel starts `hidden` (see `buildTabPanel`); the first tab is the
    // one exception, un-hidden directly rather than through `selectTab` so
    // construction does not also fire an unnecessary `preview.setResting`
    // call before the preview it would move even exists.
    panels.skin.hidden = false;

    controls.append(nameSection, tabStripSection, ...TAB_META.map((tab) => panels[tab.id]));
    body.append(this.previewWrap, controls);

    // --- footer ----------------------------------------------------------
    const footer = document.createElement('div');
    footer.className = 'shop-foot';
    const goButton = document.createElement('button');
    goButton.type = 'submit';
    goButton.className = 'shop-buy charcreate-go';
    goButton.innerHTML = '<span class="emoji">🚌</span><span>Let’s go!</span>';
    footer.append(goButton);

    form.append(body, footer);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.complete();
    });
    this.root.append(form);
    container.append(this.root);

    // A resize on the canvas's OWN box (phone rotation, layout reflow at the
    // 700px breakpoint) keeps the render buffer's aspect ratio matching its
    // CSS box exactly. Observing `previewWrap` instead would read the wrong
    // number: it is a flex child that centres the canvas inside a wider band
    // on a phone and stretches to its sibling's height on a desktop, so its
    // box is not the canvas's box — see the `align-items: flex-start` note on
    // `.charcreate-body` in style.css for the other half of this fix.
    this.resizeObserver = new ResizeObserver(() => {
      this.preview.resize(this.preview.canvas.clientWidth, this.preview.canvas.clientHeight);
    });
    this.resizeObserver.observe(this.preview.canvas);

    this.refreshPreview();

    // Pop in on the next frame — same one-shot `shop-pop` card animation
    // every other panel in the game gets, see style.css.
    requestAnimationFrame(() => {
      this.root.dataset.open = 'true';
      this.nameInput.focus();
      this.nameInput.select();
    });
  }

  dispose(): void {
    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    this.resizeObserver.disconnect();
    this.preview.dispose();
    this.root.remove();
  }

  // -------------------------------------------------------------- internals

  /**
   * Wraps one or more sections into a tab's panel — the "Hair" tab is colour
   * then style, everything else here is one section alone.
   *
   * `id`/`aria-labelledby` are derived from `id` rather than threaded through
   * as a parameter, so this (built first, while the tab strip's buttons do
   * not exist yet) and the button `aria-controls` points at it (built after,
   * from the same {@link TAB_META} table) agree on the string without either
   * one needing to hand it to the other. Starts `hidden` — the constructor
   * unhides exactly the first tab once every panel in {@link TAB_META} exists,
   * see `selectTab`'s initial call below.
   */
  private buildTabPanel(id: TabId, sections: readonly HTMLElement[]): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'charcreate-tabpanel';
    panel.id = `charcreate-tabpanel-${id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `charcreate-tab-${id}`);
    panel.hidden = true;
    panel.append(...sections);
    return panel;
  }

  /**
   * A row of curated one-tap swatches, **plus** a "Custom colour" tile that
   * opens {@link ColourWheelPicker} — see that class's doc comment for why
   * this is additive rather than a replacement. Both paths call the same
   * `onPick`, so the rest of this screen (the preview, the saved choice)
   * cannot tell a custom pick from a curated one — a bare hex number either
   * way, exactly like every colour field already stores.
   *
   * `onPick`'s second argument is only ever interesting to the outfit tab: a
   * two-tone {@link Swatch} passes its own `armsColour` through, and every
   * other swatch — curated or from the wheel — passes the same colour twice,
   * which is what makes every other caller's single-parameter callback still
   * valid here (it simply never looks at the second argument).
   */
  private buildSwatchSection(
    label: string,
    swatches: readonly Swatch[],
    initial: number,
    onPick: (colour: number, armsColour: number) => void,
  ): HTMLElement {
    const section = document.createElement('div');
    section.className = 'charcreate-section';
    const labelEl = document.createElement('p');
    labelEl.className = 'charcreate-label';
    labelEl.textContent = label;
    const row = document.createElement('div');
    row.className = 'charcreate-swatches';
    const buttons: HTMLButtonElement[] = [];
    // The colour actually applied right now — starts at `initial`, and is
    // kept in step by both a curated click and a wheel drag, so reopening the
    // wheel (or checking whether it should show its own selection ring)
    // always reflects what the character is really wearing.
    let current = initial;

    const selectCurated = (button: HTMLButtonElement) => {
      for (const other of buttons) {
        const selected = other === button;
        other.dataset.selected = selected ? 'true' : 'false';
        other.setAttribute('aria-pressed', selected ? 'true' : 'false');
      }
      picker.setSelected(false);
      picker.close();
    };

    for (const swatch of swatches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'charcreate-swatch';
      button.style.setProperty('--swatch-colour', hexToCss(swatch.colour));
      // Two-tone tiles (today, only the outfit tab's 'Red & White') get a
      // second CSS custom property and a modifier class that splits the
      // background between them — see `.charcreate-swatch--two-tone` in
      // style.css. Every other swatch never sets this at all, so it keeps
      // the plain single-colour circle it always had.
      if (swatch.armsColour !== undefined) {
        button.classList.add('charcreate-swatch--two-tone');
        button.style.setProperty('--swatch-arms-colour', hexToCss(swatch.armsColour));
      }
      button.dataset.selected = swatch.colour === initial ? 'true' : 'false';
      button.setAttribute('aria-pressed', swatch.colour === initial ? 'true' : 'false');
      button.setAttribute('aria-label', swatch.label);
      button.title = swatch.label;
      button.addEventListener('click', () => {
        current = swatch.colour;
        onPick(swatch.colour, swatch.armsColour ?? swatch.colour);
        selectCurated(button);
      });
      buttons.push(button);
      row.append(button);
    }

    const picker = new ColourWheelPicker({
      // The wheel only ever offers one colour, so a custom pick is always
      // single-tone — same behaviour a curated single-colour swatch gets.
      onChange: (colour) => {
        current = colour;
        onPick(colour, colour);
        for (const other of buttons) {
          other.dataset.selected = 'false';
          other.setAttribute('aria-pressed', 'false');
        }
        picker.setSelected(true);
      },
      // Only the "colour buttons" — the curated presets — hide while the
      // wheel is open: they are not usefully tappable mid-drag, and hiding
      // them frees the vertical space the wheel + brightness bar + Done
      // button need most. The trigger tile itself (`picker.trigger`, also in
      // `row`) stays put — it is how a child would notice the picker at all,
      // and it doubles as the panel's own expanded/collapsed indicator via
      // its `aria-expanded`.
      onOpenChange: (open) => {
        for (const button of buttons) button.hidden = open;
      },
    });
    // Starts selected when the field's starting colour is not one of the
    // curated presets at all — e.g. a save file carrying an earlier custom
    // pick reopening the creator.
    picker.setSelected(!swatches.some((swatch) => swatch.colour === initial));
    row.append(picker.trigger);
    picker.trigger.addEventListener('click', () => picker.toggle(current));

    section.append(labelEl, row, picker.panel);
    return section;
  }

  /**
   * A grid of glyph-and-label buttons — one picked at a time.
   *
   * The hair-style row's own markup, lifted into a helper the day the backpack
   * shapes needed the identical thing: same `charcreate-styles` grid, same
   * `charcreate-style-btn`, same `aria-pressed` bookkeeping. Two copies of a
   * picker is how a codebase ends up with pickers that drift apart, which
   * GAME_DESIGN.md's PREVIEW RULE exists to prevent.
   */
  private buildChoiceSection<T extends string>(
    label: string,
    choices: readonly Choice<T>[],
    initial: T,
    onPick: (value: T) => void,
  ): HTMLElement {
    const section = document.createElement('div');
    section.className = 'charcreate-section';
    const labelEl = document.createElement('p');
    labelEl.className = 'charcreate-label';
    labelEl.textContent = label;
    const row = document.createElement('div');
    row.className = 'charcreate-styles';
    const buttons: HTMLButtonElement[] = [];
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'charcreate-style-btn';
      button.dataset.selected = choice.value === initial ? 'true' : 'false';
      button.setAttribute('aria-pressed', choice.value === initial ? 'true' : 'false');
      button.innerHTML =
        `<span class="charcreate-style-glyph">${choice.glyph}</span><span>${escapeHtml(choice.label)}</span>`;
      button.addEventListener('click', () => {
        onPick(choice.value);
        for (const other of buttons) {
          const selected = other === button;
          other.dataset.selected = selected ? 'true' : 'false';
          other.setAttribute('aria-pressed', selected ? 'true' : 'false');
        }
      });
      buttons.push(button);
      row.append(button);
    }
    section.append(labelEl, row);
    return section;
  }

  /**
   * `noneOption` is additive, and only the Hat tab uses it — see
   * {@link buildHatSection}. Every other caller (today, only "Starting pet")
   * omits it and gets exactly the plain item grid this always built: one
   * button per {@link ShopItem}, `onPick` given the item tapped.
   */
  private buildCardSection(
    label: string,
    items: readonly ShopItem[],
    initialId: string,
    onPick: (item: ShopItem) => void,
    suggestedId?: string,
    noneOption?: NoneCardOption,
  ): HTMLElement {
    const section = document.createElement('div');
    section.className = 'charcreate-section';
    const labelEl = document.createElement('p');
    labelEl.className = 'charcreate-label';
    labelEl.textContent = label;
    const grid = document.createElement('div');
    grid.className = 'charcreate-grid';
    const buttons: HTMLButtonElement[] = [];

    // First, so a bare head reads as a real, always-available choice rather
    // than something tucked away after every hat there is to buy — the same
    // "the safe answer comes first" ordering `GLASSES_ORDER` already uses for
    // its own "None".
    if (noneOption) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shop-row charcreate-row';
      button.dataset.selected = noneOption.selected ? 'true' : 'false';
      button.setAttribute('aria-pressed', noneOption.selected ? 'true' : 'false');
      button.innerHTML =
        `<span class="row-icon">${noneOption.icon}</span>` +
        `<span class="row-name">${escapeHtml(noneOption.label)}</span>`;
      button.addEventListener('click', () => {
        noneOption.onPick();
        for (const other of buttons) {
          const selected = other === button;
          other.dataset.selected = selected ? 'true' : 'false';
          other.setAttribute('aria-pressed', selected ? 'true' : 'false');
        }
      });
      buttons.push(button);
      grid.append(button);
    }

    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shop-row charcreate-row';
      button.dataset.selected = item.id === initialId ? 'true' : 'false';
      button.setAttribute('aria-pressed', item.id === initialId ? 'true' : 'false');
      const suggested = item.id === suggestedId;
      button.innerHTML =
        `<span class="row-icon">${item.icon}</span>` +
        `<span class="row-name">${escapeHtml(item.displayName)}</span>` +
        (suggested ? '<span class="charcreate-suggested">Suggested!</span>' : '');
      button.addEventListener('click', () => {
        onPick(item);
        for (const other of buttons) {
          const selected = other === button;
          other.dataset.selected = selected ? 'true' : 'false';
          other.setAttribute('aria-pressed', selected ? 'true' : 'false');
        }
      });
      buttons.push(button);
      grid.append(button);
    }
    section.append(labelEl, grid);
    return section;
  }

  /**
   * The Hat tab's own card grid — a method rather than an inline call so
   * {@link applyHairStyle} can rebuild it later with a different starting
   * selection, the moment a lent-out hat comes back.
   *
   * Carries its own "No hat" card (`noneOption`) — a real, always-available
   * choice, distinct from an exclusive hair style automatically taking the
   * hat off (see {@link HAT_EXCLUSIVE_HAIR_STYLES}) and distinct from simply
   * never having bought one: a child who owns every hat in the shop can still
   * choose to wear none of them. Not a catalogue entry (`world/building/
   * shops/catalogue.ts`'s `ShopItem`) — nobody buys nothing, and a fake entry
   * there would need a shop shelf, a price and a Cute-o-dex page that make no
   * sense, the same reason `GLASSES_OPTIONS`'s own `'none'` lives in this file
   * rather than `art/models/glasses.ts`. Picking it just sets `hatId` to
   * `null`, a value `complete()`, `state/store.ts`'s
   * `completeCharacterCreation` and `entities/WornHat.ts` already all treat
   * as "bare-headed" perfectly happily — the mechanism already existed for
   * the Mohican case, this only adds a second, deliberate way to reach it.
   */
  private buildHatSection(): HTMLElement {
    return this.buildCardSection(
      'Starting hat',
      HAT_OPTIONS,
      this.hatId ?? '',
      (item) => {
        this.hatId = item.id;
        this.refreshPreview('head');
      },
      DEFAULT_HAT_ID,
      {
        icon: '🙅',
        label: 'No hat',
        selected: this.hatId === null,
        onPick: () => {
          this.hatId = null;
          this.refreshPreview('head');
        },
      },
    );
  }

  /**
   * Applies a hair-style pick, and — the reason this is not simply
   * `this.hairStyle = style` inline at the one call site — carries the hat
   * across the boundary {@link HAT_EXCLUSIVE_HAIR_STYLES} draws.
   *
   * Jim's words, 31 July 2026: "a Mohican and a hat are mutually exclusive…
   * selecting this should count against the hat, disabling the hat tab."
   * Hidden, not merely disabled — greyed-out-and-tappable invites "why can't
   * I press this" from a six-year-old, and the same "the button simply isn't
   * there until it means something" precedent already exists for the jet
   * pack's fly button (`entities/WornJetpack.ts`-adjacent work, `ui/
   * ScreenControls.ts`), shown only once a jet pack is actually worn.
   *
   * The hat itself is **remembered, not thrown away**: entering an exclusive
   * style stashes whatever `hatId` was in `hatIdBeforeExclusiveHair` and sets
   * `hatId` to `null`; leaving one restores it (or falls back to
   * {@link DEFAULT_HAT_ID} if she never had one — starting the screen already
   * on an exclusive style, say). A six-year-old who tries a mohawk and then
   * picks a different style finding her party hat waiting for her is the
   * nicer behaviour, and it costs nothing extra to keep: this is pure
   * in-session UI state, no different from every other tab already
   * remembering whatever she last tapped in it. It does **not** persist
   * across a whole browser session the way the save does — but reopening the
   * creator on an *existing* character (`ui/Hud.ts`'s "Look" pill) now starts
   * every field, hat included, from her current look rather than a hardcoded
   * default (see `currentAppearance`), and this method's own constructor-time
   * counterpart (see the constructor's seeding block) applies exactly this
   * same exclusivity rule up front if she reopens the screen already on an
   * exclusive style.
   */
  private applyHairStyle(style: HairStyle): void {
    const wasExclusive = HAT_EXCLUSIVE_HAIR_STYLES.has(this.hairStyle);
    this.hairStyle = style;

    // `this.hatId` must be fully resolved *before* the one `refreshPreview`
    // call below — that call reads `this.hatId` fresh, but only once, and it
    // used to run first: caught in QA (31 July 2026) as the Sparkly Crown
    // staying visibly worn the moment Rooster was picked, because the tab
    // itself hid correctly (a direct DOM write, `hatTabButton.hidden`,
    // independent of the preview) while the 3D preview kept rendering
    // whatever `hatId` was still set to a line later. So: settle every field
    // first, touch the preview last.
    const isExclusive = HAT_EXCLUSIVE_HAIR_STYLES.has(style);
    if (isExclusive !== wasExclusive) {
      this.hatTabButton.hidden = isExclusive;

      if (isExclusive) {
        this.hatIdBeforeExclusiveHair = this.hatId;
        this.hatId = null;
      } else {
        // `!== undefined`, not `??`: `hatIdBeforeExclusiveHair` being `null`
        // is itself a real, stashed answer since the Hat tab's own "No hat"
        // card landed — she may have entered the exclusive style already
        // bare-headed by her own choice, and `??` cannot tell that apart from
        // "nothing was ever stashed" (also `null`-shaped before that card
        // existed, back when `hatId` was never deliberately `null`). Only
        // `undefined` — this field's own "no borrow in progress" state —
        // falls back to {@link DEFAULT_HAT_ID}.
        this.hatId = this.hatIdBeforeExclusiveHair !== undefined ? this.hatIdBeforeExclusiveHair : DEFAULT_HAT_ID;
        this.hatIdBeforeExclusiveHair = undefined;
        // Only the card grid's *content* needs rebuilding — which card shows
        // selected. The panel's own visibility is untouched here on purpose:
        // she is on the Hair tab making this change, the Hat tab cannot be
        // the active one (its button was hidden the whole time she could
        // have picked an exclusive style), and `selectTab` alone decides
        // when a panel is shown, the moment she actually taps its
        // now-visible button.
        this.hatPanel.replaceChildren(this.buildHatSection());
      }
    }

    this.refreshPreview('hair');
  }

  /**
   * Rebuilds the preview, framed on whatever the child just changed.
   *
   * The family's note was that the hat they were choosing was cropped out of
   * shot, and the same for the pet and for eye colour — so every control says
   * what it is about and the preview camera goes there, then drifts back.
   */
  private refreshPreview(focus: PreviewFocus = 'all'): void {
    this.preview.update({
      skin: this.skinColour,
      hair: this.hairColour,
      hairStyle: this.hairStyle,
      outfit: this.outfitColour,
      outfitArms: this.outfitArmsColour,
      eye: this.eyeColour,
      backpack: this.backpackKind,
      backpackColour: this.backpackColour,
      shoes: this.shoeKind,
      shoesColour: this.shoeColour,
      // `''` is the sentinel `characterCreationPreview.ts` already treats as
      // "no hat": `shopItem('')` misses the catalogue `Map` and returns
      // `null`, so the preview simply builds no hat asset — the same path a
      // typo'd id would take, not a special case added for this.
      hatId: this.hatId ?? '',
      petId: this.petId,
      glasses: this.glasses,
    }, focus);
  }

  private complete(): void {
    if (this.closed) return;
    this.closed = true;

    // `null` only when an exclusive hair style is currently selected (see
    // `HAT_EXCLUSIVE_HAIR_STYLES`/`applyHairStyle`) — a real "no hat" answer,
    // not a lookup miss, so it is not defaulted to `HAT_OPTIONS[0]` the way a
    // genuinely-unresolvable id below still is.
    const hat = this.hatId === null ? null : (shopItem(this.hatId) ?? HAT_OPTIONS[0] ?? null);
    const pet = shopItem(this.petId) ?? PET_OPTIONS[0];
    // Both option lists are built from the live catalogue and always have at
    // least one entry in this game's shop line-up, but a fully-typed fallback
    // keeps this from ever throwing if that ever changed.
    if (pet) {
      const choice: CharacterCreationChoice = {
        name: this.nameInput.value,
        skinColour: this.skinColour,
        hairColour: this.hairColour,
        hairStyle: this.hairStyle,
        outfitColour: this.outfitColour,
        outfitArmsColour: this.outfitArmsColour,
        eyeColour: this.eyeColour,
        backpackKind: this.backpackKind,
        backpackColour: this.backpackColour,
        shoeKind: this.shoeKind,
        shoeColour: this.shoeColour,
        glassesKind: this.glasses,
        hat,
        pet,
      };
      this.handlers.onComplete(choice);
    }

    // Fade out (the `.shop-panel` transition, see style.css) then dispose —
    // matches every other overlay's close beat, just with no way back in.
    this.root.dataset.open = 'false';
    this.closeTimer = window.setTimeout(() => this.dispose(), 220);
  }
}

/**
 * The exact same defaults this form itself starts on, packaged as a real
 * `CharacterCreationChoice` rather than left implicit in a constructor's
 * field initialisers — what a ride deep link (`main.ts`'s `RIDE_DEEP_LINKS`)
 * uses to skip this form entirely on a profile with no save yet, so "goes
 * straight into the ride" is true even from a completely empty profile, not
 * only a returning one. Kept here, next to the fields it mirrors, so the two
 * cannot drift without both being visible in the same diff.
 */
export function defaultCharacterChoice(): CharacterCreationChoice {
  const hat = shopItem(DEFAULT_HAT_ID) ?? HAT_OPTIONS[0] ?? null;
  const pet = shopItem(DEFAULT_PET_ID) ?? PET_OPTIONS[0];
  if (!pet) {
    // Same invariant `complete()` above leans on: the shop's live catalogue
    // always has at least one pet. If that ever stopped being true this
    // throws loudly at the one call site that needs it, rather than silently
    // handing `Game` a save with no pet at all.
    throw new Error('Land of Good Places: no pet in the shop catalogue to default to.');
  }
  return {
    name: PLAYER_DEFAULT_NAME,
    skinColour: ART.kidSkin,
    hairColour: PALETTE.hair,
    hairStyle: 'bunches',
    outfitColour: PALETTE.outfit,
    outfitArmsColour: PALETTE.outfit,
    eyeColour: ART.kidEye,
    backpackKind: 'satchel',
    backpackColour: PALETTE.backpack,
    shoeKind: 'plain',
    shoeColour: PALETTE.shoe,
    glassesKind: null,
    hat,
    pet,
  };
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
