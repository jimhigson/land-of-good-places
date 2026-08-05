import { PLAYER_DEFAULT_NAME } from '../core/constants';
import type { SaveFile } from '../state/save';

/**
 * "Do you want to keep playing, or start again?"
 *
 * The very first thing on screen when there is a save to come back to, ahead
 * of the character creator in `main.ts`'s `boot()` — before `Game` exists at
 * all, for the same reason the creator runs there: `Player`'s constructor
 * reads the character off the store the moment it builds the kid, so the
 * store has to be hydrated (or not) before that happens, and there is no path
 * that rebuilds a live player model afterwards.
 *
 * ## Designing a destructive choice for a six-year-old
 *
 * This screen is the only place in the game where a wrong tap loses something
 * that cannot be got back, so it is built the way GAME_DESIGN's tone asks for
 * and then deliberately made lopsided:
 *
 * - **The safe answer is the big one.** "Keep playing!" is a full-width
 *   `.shop-buy` at the bottom of the card, where every other panel in the
 *   game puts its "yes" button. Muscle memory lands on the safe thing.
 * - **The card says what continuing keeps**, in pictures as much as words:
 *   her name, the hat she is wearing, how many cute things she has found and
 *   what day it is. A child who cannot read fluently can still recognise her
 *   own character.
 * - **Starting again is small, low-contrast, and two taps away.** It is a
 *   quiet text button under the big one, and pressing it does not start
 *   anything — it swaps the card for a confirmation whose *own* big safe
 *   button is "No, keep my game". Both taps put the safe answer under the
 *   thumb and the destructive one somewhere else, so there is no double-tap
 *   through the pair.
 * - **The words are plain.** "Start again" and "keep", not "new game" and
 *   "load". The confirmation names what is lost using her character's name.
 *
 * A plain uncontrolled set of real `<button>`s, like `CharacterCreation`: Tab
 * and Enter work for free, and there is no `InputSystem` running yet to fight
 * over the keyboard with.
 */
export interface ContinueOrRestartHandlers {
  /** Keep the save: hydrate the store and open the park. */
  onContinue(): void;
  /** Throw the save away and run character creation afresh. */
  onStartAgain(): void;
}

export class ContinueOrRestart {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly handlers: ContinueOrRestartHandlers;
  private readonly save: SaveFile;
  private closed = false;
  private closeTimer = 0;

  constructor(container: HTMLElement, save: SaveFile, handlers: ContinueOrRestartHandlers) {
    this.save = save;
    this.handlers = handlers;

    this.root = document.createElement('div');
    this.root.className = 'shop-panel welcome-back';
    this.root.dataset.open = 'true';

    this.card = document.createElement('div');
    this.card.className = 'shop-card welcome-card';
    this.root.append(this.card);
    container.append(this.root);

    this.showChoice();
  }

  // ------------------------------------------------------------ the choice

  private showChoice(): void {
    const name = escapeHtml(this.playerName());
    this.card.innerHTML =
      '<div class="shop-head">' +
      '<span class="shop-glyph">🌈</span>' +
      '<div class="shop-titles">' +
      `<h2 class="shop-title">Welcome back, ${name}!</h2>` +
      '</div>' +
      '</div>' +
      `<div class="welcome-facts">${this.factsHtml()}</div>` +
      '<div class="shop-foot welcome-foot">' +
      '<button type="button" class="shop-buy welcome-keep">' +
      '<span class="emoji">▶️</span><span>Keep playing!</span>' +
      '</button>' +
      '<button type="button" class="welcome-restart">New game instead</button>' +
      '</div>';

    this.card.querySelector('.welcome-keep')?.addEventListener('click', () => this.keep());
    this.card
      .querySelector('.welcome-restart')
      ?.addEventListener('click', () => this.showConfirmation());
    this.focusFirst('.welcome-keep');
  }

  /**
   * What continuing keeps, as four little pictures.
   *
   * Read straight off the save rather than the store: the store is not
   * hydrated yet at this point and must not be, because pressing "start
   * again" has to leave a completely fresh one behind.
   */
  private factsHtml(): string {
    const game = this.save.game;
    const facts: { glyph: string; text: string }[] = [
      { glyph: '🙂', text: escapeHtml(this.playerName()) },
    ];

    const hat = game.inventory?.find((item) => item.uid === game.wornHatUid);
    if (hat) facts.push({ glyph: hat.icon, text: escapeHtml(hat.displayName) });

    const cuties = countCuties(this.save);
    if (cuties > 0) {
      facts.push({ glyph: '🎀', text: `${cuties} cute thing${cuties === 1 ? '' : 's'}` });
    }

    const day = (game.world?.dayCount ?? 0) + 1;
    facts.push({ glyph: '☀️', text: `Day ${day}` });

    return facts
      .map(
        (fact) =>
          '<div class="welcome-fact">' +
          `<span class="welcome-fact-glyph">${fact.glyph}</span>` +
          `<span class="welcome-fact-text">${fact.text}</span>` +
          '</div>',
      )
      .join('');
  }

  // ------------------------------------------------------ are you sure?

  private showConfirmation(): void {
    const name = escapeHtml(this.playerName());
    this.card.innerHTML =
      '<div class="shop-head welcome-head--warn">' +
      '<span class="shop-glyph">🤔</span>' +
      '<div class="shop-titles">' +
      '<h2 class="shop-title">Are you sure?</h2>' +
      `<p class="shop-greeting">Starting again says goodbye to ${name}.</p>` +
      '</div>' +
      '</div>' +
      '<div class="welcome-warning">' +
      `<p>A new game makes a brand new character. ${name}, ` +
      'everything in the backpack and the whole Cute-o-dex will be gone, and ' +
      'you cannot get them back.</p>' +
      '</div>' +
      '<div class="shop-foot welcome-foot">' +
      '<button type="button" class="shop-buy welcome-keep">' +
      '<span class="emoji">💖</span><span>No, keep my game!</span>' +
      '</button>' +
      '<button type="button" class="welcome-restart welcome-restart--confirm">' +
      'Yes, start a new game' +
      '</button>' +
      '</div>';

    this.card.querySelector('.welcome-keep')?.addEventListener('click', () => this.keep());
    this.card.querySelector('.welcome-restart')?.addEventListener('click', () => this.startAgain());
    // The safe button takes focus here too, so Enter on the confirmation
    // screen means "no" — the opposite of the usual dialog default, and
    // deliberately so.
    this.focusFirst('.welcome-keep');
  }

  // ------------------------------------------------------------- answering

  private keep(): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onContinue();
    this.fadeOut();
  }

  private startAgain(): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onStartAgain();
    this.fadeOut();
  }

  /** The `.shop-panel` fade, so this closes like every other overlay. */
  private fadeOut(): void {
    this.root.dataset.open = 'false';
    this.closeTimer = window.setTimeout(() => this.dispose(), 220);
  }

  dispose(): void {
    window.clearTimeout(this.closeTimer);
    this.root.remove();
  }

  // ------------------------------------------------------------- internal

  private playerName(): string {
    const name = this.save.game.player?.name?.trim();
    return name && name.length > 0 ? name : PLAYER_DEFAULT_NAME;
  }

  private focusFirst(selector: string): void {
    const button = this.card.querySelector(selector);
    if (button instanceof HTMLElement) button.focus();
  }
}

/** How many cute things the Cute-o-dex has actually found, counting copies. */
function countCuties(save: SaveFile): number {
  const collection = save.game.collection;
  if (!collection) return 0;
  let total = 0;
  for (const entry of Object.values(collection)) {
    if (entry.discovered) total += entry.count;
  }
  return total;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
