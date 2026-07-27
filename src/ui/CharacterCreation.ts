import { hexToCss, PALETTE } from '../core/palette';
import { ART } from '../art/style/artPalette';
import { PLAYER_DEFAULT_NAME } from '../core/constants';
import { itemsForShop, shopItem, type ShopItem } from '../world/building/shops/catalogue';
import type { CharacterCreationChoice, HairStyle } from '../state';
import { CharacterPreview } from './characterCreationPreview';

/**
 * The character creator: name, hair colour and style, clothes colour, a
 * starting hat and a starting pet — the front door of the game, per
 * GAME_DESIGN.md's "The player" section and design-feedback item 27.
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
 */
export interface CharacterCreationHandlers {
  onComplete(choice: CharacterCreationChoice): void;
}

interface Swatch {
  readonly colour: number;
  readonly label: string;
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

const HAIR_STYLES: readonly { value: HairStyle; label: string; glyph: string }[] = [
  { value: 'bunches', label: 'Bunches', glyph: '🎀' },
  { value: 'bob', label: 'Bob', glyph: '💇' },
  { value: 'short', label: 'Short', glyph: '✂️' },
];

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

export class CharacterCreation {
  private readonly root: HTMLElement;
  private readonly preview: CharacterPreview;
  private readonly previewWrap: HTMLElement;
  private readonly nameInput: HTMLInputElement;

  private readonly handlers: CharacterCreationHandlers;
  private readonly resizeObserver: ResizeObserver;

  private hairColour: number = PALETTE.hair;
  private hairStyle: HairStyle = 'bunches';
  private outfitColour: number = PALETTE.outfit;
  private hatId = DEFAULT_HAT_ID;
  private petId = DEFAULT_PET_ID;

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

    // --- header --------------------------------------------------------
    const head = document.createElement('div');
    head.className = 'shop-head';
    const glyph = document.createElement('span');
    glyph.className = 'shop-glyph';
    glyph.textContent = '🧒';
    const titles = document.createElement('div');
    titles.className = 'shop-titles';
    const title = document.createElement('h2');
    title.className = 'shop-title';
    title.textContent = 'Make your character!';
    const greeting = document.createElement('p');
    greeting.className = 'shop-greeting';
    greeting.textContent = 'Pick how you look, then let’s go to the park!';
    titles.append(title, greeting);
    head.append(glyph, titles);

    // --- body: preview + controls --------------------------------------
    const body = document.createElement('div');
    body.className = 'charcreate-body';

    this.previewWrap = document.createElement('div');
    this.previewWrap.className = 'charcreate-preview';
    this.preview = new CharacterPreview();
    this.previewWrap.append(this.preview.canvas);

    const namePreview = document.createElement('div');
    namePreview.className = 'charcreate-name-preview';
    namePreview.textContent = PLAYER_DEFAULT_NAME;
    this.previewWrap.append(namePreview);

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
    this.nameInput.addEventListener('input', () => {
      namePreview.textContent = this.nameInput.value.trim() || PLAYER_DEFAULT_NAME;
    });
    nameSection.append(nameLabel, this.nameInput);

    // Hair colour ------------------------------------------------------------
    const hairColourSection = this.buildSwatchSection(
      'Hair colour',
      HAIR_SWATCHES,
      this.hairColour,
      (colour) => {
        this.hairColour = colour;
        this.refreshPreview();
      },
    );

    // Hair style ---------------------------------------------------------
    const hairStyleSection = document.createElement('div');
    hairStyleSection.className = 'charcreate-section';
    const hairStyleLabel = document.createElement('p');
    hairStyleLabel.className = 'charcreate-label';
    hairStyleLabel.textContent = 'Hair style';
    const hairStyleRow = document.createElement('div');
    hairStyleRow.className = 'charcreate-styles';
    const styleButtons: HTMLButtonElement[] = [];
    for (const style of HAIR_STYLES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'charcreate-style-btn';
      button.dataset.selected = style.value === this.hairStyle ? 'true' : 'false';
      button.setAttribute('aria-pressed', style.value === this.hairStyle ? 'true' : 'false');
      button.innerHTML = `<span class="charcreate-style-glyph">${style.glyph}</span><span>${style.label}</span>`;
      button.addEventListener('click', () => {
        this.hairStyle = style.value;
        for (const other of styleButtons) {
          const selected = other === button;
          other.dataset.selected = selected ? 'true' : 'false';
          other.setAttribute('aria-pressed', selected ? 'true' : 'false');
        }
        this.refreshPreview();
      });
      styleButtons.push(button);
      hairStyleRow.append(button);
    }
    hairStyleSection.append(hairStyleLabel, hairStyleRow);

    // Clothes colour ---------------------------------------------------------
    const outfitSection = this.buildSwatchSection(
      'Clothes colour',
      OUTFIT_SWATCHES,
      this.outfitColour,
      (colour) => {
        this.outfitColour = colour;
        this.refreshPreview();
      },
    );

    // Starting hat ------------------------------------------------------
    const hatSection = this.buildCardSection('Starting hat', HAT_OPTIONS, this.hatId, (item) => {
      this.hatId = item.id;
      this.refreshPreview();
    });

    // Starting pet ------------------------------------------------------
    const petSection = this.buildCardSection(
      'Starting pet',
      PET_OPTIONS,
      this.petId,
      (item) => {
        this.petId = item.id;
        this.refreshPreview();
      },
      'toy.ripika',
    );

    controls.append(
      nameSection,
      hairColourSection,
      hairStyleSection,
      outfitSection,
      hatSection,
      petSection,
    );
    body.append(this.previewWrap, controls);

    // --- footer ----------------------------------------------------------
    const footer = document.createElement('div');
    footer.className = 'shop-foot';
    const goButton = document.createElement('button');
    goButton.type = 'submit';
    goButton.className = 'shop-buy charcreate-go';
    goButton.innerHTML = '<span class="emoji">🚌</span><span>Let’s go!</span>';
    footer.append(goButton);

    form.append(head, body, footer);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.complete();
    });
    this.root.append(form);
    container.append(this.root);

    // A resize on the preview's own box (phone rotation, layout reflow at the
    // 700px breakpoint) keeps the aspect ratio honest — a fixed CSS size
    // alone would letterbox or crop as the box changes shape.
    this.resizeObserver = new ResizeObserver(() => {
      this.preview.resize(this.previewWrap.clientWidth, this.previewWrap.clientHeight * 0.82);
    });
    this.resizeObserver.observe(this.previewWrap);

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
        onPick(swatch.colour);
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

  private refreshPreview(): void {
    this.preview.update({
      skin: PALETTE.skin,
      hair: this.hairColour,
      hairStyle: this.hairStyle,
      outfit: this.outfitColour,
      hatId: this.hatId,
      petId: this.petId,
    });
  }

  private complete(): void {
    if (this.closed) return;
    this.closed = true;

    const hat = shopItem(this.hatId) ?? HAT_OPTIONS[0];
    const pet = shopItem(this.petId) ?? PET_OPTIONS[0];
    // Both option lists are built from the live catalogue and always have at
    // least one entry in this game's shop line-up, but a fully-typed fallback
    // keeps this from ever throwing if that ever changed.
    if (hat && pet) {
      const choice: CharacterCreationChoice = {
        name: this.nameInput.value,
        hairColour: this.hairColour,
        hairStyle: this.hairStyle,
        outfitColour: this.outfitColour,
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
