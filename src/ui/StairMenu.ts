/**
 * The tap-stairs menu.
 *
 * The family's third note: *"Stairs are a ride, not a challenge: tapping stairs
 * opens a small menu — Climb or Descend. Choosing one auto-walks the character
 * up or down while the game speeds up so they arrive quickly. No precise stair
 * movement ever needed."*
 *
 * So this is deliberately tiny — two enormous buttons and a way out. It is plain
 * DOM in the same pill-and-cream language as the rest of the HUD, which means it
 * is crisp on a phone, costs nothing to draw, and a six-year-old can hit the
 * buttons with a thumb. Nothing in it knows what a deck is: it is handed a label
 * and two flags, and it reports back which way was chosen.
 */

export type StairDirection = 'up' | 'down';

export interface StairMenuHandlers {
  onChoose(direction: StairDirection): void;
  onClose(): void;
}

export interface StairMenuContent {
  /** e.g. "Floor 2". Shown so a child knows where they are setting off from. */
  readonly floorLabel: string;
  readonly canClimb: boolean;
  readonly canDescend: boolean;
  /** Where the stairs go up to, and down to. Used for the button subtitles. */
  readonly upLabel: string;
  readonly downLabel: string;
}

export class StairMenu {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly title: HTMLElement;
  private readonly climb: HTMLButtonElement;
  private readonly descend: HTMLButtonElement;

  private open = false;

  constructor(container: HTMLElement, private readonly handlers: StairMenuHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'stair-menu';
    this.root.dataset.open = 'false';
    // A tap on the dimmed area is a "no thanks", the same as the close button.
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.close();
    });

    this.card = document.createElement('div');
    this.card.className = 'stair-card';

    const head = document.createElement('div');
    head.className = 'stair-head';

    this.title = document.createElement('h2');
    this.title.className = 'stair-title';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'shop-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '✕';
    close.addEventListener('click', () => this.close());

    head.append(glyph('🪜'), this.title, close);

    this.climb = this.button('up', '⬆️', 'Climb');
    this.descend = this.button('down', '⬇️', 'Descend');

    const list = document.createElement('div');
    list.className = 'stair-list';
    list.append(this.climb, this.descend);

    const hint = document.createElement('p');
    hint.className = 'shop-hint';
    hint.textContent = 'Move about to stop and walk yourself.';

    this.card.append(head, list, hint);
    this.root.append(this.card);
    container.append(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(content: StairMenuContent): void {
    this.title.textContent = content.floorLabel;
    setEnabled(this.climb, content.canClimb, content.upLabel);
    setEnabled(this.descend, content.canDescend, content.downLabel);
    this.open = true;
    this.root.dataset.open = 'true';
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.dataset.open = 'false';
    this.handlers.onClose();
  }

  dispose(): void {
    this.root.remove();
  }

  // -------------------------------------------------------------- internals

  private button(direction: StairDirection, icon: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stair-btn';
    button.dataset.direction = direction;
    button.innerHTML =
      `<span class="stair-arrow">${icon}</span>` +
      `<span class="stair-btn-text"><b>${label}</b><small></small></span>`;
    button.addEventListener('click', () => {
      if (button.disabled) return;
      this.open = false;
      this.root.dataset.open = 'false';
      this.handlers.onChoose(direction);
    });
    return button;
  }
}

function glyph(text: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'stair-glyph';
  element.textContent = text;
  return element;
}

function setEnabled(button: HTMLButtonElement, enabled: boolean, subtitle: string): void {
  button.disabled = !enabled;
  button.dataset.available = enabled ? 'true' : 'false';
  const small = button.querySelector('small');
  if (small) small.textContent = subtitle;
}
