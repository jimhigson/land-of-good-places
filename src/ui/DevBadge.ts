/**
 * A big red "DEV" watermark, fixed in the bottom-right corner of the screen.
 *
 * Exists so nobody — least of all a six-year-old on a tablet — mistakes a
 * `npm run dev` tab for the real, deployed game. Only ever created when
 * running under the Vite dev server (`import.meta.env.DEV`); a production
 * build never calls the constructor at all, so the badge cannot leak into
 * `npm run build` output by accident.
 *
 * Styled inline rather than in `style.css`, so this one small file is the
 * whole feature — nothing else needs to change to add or remove it.
 * `pointer-events: none` keeps it from ever stealing a tap meant for the
 * park underneath.
 */
export class DevBadge {
  /** Mounts the badge, but only in dev. Returns `null` in a production build. */
  static mountIfDev(container: HTMLElement): DevBadge | null {
    return import.meta.env.DEV ? new DevBadge(container) : null;
  }

  private readonly element: HTMLElement;

  private constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.textContent = 'DEV';
    this.element.setAttribute('aria-hidden', 'true');
    Object.assign(this.element.style, {
      position: 'fixed',
      right: 'calc(10px + env(safe-area-inset-right))',
      bottom: 'calc(10px + env(safe-area-inset-bottom))',
      fontFamily: "'Baloo 2', 'Nunito', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
      fontSize: 'clamp(28px, 6vw, 56px)',
      fontWeight: '900',
      letterSpacing: '2px',
      color: '#ff2d2d',
      textShadow:
        '0 0 6px rgba(255, 255, 255, 0.9), 0 0 14px rgba(255, 0, 0, 0.55), 0 3px 0 rgba(0, 0, 0, 0.25)',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '99999',
    } satisfies Partial<CSSStyleDeclaration>);
    container.append(this.element);
  }

  dispose(): void {
    this.element.remove();
  }
}
