import { hexToCss, PALETTE } from '../core/palette';
import { ART } from '../art/style/artPalette';
import { PLAYER_DEFAULT_NAME } from '../core/constants';
import { KID_EYE_COLOURS, KID_SKIN_TONES } from '../art/models/kid';
import { itemsForShop, shopItem, type ShopItem } from '../world/building/shops/catalogue';
import type { BackpackKind, CharacterCreationChoice, HairStyle } from '../state';
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
}

/** One button in a glyph-and-label picker grid — a hair style, a bag shape. */
interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly glyph: string;
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
type TabId = 'skin' | 'hair' | 'eyes' | 'outfit' | 'hat' | 'backpack' | 'pet';

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
  { id: 'outfit', label: 'Outfit', glyph: '👕', focus: 'body' },
  { id: 'hat', label: 'Hat', glyph: '🎩', focus: 'head' },
  { id: 'backpack', label: 'Backpack', glyph: '🎒', focus: 'backpack' },
  { id: 'pet', label: 'Pet', glyph: '🐾', focus: 'pet' },
];

/**
 * Hair styles a hat cannot sit on top of — so far, none: the Mohican that
 * would be the first entry (Jim's words, 31 July 2026: "a Mohican and a hat
 * are mutually exclusive… selecting this should count against the hat,
 * disabling the hat tab") is being modelled by the 3D-artist agent and is not
 * yet a member of `HairStyle` (`art/models/hair.ts`) — adding the literal
 * `'mohican'` here today would not compile. **Once it lands, this is the one
 * line that switches the whole mechanism on**: `new Set<HairStyle>(['mohican'])`.
 *
 * Everything downstream of this set — hiding the Hat tab, remembering and
 * restoring the hat she had on, taking a hat off if she is already wearing
 * one when she picks an exclusive style — is built and wired against it now,
 * exactly the way the shoe picker was designed against `ShoeKind` before that
 * union existed, so there is nothing left to do here the day the style lands
 * beyond this one edit. See {@link applyHairStyle}.
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
 * (`entities/WornHat.ts`, `state/store.ts`'s `setWornHat`), which already has
 * its own, separate accommodation for hair under a hat (`KidHandle.
 * setHatWorn`, which tucks a style like Spiky away rather than forbidding the
 * combination). Whether an exclusive style tucks the same way or genuinely
 * cannot coexist with a worn hat in the park is an art/geometry decision for
 * whoever lands the style, not assumed here — Jim's ask was specifically
 * about the creator's tab, and NPCs never wear hats at all
 * (`entities/npc/NpcSystem.ts` has no hat-rolling of any kind), so there is no
 * crowd-side mirror of this needed either.
 */
const HAT_EXCLUSIVE_HAIR_STYLES: ReadonlySet<HairStyle> = new Set<HairStyle>();

export class CharacterCreation {
  private readonly root: HTMLElement;
  private readonly preview: CharacterPreview;
  private readonly previewWrap: HTMLElement;
  private readonly nameInput: HTMLInputElement;

  private readonly handlers: CharacterCreationHandlers;
  private readonly resizeObserver: ResizeObserver;

  private skinColour: number = ART.kidSkin;
  private hairColour: number = PALETTE.hair;
  private hairStyle: HairStyle = 'bunches';
  private outfitColour: number = PALETTE.outfit;
  private eyeColour: number = ART.kidEye;
  private backpackKind: BackpackKind = 'satchel';
  private backpackColour: number = PALETTE.backpack;
  /**
   * `null` means "no hat" — today that only ever happens transiently while an
   * exclusive hair style (see {@link HAT_EXCLUSIVE_HAIR_STYLES}) is selected;
   * there is no independent "go bare-headed" choice on the Hat tab itself.
   * `complete()` grants nothing and clears any previously-worn hat when this
   * is `null` at submit time — see `state/store.ts`'s `completeCharacterCreation`.
   */
  private hatId: string | null = DEFAULT_HAT_ID;
  /**
   * The hat she had on right before an exclusive style took it off, so
   * switching back to an ordinary style gives it back rather than resetting
   * to {@link DEFAULT_HAT_ID} — see {@link applyHairStyle}. `null` whenever
   * she is not currently in that borrowed state, including "started the
   * screen already on an exclusive style and has never had a hat to lend".
   */
  private hatIdBeforeExclusiveHair: string | null = null;
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

