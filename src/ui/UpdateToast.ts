/**
 * The "new version ready" toast.
 *
 * A gentle pill, not a panel: a new deploy landing mid-session is not
 * exciting to a six-year-old the way a new ride is, so it never pauses the
 * park or grabs the keyboard the way `WhatsNew` or a shop does. It just sits
 * near the bottom of the screen until tapped away, one way or the other.
 *
 * Wired from `main.ts` to `virtual:pwa-register`'s `onNeedRefresh` — see the
 * doc comment there and in `vite.config.ts` for why the PWA plugin is set to
 * `registerType: 'prompt'` rather than `autoUpdate` now that something has to
 * ask first.
 */
export class UpdateToast {
  private readonly root: HTMLElement;
  private readonly refreshButton: HTMLButtonElement;

  private shown = false;
  private dismissed = false;
  private onRefresh: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'update-toast';
    this.root.dataset.show = 'false';

    const text = document.createElement('span');
    text.className = 'update-toast-text';
    text.innerHTML =
      '<span class="emoji">🎈</span><span>A new version of the park is ready!</span>';

    this.refreshButton = document.createElement('button');
    this.refreshButton.type = 'button';
    this.refreshButton.className = 'update-toast-btn';
    this.refreshButton.textContent = 'Refresh';
    this.refreshButton.addEventListener('click', () => {
      this.refreshButton.blur();
      this.refreshButton.disabled = true;
      this.refreshButton.textContent = 'Refreshing…';
      this.onRefresh?.();
    });

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'update-toast-dismiss';
    dismiss.setAttribute('aria-label', 'Not now');
    dismiss.textContent = '✕';
    dismiss.addEventListener('click', () => {
      dismiss.blur();
      this.hide();
    });

    this.root.append(text, this.refreshButton, dismiss);
    container.append(this.root);
  }

  /**
   * Shows the toast, wiring `onRefresh` to the button.
   *
   * A no-op after the first call in a session — whether that call showed the
   * toast or the player already dismissed it — so a flaky `onNeedRefresh`
   * firing twice can never nag.
   */
  show(onRefresh: () => void): void {
    if (this.shown || this.dismissed) return;
    this.shown = true;
    this.onRefresh = onRefresh;
    this.root.dataset.show = 'true';
  }

  dispose(): void {
    this.root.remove();
  }

  private hide(): void {
    this.dismissed = true;
    this.root.dataset.show = 'false';
  }
}
