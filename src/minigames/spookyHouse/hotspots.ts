import type { Camera, Object3D } from 'three';
import { Vector3 } from 'three';

/**
 * Precise tap targets for a game that isn't one-button.
 *
 * The mini-game framework merges every input device into a single "hold"
 * (`types.ts` — "every stall game in this park is a one-button game"), because
 * that is all Rail Racer needs. The Spooky House needs three *different*
 * things a tap can land on — either eye, or the mouth — so it steps outside
 * that contract: each hotspot is a real DOM element placed over the 3D anchor
 * it represents, projected from world space to screen space every frame, with
 * its own `pointerdown` handler that calls `stopPropagation()` so the tap
 * lands here and *not* on the framework's whole-screen hold catcher too.
 *
 * These are children of `context.overlay` (the `.mg-content` div, which is
 * `pointer-events: none` by default) so nothing about them fights the
 * framework's own hold pad or quit button — see `minigames/overlay.ts`.
 */

export interface Hotspot {
  /** Re-projects the anchor to screen space. Call every frame. */
  update(): void;
  /**
   * Marks this hotspot as a live jump-scare reflex target (#293) or not.
   * Sets `data-jumpscare-active` on the underlying `<button>`, which
   * `style.css` puts in the same selector as `:hover`/`:focus-visible` for
   * the HIGHLIGHT RULE's rainbow ring — so a jump-scare target gets the
   * park's one existing "you can press this" language instead of a bespoke
   * effect, and it shows up with no hover needed, which matters on the
   * touch devices this game is mostly played on.
   */
  setActive(active: boolean): void;
  dispose(): void;
}

/**
 * Adds one invisible, tappable circle tracking `anchor`'s projected screen
 * position. `sizeVmin` is the hit target's diameter as a fraction of the
 * smaller viewport dimension, so it stays a sensible size on a phone and on a
 * monitor alike.
 */
export function createHotspot(
  container: HTMLElement,
  camera: Camera,
  anchor: Object3D,
  sizeVmin: number,
  onTap: () => void,
): Hotspot {
  const el = document.createElement('button');
  el.type = 'button';
  el.setAttribute('aria-label', 'Tap');
  el.style.position = 'absolute';
  el.style.width = `${sizeVmin}vmin`;
  el.style.height = `${sizeVmin}vmin`;
  el.style.transform = 'translate(-50%, -50%)';
  el.style.border = 'none';
  el.style.borderRadius = '50%';
  el.style.background = 'transparent';
  el.style.padding = '0';
  el.style.pointerEvents = 'auto';
  el.style.touchAction = 'none';
  el.style.setProperty('-webkit-tap-highlight-color', 'transparent');
  el.style.cursor = 'pointer';
  // A soft flash on press — just enough feedback that a tap "landed" without
  // drawing a permanent target reticle over the face.
  el.style.transition = 'background 90ms ease, transform 90ms ease';
  container.append(el);

  let flashTimer: ReturnType<typeof window.setTimeout> | null = null;
  const flash = (): void => {
    el.style.background = 'radial-gradient(circle, rgba(255,255,255,0.32) 0%, transparent 70%)';
    el.style.transform = 'translate(-50%, -50%) scale(0.92)';
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      el.style.background = 'transparent';
      el.style.transform = 'translate(-50%, -50%)';
      flashTimer = null;
    }, 130);
  };

  const onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    flash();
    onTap();
  };
  el.addEventListener('pointerdown', onPointerDown);

  const projected = new Vector3();

  return {
    update(): void {
      anchor.getWorldPosition(projected);
      projected.project(camera);
      el.style.left = `${(projected.x * 0.5 + 0.5) * 100}%`;
      el.style.top = `${(1 - (projected.y * 0.5 + 0.5)) * 100}%`;
      // Hides it if it ever ends up behind the camera — shouldn't happen in
      // this static scene, but cheap insurance against a stray tap target.
      el.style.display = projected.z > 1 ? 'none' : '';
    },
    setActive(active: boolean): void {
      if (active) el.setAttribute('data-jumpscare-active', 'true');
      else el.removeAttribute('data-jumpscare-active');
    },
    dispose(): void {
      if (flashTimer !== null) window.clearTimeout(flashTimer);
      el.removeEventListener('pointerdown', onPointerDown);
      el.remove();
    },
  };
}