    // Clothes colour ---------------------------------------------------------
    const outfitSection = this.buildSwatchSection(
      'Clothes colour',
      OUTFIT_SWATCHES,
      this.outfitColour,
      (colour) => {
        this.outfitColour = colour;
        this.refreshPreview('body');
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
      outfit: this.buildTabPanel('outfit', [outfitSection]),
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
      if (tab.id === 'hat') this.hatTabButton = button;
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
   */
  private buildSwatchSection(
    label: string,
    swatches: readonly Swatch[],
    initial: number,
    onPick: (colour: number) => void,
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
      button.dataset.selected = swatch.colour === initial ? 'true' : 'false';
      button.setAttribute('aria-pressed', swatch.colour === initial ? 'true' : 'false');
      button.setAttribute('aria-label', swatch.label);
      button.title = swatch.label;
      button.addEventListener('click', () => {
        current = swatch.colour;
        onPick(swatch.colour);
        selectCurated(button);
      });
      buttons.push(button);
      row.append(button);
    }

    const picker = new ColourWheelPicker({
      onChange: (colour) => {
        current = colour;
        onPick(colour);
        for (const other of buttons) {
          other.dataset.selected = 'false';
          other.setAttribute('aria-pressed', 'false');
        }
        picker.setSelected(true);
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

  private buildCardSection(
    label: string,
    items: readonly ShopItem[],
    initialId: string,
    onPick: (item: ShopItem) => void,
    suggestedId?: string,
  ): HTMLElement {
    const section = document.createElement('div');
    section.className = 'charcreate-section';
    const labelEl = document.createElement('p');
    labelEl.className = 'charcreate-label';
    labelEl.textContent = label;
    const grid = document.createElement('div');
    grid.className = 'charcreate-grid';
    const buttons: HTMLButtonElement[] = [];
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
   */
  private buildHatSection(): HTMLElement {
    return this.buildCardSection('Starting hat', HAT_OPTIONS, this.hatId ?? DEFAULT_HAT_ID, (item) => {
      this.hatId = item.id;
      this.refreshPreview('head');
    });
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
   * across a whole creator session the way the save does — reopening the
   * creator at all (`ui/Hud.ts`'s "Look" pill) already resets every field on
   * this screen to its hardcoded default, hat included, and this does not
   * change that; see `HANDOFF-charcreate-owner.md`.
   */
  private applyHairStyle(style: HairStyle): void {
    const wasExclusive = HAT_EXCLUSIVE_HAIR_STYLES.has(this.hairStyle);
    this.hairStyle = style;
    this.refreshPreview('hair');

    const isExclusive = HAT_EXCLUSIVE_HAIR_STYLES.has(style);
    if (isExclusive === wasExclusive) return;
    this.hatTabButton.hidden = isExclusive;

    if (isExclusive) {
      this.hatIdBeforeExclusiveHair = this.hatId;
      this.hatId = null;
    } else {
      this.hatId = this.hatIdBeforeExclusiveHair ?? DEFAULT_HAT_ID;
      this.hatIdBeforeExclusiveHair = null;
      // Only the card grid's *content* needs rebuilding — which card shows
      // selected. The panel's own visibility is untouched here on purpose:
      // she is on the Hair tab making this change, the Hat tab cannot be the
      // active one (its button was hidden the whole time she could have
      // picked an exclusive style), and `selectTab` alone decides when a
      // panel is shown, the moment she actually taps its now-visible button.
      this.hatPanel.replaceChildren(this.buildHatSection());
    }
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
      eye: this.eyeColour,
      backpack: this.backpackKind,
      backpackColour: this.backpackColour,
      // `''` is the sentinel `characterCreationPreview.ts` already treats as
      // "no hat": `shopItem('')` misses the catalogue `Map` and returns
      // `null`, so the preview simply builds no hat asset — the same path a
      // typo'd id would take, not a special case added for this.
      hatId: this.hatId ?? '',
      petId: this.petId,
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
        eyeColour: this.eyeColour,
        backpackKind: this.backpackKind,
        backpackColour: this.backpackColour,
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

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
