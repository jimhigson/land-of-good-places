import type { FrameContext, GameSystem } from '../core/types';
import type { Player } from '../entities/Player';
import { nearestReadableSign, type SignZone } from '../world/signs';
import { gameStore } from '../state';

/**
 * "Read" a sign: a HUD button when you're close enough and facing one, and an
 * instant full-screen overlay of its own painted face when you press it.
 *
 * This replaces the old tap-to-inspect camera swoop (see `ARCHITECTURE.md` /
 * git history for `SignInspector.ts` and `IsoCamera.beginInspect`), which
 * fired by accident on any stray tap near a sign and was jarring to watch —
 * two family complaints, 26 Jul 2026. Tapping a sign now does nothing special
 * at all; it is read exactly like a shop counter or the fountain, by walking
 * up, facing it, and pressing a button.
 *
 * Pausing follows the same "mirror {@link active} every frame" idiom as
 * `Shopping.syncPaused` — see that class's doc for why this is what makes a
 * dismiss path unable to forget to restore movement/hop/zoom (QA-PLAYBOOK.md's
 * standing close-path rule, seeded by the backpack input-freeze bug).
 */
export class SignReader implements GameSystem {
  readonly name = 'signReader';

  private readonly button: HTMLButtonElement;
  private readonly overlay: HTMLElement;
  private readonly face: HTMLElement;

  /** Every sign in the park, captured once — see `world/signs.ts`: nothing here moves. */
  private readonly zones: readonly SignZone[];

  private nearbySign: SignZone | null = null;
  private openSign: SignZone | null = null;
  private wasPausedByUs = false;

  constructor(
    container: HTMLElement,
    private readonly player: Player,
    zones: readonly SignZone[],
    /** True while something else already owns the screen (shop, backpack, book, welcome panel, a ride, a mini-game). */
    private readonly isBlocked: () => boolean,
  ) {
    this.zones = zones;

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'pill pill--read';
    this.button.dataset.show = 'false';
    this.button.setAttribute('aria-label', 'Read the sign');
    this.button.innerHTML = '<span class="emoji">📖</span><span>Read</span>';
    this.button.addEventListener('click', () => {
      this.button.blur();
      if (this.nearbySign) this.open(this.nearbySign);
    });
    container.append(this.button);

    this.overlay = document.createElement('div');
    this.overlay.className = 'sign-reader';
    this.overlay.dataset.open = 'false';

    const frame = document.createElement('div');
    frame.className = 'sign-reader-frame';

    this.face = document.createElement('div');
    this.face.className = 'sign-reader-face';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'shop-close sign-reader-close';
    close.setAttribute('aria-label', 'Stop reading');
    close.textContent = '✕';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      this.close();
    });

    const hint = document.createElement('p');
    hint.className = 'shop-hint';
    hint.textContent = 'Tap anywhere to close';

    frame.append(this.face, close, hint);
    this.overlay.append(frame);
    // Tapping ANYWHERE — the frame, the sign face, the dimmed edge — closes it
    // instantly. Unlike the shop panel, there is no "tap outside the card"
    // distinction: the whole point is that reading a sign is a single, cheap,
    // no-ceremony action to back out of.
    this.overlay.addEventListener('pointerdown', () => this.close());
    container.append(this.overlay);
  }

  /** True while the full-screen sign is up — the park stays paused for exactly this long. */
  get active(): boolean {
    return this.openSign !== null;
  }

  /**
   * The sign the "Read" button is currently offering, or null — what the
   * HIGHLIGHT RULE outlines in rainbow while Read is primed. Same reasoning as
   * `ActionButton.zone`: one pick, read by both the pill and the outline, so
   * they cannot point at different signs.
   */
  get nearby(): SignZone | null {
    return this.nearbySign;
  }

  update(context: FrameContext): void {
    this.syncPaused();

    if (this.active) {
      // Any of the ordinary "back out" actions closes it, same vocabulary as
      // every other overlay in the game (see `Game.tick`).
      if (
        context.input.justPressed('interact') ||
        context.input.justPressed('menu') ||
        context.input.justPressed('cancel')
      ) {
        this.close();
      }
      return;
    }

    if (this.isBlocked()) {
      this.setNearby(null);
      return;
    }

    const zone = nearestReadableSign(
      this.zones,
      this.player.position.x,
      this.player.position.z,
      this.player.group.rotation.y,
    );
    this.setNearby(zone);

    if (zone && context.input.justPressed('interact')) this.open(zone);
  }

  dispose(): void {
    this.button.remove();
    this.overlay.remove();
  }

  // -------------------------------------------------------------- internals

  private setNearby(zone: SignZone | null): void {
    if (zone === this.nearbySign) return;
    this.nearbySign = zone;
    this.button.dataset.show = zone ? 'true' : 'false';
  }

  private open(zone: SignZone): void {
    this.openSign = zone;
    this.setNearby(null);
    // The sign's own canvas, straight off its in-world texture — not a
    // redraw, so it reads exactly as it does on the board, just bigger. See
    // `world/signs.ts`'s `findSignCanvas` for where this comes from.
    this.face.replaceChildren(zone.canvas);
    this.overlay.dataset.open = 'true';
  }

  private close(): void {
    if (!this.active) return;
    this.openSign = null;
    this.overlay.dataset.open = 'false';
  }

  /**
   * Keeps the park's pause state a mirror of {@link active}, checked fresh
   * every frame — the same pattern `Shopping.syncPaused` and the old
   * `SignInspector.syncPaused` used, and for the same reason: whichever of the
   * dismiss paths (tap, Esc, the interact key, the ✕ button) closed the
   * overlay, this is the one place that notices and hands movement back.
   */
  private syncPaused(): void {
    if (this.active) {
      if (!gameStore.get().paused) {
        this.wasPausedByUs = true;
        gameStore.setPaused(true);
      }
      return;
    }
    if (this.wasPausedByUs) {
      this.wasPausedByUs = false;
      gameStore.setPaused(false);
    }
  }
}
